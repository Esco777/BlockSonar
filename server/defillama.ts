import { assetKey, canonicalChain, validAddress } from '../src/lib/token-identity.js'
import type { BalanceValuation, WalletBalance, WalletValuation } from '../src/lib/wallet-valuation.js'
import { ProviderCache } from './provider-cache.js'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
export function llamaCoinId(chain: string, mint: string): string | null {
  const network = canonicalChain(chain)
  if (network === 'ethereum' && mint === 'ETH') return 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  if (network === 'solana' && mint === 'SOL') return `solana:${WRAPPED_SOL}`
  return validAddress(network, mint) ? assetKey(network, mint) : null
}
type Quote = { price?: unknown; timestamp?: unknown; confidence?: unknown }
/** Market valuation only. These quotes are never treated as trade execution prices or cost basis. */
export class DefiLlama {
  constructor(private cache = new ProviderCache(), private now = Date.now) {}
  async valueBalances(chain: string, balances: WalletBalance[], balancesAt: number | null): Promise<WalletValuation> {
    const ids = [...new Set(balances.map(b => llamaCoinId(chain, b.mint)).filter((id): id is string => !!id))].sort()
    const quotes = new Map<string, Quote>()
    let error: string | null = null
    // Bound cost independently of wallet size; omitted prices stay explicitly unavailable.
    for (let offset = 0; offset < Math.min(ids.length, 200); offset += 50) {
      const batch = ids.slice(offset, offset + 50)
      try {
        const data = await this.cache.get<{ coins: Record<string, Quote> }>(`https://coins.llama.fi/prices/current/${batch.map(encodeURIComponent).join(',')}`, 'defillama-prices', 30, 60000)
        if (!data?.coins || typeof data.coins !== 'object' || Array.isArray(data.coins)) throw new Error('Invalid prices')
        for (const id of batch) if (data.coins[id]) quotes.set(id, data.coins[id])
      } catch { error = 'Some DefiLlama prices are unavailable; wallet monitoring continues.' }
    }
    const at = this.now()
    const rows: BalanceValuation[] = balances.map(balance => {
      const coinId = llamaCoinId(chain, balance.mint), quote = coinId ? quotes.get(coinId) : undefined
      const amount = typeof balance.amount === 'string' && /^(?:\d+\.?\d*|\.\d+)$/.test(balance.amount) ? Number(balance.amount) : NaN
      const price = typeof quote?.price === 'number' && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null
      const priceAt = typeof quote?.timestamp === 'number' && Number.isFinite(quote.timestamp) ? quote.timestamp * 1000 : null
      const confidence = typeof quote?.confidence === 'number' && Number.isFinite(quote.confidence) && quote.confidence >= 0 && quote.confidence <= 1 ? quote.confidence : null
      const reason = !Number.isFinite(amount) || amount < 0 ? 'Invalid balance' : !coinId ? 'Unsupported token identity' : !quote ? 'No price returned' : price === null ? 'Invalid price' : priceAt === null || at - priceAt > 3600000 || priceAt > at + 60000 ? 'Missing or stale price timestamp' : confidence === null || confidence < 0.8 ? 'Missing or low price confidence' : !Number.isFinite(amount * price) ? 'Value outside supported numeric range' : null
      return { ...balance, coinId, priceUsd: reason ? null : price, valueUsd: reason ? null : amount * price!, priceAt, confidence, reason }
    })
    const priced = rows.filter(b => b.valueUsd !== null)
    const sum = priced.reduce((total, row) => total + row.valueUsd!, 0)
    const pricedSubtotalUsd = priced.length && Number.isFinite(sum) ? sum : null
    const complete = rows.length > 0 && priced.length === rows.length && pricedSubtotalUsd !== null
    return { source: 'DefiLlama', status: complete ? 'available' : priced.length ? 'partial' : 'unavailable', at, balancesAt, balances: rows, pricedSubtotalUsd, totalUsd: complete ? pricedSubtotalUsd : null, pricedCount: priced.length, unpricedCount: rows.length - priced.length, error }
  }
}
