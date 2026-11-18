import {test} from 'node:test'
import assert from 'node:assert/strict'
import {AlchemyPools,parseAlchemyPools} from './dist/server/alchemy-pools.js'
const now=Date.now(),address='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222'
const pool={network:'eth-mainnet',poolAddress:address,tokenAddress:token,createdAt:new Date(now-1000).toISOString(),liquidityUsd:'12345.67',priceUsd:'2.5',volumeUsd:'400',name:'TEST / ETH',buys:2,sells:3}
test('Alchemy pool parser preserves chain identities and source values without inventing absent metrics',()=>{
 const rows=parseAlchemyPools({data:[pool,pool,{...pool,network:'bnb-mainnet'},{...pool,poolAddress:'bad'},{...pool,createdAt:'invalid'}]},'eth',now)
 assert.equal(rows.length,1);assert.equal(rows[0].liquidity,12345.67);assert.equal(rows[0].source,'Alchemy');assert.equal(rows[0].price,2.5);assert.equal(rows[0].change,null)
 assert.equal(parseAlchemyPools({data:[{...pool,tokenAddress:null,liquidityUsd:null}]},'eth',now)[0].price,null)
 assert.equal(parseAlchemyPools({data:[{...pool,poolAddress:'0x'+'a'.repeat(64)}]},'eth',now).length,1)
 assert.throws(()=>parseAlchemyPools({},'eth',now))
})
test('Alchemy pool discovery keeps credentials server-side and paginates using opaque cursors',async()=>{
 let calls=0
 const cache={async get(url){calls++;const request=new URL(url);assert.equal(request.origin,'https://api.g.alchemy.com');assert.equal(request.searchParams.get('network'),'eth-mainnet');assert.equal(request.searchParams.get('pageSize'),'25');if(calls===1)return {data:[pool],pageKey:'opaque+/='};assert.equal(request.searchParams.get('pageKey'),'opaque+/=');return {data:[],pageKey:null}}}
 assert.deepEqual(await new AlchemyPools('test-key',cache).pools('eth',2),[]);assert.equal(calls,2)
 await assert.rejects(()=>new AlchemyPools('').pools('eth',1),/server API key/)
 await assert.rejects(()=>new AlchemyPools('key',cache).pools('eth',4),/Invalid pool page/)
})
