import { AbiCoder, Interface, getCreate2Address, keccak256, solidityPacked } from 'ethers'
import { decimalUnits, type EthereumActivity } from '../src/lib/ethereum-wallet.js'
import { validAddress } from '../src/lib/token-identity.js'
const abi = AbiCoder.defaultAbiCoder()
export const V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
export const V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const V2_INIT = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
const V3_INIT = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
export const transferAbi = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)'])
export const v2Abi = new Interface(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)','event Mint(address indexed sender,uint256 amount0,uint256 amount1)','event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)'])
export const v3Abi = new Interface(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)','event Mint(address sender,address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)','event Burn(address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)'])
export function uniswapPool(tokenA: string, tokenB: string, fee?: number): string {
  const [a,b] = [tokenA.toLowerCase(),tokenB.toLowerCase()].sort()
  return getCreate2Address(fee === undefined ? V2_FACTORY : V3_FACTORY,keccak256(fee === undefined ? solidityPacked(['address','address'],[a,b]) : abi.encode(['address','address','uint24'],[a,b,fee])),fee === undefined ? V2_INIT : V3_INIT).toLowerCase()
}
export type TokenMetadata = Record<string,{ decimals: number; symbol: string; logo?: string }>
/** Authenticate event emitters using official Uniswap CREATE2 pool addresses; selectors alone prove no buy. */
export function classifyEthereumTransaction(tx: any, logs: any[], wallet: string, metadata: TokenMetadata, complete: boolean): EthereumActivity {
  const owner=wallet.toLowerCase(), at=Date.parse(tx.timestamp ?? '')
  const base: EthereumActivity={signature:String(tx.hash??''),wallet:owner,chain:'ethereum',at,kind:'unknown',tokens:[],feeSol:null,nativeEthDelta:null,feeEth:tx.fee?.type==='actual' && decimalUnits(tx.fee.value,18)!==null ? Number(decimalUnits(tx.fee.value,18)) : null,buyMints:[],verification:'No supported swap confirmed',tokenValues:[]}
  if (tx.status==='error' || tx.result==='execution reverted') return {...base,kind:'failed',verification:'Failed transaction; token changes were not executed'}
  if (tx.status!=='ok' || !(Number(tx.confirmations)>0)) return {...base,verification:'Pending or unconfirmed transaction'}
  const native=decimalUnits(tx.value,18)
  const from=String(tx.from?.hash??'').toLowerCase(), to=String(tx.to?.hash??'').toLowerCase()
  base.nativeEthDelta=native!==null&&Number.isFinite(Number(native)) ? (to===owner?Number(native):0)-(from===owner?Number(native):0) : null
  const transfers: Array<{mint:string;from:string;to:string;raw:bigint}>=[]
  for (const log of logs) {
    if (!validAddress('ethereum',log.address?.hash ?? log.address ?? '')) continue
    try {
      const event=transferAbi.parseLog({topics:log.topics.filter(Boolean),data:log.data})
      if (event?.name==='Transfer') transfers.push({mint:String(log.address?.hash??log.address).toLowerCase(),from:event.args.from.toLowerCase(),to:event.args.to.toLowerCase(),raw:event.args.value})
    } catch { /* Unsupported or malformed logs stay unknown. */ }
  }
  const net=new Map<string,bigint>()
  for (const t of transfers) net.set(t.mint,(net.get(t.mint)??0n)+(t.to===owner?t.raw:0n)-(t.from===owner?t.raw:0n))
  for (const [mint,raw] of net) {
    if (raw===0n || !metadata[mint]) continue
    const amount=Number(decimalUnits((raw<0n?-raw:raw).toString(),metadata[mint].decimals))
    if (Number.isFinite(amount) && amount>0) base.tokens.push({mint,amount,direction:raw>0n?'in':'out'})
  }
  if (!complete) return {...base,verification:'Incomplete event logs; buy classification withheld'}
  const reachesWallet = (pool:string,mint:string) => {
    const reached=new Set([pool])
    for(let step=0;step<12;step++) {
      let changed=false
      for(const t of transfers) if(t.mint===mint&&t.raw>0n&&reached.has(t.from)&&!reached.has(t.to)) {reached.add(t.to);changed=true}
      if(reached.has(owner))return true
      if(!changed)break
    }
    return false
  }
  const outputTokens=new Set<string>(); let liquidity=false
  for (const log of logs) {
    const pool=String(log.address?.hash??log.address??'').toLowerCase()
    const candidates=[...new Set(transfers.filter(t=>t.from===pool||t.to===pool).map(t=>t.mint))].sort().slice(0,12)
    for(let i=0;i<candidates.length;i++) for(let j=i+1;j<candidates.length;j++) {
      const [a,b]=[candidates[i],candidates[j]]
      const v2=uniswapPool(a,b)===pool
      const v3=!v2 && [100,500,3000,10000].some(fee=>uniswapPool(a,b,fee)===pool)
      if(!v2&&!v3) continue
      try {
        const event=(v2?v2Abi:v3Abi).parseLog({topics:log.topics.filter(Boolean),data:log.data})
        if(event?.name==='Mint'||event?.name==='Burn') liquidity=true
        if(event?.name==='Swap') {
          if(v2) { if(event.args.amount0Out>0n&&reachesWallet(pool,a)) outputTokens.add(a); if(event.args.amount1Out>0n&&reachesWallet(pool,b)) outputTokens.add(b) }
          else { if(event.args.amount0<0n&&reachesWallet(pool,a)) outputTokens.add(a); if(event.args.amount1<0n&&reachesWallet(pool,b)) outputTokens.add(b) }
        }
      } catch { /* A forged Swap topic at an unrecognized pool cannot confirm a purchase. */ }
    }
  }
  const spent=base.tokens.some(t=>t.direction==='out') || (from===owner && native!==null && Number(native)>0)
  const buyMints=base.tokens.filter(t=>t.direction==='in'&&outputTokens.has(t.mint)).map(t=>t.mint)
  if(liquidity) return {...base,kind:'liquidity',verification:'Supported Uniswap liquidity events; mixed activity is not counted as a buy'}
  if(from===owner&&spent&&buyMints.length) return {...base,kind:'swap',buyMints,verification:'Confirmed transaction with authenticated Uniswap v2/v3 pool Swap event and wallet spend/receipt'}
  const self=from===owner&&to===owner&&base.tokens.length===0
  return {...base,kind:self?'internal':base.tokens.length || native!==null&&Number(native)>0?'transfer':'unknown',verification:'No supported purchase confirmed; transfers do not establish a buy'}
}
