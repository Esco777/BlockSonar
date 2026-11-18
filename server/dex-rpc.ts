import { getAddress } from 'ethers'
import { poolAbi, dexAdapters, adapterForProtocol, decodeProtocolSwap, poolLookup, type DexChain } from './dex-adapters.js'
export { poolAbi } from './dex-adapters.js'

export const BASE_V3_FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd'
export type RawDexLog = { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean }
export const hexBlock = (block: bigint) => `0x${block.toString(16)}`
export function decodeSwap(log: RawDexLog, token0: string, token1: string) {
  return decodeProtocolSwap(adapterForProtocol('base-uniswap-v3'), log, token0, token1)!
}
export class DexRpc {
  private nextAt = 0
  constructor(private url: string, private fetcher: typeof fetch = fetch) {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DEX RPC requires HTTP(S)')
  }
  async call<T = any>(method: string, params: unknown[]): Promise<T> {
    const delay = Math.max(0, this.nextAt - Date.now())
    this.nextAt = Date.now() + delay + 200
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    // Never log the provider URL: it may contain credentials.
    const response = await this.fetcher(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`DEX RPC HTTP ${response.status}`)
    const result = await response.json()
    if (result.error || result.result == null) throw new Error(`DEX RPC ${method} failed`)
    return result.result as T
  }
  async block(number: string) {
    const block = await this.call<{ hash: string; parentHash: string; number: string; timestamp: string }>('eth_getBlockByNumber', [number, false])
    if (!/^0x[0-9a-f]{64}$/i.test(block.hash) || !/^0x[0-9a-f]+$/i.test(block.timestamp)) throw new Error('Invalid block response')
    return block
  }
  async verifyPool(pool: string, chain: DexChain = 'base') {
    getAddress(pool)
    const read = async (name: string) => {
      const data = await this.call<string>('eth_call', [{ to: pool, data: poolAbi.encodeFunctionData(name) }, 'latest'])
      return poolAbi.decodeFunctionResult(name, data)[0]
    }
    const factory = String(await read('factory')).toLowerCase()
    const adapter = dexAdapters.find(a => a.chain === chain && a.factory === factory)
    if (!adapter) throw new Error('Pool does not use a supported factory on this chain')
    const token0 = String(await read('token0')).toLowerCase(), token1 = String(await read('token1')).toLowerCase()
    if (token0 === token1 || /^0x0{40}$/.test(token0) || /^0x0{40}$/.test(token1)) throw new Error('Invalid pool token addresses')
    const lookup = poolLookup(adapter, token0, token1, adapter.version === 3 ? BigInt(await read('fee')) : undefined)
    const data = await this.call<string>('eth_call', [{ to: factory, data: lookup.data }, 'latest'])
    if (lookup.decode(data) !== pool.toLowerCase()) throw new Error('Factory did not confirm pool')
    return { token0, token1, protocol: adapter.id }

  }
}
