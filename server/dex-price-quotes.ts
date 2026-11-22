import { AlchemyDexPrices } from './alchemy-dex-prices.js'
import { coinGeckoConfig } from './coingecko-config.js'
import { ProviderCache } from './provider-cache.js'

const platforms = new Map([
  ['ethereum', 'ethereum'],
  ['base', 'base'],
  ['bsc', 'binance-smart-chain'],
  ['solana', 'solana'],
])

type Quote = {
  token: string
  priceUsd: number | null
  priceAt: number | null
  source?: 'Alchemy' | 'CoinGecko'
}

export class DexPriceQuotes {
  constructor(
    private env: NodeJS.ProcessEnv,
    private cache = new ProviderCache(),
    private now = Date.now,
    private alchemy = new AlchemyDexPrices(env.ALCHEMY_API_KEY?.trim(), cache, now),
  ) {}

  async getQuotes(chain: string, tokens: string[]) {
    const platform = platforms.get(chain)
    if (!platform) throw new Error('Unsupported USD pricing chain')
    const normalize = (token: string) => chain === 'solana' ? token : token.toLowerCase()
    const quotes = new Map<string, Quote>()
    if (this.env.ALCHEMY_API_KEY?.trim()) {
      try {
        const result = await this.alchemy.getQuotes(chain, tokens)
        for (const quote of result.quotes) {
          if (quote.priceUsd !== null) quotes.set(normalize(quote.token), { ...quote, source: 'Alchemy' })
        }
      } catch { /* Try CoinGecko for missing quotes. */ }
    }

    const missing = [...new Set(tokens.map(normalize))].filter(token => !quotes.has(token)).sort()
    const at = this.now()
    if (missing.length) {
      try {
        const { base, headers, configured } = coinGeckoConfig(this.env)
        const batches = configured ? [missing] : missing.map(token => [token])
        const responses = await Promise.allSettled(batches.map(tokens => {
          const params = new URLSearchParams({
            contract_addresses: tokens.join(','),
            vs_currencies: 'usd',
            include_last_updated_at: 'true',
          })
          return this.cache.get<Record<string, { usd?: number; last_updated_at?: number }>>(
            `${base}/simple/token_price/${platform}?${params}`, 'coingecko-dex-prices', 12, 60000, { headers },
          )
        }))
        const requested = new Set(missing)
        const rows = responses.flatMap(response => response.status === 'fulfilled' ? Object.entries(response.value ?? {}) : [])
        for (const [token, row] of rows) {
          const key = normalize(token)
          const price = row?.usd
          const timestamp = row?.last_updated_at
          if (!requested.has(key) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
              typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue
          const priceAt = timestamp * 1000
          if (at - priceAt > 3600000 || priceAt > at + 60000) continue
          quotes.set(key, { token, priceUsd: price, priceAt, source: 'CoinGecko' })
        }
      } catch { /* Preserve valid primary quotes when the fallback fails. */ }
    }

    return {
      at,
      quotes: tokens.map(token => ({ ...(quotes.get(normalize(token)) ?? { priceUsd: null, priceAt: null }), token })),
    }
  }
}
