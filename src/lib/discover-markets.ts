import { assetKey } from './token-identity.js'
export const DISCOVER_NETWORKS = [
  { id: 'eth', name: 'Ethereum', short: 'ETH', explorer: 'https://etherscan.io/token/' },
  { id: 'solana', name: 'Solana', short: 'SOL', explorer: 'https://solscan.io/token/' },
  { id: 'bsc', name: 'BNB Chain', short: 'BNB', explorer: 'https://bscscan.com/token/' },
] as const
export type DiscoverNetwork = typeof DISCOVER_NETWORKS[number]['id']
export type DiscoveredPool = {
  source?: 'Alchemy' | 'CoinGecko' | 'GeckoTerminal'; observedAt?: number; feedNotice?: string; priceSource?: 'Alchemy'
  dexData?: { url: string; price: number | null; marketCap: number | null; fdv: number | null; promotion: string; observation: { at: number; liquidity: number | null; volume: number | null; buys: number | null; sells: number | null }; liquidityDelta: number | null; volumeDelta: number | null } | null
  enrichmentError?: string
  id: string; network: DiscoverNetwork; address: string; name: string
  symbol: string; tokenAddress: string | null; image: string | null; dex: string
  createdAt: number; price: number | null; liquidity: number | null; volume: number | null
  change: number | null; fdv: number | null; buys: number | null; sells: number | null
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const numeric = (value: unknown): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
const text = (value: unknown) => typeof value === 'string' ? value : ''
const relationId = (relationships: Record<string, unknown>, name: string) => text(record(record(relationships[name]).data).id)

export function parseNewPools(payload: unknown, network: DiscoverNetwork): DiscoveredPool[] {
  const response = record(payload)
  if (!Array.isArray(response.data)) throw new Error('Invalid pool response')
  const included = new Map((Array.isArray(response.included) ? response.included : []).map((item) => {
    const resource = record(item)
    return [text(resource.id), record(resource.attributes)]
  }))
  const unique = new Map<string, DiscoveredPool>()
  for (const value of response.data) {
    const pool = record(value), attributes = record(pool.attributes), relationships = record(pool.relationships)
    const address = text(attributes.address)
    const createdAt = Date.parse(text(attributes.pool_created_at))
    if (!address || !Number.isFinite(createdAt)) continue
    const token = included.get(relationId(relationships, 'base_token')) ?? {}
    const dexId = relationId(relationships, 'dex')
    const dex = included.get(dexId) ?? {}
    const image = text(token.image_url)
    const transactions = record(record(attributes.transactions).h24)
    const row: DiscoveredPool = {
      id: assetKey(network, address), network, address, createdAt,
      name: text(attributes.name) || 'Unnamed pool', symbol: text(token.symbol),
      tokenAddress: text(token.address) || null, image: /^https?:\/\//.test(image) ? image : null,
      dex: text(dex.name) || dexId || 'Unknown DEX',
      price: numeric(attributes.base_token_price_usd), liquidity: numeric(attributes.reserve_in_usd),
      volume: numeric(record(attributes.volume_usd).h24), change: numeric(record(attributes.price_change_percentage).h24),
      fdv: numeric(attributes.fdv_usd), buys: numeric(transactions.buys), sells: numeric(transactions.sells),
    }
    unique.set(row.id, row)
  }
  return [...unique.values()].sort((a, b) => b.createdAt - a.createdAt)
}
export async function fetchNewPools(network: DiscoverNetwork, page: number, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools`)
  url.search = new URLSearchParams({ include: 'base_token,quote_token,dex', page: String(page) }).toString()
  const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(response.status === 429 ? 'Rate limited · retrying on the next refresh' : `Feed unavailable (HTTP ${response.status})`)
  return parseNewPools(await response.json(), network)
}

export async function fetchEnrichedNewPools(network: DiscoverNetwork, page: number, signal: AbortSignal): Promise<DiscoveredPool[]> {
  const response = await fetch(`/api/discovery/pools?network=${network}&page=${page}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) })
  if (!response.ok) throw new Error('New pool feed unavailable · retrying on the next refresh')
  const pools = await response.json()
  if (!Array.isArray(pools)) throw new Error('Invalid discovery response')
  return pools
}
