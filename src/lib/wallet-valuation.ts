export type WalletBalance = { mint: string; amount: string }
export type BalanceValuation = WalletBalance & { coinId: string | null; priceUsd: number | null; valueUsd: number | null; priceAt: number | null; confidence: number | null; reason: string | null }
export type WalletValuation = {
  source: 'DefiLlama'; status: 'available' | 'partial' | 'unavailable'; at: number
  balancesAt: number | null; balances: BalanceValuation[]; pricedSubtotalUsd: number | null
  totalUsd: number | null; pricedCount: number; unpricedCount: number; error: string | null
}
