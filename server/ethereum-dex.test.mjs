import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Interface } from 'ethers'
import { DexStore } from './dist/server/dex-store.js'
import { DexRpc, poolAbi } from './dist/server/dex-rpc.js'
import { dexConfig, DexWorker } from './dist/server/dex-worker.js'
import { adapterForProtocol, v2PoolAbi, decodeProtocolSwap, poolLookup, pancakeV3PoolAbi } from './dist/server/dex-adapters.js'
const pool = `0x${'11'.repeat(20)}`, token0 = `0x${'22'.repeat(20)}`, token1 = `0x${'33'.repeat(20)}`
const hash = `0x${'aa'.repeat(32)}`, tx = `0x${'bb'.repeat(32)}`
const v2 = adapterForProtocol('ethereum-uniswap-v2'), v3 = adapterForProtocol('ethereum-uniswap-v3')
function log(version = 2, amounts = [100n, 0n, 0n, 50n], index = 0) {
  const abi = version === 2 ? v2PoolAbi : poolAbi
  const args = version === 2 ? [pool, ...amounts, pool] : [pool, pool, amounts[0], amounts[1], 1n, 1n, 0]
  return { ...abi.encodeEventLog(abi.getEvent('Swap'), args), address: pool, blockNumber: '0xa', blockHash: hash, transactionHash: tx, logIndex: `0x${index.toString(16)}` }
}
test('Ethereum config is opt-in, uses the same Alchemy key and supports independent batching', () => {
  assert.equal(dexConfig({ ALCHEMY_API_KEY: 'fake' }, 'ethereum'), null)
  const env = { ALCHEMY_API_KEY: 'fake', DEX_ETHEREUM_POOLS: pool, DEX_ETHEREUM_START_BLOCK: '10' }
  assert.equal(dexConfig(env, 'ethereum').chain, 'ethereum')
  assert.equal(dexConfig(env, 'ethereum').rpc, 'https://eth-mainnet.g.alchemy.com/v2/fake')
  assert.equal(dexConfig(env, 'ethereum').batch, 10n)
  assert.equal(dexConfig({ ...env, DEX_BATCH_BLOCKS: '50', DEX_ETHEREUM_BATCH_BLOCKS: '5' }, 'ethereum').batch, 5n)
  assert.equal(dexConfig({ ...env, DEX_ETHEREUM_POLL_MS: '15000' }, 'ethereum').interval, 15000)
  assert.throws(() => dexConfig({ ...env, DEX_ETHEREUM_START_BLOCK: '' }, 'ethereum'))
  assert.throws(() => dexConfig({ ...env, DEX_ETHEREUM_POOLS: 'invalid' }, 'ethereum'))
})
test('V2 decodes both directions without floating point or trader attribution', () => {
  const forward = decodeProtocolSwap(v2, log(2, [2n ** 200n, 0n, 0n, 90n]), token0, token1)
  assert.equal(forward.amountIn, (2n ** 200n).toString()); assert.equal(forward.amountOut, '90'); assert.equal(forward.wallet, null)
  const reverse = decodeProtocolSwap(v2, log(2, [0n, 80n, 20n, 0n]), token0, token1)
  assert.equal(reverse.tokenIn, token1); assert.equal(reverse.tokenOut, token0)
  assert.equal(reverse.amountOut, '20')
})
test('ambiguous flash swaps have no fabricated direction; removed and foreign event logs fail', () => {
  for (const amounts of [[1n, 1n, 0n, 1n], [1n, 0n, 1n, 0n], [0n, 0n, 0n, 0n]]) assert.equal(decodeProtocolSwap(v2, log(2, amounts), token0, token1), null)
  assert.throws(() => decodeProtocolSwap(v2, { ...log(), removed: true }, token0, token1))
  assert.throws(() => decodeProtocolSwap(v2, log(3, [100n, -50n]), token0, token1))
  const swap = decodeProtocolSwap(v3, log(3, [-50n, 100n]), token0, token1)
  assert.equal(swap.tokenIn, token1)
})
test('factory verification enforces chain, canonical registry and V2/V3 lookup semantics', async () => {
  for (const adapter of [v2, v3, adapterForProtocol('bsc-pancakeswap-v2'), adapterForProtocol('bsc-pancakeswap-v3')]) {
    const rpc = new DexRpc('https://test.invalid')
    let forged = false, lastMethod = ''
    rpc.call = async (_method, [request]) => {
      if (request.to === pool) {
        const parsed = poolAbi.parseTransaction({ data: request.data })
        const result = { factory: adapter.factory, token0, token1, fee: 3000n }[parsed.name]
        return poolAbi.encodeFunctionResult(parsed.name, [result])
      }
      const factoryAbi = new Interface([adapter.version === 2 ? 'function getPair(address,address) view returns (address)' : 'function getPool(address,address,uint24) view returns (address)'])
      const parsed = factoryAbi.parseTransaction({ data: request.data }); lastMethod = parsed.name
      return factoryAbi.encodeFunctionResult(parsed.name, [forged ? token0 : pool])
    }
    const verified = await rpc.verifyPool(pool, adapter.chain)
    assert.equal(verified.protocol, adapter.id)
    assert.equal(lastMethod, adapter.version === 2 ? 'getPair' : 'getPool')
    await assert.rejects(rpc.verifyPool(pool, 'base'))
    forged = true
    await assert.rejects(rpc.verifyPool(pool, adapter.chain), /Factory did not confirm/)
    assert.ok(poolLookup(adapter, token0, token1, 3000n).data.startsWith('0x'))
  }
})
test('Ethereum RPC cannot accidentally index Base data', async () => {
  const worker = new DexWorker({}, { chain: 'ethereum', rpc: 'https://test.invalid' }, { call: async () => '0x2105' })
  await assert.rejects(worker.batch(pool), /ethereum Mainnet/)
})
test('Ethereum V2/V3 storage remains separate from Base, resumes and retains ambiguous events', async () => {
  const db = new PGlite(), store = new DexStore('postgresql://unused'); await store.db.end()
  const query = async (sql, args) => {
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }], rowCount: 1 }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
    if (sql.includes('INSERT INTO dex_protocols')) { await db.exec(sql); return { rows: [], rowCount: 0 } }
    const r = await db.query(sql, args); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }
  }
  store.db = { query, connect: async () => ({ query, release() {} }), end: () => db.close() }
  try {
    await store.migrate(); await store.migrate()
    assert.equal((await query('SELECT * FROM dex_schema_migrations')).rows.length, 4)
    let chain = 'base', protocol = 'base-uniswap-v3', events = [log(3, [100n, -50n])], reorg = false, failure = false
    const rpc = {
      call: async method => { if (method === 'eth_chainId') return chain === 'base' ? '0x2105' : '0x1'; if (failure) throw new Error('RPC failure'); return events },
      verifyPool: async () => ({ token0, token1, protocol }),
      block: async n => ({ number: n === 'finalized' ? '0xa' : n, hash: reorg ? tx : hash, timestamp: '0x6553f100' }),
    }
    const config = { rpc: 'https://test.invalid', pools: [pool], start: 10n, batch: 10n, interval: 1000 }
    await new DexWorker(store, config, rpc).batch(pool)
    chain = 'ethereum'; protocol = v2.id
    events = [log(), log(2, [1n, 0n, 1n, 0n], 1)]
    const worker = new DexWorker(store, { ...config, chain }, rpc)
    failure = true; await assert.rejects(worker.batch(pool))
    assert.equal((await store.coverage()).length, 1)
    failure = false; await worker.batch(pool)
    assert.equal((await store.swaps({ chain: 'base', offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ chain: 'ethereum', offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ dex: v2.id, offset: 0, limit: 50 }))[0].amount_in, '100')
    assert.equal((await query('SELECT * FROM dex_unclassified_swaps')).rows.length, 1)
    await worker.batch(pool)
    assert.equal((await query('SELECT * FROM dex_swaps')).rows.length, 2, 'same transaction identity is distinct on different chains')
    assert.equal((await store.coverage()).length, 2)
    reorg = true; await worker.batch(pool)
    assert.equal((await query('SELECT * FROM dex_unclassified_swaps')).rows.length, 0)
    assert.equal((await store.swaps({ chain: 'base', offset: 0, limit: 50 })).length, 1, 'Ethereum reorg never deletes Base history')
    assert.equal((await store.swaps({ chain: 'ethereum', offset: 0, limit: 50 })).length, 0)
    reorg = false; protocol = v3.id; events = [log(3, [-20n, 40n])]
    // Use a different pool for V3 so existing V2 pool identity is preserved.
    const pool3 = `0x${'44'.repeat(20)}`; events = events.map(e => ({ ...e, address: pool3 }))
    await new DexWorker(store, { ...config, chain }, rpc).batch(pool3)
    assert.equal((await store.swaps({ chain: 'ethereum', dex: v3.id, offset: 0, limit: 50 })).length, 1)
    chain = 'bsc'; protocol = 'bsc-pancakeswap-v3'
    rpc.call = async method => method === 'eth_chainId' ? '0x38' : events
    events = [{ ...log(), ...pancakeV3PoolAbi.encodeEventLog(pancakeV3PoolAbi.getEvent('Swap'), [pool, pool, 100n, -50n, 1n, 1n, 0, 2n, 0n]) }]
    const bnb = new DexWorker(store, { ...config, chain }, rpc)
    await bnb.batch(pool)
    assert.equal((await store.swaps({ chain: 'bsc', dex: protocol, offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ offset: 0, limit: 50 })).length, 3, 'same hash/log identity survives on three chains')
    protocol = 'bsc-pancakeswap-v2'; events = [{ ...log(2, [100n, 0n, 0n, 50n], 1), address: pool3 }]
    await new DexWorker(store, { ...config, chain }, rpc).batch(pool3)
    assert.equal((await store.swaps({ chain: 'bsc', dex: protocol, offset: 0, limit: 50 })).length, 1)
    protocol = 'bsc-pancakeswap-v3'; reorg = true; await bnb.batch(pool)
    assert.equal((await store.swaps({ chain: 'base', offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ chain: 'ethereum', offset: 0, limit: 50 })).length, 1)
    assert.equal((await store.swaps({ chain: 'bsc', dex: 'bsc-pancakeswap-v3', offset: 0, limit: 50 })).length, 0)

  } finally { await store.close() }
})
