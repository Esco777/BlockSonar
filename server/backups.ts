import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import os from 'node:os'
import { Client } from 'pg'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

type Manifest = { version: 1; createdAt: string; tables: Record<string, string>; files: Array<{ name: string; sha256: string }> }
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
const hash = async (file: string) => { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex') }
export class Backups {
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<string>
  private lastError = false
  readonly directory: string
  constructor(private env = process.env) { this.directory = path.resolve(env.BLOCKSONAR_BACKUP_DIR || 'backups') }
  private connection(database?: string) {
    if (!this.env.DEX_DATABASE_URL) throw new Error('Configure DEX_DATABASE_URL')
    const url = new URL(this.env.DEX_DATABASE_URL)
    if (database) url.pathname = `/${database}`
    return url
  }
  private async binary(name: string) {
    for (const dir of [this.env.PG_BIN_DIR, path.resolve('.tools/postgresql/bin'), '/opt/homebrew/opt/libpq/bin', '/usr/local/opt/libpq/bin']) {
      if (!dir) continue
      const candidate = path.join(dir, name)
      try { await access(candidate, constants.X_OK); return candidate } catch { /* Try the next configured location. */ }
    }
    return name
  }
  private async command(name: string, args: string[], database?: string) {
    const url = this.connection(database)
    const env = { ...process.env, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=5000', PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}) }
    const binary = await this.binary(name)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, { env, timeout: 900000, killSignal: 'SIGTERM', stdio: ['ignore', 'ignore', 'ignore'] })
      child.on('error', () => reject(new Error('PostgreSQL client tools unavailable; configure PG_BIN_DIR')))
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${name} failed; verify client version and database access`)))
    })
  }
  async status() {
    const names = await readdir(this.directory).catch(() => [] as string[])
    for (const name of names.filter(n => /^backup-[0-9TZ-]+-[a-f0-9-]+$/.test(n)).sort().reverse()) {
      try {
        const manifest: Manifest = JSON.parse(await readFile(path.join(this.directory, name, 'manifest.json'), 'utf8'))
        return { enabled: !!this.env.DEX_DATABASE_URL && this.env.BLOCKSONAR_BACKUPS_DISABLED !== 'true', lastBackupAt: manifest.createdAt, lastAttemptFailed: this.lastError, localOnly: true }
      } catch { /* Ignore unfinished backups. */ }
    }
    return { enabled: !!this.env.DEX_DATABASE_URL && this.env.BLOCKSONAR_BACKUPS_DISABLED !== 'true', lastBackupAt: null, lastAttemptFailed: this.lastError, localOnly: true }
  }
  run() {
    if (!this.pending) this.pending = this.create().then(file => { this.lastError = false; return file }).catch(error => { this.lastError = true; throw error }).finally(() => { this.pending = undefined })
    return this.pending
  }
  private async create() {
    const connectionString = this.connection().toString()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const lock = path.join(this.directory, '.running')
    try { await mkdir(lock, { mode: 0o700 }) } catch {
      let stale = false
      try { const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8')); if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0) } catch (error) { stale = (error as NodeJS.ErrnoException).code === 'ESRCH' } } } catch { try { stale = Date.now() - (await stat(lock)).mtimeMs > 60000 } catch { /* Lock changed while checking. */ } }
      if (!stale) throw new Error('Another backup is running; retry later')
      await rm(lock, { recursive: true }); await mkdir(lock, { mode: 0o700 })
    }
    await writeFile(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 })
    const id = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`, staging = path.join(this.directory, `.${id}`), final = path.join(this.directory, id)
    const db = new Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 60000 })
    try {
      await mkdir(staging, { mode: 0o700 }); await db.connect()
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const snapshot = (await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id
      const names = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
      const tables: Record<string, string> = {}
      for (const row of names) tables[row.tablename] = (await db.query(`SELECT count(*)::text AS count FROM public.${quote(row.tablename)}`)).rows[0].count
      await this.command('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, `--file=${path.join(staging, 'database.dump')}`])
      await db.query('COMMIT')
      await pipeline(createReadStream(path.join(staging, 'database.dump')), createGzip(), createWriteStream(path.join(staging, 'database.dump.gz'), { mode: 0o600 }))
      await rm(path.join(staging, 'database.dump'))
      const files = ['database.dump.gz']
      const stateFiles = { 'narratives.json': this.env.NARRATIVE_DATA_FILE || 'data/early-narrative.json', 'intelligence.json': this.env.INTELLIGENCE_STORE_PATH || 'data/intelligence.json', 'ethereum-wallets.json': this.env.ETHEREUM_WALLET_STORE_PATH || 'data/ethereum-wallets.json', 'holder-observations.json': this.env.HOLDER_OBSERVATIONS_PATH || 'data/holder-observations.json' }
      for (const [name, source] of Object.entries(stateFiles)) {
        let text: string
        try { text = await readFile(source, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        JSON.parse(text)
        await writeFile(path.join(staging, name), text, { mode: 0o600 }); files.push(name)
      }
      const manifest: Manifest = { version: 1, createdAt: new Date().toISOString(), tables, files: await Promise.all(files.map(async name => ({ name, sha256: await hash(path.join(staging, name)) }))) }
      await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
      await rename(staging, final)
      const keep = Number(this.env.BLOCKSONAR_BACKUP_KEEP || 14)
      if (Number.isSafeInteger(keep) && keep >= 2) {
        const completed = (await readdir(this.directory)).filter(name => /^backup-[0-9TZ-]+-[a-f0-9-]+$/.test(name)).sort().reverse()
        for (const name of completed.slice(keep)) {
          try { const old = JSON.parse(await readFile(path.join(this.directory, name, 'manifest.json'), 'utf8')); if (old.version === 1) await rm(path.join(this.directory, name), { recursive: true }) } catch { /* Keep unrecognized backups. */ }
        }
      }
      return final
    } finally { await db.end().catch(() => {}); await rm(staging, { recursive: true, force: true }); await rm(lock, { recursive: true, force: true }) }
  }
  async verify(backup: string) {
    const directory = path.resolve(backup), manifest: Manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.tables || !manifest.files.some(file => ['database.dump', 'database.dump.gz'].includes(file.name))) throw new Error('Invalid backup manifest')
    for (const file of manifest.files) {
      if (!['database.dump', 'database.dump.gz', 'narratives.json', 'intelligence.json', 'ethereum-wallets.json', 'holder-observations.json'].includes(file.name) || await hash(path.join(directory, file.name)) !== file.sha256) throw new Error('Backup checksum mismatch')
      if (file.name.endsWith('.json')) JSON.parse(await readFile(path.join(directory, file.name), 'utf8'))
    }
    const restoreDirectory = path.join(os.tmpdir(), `blocksonar-restore-${randomUUID()}`)
    const databaseFile = manifest.files.find(file => ['database.dump', 'database.dump.gz'].includes(file.name))!.name
    const database = `blocksonar_restore_${randomUUID().replaceAll('-', '')}`
    const admin = new Client({ connectionString: this.connection('postgres').toString(), connectionTimeoutMillis: 5000 })
    let created = false
    try {
      await mkdir(restoreDirectory, { mode: 0o700 })
      const dump = path.join(restoreDirectory, 'database.dump')
      if (databaseFile.endsWith('.gz')) await pipeline(createReadStream(path.join(directory, databaseFile)), createGunzip(), createWriteStream(dump, { mode: 0o600 }))
      await admin.connect(); await admin.query(`CREATE DATABASE ${quote(database)}`); created = true
      await this.command('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', `--dbname=${database}`, databaseFile.endsWith('.gz') ? dump : path.join(directory, databaseFile)], database)
      const restored = new Client({ connectionString: this.connection(database).toString(), connectionTimeoutMillis: 5000 })
      try {
        await restored.connect()
        for (const [name, expected] of Object.entries(manifest.tables)) {
          const count = (await restored.query(`SELECT count(*)::text AS count FROM public.${quote(name)}`)).rows[0].count
          if (count !== expected) throw new Error('Restored row count differs from backup snapshot')
        }
      } finally { await restored.end() }
      const report = { verifiedAt: new Date().toISOString(), tables: Object.keys(manifest.tables).length, files: manifest.files.length }
      await writeFile(path.join(directory, 'restore-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
      return report
    } finally { if (created) await admin.query(`DROP DATABASE ${quote(database)}`).catch(() => {}); await admin.end(); await rm(restoreDirectory, { recursive: true, force: true }) }
  }
  start() {
    if (this.env.BLOCKSONAR_BACKUPS_DISABLED === 'true' || !this.env.DEX_DATABASE_URL) return
    const interval = Number(this.env.BLOCKSONAR_BACKUP_INTERVAL_MS || 21600000)
    if (!Number.isSafeInteger(interval) || interval < 60000) throw new Error('Backup interval must be at least one minute')
    const check = async () => {
      try { const status = await this.status(); if (!status.lastBackupAt || Date.now() - Date.parse(status.lastBackupAt) >= interval) await this.run() }
      catch { console.error(JSON.stringify({ service: 'backups', event: 'backup_failed', message: 'Check PostgreSQL client tools and backup directory access' })) }
    }
    void check(); this.timer = setInterval(() => void check(), Math.min(interval, 60000)); this.timer.unref()
  }
  async stop() { if (this.timer) clearInterval(this.timer); await this.pending?.catch(() => {}) }
}
