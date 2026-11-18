import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dexConfig, DexWorker } from './dist/server/dex-worker.js'
import { adapterForProtocol, pancakeV3PoolAbi, poolAbi, decodeProtocolSwap, swapAbi } from './dist/server/dex-adapters.js'
const pool = `0x${'11'.repeat(20)}`, token0 = `0x${'22'.repeat(20)}`, token1 = `0x${'33'.repeat(20)}`
test('BNB is opt-in, uses Alchemy BNB and independent settings', () => {
  assert.equal(dexConfig({ ALCHEMY_API_KEY: 'fake' }, 'bsc'), null)
  const env = { ALCHEMY_API_KEY: 'fake', DEX_BSC_POOLS: pool, DEX_BSC_START_BLOCK: '10' }
  assert.equal(dexConfig(env, 'bsc').rpc, 'https://bnb-mainnet.g.alchemy.com/v2/fake')
  assert.equal(dexConfig(env, 'bsc').batch, 10n)
  assert.equal(dexConfig({ ...env, DEX_BSC_RPC_URL: 'https://operator.invalid', DEX_BSC_BATCH_BLOCKS: '7', DEX_BSC_POLL_MS: '2000' }, 'bsc').batch, 7n)
  assert.throws(() => dexConfig({ ...env, DEX_BSC_START_BLOCK: '' }, 'bsc'))
})
test('Pancake V3 uses its own extended Swap topic and preserves amounts and raw fees', () => {
  const adapter = adapterForProtocol('bsc-pancakeswap-v3')
  assert.equal(swapAbi(adapter), pancakeV3PoolAbi)
  assert.notEqual(swapAbi(adapter).getEvent('Swap').topicHash, poolAbi.getEvent('Swap').topicHash)
  const encode = (a, b) => pancakeV3PoolAbi.encodeEventLog(pancakeV3PoolAbi.getEvent('Swap'), [pool, pool, a, b, 1n, 1n, 0, 9n, 0n])
  const forward = decodeProtocolSwap(adapter, encode(2n ** 200n, -50n), token0, token1)
  assert.equal(forward.amountIn, (2n ** 200n).toString()); assert.equal(forward.amountOut, '50'); assert.equal(forward.wallet, null)
  assert.equal(decodeProtocolSwap(adapter, encode(-50n, 100n), token0, token1).tokenIn, token1)
  assert.equal(decodeProtocolSwap(adapter, encode(1n, 1n), token0, token1), null)
  assert.throws(() => decodeProtocolSwap(adapterForProtocol('ethereum-uniswap-v3'), encode(1n, -1n), token0, token1))
})
test('BNB worker rejects a different network before indexing', async () => {
  const worker = new DexWorker({}, { chain: 'bsc', rpc: 'https://unused.invalid' }, { call: async () => '0x1' })
  await assert.rejects(worker.batch(pool), /bsc Mainnet/)
})
