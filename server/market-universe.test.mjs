import test from 'node:test'
import assert from 'node:assert/strict'
import { loadMarketUniverse } from './dist/src/lib/market-universe.js'
const row = (id) => ({ id, name: id, symbol: id, current_price: 100, price_change_percentage_24h: 2, market_cap: 1000, total_volume: 100, sparkline_in_7d: { price: [90, 100] } })
const response = (rows) => new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json', 'X-Market-API-Mode': 'demo', 'X-Market-Updated-At': '1000' } })

test('loads six 250-asset pages, analyzes 1500 unique assets, and reports progress', async () => {
  const calls = [], progress = [], pauses = []
  const result = await loadMarketUniverse(new AbortController().signal, (n) => progress.push(n), async (url) => {
    const page = Number(new URL(url,'http://localhost').searchParams.get('page'))
    calls.push(page)
    assert.equal(url, `/api/market/coins?page=${page}`)
    return response(Array.from({ length: 250 }, (_, i) => row(`coin-${(page - 1) * 250 + i}`)))
  }, async (ms) => { pauses.push(ms) })
  assert.equal(result.coins.length, 1500)
  assert.equal(result.complete, true)
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(progress, [250, 500, 750, 1000, 1250, 1500])
  assert.deepEqual(pauses, [])
})

test('keeps available data and marks coverage incomplete when a later page fails', async () => {
  const result = await loadMarketUniverse(new AbortController().signal, () => {}, async (url) => Number(new URL(url,'http://localhost').searchParams.get('page')) === 1 ? response(Array.from({ length: 250 }, (_, i) => row(`coin-${i}`))) : new Response('', { status: 503 }), async () => {})
  assert.equal(result.complete, false)
  assert.equal(result.coins.length, 250)
})

test('backs off and retries 429 without inventing or duplicating assets', async () => {
  let calls = 0
  const pauses = []
  const result = await loadMarketUniverse(new AbortController().signal, () => {}, async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '90' } }) : response([row('btc'), row('btc'), { ...row('missing'), price_change_percentage_24h: null }]), async (ms) => { pauses.push(ms) })
  assert.equal(calls, 2)
  assert.deepEqual(pauses, [90000])
  assert.equal(result.coins.length, 1)
  assert.equal(result.complete, false)
})

test('cancellation stops subsequent pages', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(() => loadMarketUniverse(controller.signal, () => { controller.abort() }, async () => { calls++; return response(Array.from({ length: 250 }, (_, i) => row(`coin-${i}`))) }, async () => { controller.abort(); controller.signal.throwIfAborted() }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('server responses preserve plan, original timestamp and stale status without client credentials', async () => {
  const live = await loadMarketUniverse(new AbortController().signal, () => {}, async (url, init) => {
    assert.equal(url, '/api/market/coins?page=1')
    assert.equal(init.headers, undefined)
    return Response.json([row('btc')], { headers: {
      'X-Market-API-Mode': 'demo', 'X-Market-Updated-At': '1000', 'X-Market-Stale': '1',
    } })
  })
  assert.equal(live.complete, false)
  assert.equal(live.apiMode, 'demo')
  assert.equal(live.updatedAt, 1000)
  assert.equal(live.stale, true)
})

test('fills filtered and duplicate records from additional pages and stops at 1500 eligible coins',async()=>{
 const calls=[],progress=[]
 const result=await loadMarketUniverse(new AbortController().signal,n=>progress.push(n),async url=>{
  const page=Number(new URL(url, 'http://localhost').searchParams.get('page'));calls.push(page)
  return response(Array.from({length:250},(_,i)=>i===0?row('shared'):i<25?{...row(`missing-${page}-${i}`),price_change_percentage_24h:null}:row(`coin-${page}-${i}`)))
 },async()=>{})
 assert.equal(result.coins.length,1500);assert.equal(new Set(result.coins.map(c=>c.id)).size,1500);assert.equal(result.complete,true)
 assert.deepEqual(calls,[1,2,3,4,5,6,7]);assert.equal(progress.at(-1),1500)
})
test('bounds extra scans when the provider keeps returning unusable records',async()=>{
 let calls=0
 const result=await loadMarketUniverse(new AbortController().signal,()=>{},async()=>{calls++;return response(Array.from({length:250},()=>({...row('missing'),current_price:null})))},async()=>{})
 assert.equal(calls,12);assert.equal(result.coins.length,0);assert.equal(result.complete,false);assert.match(result.errorMessage,/Scan ended/)
})
