import {ProviderCache} from './provider-cache.js'
import type {SonarDefi} from '../src/lib/sonar-defi.js'
const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0
/** Supplemental context only; never changes the CoinGecko market universe. */
export class SonarDefiService {
 private cache:ProviderCache
 constructor(fetcher:typeof fetch=fetch,private now=Date.now){this.cache=new ProviderCache(async(url,init)=>{
  const response=await fetcher(url,init)
  if(!response.ok)return response
  return Response.json({rows:await response.json(),fetchedAt:this.now()})
 },now)}
 async snapshot():Promise<SonarDefi>{
  const result:SonarDefi={source:'DefiLlama',ethereum:null,solana:null,dex:null}
  await Promise.all([
   (async()=>{try{
    const observation=await this.cache.get<{rows:unknown;fetchedAt:number}>('https://api.llama.fi/v2/chains','sonar-defi-tvl',10,300000)
    // Cache the observation time along with the provider response, rather than relabel cached data as newly fetched.
    if(!Array.isArray(observation.rows))return
    for(const [key,name] of [['ethereum','Ethereum'],['solana','Solana']] as const){const row=observation.rows.find(row=>row?.name===name);if(valid(row?.tvl))result[key]={tvl:row.tvl,fetchedAt:observation.fetchedAt}}
   }catch{}})(),
   (async()=>{try{
    const observation=await this.cache.get<{rows:{total24h?:unknown};fetchedAt:number}>('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume','sonar-defi-dex',10,300000)
    if(valid(observation.rows?.total24h))result.dex={volume24h:observation.rows.total24h,fetchedAt:observation.fetchedAt}
   }catch{}})()
  ])
  return result
 }
}
