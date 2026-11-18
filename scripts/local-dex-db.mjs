import 'dotenv/config'
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep credentials, initdb password files, and database logs private.
process.umask(0o077)
const root = fileURLToPath(new URL('../', import.meta.url))
const data = `${root}data/postgres`
const envFile = `${root}.env`
const logFile = `${root}data/postgres.log`
mkdirSync(`${root}data`, { recursive: true })
let connectionString = process.env.DEX_DATABASE_URL
if (!connectionString) {
  if (existsSync(`${data}/PG_VERSION`)) throw new Error('Existing local cluster needs its original DEX_DATABASE_URL; refusing to replace credentials.')
  connectionString = `postgresql://blocksonar:${randomBytes(32).toString('hex')}@127.0.0.1:5433/blocksonar`
  let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  const line = `DEX_DATABASE_URL=${JSON.stringify(connectionString)}`
  text = /^DEX_DATABASE_URL=.*$/m.test(text) ? text.replace(/^DEX_DATABASE_URL=.*$/m, () => line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  writeFileSync(envFile, text, { mode: 0o600 }); chmodSync(envFile, 0o600)
}
const url = new URL(connectionString)
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.username !== 'blocksonar' || url.pathname !== '/blocksonar') {
  throw new Error('DEX_DATABASE_URL points to another database. This helper manages only the project-local database on 127.0.0.1:5433.')
}
const adminOptions = { host: '127.0.0.1', port: 5433, user: 'blocksonar', password: decodeURIComponent(url.password), database: 'postgres', connectionTimeoutMillis: 3000 }
async function ensureDatabase() {
  const client = new Client(adminOptions)
  try {
    await client.connect()
    if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='blocksonar'")).rowCount) await client.query('CREATE DATABASE blocksonar')
  } finally { await client.end() }
}
try {
  await ensureDatabase()
  console.log('Project PostgreSQL is already running on 127.0.0.1:5433. Data is preserved.')
} catch (error) {
  if (error.code !== 'ECONNREFUSED') throw new Error('Existing local PostgreSQL could not be authenticated; check the saved database credentials.')
  const database = new EmbeddedPostgres({ databaseDir: data, user: 'blocksonar', password: adminOptions.password,
    port: 5433, authMethod: 'scram-sha-256', persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: message => appendFileSync(logFile, String(message), { mode: 0o600 }),
    onError: () => console.error('Local PostgreSQL reported a connection error; see data/postgres.log.'),
  })
  try {
    if (!existsSync(`${data}/PG_VERSION`)) { console.log('Initializing persistent project PostgreSQL…'); await database.initialise() }
    await database.start()
    await ensureDatabase()
    console.log('PostgreSQL ready on 127.0.0.1:5433. Credentials saved privately in .env.')
    console.log('Keep this terminal running. In another terminal: npm run start:server')
    console.log('Stopping this process shuts down PostgreSQL cleanly and keeps all stored swaps.')
  } catch {
    await database.stop()
    console.error('Local database startup failed. Check data/postgres.log; existing data has been retained.')
    process.exitCode = 1
  }
}
