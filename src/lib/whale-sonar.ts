import type { HolderSearchResult, WhalePurchase } from './holder-search.js'
import { compareNativeBalances } from './holder-rankings.js'
import { validAddress } from './token-identity.js'
export type WhaleSonarFeed = { latest: WhalePurchase | null; active: boolean; checking: boolean; delayed: boolean; checked: number; targeted: number; observedAt: number | null }
export function recentWhalePurchase(chain: 'ethereum' | 'solana', search: HolderSearchResult | null, previous: WhalePurchase | null = null, now = Date.now()): WhalePurchase | null {
  if (!search) return null
  const key = (address: string) => chain === 'ethereum' ? address.toLowerCase() : address
  const candidates = [...search.purchases, ...(previous ? [previous] : [])].filter(purchase => {
    if (!validAddress(chain, purchase.wallet) || !validAddress(chain, purchase.token) || !Number.isFinite(purchase.at) || purchase.at <= 0 || purchase.at < now - 86400000 || purchase.at > now) return false
    if (typeof purchase.amount !== 'string' || !Number.isFinite(Number(purchase.amount)) || Number(purchase.amount) <= 0) return false
    if (!(chain === 'ethereum' ? /^0x[0-9a-f]{64}$/i : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/).test(purchase.signature)) return false
    const holder = search.holders.find(holder => key(holder.address) === key(purchase.wallet))
    try { return !!holder && !holder.isContract && compareNativeBalances(holder.amount, search.parameters.whaleMinimum) <= 0 } catch { return false }
  }).sort((a, b) => b.at - a.at || a.signature.localeCompare(b.signature) || a.token.localeCompare(b.token))
  const latest = candidates[0]
  return latest ? { ...latest, balance: search.holders.find(holder => key(holder.address) === key(latest.wallet))!.amount } : null
}
