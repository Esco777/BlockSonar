import { getAddress } from 'ethers'
import { poolAbi, dexAdapters, adapterForProtocol, decodeProtocolSwap, poolLookup, type DexChain } from './dex-adapters.js'
export { poolAbi } from './dex-adapters.js'

export const BASE_V3_FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd'
export type RawDexLog = { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean }
export const hexBlock = (block: bigint) => `0x${block.toString(16)}`
export class DexRpcError extends Error {
  constructor(readonly method: string, readonly reason: 'connection' | 'http' | 'response' | 'rpc', readonly status?: number, readonly rpcCode?: number) {
    super(status === undefined ? `DEX RPC ${method} failed` : `DEX RPC HTTP ${status}`)
  }
}
export function decodeSwap(log: RawDexLog, token0: string, token1: string) {
  return decodeProtocolSwap(adapterForProtocol('base-uniswap-v3'), log, token0, token1)!
}
export class DexRpc {
  private nextAt = 0
  private verified = new Map<string, Promise<void>>()
  constructor(private url: string, private fetcher: typeof fetch = fetch, private fallback?: { url: string; identityMethod: string; identity: string }) {
    for (const endpoint of [url, ...(fallback ? [fallback.url] : [])]) {
      if (!['http:', 'https:'].includes(new URL(endpoint).protocol)) throw new Error('DEX RPC requires HTTP(S)')
    }
  }
  private async verifyEndpoint(url: string) {
    if (!this.fallback) return
    let check = this.verified.get(url)
    if (!check) {
      const { identityMethod, identity } = this.fallback
      check = this.request<string>(url, identityMethod, []).then(actual => {
        if (actual !== identity) throw new Error('DEX RPC endpoint serves a different chain')
      }).catch(error => { this.verified.delete(url); throw error })
      this.verified.set(url, check)
    }
    await check
  }
  async call<T = any>(method: string, params: unknown[]): Promise<T> {
    const delay = Math.max(0, this.nextAt - Date.now())
    this.nextAt = Date.now() + delay + 200
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    try {
      await this.verifyEndpoint(this.url)
      return await this.request<T>(this.url, method, params)
    } catch (error) {
      if (!this.fallback) throw error
      await this.verifyEndpoint(this.fallback.url)
      return this.request<T>(this.fallback.url, method, params)
    }
  }
  private async request<T>(url: string, method: string, params: unknown[]): Promise<T> {
    // Never log the provider URL: it may contain credentials.
    const response = await this.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })
      .catch(() => { throw new DexRpcError(method, 'connection') })
    if (!response.ok) throw new DexRpcError(method, 'http', response.status)
    const result = await response.json().catch(() => { throw new DexRpcError(method, 'response') })
    if (result?.error || result?.result == null) {
      const code = result?.error?.code
      throw new DexRpcError(method, 'rpc', undefined, Number.isInteger(code) ? code : undefined)
    }
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
