import{test}from'node:test'
import assert from'node:assert/strict'
import{MarketSnapshotService}from'./dist/server/market-snapshot.js'
const now=Date.now(),global={data:{total_market_cap:{usd:2000000000000},total_volume:{usd:90000000000},market_cap_change_percentage_24h_usd:-2,updated_at:Math.floor(now/1000)}},markets=[{id:'a',price_change_percentage_24h:1,last_updated:new Date(now).toISOString()},{id:'b',price_change_percentage_24h:-1,last_updated:new Date(now).toISOString()},{id:'c',price_change_percentage_24h:null,last_updated:new Date(now).toISOString()}],sentiment={data:[{value:'35',value_classification:'Fear',timestamp:String(Math.floor(now/1000))}]}
test('snapshot uses actual global totals, excludes missing changes from breadth and authenticates privately',async()=>{
 let calls=0;const service=new MarketSnapshotService({COINGECKO_DEMO_API_KEY:'secret'},async(url,init)=>{calls++;if(String(url).includes('coingecko'))assert.equal(init.headers['x-cg-demo-api-key'],'secret');return new Response(JSON.stringify(String(url).includes('/global')?global:String(url).includes('/coins/markets')?markets:sentiment))},()=>now)
 const data=await service.snapshot();assert.equal(data.global.marketCap,2000000000000);assert.equal(data.global.volumeChange,null);assert.deepEqual({...data.breadth,at:0},{advancing:1,declining:1,unchanged:0,total:2,at:0});assert.equal(data.sentiment.value,35);assert.equal(data.errors.length,0);assert.doesNotMatch(JSON.stringify(data),/secret/);await service.snapshot();assert.equal(calls,3)
})
test('independent provider failures do not replace metrics with fabricated values',async()=>{
 const service=new MarketSnapshotService({},async url=>{if(String(url).includes('coingecko'))return new Response('failure',{status:429});return new Response(JSON.stringify(sentiment))},()=>now)
 const data=await service.snapshot();assert.equal(data.global,null);assert.equal(data.breadth,null);assert.equal(data.sentiment.value,35);assert.equal(data.errors.length,2)
})
test('stale provider observations and out-of-range sentiment are rejected',async()=>{
 const service=new MarketSnapshotService({},async url=>new Response(JSON.stringify(String(url).includes('/global')?{data:{...global.data,updated_at:1}}:String(url).includes('/coins/markets')?[{...markets[0],last_updated:'2000-01-01'}]:{data:[{...sentiment.data[0],value:'101'}]})),()=>now)
 const data=await service.snapshot();assert.equal(data.global,null);assert.equal(data.breadth,null);assert.equal(data.sentiment,null)
})
test('global totals fall back to public CoinGecko without sending the saved key',async()=>{
 let publicCalls=0
 const service=new MarketSnapshotService({COINGECKO_DEMO_API_KEY:'secret'},async(url,init)=>{
  if(String(url).endsWith('/global')){
   if(init?.headers?.['x-cg-demo-api-key'])return new Response('Throttled',{status:429})
   publicCalls++;assert.equal(init?.headers,undefined);return Response.json(global)
  }
  return Response.json(String(url).includes('/coins/markets')?markets:sentiment)
 },()=>now)
 const data=await service.snapshot();assert.equal(data.global.marketCap,global.data.total_market_cap.usd);assert.equal(data.global.volume,global.data.total_volume.usd);assert.equal(publicCalls,1);assert.equal(data.errors.length,0)
})
test('temporary global failures retain only an unexpired previous observation',async()=>{
 let clock=now,fail=false
 const service=new MarketSnapshotService({},async url=>{
  if(String(url).endsWith('/global'))return fail?new Response('unavailable',{status:503}):Response.json(global)
  return Response.json(String(url).includes('/coins/markets')?markets:sentiment)
 },()=>clock)
 const initial=await service.snapshot();fail=true;clock+=61000
 const delayed=await service.snapshot();assert.deepEqual(delayed.global,initial.global);assert.ok(delayed.errors.includes('Global market totals unavailable'))
 clock=now+601000;assert.equal((await service.snapshot()).global,null)
})
