import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { DexStore } from './dist/server/dex-store.js'
import { DexWorker, dexConfig } from './dist/server/dex-worker.js'
import { decodeSwap, poolAbi, DexRpc } from './dist/server/dex-rpc.js'
import { parseDexFilters, DexApi } from './dist/server/dex-api.js'

const pool = `0x${'11'.repeat(20)}`, token0 = `0x${'22'.repeat(20)}`, token1 = `0x${'33'.repeat(20)}`
const hash = `0x${'aa'.repeat(32)}`, tx = `0x${'bb'.repeat(32)}`
function event(a = 123456789012345678901234567890n, b = -42000000n) {
  const encoded = poolAbi.encodeEventLog(poolAbi.getEvent('Swap'), [pool, pool, a, b, 1n, 1n, 0])
  return { ...encoded, address: pool, blockNumber: '0xa', blockHash: hash, transactionHash: tx, logIndex: '0x2' }
}
test('V3 decoder preserves raw precision and does not attribute router sender', () => {
  const decoded = decodeSwap(event(), token0, token1)
  assert.equal(decoded.amountIn, '123456789012345678901234567890')
  assert.equal(decoded.amountOut, '42000000')
  assert.equal(decoded.tokenIn, token0)
  assert.equal(decoded.wallet, null)
  const reverse = decodeSwap(event(-45n, 20n), token0, token1)
  assert.equal(reverse.tokenIn, token1); assert.equal(reverse.amountOut, '45')
})
test('decoder retains ambiguous amounts as unclassified and rejects non-swap and removed events', () => {
  assert.equal(decodeSwap(event(1n, 2n), token0, token1), null)
  for (const amounts of [[0n, -1n], [1n, 0n], [0n, 0n]]) assert.equal(decodeSwap(event(...amounts), token0, token1), null)
  assert.throws(() => decodeSwap({ ...event(), removed: true }, token0, token1))
  assert.throws(() => decodeSwap({ ...event(), topics: [] }, token0, token1))
})
test('configuration requires a deliberate start block and bounded workloads', () => {
  assert.equal(dexConfig({}), null)
  assert.throws(() => dexConfig({ DEX_BASE_RPC_URL: 'https://rpc.invalid' }))
  const env = { DEX_BASE_RPC_URL: 'https://rpc.invalid', DEX_BASE_POOLS: pool, DEX_BASE_START_BLOCK: '10' }
  assert.equal(dexConfig(env).start, 10n)
  assert.throws(() => dexConfig({ ...env, DEX_BATCH_BLOCKS: '0' }))
  assert.throws(() => dexConfig({ ...env, DEX_POLL_MS: 'NaN' }))
})
test('Alchemy key configures Base RPC server-side and explicit provider URLs take precedence', () => {
  const env = { ALCHEMY_API_KEY: 'test-key', DEX_BASE_POOLS: pool, DEX_BASE_START_BLOCK: '10' }
  assert.equal(dexConfig(env).rpc, 'https://base-mainnet.g.alchemy.com/v2/test-key')
  assert.equal(dexConfig(env).batch, 10n)
  assert.equal(dexConfig({ ...env, DEX_BASE_RPC_URL: 'https://operator.invalid' }).batch, 100n)
  assert.equal(dexConfig({ ...env, DEX_BASE_RPC_URL: 'https://operator.invalid' }).rpc, 'https://operator.invalid')
  assert.equal(dexConfig({ ...env, DEX_BASE_RPC_URL: '  ' }).rpc, 'https://base-mainnet.g.alchemy.com/v2/test-key')
  assert.equal(dexConfig({ ALCHEMY_API_KEY: '  ' }), null)
  assert.equal(dexConfig({ ...env, ALCHEMY_API_KEY: 'a/b' }).rpc, 'https://base-mainnet.g.alchemy.com/v2/a%2Fb')
})
test('API filters validate pagination, addresses, date ranges and numeric size', () => {
  const parse = query => parseDexFilters(new URL(`http://localhost/api/dex/swaps/base?${query}`))
  assert.equal(parse('limit=20').chain, 'base')
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=10001', 'wallet=invalid', 'minUsd=NaN', 'from=nope', 'from=2026-12-01&to=2026-01-01', 'dex=hello%27']) assert.throws(() => parse(query), query)
  assert.equal(parse(`token=${token0}&minUsd=12.25`).minUsd, '12.25')
})
test('RPC errors do not leak provider credentials', async () => {
  const rpc = new DexRpc('https://secret.invalid/API_KEY', async () => new Response(JSON.stringify({ error: { message: 'secret provider error' } }), { status: 200 }))
  await assert.rejects(rpc.call('eth_getLogs', []), /^Error: DEX RPC eth_getLogs failed$/)
})
test('historical migrations, atomic batches, restart, deduplication, retries and finalized reorg replay', async () => {
  const db = new PGlite(), store = new DexStore('postgresql://unused')
  await store.db.end()
  // PGlite runs real PostgreSQL SQL; advisory locks are mocked because there is one test connection.
  const query = async (sql, values) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }], rowCount: 1 }
    const result = await db.query(sql, values)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  store.db = { query, connect: async () => ({ query, release() {} }), end: () => db.close() }
  try {
    // PGlite query accepts one statement; execute the real migration SQL via exec.
    const originalQuery = store.db.query
    const migrationQuery = async (sql, args) => sql.includes('INSERT INTO dex_protocols') ? db.exec(sql) : originalQuery(sql, args)
    store.db.connect = async () => ({ query: migrationQuery, release() {} })
    await store.migrate(); await store.migrate()
    assert.equal((await query('SELECT * FROM dex_schema_migrations')).rows.length, 4)
    let fail = false, changed = false, mismatch = false, empty = false, ambiguous = false
    const rpc = {
      call: async method => {
        if (method === 'eth_chainId') return '0x2105'
        if (fail) throw new Error('RPC down')
        if (empty) return []
        if (ambiguous) return [{ ...event(1n, 0n), blockNumber: '0xb' }]
        return [mismatch ? { ...event(), blockHash: tx } : event()]
      },
      verifyPool: async () => ({ token0, token1 }),
      block: async number => ({ hash: changed ? tx : hash, parentHash: hash, number: number === 'finalized' ? '0xb' : number, timestamp: '0x6553f100' }),
    }
    const config = { rpc: 'https://unused.invalid', pools: [pool], start: 10n, batch: 1n, interval: 1000 }
    const worker = new DexWorker(store, config, rpc)
    fail = true
    await assert.rejects(worker.batch(pool))
    assert.equal((await store.coverage()).length, 0, 'failed RPC must not claim coverage')
    fail = false; mismatch = true
    await assert.rejects(worker.batch(pool))
    assert.equal((await query('SELECT * FROM dex_swaps')).rows.length, 0, 'invalid batch rolls back')
    mismatch = false
    assert.equal(await worker.batch(pool), true, 'unfinished history requests another catch-up batch')
    let rows = await store.swaps({ chain: 'base', offset: 0, limit: 50 })
    assert.equal(rows.length, 1); assert.equal(rows[0].amount_in, '123456789012345678901234567890')
    assert.equal(String((await store.coverage())[0].end_block), '10')
    await query(`INSERT INTO dex_swaps SELECT * FROM dex_swaps ON CONFLICT DO NOTHING`)
    assert.equal((await query('SELECT * FROM dex_swaps')).rows.length, 1)
    assert.equal((await store.swaps({ token: token1, offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ minUsd: '1', offset: 0, limit: 50 })).length, 0)
    assert.equal((await store.swaps({ wallet: pool, offset: 0, limit: 50 })).length, 0)
    // A new worker resumes persisted block 10, then a failed block 11 leaves it intact.
    fail = true
    await assert.rejects(new DexWorker(store, config, rpc).batch(pool))
    assert.equal(String((await store.coverage())[0].end_block), '10')
    fail = false; changed = true
    await worker.batch(pool)
    assert.equal((await store.coverage()).length, 0)
    assert.equal((await query('SELECT * FROM dex_swaps')).rows.length, 0)
    assert.equal((await query('SELECT status FROM backfill_jobs')).rows[0].status, 'replaying')
    changed = false; await worker.batch(pool)
    assert.equal((await store.swaps({ offset: 0, limit: 50 })).length, 1)
    ambiguous = true
    assert.equal(await new DexWorker(store, config, rpc).batch(pool), false, 'caught-up indexing returns to normal polling')
    assert.equal((await query('SELECT * FROM dex_unclassified_swaps')).rows.length, 1, 'ambiguous V3 event is preserved without blocking progress')
    assert.equal(String((await store.coverage())[0].end_block), '11')
    assert.equal((await store.swaps({ offset: 0, limit: 50 })).length, 1, 'ambiguous event does not fabricate a trade')
    empty = true; ambiguous = false
    assert.equal(await new DexWorker(store, config, rpc).batch(pool), undefined, 'caught-up worker waits for a new finalized block')
    assert.equal(String((await store.coverage())[0].end_block), '11', 'restart resumes with the next contiguous range')
    assert.equal((await store.swaps({ offset: 0, limit: 50 })).length, 1, 'empty successful range does not fabricate swaps')
    await new DexWorker(store, config, rpc).batch(pool)
    assert.equal(String((await store.coverage())[0].end_block), '11', 'caught-up worker does not advance beyond finalized head')
  } finally { await store.close() }
})
function request(api, path, authorization) {
  return new Promise(resolve => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value }, writeHead(status) { this.status = status }, end(body) { resolve({ status: this.status, data: JSON.parse(body) }) } }
    api.handle({ headers: { authorization }, socket: { remoteAddress: '127.0.0.1' } }, res, new URL(path, 'http://localhost'))
  })
}
test('unconfigured API reports no fabricated history and production fails closed', async () => {
  const api = new DexApi({})
  const result = await request(api, '/api/dex/swaps')
  assert.equal(result.status, 200); assert.equal(result.data.configured, false); assert.deepEqual(result.data.swaps, [])
  assert.equal((await request(api, '/api/dex/swaps?limit=999')).status, 400)
  assert.equal((await request(new DexApi({ NODE_ENV: 'production' }), '/api/chains')).status, 503)
  const secured = new DexApi({ NODE_ENV: 'production', DEX_READ_TOKEN: 'test-secret' })
  assert.equal((await request(secured, '/api/chains')).status, 401)
  assert.equal((await request(secured, '/api/chains', 'Bearer test-secret')).status, 200)
})
test('DEX endpoints enforce per-client query rate limits', async () => {
  const api = new DexApi({})
  for (let i = 0; i < 90; i++) assert.equal((await request(api, '/api/chains')).status, 200)
  assert.equal((await request(api, '/api/chains')).status, 429)
})

test('DEX initialization recovers when PostgreSQL becomes available after startup', async t => {
  try { t.mock.timers.enable({ apis: ['setTimeout'] }) } catch (error) {
    if (error.code !== 'ERR_INVALID_ARG_TYPE') throw error
    t.mock.timers.enable(['setTimeout'])
  }
  let attempts = 0
  t.mock.method(DexStore.prototype, 'migrate', async () => {
    if (++attempts === 1) throw new Error('Database is starting')
  })
  t.mock.method(DexStore.prototype, 'coverage', async () => [])
  t.mock.method(DexStore.prototype, 'swaps', async () => [{ tx_hash: tx }])
  const api = new DexApi({ DEX_DATABASE_URL: 'postgresql://localhost/test' })
  try {
    api.start()
    assert.equal((await request(api, '/api/dex/swaps')).status, 503)
    t.mock.timers.tick(15000)
    const result = await request(api, '/api/dex/swaps')
    assert.equal(attempts, 2)
    assert.equal(result.status, 200)
    assert.equal(result.data.configured, true)
    assert.equal(result.data.swaps[0].tx_hash, tx)
    api.start()
    assert.equal(attempts, 2, 'starting twice does not duplicate workers')
  } finally { await api.stop() }
})

test('stopping DEX cancels pending database initialization retries', async t => {
  try { t.mock.timers.enable({ apis: ['setTimeout'] }) } catch (error) {
    if (error.code !== 'ERR_INVALID_ARG_TYPE') throw error
    t.mock.timers.enable(['setTimeout'])
  }
  let attempts = 0
  t.mock.method(DexStore.prototype, 'migrate', async () => {
    attempts++
    throw new Error('Database unavailable')
  })
  const api = new DexApi({ DEX_DATABASE_URL: 'postgresql://localhost/test' })
  api.start()
  assert.equal((await request(api, '/api/dex/swaps')).status, 503)
  await api.stop()
  t.mock.timers.tick(30000)
  assert.equal(attempts, 1)
})
