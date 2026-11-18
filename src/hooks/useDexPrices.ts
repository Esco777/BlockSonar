import { useEffect, useState } from 'react'
import type { DexSwap } from '../lib/dex-intell'
import { swapToken } from '../lib/swap-presentation'
import { quoteKey, type SwapQuote } from '../lib/swap-valuation'
export function useDexPrices(swaps: DexSwap[], access: string) {
  const [quotes, setQuotes] = useState<Record<string, SwapQuote>>({})
  const tokens = [...new Set(swaps.flatMap(swap => [swap.token_in, swap.token_out].filter(token => swapToken(swap.chain, token).decimals !== null).map(token => quoteKey(swap.chain, token))))].sort().slice(0, 8).join(',')
  useEffect(() => {
    if (!tokens) return
    const controller = new AbortController()
    const run = async () => {
      const results: Record<string, SwapQuote> = {}
      const groups = new Map<string, string[]>()
      for (const key of tokens.split(',')) { const [chain, token] = key.split(':'); groups.set(chain, [...(groups.get(chain) ?? []), token]) }
      await Promise.all([...groups].flatMap(([chain, addresses]) => Array.from({length:Math.ceil(addresses.length / 2)}, (_, index) => (async () => {
        try {
          const params = new URLSearchParams({chain,tokens:addresses.slice(index * 2, index * 2 + 2).join(',')})
          const response = await fetch(`/api/dex/prices?${params}`, {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),headers:access ? {Authorization:`Bearer ${access}`} : undefined})
          if (!response.ok) return
          const data = await response.json()
          for (const quote of data.quotes ?? []) results[quoteKey(chain, quote.token)] = {priceUsd:quote.priceUsd,priceAt:quote.priceAt,source:typeof data.source === 'string' ? data.source : undefined}
        } catch { /* Missing prices stay unavailable. */ }
      })())))
      if (!controller.signal.aborted) setQuotes(results)
    }
    void run(); const timer = window.setInterval(() => void run(), 60000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [tokens, access])
  return quotes
}
