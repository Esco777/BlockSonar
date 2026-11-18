import test from 'node:test'
import assert from 'node:assert/strict'
import { DefiLlama, llamaCoinId } from './dist/server/defillama.js'
import { ProviderCache } from './dist/server/provider-cache.js'
const mint = 'So11111111111111111111111111111111111111112'
const time = 1800000000000
const quote = { price: 100, timestamp: time / 1000, confidence: .99 }
const provider = coins => new DefiLlama(new ProviderCache(async () => new Response(JSON.stringify({ coins }))), () => time)
test('DefiLlama maps native SOL explicitly and retains chain/address identity', () => {
  assert.equal(llamaCoinId('solana','SOL'), `solana:${mint}`)
  assert.equal(llamaCoinId('solana',mint), `solana:${mint}`)
  assert.equal(llamaCoinId('eth','0x'+'AB'.repeat(20)), 'ethereum:0x'+'ab'.repeat(20))
  assert.equal(llamaCoinId('solana','garbage'), null)
})
test('batched prices value observed balances, including separate accounts of the same mint', async () => {
  let count = 0
  const llama = new DefiLlama(new ProviderCache(async url => {
    count++
    const path = decodeURIComponent(new URL(url).pathname)
    assert.ok(path.endsWith(`/prices/current/solana:${mint}`))
    return new Response(JSON.stringify({ coins: { [`solana:${mint}`]: quote } }))
  }), () => time)
  const data = await llama.valueBalances('solana', [{ mint: 'SOL', amount: '2' }, { mint, amount: '0.5' }], time - 1000)
  assert.equal(data.totalUsd, 250)
  assert.equal(data.pricedCount, 2)
  assert.equal(data.balancesAt, time-1000)
  await llama.valueBalances('solana', [{ mint: 'SOL', amount: '1' }], time)
  assert.equal(count, 1)
})
test('missing prices produce partial coverage and never a complete portfolio total', async () => {
  const data = await provider({ [`solana:${mint}`]: quote }).valueBalances('solana', [{ mint: 'SOL', amount: '2' }, { mint: '11111111111111111111111111111111', amount: '3' }], time)
  assert.equal(data.status, 'partial')
  assert.equal(data.totalUsd, null)
  assert.equal(data.pricedSubtotalUsd, 200)
  assert.equal(data.balances[1].valueUsd, null)
})
test('stale, future, low confidence, invalid quotes and invalid balances remain unavailable', async () => {
  for (const value of [{ ...quote, timestamp: (time-3600001)/1000 }, { ...quote, timestamp: (time+61000)/1000 }, { ...quote, confidence: .1 }, { ...quote, confidence: null }, { ...quote, price: -1 }, { ...quote, price: '100' }, { ...quote, timestamp: null }]) {
    const result = await provider({ [`solana:${mint}`]: value }).valueBalances('solana',[{ mint:'SOL',amount:'1' }],time)
    assert.equal(result.totalUsd,null)
    assert.equal(result.balances[0].valueUsd,null)
  }
  for (const amount of ['', '-1', 'NaN', 'Infinity', '0xFF']) {
    const result = await provider({ [`solana:${mint}`]: quote }).valueBalances('solana',[{ mint:'SOL',amount }],time)
    assert.equal(result.balances[0].reason,'Invalid balance')
  }
  assert.equal((await provider({}).valueBalances('solana',[],time)).totalUsd,null)
})
test('provider failures do not fabricate zero value or interrupt wallet history', async () => {
  const llama = new DefiLlama(new ProviderCache(async () => new Response('', { status: 429 })), () => time)
  const data = await llama.valueBalances('solana',[{ mint:'SOL',amount:'1' }],time)
  assert.equal(data.status,'unavailable')
  assert.equal(data.totalUsd,null)
  assert.equal(data.pricedSubtotalUsd,null)
  assert.match(data.error,/unavailable/)
})
test('large wallets use bounded batches of 50 token identities', async () => {
  let requests = 0
  const llama = new DefiLlama(new ProviderCache(async url => {
    requests++
    const ids = decodeURIComponent(new URL(url).pathname).split('/').at(-1).split(',')
    assert.ok(ids.length <= 50)
    return new Response(JSON.stringify({ coins: Object.fromEntries(ids.map(id=>[id,quote])) }))
  }),()=>time)
  const balances = Array.from({length:201},(_,i)=>({mint:'0x'+i.toString(16).padStart(40,'0'),amount:'1'}))
  const data = await llama.valueBalances('eth',balances,time)
  assert.equal(requests,4)
  assert.equal(data.pricedCount,200)
  assert.equal(data.unpricedCount,1)
  assert.equal(data.totalUsd,null)
})
