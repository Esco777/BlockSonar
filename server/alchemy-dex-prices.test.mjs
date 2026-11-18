import {test} from 'node:test'
import assert from 'node:assert/strict'
import {AlchemyDexPrices} from './dist/server/alchemy-dex-prices.js'
const now=Date.now(), token='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
test('Alchemy quote requests use the server key, POST contract identity, correct networks, and USD source',async()=>{
 for(const [chain,network] of Object.entries({ethereum:'eth-mainnet',base:'base-mainnet',bsc:'bnb-mainnet',solana:'solana-mainnet'})){
  const cache={async get(url,group,limit,ttl,init){assert.equal(url,'https://api.g.alchemy.com/prices/v1/test-key/tokens/by-address');assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{addresses:[{network,address:token}]});return {data:[{network,address:token,prices:[{currency:'usd',value:'2000.25',lastUpdatedAt:new Date(now).toISOString()}]}]}}}
  const result=await new AlchemyDexPrices('test-key',cache,()=>now).getQuotes(chain,[token])
  assert.equal(result.source,'Alchemy');assert.equal(result.quotes[0].priceUsd,2000.25)
 }
})
test('Alchemy missing, stale, per-token errors, wrong network and invalid quotes remain unavailable',async()=>{
 for(const row of [undefined,{network:'base-mainnet',address:token,prices:[]},{network:'eth-mainnet',address:token,error:'unsupported',prices:[]},...['0','NaN','-1'].map(value=>({network:'eth-mainnet',address:token,prices:[{currency:'usd',value,lastUpdatedAt:new Date(now).toISOString()}]})),{network:'eth-mainnet',address:token,prices:[{currency:'usd',value:'2000',lastUpdatedAt:new Date(now-3600001).toISOString()}]}]){
  const cache={async get(){return {data:row?[row]:[]}}}
  assert.equal((await new AlchemyDexPrices('test-key',cache,()=>now).getQuotes('ethereum',[token])).quotes[0].priceUsd,null)
 }
 await assert.rejects(()=>new AlchemyDexPrices(undefined).getQuotes('ethereum',[token]),/not configured/)
})
