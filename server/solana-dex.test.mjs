import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeBase58 } from 'ethers'
import { PGlite } from '@electric-sql/pglite'
import { discriminator, decodeSolanaPool, decodeSolanaSwaps, validSolanaKey, ORCA_PROGRAM, RAYDIUM_CPMM_PROGRAM, SOLANA_MAINNET_GENESIS } from './dist/server/solana-dex.js'
import { SolanaDexWorker, solanaDexConfig } from './dist/server/solana-dex-worker.js'
import { DexStore } from './dist/server/dex-store.js'
const bytes = n => Buffer.alloc(32, n), key = n => encodeBase58(bytes(n)), signature = n => encodeBase58(Buffer.alloc(64, n))
const pool = { address: key(1), program: ORCA_PROGRAM, protocol: 'solana-orca-whirlpool', token0: key(2), token1: key(3) }
function event(direction = 1) {
  const b = Buffer.alloc(121); discriminator('event:Traded').copy(b); bytes(1).copy(b, 8); b[40] = direction
  b.writeBigUInt64LE(18446744073709551610n, 73); b.writeBigUInt64LE(42n, 81); return b.toString('base64')
}
const logs = (data = event(), program = ORCA_PROGRAM) => [`Program ${program} invoke [1]`, `Program data: ${data}`, `Program ${program} success`]
const tx = (data = logs()) => ({ meta: { err: null, logMessages: data } })
test('Solana config is opt-in, preserves case and rejects invalid keys/ranges', () => {
  assert.equal(solanaDexConfig({ ALCHEMY_API_KEY: 'fake' }), null)
  const env = { ALCHEMY_API_KEY: 'fake', DEX_SOLANA_POOLS: pool.address, DEX_SOLANA_START_SLOT: '10' }
  assert.equal(solanaDexConfig(env).rpc, 'https://solana-mainnet.g.alchemy.com/v2/fake')
  assert.equal(solanaDexConfig(env).pools[0], pool.address)
  assert.throws(() => solanaDexConfig({ ...env, DEX_SOLANA_POOLS: '0x1234' }))
  assert.throws(() => solanaDexConfig({ ...env, DEX_SOLANA_START_SLOT: '' }))
  assert.throws(() => solanaDexConfig({ ...env, DEX_SOLANA_PAGE_SIZE: '51' }))
  assert.equal(validSolanaKey(pool.address), true)
  assert.equal(validSolanaKey('1'.repeat(33)), false)
})
test('pool verification checks canonical program, account discriminator, layout and token mints', () => {
  for (const [program, name, length, a, b] of [[ORCA_PROGRAM, 'Whirlpool', 653, 101, 181], [RAYDIUM_CPMM_PROGRAM, 'PoolState', 637, 168, 200]]) {
    const data = Buffer.alloc(length); discriminator(`account:${name}`).copy(data); bytes(2).copy(data, a); bytes(3).copy(data, b)
    const account = { owner: program, executable: false, data: [data.toString('base64'), 'base64'] }
    assert.equal(decodeSolanaPool(pool.address, account).token0, key(2))
    assert.throws(() => decodeSolanaPool(pool.address, { ...account, owner: key(9) }))
    assert.throws(() => decodeSolanaPool(pool.address, { ...account, executable: true }))
    data[0] ^= 1
    assert.throws(() => decodeSolanaPool(pool.address, { ...account, data: [data.toString('base64'), 'base64'] }))
  }
})
test('Orca events decode both directions at u64 precision; sender is not assumed to be trader', () => {
  const swap = decodeSolanaSwaps(tx(), pool)[0]
  assert.equal(swap.amountIn, '18446744073709551610'); assert.equal(swap.amountOut, '42'); assert.equal(swap.wallet, null); assert.equal(swap.index, 1)
  assert.equal(decodeSolanaSwaps(tx(logs(event(0))), pool)[0].tokenIn, key(3))
})
test('Raydium CPMM events verify pool and mint identity and preserve execution amounts', () => {
  const cp = { ...pool, program: RAYDIUM_CPMM_PROGRAM, protocol: 'solana-raydium-cpmm' }
  const b = Buffer.alloc(170); discriminator('event:SwapEvent').copy(b); bytes(1).copy(b, 8); bytes(2).copy(b, 89); bytes(3).copy(b, 121)
  b.writeBigUInt64LE(10000000000000000000n, 56); b.writeBigUInt64LE(20n, 64)
  assert.equal(decodeSolanaSwaps(tx(logs(b.toString('base64'), cp.program)), cp)[0].amountIn, '10000000000000000000')
  bytes(9).copy(b, 89)
  assert.throws(() => decodeSolanaSwaps(tx(logs(b.toString('base64'), cp.program)), cp), /mint mismatch/)
})
test('transfers, spoofed logs, failed transactions and rolled-back CPI events never become swaps', () => {
  assert.deepEqual(decodeSolanaSwaps(tx(logs(event(), key(9))), pool), [])
  assert.deepEqual(decodeSolanaSwaps({ meta: { err: { error: 1 }, logMessages: logs() } }, pool), [])
  assert.deepEqual(decodeSolanaSwaps(tx([`Program ${key(9)} invoke [1]`, `Program ${ORCA_PROGRAM} invoke [2]`, `Program data: ${event()}`, `Program ${ORCA_PROGRAM} success`, `Program ${key(9)} failed: error`]), pool), [])
  assert.deepEqual(decodeSolanaSwaps(tx([`Program ${ORCA_PROGRAM} invoke [1]`, 'Program log: Transfer', `Program ${ORCA_PROGRAM} success`]), pool), [])
  assert.throws(() => decodeSolanaSwaps(tx(['Log truncated']), pool))
  assert.throws(() => decodeSolanaSwaps(tx(logs().slice(0, 2)), pool))
})
test('durable signature paging resumes after failure/restart and advances coverage only on a completed scan', async () => {
  const db = new PGlite(), store = new DexStore('postgresql://unused'); await store.db.end()
  const query = async (sql, args) => {
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }], rowCount: 1 }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
    if (sql.includes('INSERT INTO dex_protocols')) { await db.exec(sql); return { rows: [], rowCount: 0 } }
    const r = await db.query(sql, args); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }
  }
  store.db = { query, connect: async () => ({ query, release() {} }), end: () => db.close() }
  try {
    await store.migrate()
    const row = n => ({ signature: signature(n), slot: 10 + n, blockTime: 1700000000 + n, err: null, confirmationStatus: 'finalized' })
    let missing = true, unavailableAnchor = false, nextPage = false
    const rpc = { solanaPool: async () => pool, call: async (method, args) => {
      if (method === 'getGenesisHash') return SOLANA_MAINNET_GENESIS
      if (method === 'getSignatureStatuses') return { value: [unavailableAnchor ? null : { confirmationStatus: 'finalized' }] }
      if (method === 'getSignaturesForAddress') {
        if (args[1].before) { assert.equal(args[1].before, signature(2)); nextPage = true; return [row(1)] }
        if (args[1].until) { assert.equal(args[1].until, signature(3)); return [] }
        return [row(3), row(2)]
      }
      if (method === 'getTransaction') {
        assert.equal(args[1].maxSupportedTransactionVersion, 1)
        if (missing) throw new Error('Missing transaction')
        const n = [1, 2, 3].find(n => signature(n) === args[0])
        return { ...tx(), slot: 10 + n, blockTime: 1700000000 + n, transaction: { signatures: [args[0]] } }
      }
      throw new Error('Unexpected RPC method')
    } }
    const config = { rpc: 'https://unused.invalid', pools: [pool.address], start: 10, pageSize: 2, interval: 1000 }
    const worker = new SolanaDexWorker(store, config, rpc)
    await assert.rejects(worker.batch(pool.address)); assert.equal((await store.coverage()).length, 0)
    missing = false
    assert.equal(await worker.batch(pool.address), true)
    assert.equal((await store.swaps({ chain: 'solana', offset: 0, limit: 50 })).length, 2)
    assert.equal((await store.coverage()).length, 0, 'partial scans do not claim complete coverage')
    assert.equal(await new SolanaDexWorker(store, config, rpc).batch(pool.address), false)
    assert.equal(nextPage, true)
    assert.equal((await store.swaps({ chain: 'solana', offset: 0, limit: 50 })).length, 3)
    assert.equal(String((await store.coverage())[0].end_block), '13')
    await worker.batch(pool.address)
    assert.equal((await store.swaps({ chain: 'solana', offset: 0, limit: 50 })).length, 3)
    unavailableAnchor = true
    await assert.rejects(worker.batch(pool.address), /anchor unavailable/)
    assert.equal(String((await store.coverage())[0].end_block), '13')
    assert.equal((await query('SELECT * FROM solana_transactions')).rows.length, 3)
  } finally { await store.close() }
})
