import test from 'node:test'
import assert from 'node:assert/strict'
import {SonarDefiService} from './dist/server/sonar-defi.js'
test('DeFi context caches real observations and keeps provider metrics separate',async()=>{
 let now=1000000,calls=0
 const service=new SonarDefiService(async url=>{calls++;return Response.json(String(url).includes('/v2/chains')?[{name:'Ethereum',tvl:100},{name:'Solana',tvl:50}]:{total24h:200})},()=>now)
 const first=await service.snapshot();assert.equal(first.ethereum.tvl,100);assert.equal(first.solana.tvl,50);assert.equal(first.dex.volume24h,200);assert.equal(first.source,'DefiLlama')
 now+=60000;assert.deepEqual(await service.snapshot(),first);assert.equal(calls,2)
 now+=300000;assert.equal((await service.snapshot()).dex.fetchedAt,now);assert.equal(calls,4)
})
test('an independent failure or invalid metric never fabricates zero or hides other metrics',async()=>{
 const service=new SonarDefiService(async url=>String(url).includes('/v2/chains')?Response.json([{name:'Ethereum',tvl:-1},{name:'Solana',tvl:0}]):new Response('throttled',{status:429}))
 const data=await service.snapshot();assert.equal(data.ethereum,null);assert.equal(data.solana.tvl,0);assert.equal(data.dex,null)
})
