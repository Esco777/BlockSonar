import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFeed, parseCategories, parseNarrativeTokens, NarrativeHttpClient } from './dist/server/narrative-collectors.js'
import { deduplicateEvidence } from './dist/src/lib/early-narrative.js'
test('RSS keeps headline provenance, rejects future timestamps and unsafe links, deduplicates syndication', () => {
  const now = Date.UTC(2026, 10, 11)
  const xml = `<rss><item><title><![CDATA[AI agents &amp; DePIN]]></title><link>https://news.test/a?utm_source=x</link><pubDate>${new Date(now).toUTCString()}</pubDate></item><item><title>Bad</title><link>javascript:alert(1)</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></rss>`
  const rows = parseNewsFeed(xml, 'Publisher', now)
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'AI agents & DePIN'); assert.equal(rows[0].collectedAt, now)
  assert.equal(deduplicateEvidence([...rows, { ...rows[0], id: 'other', url: 'https://other.test/syndicated' }]).length, 1)
  assert.throws(() => parseNewsFeed('<!ENTITY x SYSTEM "file:///etc/passwd">', 'x', now))
})
test('CoinGecko categories and verified IDs retain missing values rather than generating metrics', () => {
  const rows = parseCategories([{ id: 'ai', name: 'AI', market_cap: 20, volume_24h: null, top_3_coins_id: ['token-id'] }], 1)
  assert.equal(rows[0].volume, null); assert.deepEqual(rows[0].topCoinIds, ['token-id'])
  const token = parseNarrativeTokens([{ id: 'real-id', name: 'Project', symbol: 'abc', current_price: 2 }], 1)[0]
  assert.equal(token.liquidity, null); assert.equal(token.relevance, null); assert.deepEqual(token.chains, [])
})
test('collector caches successful reads and backs off rate-limited sources', async () => {
  let calls = 0
  const client = new NarrativeHttpClient(async () => { calls++; return new Response('ok') })
  assert.equal(await client.get('https://one.test/feed', 60000), 'ok'); assert.equal(await client.get('https://one.test/feed', 60000), 'ok'); assert.equal(calls, 1)
  const limited = new NarrativeHttpClient(async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '60' } }) })
  await assert.rejects(limited.get('https://two.test/feed', 60000)); const previous = calls
  await assert.rejects(limited.get('https://two.test/feed', 60000)); assert.equal(calls, previous)
})


test('token logos use source-provided safe URLs and reject executable URLs', () => {
  const rows = parseNarrativeTokens([
    { id: 'verified', name: 'Verified', symbol: 'coin', image: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png' },
    { id: 'unsafe', name: 'Unsafe', symbol: 'bad', image: 'javascript:alert(1)' },
  ], 1)
  assert.equal(rows[0].image, 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png')
  assert.equal(rows[1].image, null)
})
