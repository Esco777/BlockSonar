import { ProviderCache } from './provider-cache.js'

export class AlchemyWalletRpc {
  private url: string
  constructor(key: string, private network: 'eth-mainnet' | 'solana-mainnet', private cache = new ProviderCache()) {
    if (!key.trim()) throw new Error('Alchemy key is missing')
    this.url = `https://${network}.g.alchemy.com/v2/${encodeURIComponent(key.trim())}`
  }
  async call<T = any>(method: string, params: unknown[], ttl = 60000): Promise<T> {
    const data = await this.cache.get<any>(this.url, `alchemy-wallet-${this.network}`, 180, ttl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (data.error || data.result == null) throw new Error(`Alchemy wallet ${method} unavailable`)
    return data.result as T
  }
}
