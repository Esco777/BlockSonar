import test from 'node:test'
import assert from 'node:assert/strict'
import { assetKey, deduplicatePools, validAddress } from './dist/src/lib/token-identity.js'
import { classifyTransaction, earlyBuyers, estimatePnl, accumulationPatterns } from './dist/src/lib/wallet-intelligence.js'
import { ProviderCache } from './dist/server/provider-cache.js'
import { DexScreener } from './dist/server/dex-screener.js'
const wallet = 'owner'
const tx = { signature: 'sig', timestamp: 100, type: 'SWAP', events: { swap: {} }, fee: 5000, tokenTransfers: [{ mint: 'Token', tokenAmount: 10, fromUserAccount: 'other', toUserAccount: wallet }] }
test('identity aliases, EVM casing and Solana casing; same token different pools stay distinct', () => {
  assert.equal(assetKey('eth', '0xAb'), assetKey('1', '0xab'))
  assert.notEqual(assetKey('solana', 'Ab'), assetKey('solana', 'ab'))
  assert.notEqual(assetKey('eth', '0xab'), assetKey('bsc', '0xab'))
  assert.equal(deduplicatePools([{ network: 'eth', address: '0xAb' }, { network: 'ethereum', address: '0xab' }, { network: 'eth', address: '0xCD' }]).length, 2)
  assert.ok(validAddress('solana', '11111111111111111111111111111111'))
  assert.equal(validAddress('solana', '111111111111111111111111111111111'), false)
})
test('classifies supported swaps, failed transactions, liquidity, transfers and internal movements', () => {
  assert.equal(classifyTransaction(tx, wallet).kind, 'swap')
  assert.equal(classifyTransaction({ ...tx, transactionError: { error: 'failed' } }, wallet).kind, 'failed')
  assert.equal(classifyTransaction({ ...tx, type: 'ADD_LIQUIDITY' }, wallet).kind, 'liquidity')
  assert.equal(classifyTransaction({ ...tx, type: 'TRANSFER' }, wallet).kind, 'transfer')
  assert.equal(classifyTransaction({ ...tx, events: {} }, wallet).kind, 'unknown')
  assert.equal(classifyTransaction({ ...tx, type: 'TRANSFER', tokenTransfers: [{ ...tx.tokenTransfers[0], fromUserAccount: wallet }] }, wallet).kind, 'internal')
  assert.equal(classifyTransaction({ ...tx, type: 'UNKNOWN' }, wallet).kind, 'unknown')
})
test('early buyers require successful swaps after creation and within window, deduplicate repeated buys', () => {
  const activity = classifyTransaction(tx, wallet)
  const pools = [{ network: 'solana', address: 'pool', tokenAddress: 'Token', createdAt: 90000 }]
  assert.equal(earlyBuyers([activity, { ...activity, signature: 'second', at: 120000 }], pools).length, 1)
  assert.equal(earlyBuyers([{ ...activity, kind: 'failed' }, { ...activity, kind: 'transfer' }], pools).length, 0)
  assert.equal(earlyBuyers([{ ...activity, at: 80000 }, { ...activity, at: 800000 }], pools).length, 0)
  assert.equal(earlyBuyers([activity], [{ ...pools[0], tokenAddress: 'token' }]).length, 0)
})
test('FIFO P&L includes fees, unknown basis/prices/inventory never produces profit', () => {
  const trades = [{ at: 1, side: 'buy', quantity: 10, usd: 100, feeUsd: 2 }, { at: 2, side: 'buy', quantity: 10, usd: 200, feeUsd: 0 }, { at: 3, side: 'sell', quantity: 15, usd: 400, feeUsd: 3 }]
  assert.equal(estimatePnl(trades, true).realized, 195)
  assert.equal(estimatePnl(trades, false).realized, null)
  assert.equal(estimatePnl([{ ...trades[0], usd: null }], true).realized, null)
  assert.equal(estimatePnl([{ ...trades[0], feeUsd: null }], true).realized, null)
  assert.equal(estimatePnl([trades[2]], true).realized, null)
  assert.equal(estimatePnl([{ ...trades[0], quantity: NaN }], true).realized, null)
})
test('directional patterns exclude transfers, failures, future and old activity', () => {
  const a = classifyTransaction(tx, wallet)
  assert.equal(accumulationPatterns([a,a,a], 3, 1000, a.at + 10)[0].pattern, 'accumulation')
  assert.equal(accumulationPatterns([{ ...a, kind: 'transfer' }, a], 3, 1000, a.at + 10).length, 0)
})
test('cache coalesces requests and respects rate-limit backoff and retry-after', async () => {
  let count = 0, now = 0
  const cache = new ProviderCache(async () => { count++; return new Response(JSON.stringify({ value: 1 })) }, () => now)
  await Promise.all([cache.get('url','group', 1), cache.get('url','group', 1)])
  assert.equal(count, 1)
  await assert.rejects(cache.get('other','group', 1), /rate limited/)
  now = 61000
  await cache.get('url','group', 1)
  assert.equal(count, 2)
  const limited = new ProviderCache(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }), () => now)
  await assert.rejects(limited.get('url','limit', 50), /429/)
  now += 61000
  await assert.rejects(limited.get('url','limit', 50), /rate limited/)
})
test('DEX enrichment rejects other pool metrics, preserves missing values, computes timestamped deltas', async () => {
  const pair = { chainId: 'ethereum', pairAddress: '0xAB', priceUsd: '2', volume: { h24: 200 }, liquidity: { usd: 300 }, boosts: { active: 1 } }
  const dex = new DexScreener(new ProviderCache(async () => new Response(JSON.stringify({ pairs: [pair] }))))
  const pool = { network: 'eth', address: '0xab', tokenAddress: '0xtoken' }
  const result = await dex.enrich(pool, [{ at: Date.now()-120000, liquidity: 200, volume: 100, buys: null, sells: null }])
  assert.equal(result.liquidityDelta, 100)
  assert.equal(result.volumeDelta, 100)
  assert.equal(result.marketCap, null)
  assert.equal(result.promotion, 'boosted')
  assert.equal(await dex.enrich({ ...pool, address: '0xCD' }), null)
})

test('routed intermediate token legs net to zero and native transfers remain observable', () => {
  const activity = classifyTransaction({ ...tx, tokenTransfers: [...tx.tokenTransfers, { mint: 'Intermediate', tokenAmount: 3, fromUserAccount: wallet, toUserAccount: 'route' }, { mint: 'Intermediate', tokenAmount: 3, fromUserAccount: 'route', toUserAccount: wallet }], nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'other', amount: 1000000000 }] }, wallet)
  assert.equal(activity.tokens.length, 1)
  assert.equal(activity.nativeSolDelta, -1)
  assert.equal(estimatePnl([], true).realized, null)
})

test('wallet history persists, deduplicates signatures and never fabricates P&L or completeness', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { IntelligenceService } = await import('./dist/server/intelligence-service.js')
  const directory = await mkdtemp(path.join(tmpdir(), 'blocksonar-intel-'))
  const provider = { chain: 'solana', async history() { return { activities: [classifyTransaction(tx,wallet)], before: 'older', complete: true } }, async balances() { return [{ mint: 'SOL', amount: '1' }] } }
  try {
    const filename = path.join(directory, 'state.json')
    const first = new IntelligenceService(filename, provider)
    await first.wallet(wallet)
    const older = await first.wallet(wallet, 'older')
    assert.equal(older.activities.length, 1)
    assert.equal(older.complete, false)
    assert.equal(older.pnl.realized, null)
    const restarted = new IntelligenceService(filename, provider)
    const restored = await restarted.wallet(wallet)
    assert.equal(restored.activities.length, 1)
    assert.equal(restored.balances[0].amount, '1')
    const disabled = await new IntelligenceService(path.join(directory, 'disabled.json'), null).wallet(wallet)
    assert.equal(disabled.configured, false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
