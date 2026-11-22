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

test('DEX quotes use CoinGecko for missing Alchemy prices and preserve per-token provenance', async () => {
 const { DexPriceQuotes } = await import('./dist/server/dex-price-quotes.js')
 const { ProviderCache } = await import('./dist/server/provider-cache.js')
 const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
 const at = 1_800_000_000_000
 const fetcher = async (url, init) => {
  const endpoint = new URL(url)
  if (endpoint.hostname === 'api.g.alchemy.com') {
   return Response.json({ data: [{ network: 'eth-mainnet', address: token, prices: [
    { currency: 'usd', value: '2300', lastUpdatedAt: new Date(at).toISOString() },
   ] }] })
  }
  assert.equal(endpoint.pathname, '/api/v3/simple/token_price/ethereum')
  assert.equal(endpoint.searchParams.get('contract_addresses'), usdc)
  assert.equal(endpoint.searchParams.get('include_last_updated_at'), 'true')
  assert.equal(init.headers['x-cg-demo-api-key'], 'demo-test')
  return Response.json({ [usdc]: { usd: 0.999, last_updated_at: at / 1000 } })
 }
 const service = new DexPriceQuotes({ ALCHEMY_API_KEY: 'alchemy-test', COINGECKO_DEMO_API_KEY: 'demo-test' }, new ProviderCache(fetcher), () => at)
 assert.deepEqual((await service.getQuotes('ethereum', [token, usdc])).quotes, [
  { token, priceUsd: 2300, priceAt: at, source: 'Alchemy' },
  { token: usdc, priceUsd: 0.999, priceAt: at, source: 'CoinGecko' },
 ])
})

test('DEX quotes fall back after an Alchemy error and reject stale or wrong-case Solana prices', async () => {
 const { DexPriceQuotes } = await import('./dist/server/dex-price-quotes.js')
 const { ProviderCache } = await import('./dist/server/provider-cache.js')
 const sol = 'So11111111111111111111111111111111111111112'
 const at = 1_800_000_000_000
 const fetcher = async url => {
  if (new URL(url).hostname === 'api.g.alchemy.com') return new Response(null, { status: 503 })
  return Response.json({
   [sol]: { usd: 145, last_updated_at: at / 1000 - 3601 },
   [sol.toLowerCase()]: { usd: 150, last_updated_at: at / 1000 },
  })
 }
 const service = new DexPriceQuotes({ ALCHEMY_API_KEY: 'alchemy-test' }, new ProviderCache(fetcher), () => at)
 assert.deepEqual((await service.getQuotes('solana', [sol])).quotes, [{ token: sol, priceUsd: null, priceAt: null }])
})

test('public CoinGecko fallback requests one address at a time and keeps successful quotes', async () => {
 const { DexPriceQuotes } = await import('./dist/server/dex-price-quotes.js')
 const { ProviderCache } = await import('./dist/server/provider-cache.js')
 const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
 const at = 1_800_000_000_000
 const requested = []
 const fetcher = async url => {
  const address = new URL(url).searchParams.get('contract_addresses')
  requested.push(address)
  if (address === usdc) return new Response(null, { status: 429 })
  return Response.json({ [token]: { usd: 2300, last_updated_at: at / 1000 } })
 }
 const service = new DexPriceQuotes({}, new ProviderCache(fetcher), () => at)
 assert.deepEqual((await service.getQuotes('ethereum', [token, usdc])).quotes, [
  { token, priceUsd: 2300, priceAt: at, source: 'CoinGecko' },
  { token: usdc, priceUsd: null, priceAt: null },
 ])
 assert.deepEqual(requested.sort(), [usdc, token].sort())
})
