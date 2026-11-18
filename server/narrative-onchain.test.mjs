import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NarrativeOnchain} from './dist/server/narrative-onchain.js'
const now=Date.now(),sender='0x1111111111111111111111111111111111111111'
function fetcher(failSol=false,stale=false){return async (url,init)=>{
 const {method,params}=JSON.parse(init.body)
 if(url.includes('solana')&&failSol)return Response.json({error:{message:'secret-key must not be exposed'}})
 let result
 if(method==='eth_getBlockByNumber'){assert.deepEqual(params,['finalized',true]);result={number:'0x100',timestamp:'0x'+Math.floor((now-(stale?1800000:600000))/1000).toString(16),transactions:[{from:sender},{from:sender}]}}
 else if(method==='getSlot'){assert.equal(params[0].commitment,'finalized');result=123}
 else{assert.equal(method,'getBlock');assert.equal(params[1].transactionDetails,'signatures');result={blockTime:Math.floor(now/1000),signatures:['one','two','three']}}
 return Response.json({result})
}}
test('narrative on-chain health collects real finalized Ethereum/Solana activity with bounded cached requests',async()=>{
 let requests=0;const get=fetcher();const source=new NarrativeOnchain('test-key',async(...args)=>{requests++;return get(...args)},()=>now)
 const health=await source.collect();assert.equal(health.status,'live');assert.equal(health.updatedAt,now)
 assert.match(health.message,/2 transactions, 1 sending addresses/);assert.match(health.message,/3 transaction signatures/);assert.match(health.message,/narrative-specific wallet attribution is unavailable/)
 await source.collect();assert.equal(requests,3)
})
test('unconfigured, partial, RPC errors and stale chain samples never report healthy full coverage',async()=>{
 assert.equal((await new NarrativeOnchain('',fetcher(),()=>now).collect()).status,'unconfigured')
 const partial=await new NarrativeOnchain('secret-key',fetcher(true),()=>now).collect();assert.equal(partial.status,'error');assert.match(partial.message,/Solana collection unavailable/);assert.doesNotMatch(partial.message,/secret-key/)
 const stale=await new NarrativeOnchain('key',fetcher(false,true),()=>now).collect();assert.equal(stale.status,'error');assert.match(stale.message,/Ethereum collection unavailable/)
})
