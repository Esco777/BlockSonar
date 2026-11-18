import type { WalletActivity } from './wallet-intelligence.js'
export type EthereumHolding = { mint: string; symbol: string; amount: string; logo?: string; priceUsd: number | null; valueUsd: number | null; priceAt: number | null }
export type EthereumActivity = WalletActivity & { chain: 'ethereum'; nativeEthDelta: number | null; feeEth: number | null; buyMints: string[]; verification: string; tokenValues: Array<{ mint: string; symbol: string; amount: number; direction: 'in' | 'out'; valueUsd: number | null; purchased: boolean }> }
export type EthereumSnapshot = { source?: string; address: string; at: number; holdings: EthereumHolding[]; activities: EthereumActivity[]; pricedSubtotalUsd: number | null; unpricedCount: number; warnings: string[]; coverage: string }
export type EthereumLargeHolder = { address: string; label: string | null; eth: string; isContract: boolean }
export const ethereumTokenLink = (mint: string) => mint === 'ETH' ? 'https://etherscan.io' : `https://dexscreener.com/ethereum/${encodeURIComponent(mint)}`
/** Quantities remain decimal strings; numeric USD values are approximate display estimates. */
export function decimalUnits(raw: unknown, decimals: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const d = typeof decimals === 'number' ? decimals : typeof decimals === 'string' && /^\d+$/.test(decimals) ? Number(decimals) : NaN
  if (!Number.isInteger(d) || d < 0 || d > 36) return null
  const padded = raw.replace(/^0+(?=\d)/,'').padStart(d+1,'0')
  return d ? `${padded.slice(0,-d)}.${padded.slice(-d)}`.replace(/\.?0+$/,'') : padded
}
