import type { DexSwap } from './dex-intell.js'
import { swapQuantity, swapToken } from './swap-presentation.js'
export type SwapQuote = { priceUsd: number | null; priceAt: number | null; source?: string }
export const quoteKey = (chain: string, token: string) => `${chain}:${chain === 'solana' ? token : token.toLowerCase()}`
export function estimateSwapUsd(swap: DexSwap, quotes: Record<string, SwapQuote>, now = Date.now()): { value: number; priceAt: number; source?: string } | null {
  for (const [token, raw] of [[swap.token_in, swap.amount_in], [swap.token_out, swap.amount_out]]) {
    const decimals = swapToken(swap.chain, token).decimals, quote = quotes[quoteKey(swap.chain, token)]
    if (decimals === null || !/^\d+$/.test(raw) || !quote || quote.priceUsd === null || !Number.isFinite(quote.priceUsd) || quote.priceUsd <= 0 || quote.priceAt === null || !Number.isFinite(quote.priceAt) || now - quote.priceAt > 3600000 || quote.priceAt > now + 60000) continue
    const value = Number(swapQuantity(raw, decimals).exact) * quote.priceUsd
    if (Number.isFinite(value) && value >= 0) return { value, priceAt: quote.priceAt, ...(quote.source ? {source:quote.source} : {}) }
  }
  return null
}
