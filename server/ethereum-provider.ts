import { ProviderCache } from './provider-cache.js'
import { classifyEthereumTransaction, type TokenMetadata } from './ethereum-classifier.js'
import { decimalUnits, type EthereumActivity, type EthereumLargeHolder } from '../src/lib/ethereum-wallet.js'
import { validAddress } from '../src/lib/token-identity.js'
const root='https://eth.blockscout.com/api/v2'
export class EthereumProvider {
  readonly chain='ethereum'
  private gate=Promise.resolve()
  private nextRequestAt=0
  constructor(private cache=new ProviderCache()) {}
  private async get<T=any>(path:string,ttl=60000,retries=1):Promise<T> {
    const turn=this.gate.then(async()=>{
      const delay=Math.max(0,this.nextRequestAt-Date.now())
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay))
      this.nextRequestAt=Date.now()+350
    })
    this.gate=turn.catch(()=>{});await turn
    try { return await this.cache.get<T>(`${root}${path}`,'blockscout-ethereum',60,ttl) }
    catch(error) {
      const message=error instanceof Error?error.message:''
      if(retries>0 && (message==='Provider connection unavailable'||/^Provider unavailable \(HTTP (502|503|504)\)$/.test(message))) return this.get<T>(path,ttl,retries-1)
      throw error
    }
  }
  async largeHolders():Promise<EthereumLargeHolder[]> {
    const data=await this.get('/addresses?sort=balance&order=desc',60000)
    if(!Array.isArray(data.items)) throw new Error('Ethereum holder list unavailable')
    return data.items.slice(0,30).flatMap((row:any)=>{
      const eth=decimalUnits(row.coin_balance,18)
      return validAddress('ethereum',row.hash??'')&&eth!==null ? [{address:row.hash.toLowerCase(),label:typeof row.name==='string'?row.name:null,eth,isContract:row.is_contract===true}] : []
    })
  }
  async snapshot(address:string) {
    const results=await Promise.allSettled([this.get(`/addresses/${address}`),this.get(`/addresses/${address}/token-balances`),this.get(`/addresses/${address}/token-transfers?type=ERC-20`),this.get(`/addresses/${address}/transactions`)])
    const value=(i:number):any=>results[i].status==='fulfilled'?(results[i] as PromiseFulfilledResult<any>).value:null
    const info=value(0)??{}, balanceData=value(1), transferData=value(2), transactionData=value(3)
    if(decimalUnits(info.coin_balance,18)===null&&!Array.isArray(balanceData)) throw new Error('Ethereum holdings are unavailable')
    const balances=Array.isArray(balanceData)?balanceData:[], transfers={items:Array.isArray(transferData?.items)?transferData.items:[]}, transactions={items:Array.isArray(transactionData?.items)?transactionData.items:[]}
    const warnings:string[]=[]
    if(!Array.isArray(balanceData))warnings.push('ERC-20 holdings are unavailable; showing only the observed native balance.')
    if(!Array.isArray(transferData?.items)||!Array.isArray(transactionData?.items))warnings.push('Recent transaction discovery is incomplete; balances remain visible.')
    const metadata:TokenMetadata={}
    const remember=(token:any)=>{
      const mint=String(token?.address_hash??'').toLowerCase(),decimals=Number(token?.decimals)
      if(validAddress('ethereum',mint)&&decimalUnits('0',token?.decimals)!==null&&Number.isInteger(decimals)&&decimals>=0&&decimals<=36) metadata[mint]={decimals,symbol:typeof token.symbol==='string'?token.symbol.slice(0,30):mint.slice(0,8)}
    }
    for(const row of balances) remember(row.token)
    for(const row of transfers.items) remember(row.token)
    const eth=decimalUnits(info.coin_balance,18)
    const holdings:Array<{mint:string;symbol:string;amount:string}>=eth!==null?[{mint:'ETH',symbol:'ETH',amount:eth}]:[]
    const validBalances=balances.filter((row:any)=>row.token?.type==='ERC-20'&&!['scam','spam'].includes(String(row.token?.reputation).toLowerCase()))
    for(const row of validBalances.slice(0,200)) {
      const mint=String(row.token?.address_hash??'').toLowerCase(),meta=metadata[mint]
      const amount=meta?decimalUnits(row.value,meta.decimals):null
      if(meta&&amount!==null&&Number(amount)>0) holdings.push({mint,symbol:meta.symbol,amount})
    }
    const timeline=[...transfers.items.map((t:any)=>({hash:t.transaction_hash,at:Date.parse(t.timestamp)})),...transactions.items.map((t:any)=>({hash:t.hash,at:Date.parse(t.timestamp)}))].filter(t=>typeof t.hash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(t.hash)&&Number.isFinite(t.at)).sort((a,b)=>b.at-a.at)
    const hashes=[...new Set<string>(timeline.map(t=>t.hash))].slice(0,8)
    const activities:EthereumActivity[]=[]
    const detailDeadline=Date.now()+10000
    if(validBalances.length>200) warnings.push('Token holdings are limited to the first 200 ERC-20 balance entries.')
    if(eth===null) warnings.push('Native ETH balance is unavailable.')
    for(let offset=0;offset<hashes.length;offset+=2) {
      if(Date.now()>=detailDeadline){warnings.push('Transaction confirmation budget reached; remaining activity will retry on the next refresh.');break}
      const detailWork=Promise.allSettled(hashes.slice(offset,offset+2).map(async hash=>{
        const [tx,logs]=await Promise.all([this.get(`/transactions/${hash}`),this.get(`/transactions/${hash}/logs`)])
        if(tx.hash?.toLowerCase()!==hash.toLowerCase()||!Array.isArray(logs.items)) throw new Error('Incomplete transaction data')
        const activity=classifyEthereumTransaction(tx,logs.items,address,metadata,!logs.next_page_params)
        activity.tokenValues=activity.tokens.map(t=>({...t,symbol:metadata[t.mint]?.symbol??t.mint,valueUsd:null,purchased:activity.buyMints.includes(t.mint)}))
        return activity
      }))
      let timer:ReturnType<typeof setTimeout>|undefined
      const results=await Promise.race([detailWork,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),Math.max(1,detailDeadline-Date.now()))})]).finally(()=>{if(timer)clearTimeout(timer)})
      if(!results){warnings.push('Transaction confirmation is delayed; holdings remain visible and no pending activity is labeled a buy.');break}
      for(const result of results) if(result.status==='fulfilled'&&Number.isFinite(result.value.at)) activities.push(result.value); else warnings.push('Some transaction details could not be confirmed; retry on the next refresh.')
    }
    return {holdings,activities,warnings:[...new Set(warnings)],metadata}
  }
}
