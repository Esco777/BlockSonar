import { swapQuantity, swapToken, type TokenMark } from './swap-presentation.js'
import type { HolderDirectory } from './holder-rankings.js'
export type WalletHologramEntry = { id: string; mint: string; symbol: string; name: string; mark: TokenMark; amount: string; usd: number | null; owner: string; logo?: string }
export function walletAsset(chain: 'ethereum' | 'solana', mint: string, symbol?: string) {
  if (mint === 'ETH' && chain === 'ethereum') return { symbol: 'ETH', name: 'Ether', mark: 'ethereum' as const }
  if (mint === 'SOL' && chain === 'solana') return { symbol: 'SOL', name: 'Solana', mark: 'solana' as const }
  const known = swapToken(chain, mint)
  return { symbol: symbol || known.symbol, name: known.mark === 'unknown' ? 'Observed token holding' : known.name, mark: known.mark }
}
export function walletAmount(amount: string) {
  if (!/^\d+(\.\d+)?$/.test(amount)) return { display: 'Unavailable', exact: amount, raw: false }
  const [whole, fraction = ''] = amount.split('.')
  return swapQuantity(whole + fraction, fraction.length)
}
export const nextWalletEntry = (index: number, length: number) => length > 0 ? (index + 1) % length : 0
export function directoryBalanceEntries(chain: 'ethereum' | 'solana', directory: HolderDirectory | null): WalletHologramEntry[] {
  const mint = chain === 'ethereum' ? 'ETH' : 'SOL'
  return directory?.holders.map(h => ({ id: h.address, mint, ...walletAsset(chain, mint), name: h.label || (chain === 'ethereum' ? 'Native Ether balance' : 'Native SOL balance'), amount: h.amount, usd: null, owner: h.address })) ?? []
}

export function walletCycleStep(index: number, length: number): number | null {
  return length > 0 && index + 3 < length ? index + 3 : null
}
