import { mkdir,readFile,rename,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EthereumProvider } from './ethereum-provider.js'
import { AlchemyEthereumWalletProvider } from './alchemy-ethereum-wallet.js'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { DefiLlama } from './defillama.js'
import { ProviderCache } from './provider-cache.js'
import type { EthereumSnapshot } from '../src/lib/ethereum-wallet.js'
export class EthereumWalletService {
  private cache=new ProviderCache()
  private provider:Pick<EthereumProvider,'snapshot'|'largeHolders'> & {source?:string}
  private prices:DefiLlama
  private state:Record<string,EthereumSnapshot>={}
  private ready:Promise<void>
  private writing=Promise.resolve()
  private pending=new Map<string,Promise<EthereumSnapshot>>()
  constructor(private filename=process.env.ETHEREUM_WALLET_STORE_PATH??'data/ethereum-wallets.json',provider?:Pick<EthereumProvider,'snapshot'|'largeHolders'> & {source?:string},prices?:DefiLlama) {
    this.provider=provider??(process.env.ALCHEMY_API_KEY ? new AlchemyEthereumWalletProvider(new AlchemyWalletRpc(process.env.ALCHEMY_API_KEY,'eth-mainnet',this.cache)) : new EthereumProvider(this.cache));this.prices=prices??new DefiLlama(this.cache)
    this.ready=this.load();void this.ready.catch(()=>{})
  }
  private async load() {
    try { const data=JSON.parse(await readFile(this.filename,'utf8')); if(data.version!==1||!data.wallets||typeof data.wallets!=='object'||Array.isArray(data.wallets)) throw new Error('Invalid Ethereum wallet store');this.state=data.wallets }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
  private save() {
    const data=JSON.stringify({version:1,wallets:this.state})
    this.writing=this.writing.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.filename),{recursive:true});await writeFile(`${this.filename}.tmp`,data,{mode:0o600});await rename(`${this.filename}.tmp`,this.filename)})
    return this.writing
  }
  largeHolders(){return this.provider.largeHolders()}
  async wallet(address:string):Promise<EthereumSnapshot> {
    await this.ready;address=address.toLowerCase()
    const old=this.state[address]
    if(old&&Date.now()-old.at<60000&&(old.source??'blockscout')===(this.provider.source??'blockscout'))return old
    const pending=this.pending.get(address);if(pending)return pending
    const run=async()=>{
      const observed=await this.provider.snapshot(address)
      const at=Date.now()
      const activities=[...new Map([...(old?.activities??[]),...observed.activities].map(a=>[a.signature,a])).values()].sort((a,b)=>b.at-a.at).slice(0,1000)
      const ids=[...new Set([...observed.holdings.map(h=>h.mint),...activities.flatMap(a=>a.tokens.map(t=>t.mint))])]
      let pricingTimer:ReturnType<typeof setTimeout>|undefined
      const quotes=await Promise.race([
        this.prices.valueBalances('ethereum',ids.map(mint=>({mint,amount:'1'})),at),
        new Promise<{balances:Awaited<ReturnType<DefiLlama['valueBalances']>>['balances'];error:string}>(resolve=>{pricingTimer=setTimeout(()=>resolve({balances:[],error:'USD pricing is delayed; observed quantities remain available.'}),8000)})
      ]).finally(()=>{if(pricingTimer)clearTimeout(pricingTimer)})
      const prices=new Map(quotes.balances.map(q=>[q.mint,q]))
      const holdings=observed.holdings.map(h=>{
        const quote=prices.get(h.mint),value=quote?.priceUsd!=null?Number(h.amount)*quote.priceUsd:null
        return {...h,priceUsd:quote?.priceUsd??null,valueUsd:value!==null&&Number.isFinite(value)?value:null,priceAt:quote?.priceAt??null}
      }).sort((a,b)=>(b.valueUsd??-1)-(a.valueUsd??-1))
      for(const activity of activities) activity.tokenValues=activity.tokenValues.map(t=>{
        const price=prices.get(t.mint)?.priceUsd,value=price!=null?t.amount*price:null
        return {...t,valueUsd:value!==null&&Number.isFinite(value)?value:null}
      })
      const priced=holdings.filter(h=>h.valueUsd!==null),sum=priced.reduce((s,h)=>s+h.valueUsd!,0)
      const result:EthereumSnapshot={source:this.provider.source??'blockscout',address,at,holdings,activities,pricedSubtotalUsd:priced.length&&Number.isFinite(sum)?sum:null,unpricedCount:holdings.length-priced.length,warnings:[...observed.warnings,...(quotes.error?[quotes.error]:[])],coverage:'Ethereum mainnet · observed ETH and ERC-20 holdings · up to 8 recent transactions examined per refresh · retained observed history, not a complete wallet history. Purchases require confirmed Uniswap v2/v3 events from authenticated pools. USD amounts use current quotes, not historical execution prices.'}
      if(!this.state[address]&&Object.keys(this.state).length>=50)delete this.state[Object.keys(this.state)[0]]
      this.state[address]=result;await this.save();return result
    }
    const promise=run().finally(()=>this.pending.delete(address));this.pending.set(address,promise);return promise
  }
}
