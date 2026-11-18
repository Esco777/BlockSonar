import { Interface } from 'ethers'
import type { RawDexLog } from './dex-rpc.js'

export type DexChain = 'base' | 'ethereum' | 'bsc'
export const poolAbi = new Interface([
  'function factory() view returns (address)', 'function token0() view returns (address)',
  'function token1() view returns (address)', 'function fee() view returns (uint24)',
  'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
])
export const v2PoolAbi = new Interface([
  'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)',
])
export const pancakeV3PoolAbi = new Interface([
  'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint128 protocolFeesToken0,uint128 protocolFeesToken1)',
])
const v2Factory = new Interface(['function getPair(address,address) view returns (address)'])
const v3Factory = new Interface(['function getPool(address,address,uint24) view returns (address)'])
export const dexAdapters = [
  { id: 'base-uniswap-v3', chain: 'base', factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd', version: 3 },
  { id: 'ethereum-uniswap-v2', chain: 'ethereum', factory: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', version: 2 },
  { id: 'ethereum-uniswap-v3', chain: 'ethereum', factory: '0x1f98431c8ad98523631ae4a59f267346ea31f984', version: 3 },
  { id: 'bsc-pancakeswap-v2', chain: 'bsc', factory: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', version: 2 },
  { id: 'bsc-pancakeswap-v3', chain: 'bsc', factory: '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', version: 3 },
] as const
export type DexAdapter = typeof dexAdapters[number]
export function adapterForProtocol(id: string): DexAdapter {
  const adapter = dexAdapters.find(a => a.id === id)
  if (!adapter) throw new Error('Unsupported DEX protocol')
  return adapter
}
export const swapAbi = (adapter: DexAdapter) => adapter.version === 2 ? v2PoolAbi : adapter.id === 'bsc-pancakeswap-v3' ? pancakeV3PoolAbi : poolAbi
export function poolLookup(adapter: DexAdapter, token0: string, token1: string, fee?: bigint) {
  const abi = adapter.version === 2 ? v2Factory : v3Factory
  const method = adapter.version === 2 ? 'getPair' : 'getPool'
  return { data: abi.encodeFunctionData(method, adapter.version === 2 ? [token0, token1] : [token0, token1, fee]),
    decode: (data: string) => String(abi.decodeFunctionResult(method, data)[0]).toLowerCase() }
}
export function decodeProtocolSwap(adapter: DexAdapter, log: RawDexLog, token0: string, token1: string) {
  if (log.removed) throw new Error('Removed swap log')
  const parsed = swapAbi(adapter).parseLog(log)
  if (!parsed || parsed.name !== 'Swap') throw new Error('Unexpected event')
  let tokenIn: string, tokenOut: string, amountIn: bigint, amountOut: bigint
  if (adapter.version === 2) {
    const [a, b, c, d] = [parsed.args.amount0In, parsed.args.amount1In, parsed.args.amount0Out, parsed.args.amount1Out].map(BigInt)
    // Complex flash swaps and same-token repayments do not establish one trading pair direction.
    if (a > 0n && b === 0n && c === 0n && d > 0n) { tokenIn = token0; tokenOut = token1; amountIn = a; amountOut = d }
    else if (b > 0n && a === 0n && d === 0n && c > 0n) { tokenIn = token1; tokenOut = token0; amountIn = b; amountOut = c }
    else return null
  } else {
    const a = BigInt(parsed.args.amount0), b = BigInt(parsed.args.amount1)
    // Zero-sided or otherwise ambiguous events cannot establish a priced trade.
    // Retain them as unclassified instead of blocking every later batch.
    if (!((a > 0n && b < 0n) || (a < 0n && b > 0n))) return null
    tokenIn = a > 0n ? token0 : token1; tokenOut = a > 0n ? token1 : token0
    amountIn = a > 0n ? a : b; amountOut = a < 0n ? -a : -b
  }
  return { tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString(), wallet: null }
}
