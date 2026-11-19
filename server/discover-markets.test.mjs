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

test('server discovery prefers CoinGecko and labels GeckoTerminal fallback', async (t) => {
  const { IntelligenceService } = await import('./dist/server/intelligence-service.js')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'pool-discovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const previousProKey = process.env.COINGECKO_PRO_API_KEY
  process.env.COINGECKO_PRO_API_KEY = 'fixture-pro-key'
  t.after(() => {
    if (previousProKey === undefined) delete process.env.COINGECKO_PRO_API_KEY
    else process.env.COINGECKO_PRO_API_KEY = previousProKey
  })

  const requests = t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input)
    if (url.hostname === 'pro-api.coingecko.com' && url.searchParams.get('page') === '2') {
      return new Response(null, { status: 429 })
    }
    return Response.json(payload)
  })
  const service = new IntelligenceService(join(directory, 'intelligence.json'), null)
  const [primary] = await service.pools('eth', 1)
  const [fallback] = await service.pools('eth', 2)

  assert.equal(primary.source, 'CoinGecko')
  assert.equal(primary.price, .0000000123)
  assert.equal(fallback.source, 'GeckoTerminal')
  assert.equal(requests.mock.callCount(), 3)
  const [primaryUrl, primaryOptions] = requests.mock.calls[0].arguments
  assert.equal(new URL(primaryUrl).pathname, '/api/v3/onchain/networks/eth/new_pools')
  assert.equal(new Headers(primaryOptions.headers).get('x-cg-pro-api-key'), 'fixture-pro-key')
  const [fallbackUrl, fallbackOptions] = requests.mock.calls[2].arguments
  assert.equal(new URL(fallbackUrl).hostname, 'api.geckoterminal.com')
  assert.equal(new URL(fallbackUrl).searchParams.get('page'), '2')
  assert.equal(new Headers(fallbackOptions.headers).get('x-cg-pro-api-key'), null)
})
