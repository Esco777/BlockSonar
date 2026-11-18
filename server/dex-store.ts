import { Pool, type PoolClient } from 'pg'
import { readFile } from 'node:fs/promises'
import type { DexCoverage, DexSwap } from '../src/lib/dex-intell.js'

export type SwapFilters = { chain?: string; token?: string; pool?: string; wallet?: string; dex?: string; from?: string; to?: string; minUsd?: string; offset: number; limit: number }
export class DexStore {
  readonly db: Pool
  constructor(connectionString: string) { this.db = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); this.db.on('error', () => console.error(JSON.stringify({ service: 'dex', event: 'database_connection_error' }))) }
  async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.db.connect()
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result }
    catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  async migrate() {
    // Resolve from compiled server/dist/server to tracked source migrations.
    await this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(8453001)')
      await client.query('CREATE TABLE IF NOT EXISTS dex_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      for (const [version, file] of [[1, '001-dex-intell.sql'], [2, '002-ethereum-dex.sql'], [3, '003-bnb-dex.sql'], [4, '004-solana-dex.sql']] as const) {
        const existing = await client.query('SELECT version FROM dex_schema_migrations WHERE version=$1', [version])
        if (!existing.rowCount) {
          const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
          await client.query(sql)
          await client.query('INSERT INTO dex_schema_migrations(version) VALUES($1)', [version])
        }
      }
    })
  }
  async coverage(): Promise<DexCoverage[]> {
    return (await this.db.query('SELECT * FROM data_coverage ORDER BY chain,pool')).rows
  }
  async swaps(filters: SwapFilters): Promise<DexSwap[]> {
    const values: unknown[] = [], conditions: string[] = []
    const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replaceAll('?', `$${values.length}`)) }
    if (filters.chain) add('chain=?', filters.chain)
    if (filters.token) add('(token_in=? OR token_out=?)', filters.token)
    if (filters.pool) add('pool=?', filters.pool)
    if (filters.wallet) add('wallet=?', filters.wallet)
    if (filters.dex) add('protocol=?', filters.dex)
    if (filters.from) add('at>=?::timestamptz', filters.from)
    if (filters.to) add('at<=?::timestamptz', filters.to)
    if (filters.minUsd) add('usd_value>=?::numeric', filters.minUsd)
    values.push(filters.limit + 1, filters.offset)
    const result = await this.db.query(`SELECT chain,protocol,tx_hash,log_index,block_number,at,pool,token_in,token_out,amount_in,amount_out,wallet,usd_value,finality FROM dex_swaps ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY at DESC,chain,block_number DESC,log_index DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
    return result.rows
  }
  async close() { await this.db.end() }
}
