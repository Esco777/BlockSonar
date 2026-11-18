import { assetKey, canonicalChain } from '../src/lib/token-identity.js'
import type { DiscoveredPool } from '../src/lib/discover-markets.js'
import { ProviderCache } from './provider-cache.js'
export type DexObservation = { at: number; liquidity: number | null; volume: number | null; buys: number | null; sells: number | null }
export type DexEnrichment = { pairKey: string; tokenKey: string | null; url: string; price: number | null; marketCap: number | null; fdv: number | null; createdAt: number | null; promotion: 'boosted' | 'paid-order-observed' | 'not-observed' | 'unknown' ; observation: DexObservation; previous: DexObservation | null; liquidityDelta: number | null; volumeDelta: number | null }
const number = (n: unknown) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : null
export class DexScreener {
  constructor(private cache = new ProviderCache()) {}
  async pair(chain: string, address: string, token = false): Promise<any[]> {
    const network = canonicalChain(chain)
    const path = token ? `token-pairs/v1/${network}/${encodeURIComponent(address)}` : `latest/dex/pairs/${network}/${encodeURIComponent(address)}`
    const data = await this.cache.get<any>(`https://api.dexscreener.com/${path}`, 'dex-pairs', 240)
    return (Array.isArray(data) ? data : Array.isArray(data?.pairs) ? data.pairs : []).filter((p: any) => canonicalChain(p.chainId ?? '') === network)
  }
  async enrich(pool: DiscoveredPool, history: DexObservation[] = []): Promise<DexEnrichment | null> {
    let pairs = await this.pair(pool.network, pool.address)
    if (!pairs.length && pool.tokenAddress) pairs = await this.pair(pool.network, pool.tokenAddress, true)
    // Never attach metrics from a different pool for the same token.
    const pair = pairs.find(p => assetKey(p.chainId, p.pairAddress ?? '') === assetKey(pool.network, pool.address))
    if (!pair) return null
    const sameBase = !pool.tokenAddress || assetKey(pool.network, pair.baseToken?.address ?? '') === assetKey(pool.network, pool.tokenAddress)
    let promotion: DexEnrichment['promotion'] = number(pair.boosts?.active) ? 'boosted' : 'unknown'
    if (promotion !== 'boosted' && pool.tokenAddress) {
      try {
        const data = await this.cache.get<any>(`https://api.dexscreener.com/orders/v1/${canonicalChain(pool.network)}/${encodeURIComponent(pool.tokenAddress)}`, 'dex-promotions', 48, 300000)
        const orders = Array.isArray(data) ? data : data?.orders
        if (Array.isArray(orders)) promotion = orders.some((o: any) => o.status === 'approved') ? 'paid-order-observed' : 'not-observed'
      } catch { /* Promotion coverage remains unknown when its independent budget is exhausted. */ }
    }
    const cached = history.at(-1)
    const observation = cached && Date.now() - cached.at < 60000 ? cached : { at: Date.now(), liquidity: number(pair.liquidity?.usd), volume: number(pair.volume?.h24), buys: number(pair.txns?.h24?.buys), sells: number(pair.txns?.h24?.sells) }
    const previous = history.filter(o => o.at < observation.at).at(-1) ?? null
    return { pairKey: assetKey(pool.network, pool.address), tokenKey: pool.tokenAddress ? assetKey(pool.network, pool.tokenAddress) : null,
      url: `https://dexscreener.com/${canonicalChain(pool.network)}/${encodeURIComponent(pool.address)}`, price: sameBase ? number(pair.priceUsd) : null, marketCap: sameBase ? number(pair.marketCap) : null, fdv: sameBase ? number(pair.fdv) : null, createdAt: number(pair.pairCreatedAt), promotion, observation, previous,
      liquidityDelta: previous?.liquidity != null && observation.liquidity != null ? observation.liquidity - previous.liquidity : null,
      volumeDelta: previous?.volume != null && observation.volume != null ? observation.volume - previous.volume : null }
  }
}
