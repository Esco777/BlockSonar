import {coinGeckoConfig} from './coingecko-config.js'
import {ProviderCache} from './provider-cache.js'
import type {MarketSnapshot} from '../src/lib/market-snapshot.js'
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
export class MarketSnapshotService{
 private cache:ProviderCache
 private lastGlobal:MarketSnapshot['global']=null
 constructor(private env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,private now=Date.now){this.cache=new ProviderCache(fetcher,now)}
 async snapshot():Promise<MarketSnapshot>{
  const {base,headers}=coinGeckoConfig(this.env)
  const result:MarketSnapshot={global:null,breadth:null,sentiment:null,errors:[],checkedAt:this.now()}
  await Promise.all([
   (async()=>{try{
    let payload:any
    try { payload=await this.cache.get<any>(base+'/global','snapshot-coingecko-global',20,60000,{headers}) }
    catch { payload=await this.cache.get<any>('https://api.coingecko.com/api/v3/global','snapshot-coingecko-global-public',20,60000) }
    const d=payload?.data
    const at=d?.updated_at*1000
    if(!finite(d?.total_market_cap?.usd)||d.total_market_cap.usd<=0||!finite(d?.total_volume?.usd)||d.total_volume.usd<0||!finite(at)||at>this.now()+60000||this.now()-at>600000)throw Error()
    result.global={marketCap:d.total_market_cap.usd,volume:d.total_volume.usd,capChange:finite(d.market_cap_change_percentage_24h_usd)?d.market_cap_change_percentage_24h_usd:null,volumeChange:finite(d.volume_change_percentage_24h_usd)?d.volume_change_percentage_24h_usd:null,at}
    this.lastGlobal=result.global
   }catch{if(this.lastGlobal&&this.now()-this.lastGlobal.at<=600000)result.global=this.lastGlobal;result.errors.push('Global market totals unavailable')}})(),
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
}
