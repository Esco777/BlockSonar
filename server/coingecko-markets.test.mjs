import test from 'node:test'
import assert from 'node:assert/strict'
import { CoinGeckoMarkets } from './dist/server/coingecko-markets.js'
import { coinGeckoConfig } from './dist/server/coingecko-config.js'
const row={id:'bitcoin',current_price:100,price_change_percentage_24h:1}
const response=()=>Response.json([row])
const result=()=>({headers:{},setHeader(key,value){this.headers[key]=value},writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}})
test('Demo, Pro and generic key names select the matching private headers and fixed provider host',()=>{
 const demo=coinGeckoConfig({COINGECKO_DEMO_API_KEY:' demo-secret '})
 assert.equal(demo.mode,'demo');assert.equal(demo.base,'https://api.coingecko.com/api/v3');assert.equal(demo.headers['x-cg-demo-api-key'],'demo-secret')
 assert.equal(coinGeckoConfig({COINGECKO_API_KEY:'generic'}).headers['x-cg-demo-api-key'],'generic')
 const pro=coinGeckoConfig({COINGECKO_API_KEY:'paid',COINGECKO_API_PLAN:'pro'})
 assert.equal(pro.base,'https://pro-api.coingecko.com/api/v3');assert.equal(pro.headers['x-cg-pro-api-key'],'paid')
 assert.equal(coinGeckoConfig({}).mode,'public')
 assert.throws(()=>coinGeckoConfig({COINGECKO_API_KEY:'key',COINGECKO_API_PLAN:'invalid'}),/demo or pro/)
})
test('concurrent browsers share one authenticated request and cached data retain their original timestamp',async()=>{
 let calls=0,clock=1000000
 const service=new CoinGeckoMarkets({COINGECKO_DEMO_API_KEY:'private-demo'},async(url,init)=>{
  calls++;assert.equal(url.hostname,'api.coingecko.com');assert.equal(url.searchParams.get('per_page'),'250');assert.equal(init.headers['x-cg-demo-api-key'],'private-demo');return response()
 },()=>clock,async ms=>{clock+=ms})
 const [a,b]=await Promise.all([service.page(1),service.page(1)])
 assert.equal(calls,1);assert.deepEqual(a,b)
 clock+=60000;assert.equal((await service.page(1)).at,1000000);assert.equal(calls,1)
 const res=result();await service.handle({method:'GET'},res,new URL('http://localhost/api/market/coins?page=1'))
 assert.equal(res.headers['X-Market-API-Mode'],'demo')
 assert.doesNotMatch(JSON.stringify(res),/private-demo/)
 service.stop()
})
test('429 backoff is shared and stale prices are never relabeled as fresh',async()=>{
 let calls=0,clock=1000000,limited=false
 const service=new CoinGeckoMarkets({},async()=>{calls++;return limited?new Response('',{status:429,headers:{'Retry-After':'90'}}):response()},()=>clock,async ms=>{clock+=ms})
 const first=await service.page(1);clock+=180001;limited=true
 const stale=await service.page(1);assert.equal(stale.stale,true);assert.equal(stale.at,first.at)
 await assert.rejects(service.page(2),error=>error.status===429);assert.equal(calls,2,'cooldown prevents another upstream request')
 const res=result();await service.handle({method:'GET'},res,new URL('http://localhost/api/market/coins?page=2'))
 assert.equal(res.status,429);assert.equal(res.headers['Retry-After'],'90')
 clock+=90001;limited=false;assert.equal((await service.page(2)).stale,false);assert.equal(calls,3)
 service.stop()
})
test('key rejection and malformed configuration are explicit without exposing credentials',async()=>{
 const service=new CoinGeckoMarkets({COINGECKO_DEMO_API_KEY:'do-not-expose'},async()=>new Response('provider body must not be forwarded',{status:401}))
 const res=result();await service.handle({method:'GET'},res,new URL('http://localhost/api/market/coins?page=1'))
 assert.equal(res.status,502);assert.match(res.body.error,/rejected.*Demo/);assert.doesNotMatch(JSON.stringify(res),/do-not-expose|provider body/)
 const invalid=new CoinGeckoMarkets({COINGECKO_API_KEY:'private',COINGECKO_API_PLAN:'typo'})
 const bad=result();await invalid.handle({method:'GET'},bad,new URL('http://localhost/api/market/coins?page=1'));assert.equal(bad.status,503)
 service.stop();invalid.stop()
})
test('invalid pagination never becomes an arbitrary upstream proxy',async()=>{
 let calls=0;const service=new CoinGeckoMarkets({},async()=>{calls++;return response()})
 const res=result();await service.handle({method:'GET'},res,new URL('http://localhost/api/market/coins?page=13'))
 assert.equal(res.status,400);assert.equal(calls,0);service.stop()
})

test('backend loads saved Demo keys from .env.local without changing other app settings',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path')
 const {loadCoinGeckoEnv}=await import('./dist/server/coingecko-config.js')
 const directory=await mkdtemp(path.join(tmpdir(),'coingecko-env-')),cwd=process.cwd()
 const names=['COINGECKO_DEMO_API_KEY','COINGECKO_PRO_API_KEY','COINGECKO_API_KEY','CG_API_KEY','COINGECKO_API_PLAN'],original=Object.fromEntries(names.map(name=>[name,process.env[name]]))
 const membership=process.env.MEMBERSHIP_CHAIN_ID
 try{
  for(const name of names)delete process.env[name]
  await writeFile(path.join(directory,'.env'),'MEMBERSHIP_CHAIN_ID=999999\n')
  await writeFile(path.join(directory,'.env.local'),'COINGECKO_DEMO_API_KEY="local-demo-fixture"\n')
  process.chdir(directory);loadCoinGeckoEnv()
  assert.equal(coinGeckoConfig().headers['x-cg-demo-api-key'],'local-demo-fixture')
  assert.equal(process.env.MEMBERSHIP_CHAIN_ID,membership)
  process.env.COINGECKO_DEMO_API_KEY='deployment-secret-fixture';loadCoinGeckoEnv()
  assert.equal(process.env.COINGECKO_DEMO_API_KEY,'deployment-secret-fixture','explicit deployment secrets retain precedence')
 }finally{process.chdir(cwd);for(const name of names){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name]}await rm(directory,{recursive:true,force:true})}
})

test('instruction placeholders use public mode instead of authenticating with an example key',async()=>{
 for(const key of ['your_actual_key','YOUR_API_KEY','your_demo_api_key','your_key_here','replace_me']){
  const config=coinGeckoConfig({COINGECKO_DEMO_API_KEY:key})
  assert.equal(config.mode,'public');assert.equal(config.configured,false);assert.deepEqual(config.headers,{})
 }
 const service=new CoinGeckoMarkets({COINGECKO_DEMO_API_KEY:'your_actual_key'},async(url,init)=>{assert.deepEqual(init.headers,{});return response()})
 const res=result();await service.handle({method:'GET'},res,new URL('http://localhost/api/market/coins?page=7'))
 assert.equal(res.headers['X-Market-API-Mode'],'public');assert.equal(res.body.length,1);service.stop()
})
