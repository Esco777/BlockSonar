import {coinGeckoConfig} from './coingecko-config.js'
import {ProviderCache} from './provider-cache.js'
import {GLOBAL_MARKET_DELAY_MS, GLOBAL_MARKET_MAX_AGE_MS, GLOBAL_MARKET_REFRESH_MS, type MarketSnapshot} from '../src/lib/market-snapshot.js'
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const publicGlobalUrl = 'https://api.coingecko.com/api/v3/global'
export class MarketSnapshotService{
 private cache:ProviderCache
 private lastGlobal:MarketSnapshot['global']=null
 constructor(private env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,private now=Date.now){this.cache=new ProviderCache(fetcher,now)}
 async snapshot():Promise<MarketSnapshot>{
  const {base,headers,configured}=coinGeckoConfig(this.env)
  const result:MarketSnapshot={global:null,breadth:null,sentiment:null,errors:[],checkedAt:this.now()}
  await Promise.all([
   (async()=>{
    const primary = configured
     ? await this.globalTotals(base+'/global', 'snapshot-coingecko-global', headers)
     : null
    const fallback = !primary || this.now()-primary.at>GLOBAL_MARKET_DELAY_MS
     ? await this.globalTotals(publicGlobalUrl, 'snapshot-coingecko-global-public')
     : null
    const latest = [primary, fallback, this.lastGlobal]
     .filter((value): value is NonNullable<MarketSnapshot['global']> => !!value && this.now()-value.at<=GLOBAL_MARKET_MAX_AGE_MS)
     .sort((a,b)=>b.at-a.at)[0] ?? null
    result.global = this.lastGlobal = latest
    if (!primary && !fallback) result.errors.push('Global market totals unavailable')
   })(),
   (async()=>{try{
    const rows=await this.cache.get<any>(base+'/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false','snapshot-coingecko',20,60000,{headers})
    if(!Array.isArray(rows))throw Error()
    const seen=new Set<string>(),valid=rows.filter(row=>{const at=Date.parse(row?.last_updated);if(typeof row?.id!=='string'||seen.has(row.id)||!finite(row.price_change_percentage_24h)||!Number.isFinite(at)||at>this.now()+60000||this.now()-at>600000)return false;seen.add(row.id);return true})
    if(!valid.length)throw Error()
    result.breadth={advancing:valid.filter(row=>row.price_change_percentage_24h>0).length,declining:valid.filter(row=>row.price_change_percentage_24h<0).length,unchanged:valid.filter(row=>row.price_change_percentage_24h===0).length,total:valid.length,at:Math.min(...valid.map(row=>Date.parse(row.last_updated)))}
   }catch{result.errors.push('Top-100 market breadth unavailable')}})(),
   (async()=>{try{
    const payload=await this.cache.get<any>('https://api.alternative.me/fng/?limit=1','snapshot-sentiment',10,3600000),row=payload.data?.[0],value=Number(row?.value),at=Number(row?.timestamp)*1000
    if(row?.value==null||!Number.isInteger(value)||value<0||value>100||typeof row?.value_classification!=='string'||!row.value_classification||!finite(at)||at>this.now()+60000||this.now()-at>48*3600000)throw Error()
    result.sentiment={value,label:row.value_classification,at}
   }catch{result.errors.push('Daily Bitcoin sentiment unavailable')}})()
  ])
  return result
 }
 private async globalTotals(url: string, group: string, headers?: Record<string, string>): Promise<MarketSnapshot['global']> {
  try {
   const signal = AbortSignal.timeout(8000)
   // Leave time for the previous request to finish before the next browser poll.
   const payload = await this.cache.get<any>(url, group, 20, GLOBAL_MARKET_REFRESH_MS - 5000, {headers, signal})
   const d = payload?.data
   if (!finite(d?.updated_at) || !finite(d?.total_market_cap?.usd) || d.total_market_cap.usd<=0 ||
       !finite(d?.total_volume?.usd) || d.total_volume.usd<0) return null
   const at = d.updated_at*1000
   const age = this.now()-at
   if (age < -60000 || age > GLOBAL_MARKET_MAX_AGE_MS) return null
   return {
    marketCap: d.total_market_cap.usd,
    volume: d.total_volume.usd,
    capChange: finite(d.market_cap_change_percentage_24h_usd) ? d.market_cap_change_percentage_24h_usd : null,
    volumeChange: finite(d.volume_change_percentage_24h_usd) ? d.volume_change_percentage_24h_usd : null,
    at,
   }
  } catch {
   return null
  }
 }
}
