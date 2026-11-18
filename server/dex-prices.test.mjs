import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DexApi } from './dist/server/dex-api.js'
const token='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
async function query(api,path,authorization){
 return new Promise(resolve=>{
 const req={socket:{remoteAddress:'test'},headers:{authorization}}
 const res={setHeader(){},writeHead(status){this.status=status},end(body){resolve({status:this.status,body:JSON.parse(body)})}}
 api.handle(req,res,new URL(path,'http://local'))
 })
}
test('DEX price route returns timestamped current quotes without requiring the swap database',async()=>{
 const api=new DexApi({})
 api.prices={async getQuotes(chain,tokens){assert.equal(chain,'ethereum');assert.deepEqual(tokens,[token]);return {source:'Alchemy',at:100,quotes:[{token,priceUsd:2500,priceAt:90}]}}}
 const result=await query(api,`/api/dex/prices?chain=ethereum&tokens=${token}`)
 assert.equal(result.status,200);assert.deepEqual(result.body.quotes,[{token,priceUsd:2500,priceAt:90}])
})
test('DEX price route rejects unbounded or invalid tokens and enforces existing access control',async()=>{
 const api=new DexApi({})
 for(const path of ['/api/dex/prices','/api/dex/prices?chain=ethereum&tokens=invalid',`/api/dex/prices?chain=ethereum&tokens=${token},${token},${token}`])assert.equal((await query(api,path)).status,400)
 assert.equal((await query(new DexApi({DEX_READ_TOKEN:'test-secret'}),`/api/dex/prices?chain=ethereum&tokens=${token}`)).status,401)
})
