import {ProviderCache} from './provider-cache.js'
import {assetKey,validAddress} from '../src/lib/token-identity.js'
import type {DiscoverNetwork,DiscoveredPool} from '../src/lib/discover-markets.js'
const networks={eth:'eth-mainnet',base:'base-mainnet',solana:'solana-mainnet',bsc:'bnb-mainnet'}
const number=(value:unknown)=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null:null
export function parseAlchemyPools(payload:any,network:DiscoverNetwork,now=Date.now()):DiscoveredPool[]{
 if(!Array.isArray(payload?.data))throw new Error('Invalid Alchemy pool response')
 const pools=new Map<string,DiscoveredPool>()
 for(const row of payload.data){
  const address=row.poolAddress,createdAt=Date.parse(row.createdAt)
  if(row.network!==networks[network]||typeof address!=='string'||!(network==='solana'?validAddress('solana',address):/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(address))||!Number.isFinite(createdAt)||createdAt>now+60000)continue
  const tokenAddress=typeof row.tokenAddress==='string'&&validAddress(network,row.tokenAddress)?row.tokenAddress:null
  const name=typeof row.name==='string'&&row.name?row.name:'Unnamed pool'
  const pool:DiscoveredPool={id:assetKey(network,address),network,address,name,symbol:typeof row.symbol==='string'?row.symbol:'',tokenAddress,image:null,dex:typeof row.dexName==='string'?row.dexName:'DEX not supplied',createdAt,price:tokenAddress?number(row.priceUsd):null,liquidity:number(row.liquidityUsd),volume:number(row.volumeUsd),change:null,fdv:number(row.fdvUsd),buys:number(row.buys),sells:number(row.sells),source:'Alchemy',observedAt:now}
  pools.set(pool.id,pool)
 }
 return [...pools.values()].sort((a,b)=>b.createdAt-a.createdAt)
}
export class AlchemyPools{
 constructor(private key=process.env.ALCHEMY_API_KEY,private cache=new ProviderCache()){}
 async pools(network:DiscoverNetwork,page:number):Promise<DiscoveredPool[]>{
  if(!this.key)throw new Error('Alchemy pool discovery requires the server API key')
  if(!Number.isInteger(page)||page<1||page>3)throw new Error('Invalid pool page')
  let cursor:string|undefined
  for(let current=1;current<=page;current++){
   const params=new URLSearchParams({network:networks[network],pageSize:'25'})
   if(cursor)params.set('pageKey',cursor)
   let response:any
   try { response=await this.cache.get<any>(`https://api.g.alchemy.com/trading/v1/${this.key}/pools/new?${params}`,'alchemy-pool-discovery',24,60000) } catch(error) { const status = /HTTP (\d+)/.exec(error instanceof Error ? error.message : '')?.[1]; throw new Error(`Alchemy pool discovery unavailable${status ? ` (HTTP ${status})` : ''}; Trading API access may need activation`) }
   const rows=parseAlchemyPools(response,network)
   if(current===page)return rows
   if(response.pageKey==null)return []
   if(typeof response.pageKey!=='string'||!response.pageKey||response.pageKey.length>4096)throw new Error('Invalid Alchemy pool cursor')
   cursor=response.pageKey
  }
  return []
 }
}
