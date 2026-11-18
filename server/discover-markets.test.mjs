import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewPools, fetchNewPools } from './dist/src/lib/discover-markets.js'
const pool = { attributes: { address: '0xpool', name: 'NEW / WETH', pool_created_at: '2026-11-09T12:00:00Z', base_token_price_usd: '0.0000000123', reserve_in_usd: '5000', fdv_usd: '25000', volume_usd: { h24: '500' }, price_change_percentage: { h24: '-2' }, transactions: { h24: { buys: 2, sells: 1 } } }, relationships: { base_token: { data: { id: 'token' } }, dex: { data: { id: 'dex' } } } }
const payload = { data: [pool], included: [{ id: 'token', attributes: { name: 'New', symbol: 'NEW', address: '0xtoken', image_url: 'https://example.com/token.png' } }, { id: 'dex', attributes: { name: 'Uniswap' } }] }

test('normalizes new pool timestamps, token relationships and observed trading data', () => {
  const [row] = parseNewPools(payload, 'eth')
  assert.equal(row.symbol, 'NEW')
  assert.equal(row.dex, 'Uniswap')
  assert.equal(row.tokenAddress, '0xtoken')
  assert.equal(row.price, .0000000123)
  assert.equal(row.change, -2)
  assert.equal(row.createdAt, Date.parse('2026-11-09T12:00:00Z'))
  assert.equal(row.liquidity, 5000)
})

test('missing fields remain unavailable, invalid timestamps are rejected, pools deduplicate', () => {
  const partial = { attributes: { address: 'pool', pool_created_at: '2026-11-09T12:00:00Z' } }
  const rows = parseNewPools({ data: [partial, partial, { attributes: { address: 'bad', pool_created_at: 'bad' } }] }, 'solana')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].price, null)
  assert.equal(rows[0].volume, null)
  assert.equal(rows[0].image, null)
  assert.throws(() => parseNewPools({}, 'bsc'), /Invalid pool response/)
})

test('identical addresses on different chains retain distinct pool identities', () => {
  assert.notEqual(parseNewPools(payload, 'eth')[0].id, parseNewPools(payload, 'bsc')[0].id)
})

test('requests the selected chain and page and exposes rate-limit failures', async () => {
  const rows = await fetchNewPools('bsc', 2, new AbortController().signal, async (url) => {
    assert.ok(url.pathname.includes('/networks/bsc/new_pools'))
    assert.equal(url.searchParams.get('page'), '2')
    assert.equal(url.searchParams.get('include'), 'base_token,quote_token,dex')
    return new Response(JSON.stringify(payload))
  })
  assert.equal(rows[0].network, 'bsc')
  await assert.rejects(() => fetchNewPools('eth', 1, new AbortController().signal, async () => new Response('', { status: 429 })), /Rate limited/)
})
