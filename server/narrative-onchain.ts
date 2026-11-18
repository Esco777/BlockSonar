import {ProviderCache} from './provider-cache.js'
import type {NarrativeSource} from '../src/lib/early-narrative.js'
export class NarrativeOnchain {
 private cache:ProviderCache
 constructor(private key=process.env.ALCHEMY_API_KEY,fetcher:typeof fetch=fetch,private now=Date.now){this.cache=new ProviderCache(fetcher,now)}
 private async rpc(network:string,method:string,params:unknown[]):Promise<any>{
  const response=await this.cache.get<any>(`https://${network}.g.alchemy.com/v2/${this.key}`,'narrative-alchemy',12,60000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  if(response.error || response.result==null)throw new Error('Alchemy activity request unavailable')
  return response.result
 }
 async collect():Promise<Pick<NarrativeSource,'status'|'message'|'updatedAt'>>{
  if(!this.key)return {status:'unconfigured',message:'Alchemy API key is not configured for on-chain collection',updatedAt:null}
  const results=await Promise.allSettled([
   (async()=>{
    const block=await this.rpc('eth-mainnet','eth_getBlockByNumber',['finalized',true])
    if(!/^0x[0-9a-f]+$/i.test(block.number)||!/^0x[0-9a-f]+$/i.test(block.timestamp)||!Array.isArray(block.transactions))throw new Error('Invalid Ethereum activity')
    const time=Number(BigInt(block.timestamp))*1000
    if(this.now()-time>20*60000||time>this.now()+60000)throw new Error('Stale Ethereum activity')
    const senders=new Set<string>()
    for(const tx of block.transactions){if(!tx||!/^0x[0-9a-f]{40}$/i.test(tx.from))throw new Error('Missing transaction sender');senders.add(tx.from.toLowerCase())}
    return `Ethereum finalized block ${BigInt(block.number)}: ${block.transactions.length} transactions, ${senders.size} sending addresses`
   })(),
   (async()=>{
    const slot=await this.rpc('solana-mainnet','getSlot',[{commitment:'finalized'}])
    if(!Number.isSafeInteger(slot)||slot<0)throw new Error('Invalid Solana slot')
    const block=await this.rpc('solana-mainnet','getBlock',[slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:0}])
    if(!Array.isArray(block.signatures)||block.signatures.some((signature:unknown)=>typeof signature!=='string')||typeof block.blockTime!=='number'||!Number.isFinite(block.blockTime)||this.now()-block.blockTime*1000>5*60000||block.blockTime*1000>this.now()+60000)throw new Error('Invalid or stale Solana activity')
    return `Solana finalized slot ${slot}: ${block.signatures.length} transaction signatures (includes votes)`
   })()
  ])
  const good=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[])
  const failed=results.flatMap((result,index)=>result.status==='rejected'?[index===0?'Ethereum':'Solana']:[])
  return {status:failed.length?'error':'live',updatedAt:good.length?this.now():null,message:`Alchemy · ${good.join('; ')}${failed.length?`${good.length?'; ':''}${failed.join(' / ')} collection unavailable; retrying each minute`:''}. Finalized network samples only; narrative-specific wallet attribution is unavailable.`}
 }
}
