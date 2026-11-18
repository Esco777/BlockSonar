import { assetKey } from './token-identity.js'
export type WalletActivity = { buyMints?: string[]; signature: string; wallet: string; at: number; kind: 'swap' | 'transfer' | 'liquidity' | 'internal' | 'unknown' | 'failed'; tokens: Array<{ mint: string; amount: number; direction: 'in' | 'out' }>; rawTokens?: Array<{ mint: string; rawAmount: string; decimals: number; direction: 'in' | 'out' }>; feeSol: number | null; nativeSolDelta?: number | null }
export type PricedTrade = { at: number; side: 'buy' | 'sell'; quantity: number; usd: number | null; feeUsd: number | null }
/** FIFO, only for explicitly complete histories and historical execution values. */
export function estimatePnl(trades: PricedTrade[], complete: boolean): { realized: number | null; reason: string | null } {
  if (!trades.length) return { realized: null, reason: 'No priced trades available' }
  if (!complete) return { realized: null, reason: 'Incomplete history or unknown opening cost basis' }
  const lots: Array<{ quantity: number; cost: number }> = []
  let realized = 0
  for (const trade of [...trades].sort((a, b) => a.at - b.at)) {
    if (!(trade.quantity > 0) || !Number.isFinite(trade.quantity) || trade.usd === null || !Number.isFinite(trade.usd) || trade.usd < 0 || trade.feeUsd === null || !Number.isFinite(trade.feeUsd) || trade.feeUsd < 0) return { realized: null, reason: 'Missing historical execution price or fee' }
    if (trade.side === 'buy') lots.push({ quantity: trade.quantity, cost: (trade.usd + trade.feeUsd) / trade.quantity })
    else {
      let remaining = trade.quantity, basis = 0
      for (const lot of lots) { const used = Math.min(lot.quantity, remaining); basis += used * lot.cost; lot.quantity -= used; remaining -= used; if (remaining <= 1e-12) break }
      if (remaining > 1e-12) return { realized: null, reason: 'Sale exceeds known inventory' }
      realized += trade.usd - trade.feeUsd - basis
    }
  }
  return { realized, reason: null }
}
export function classifyTransaction(tx: any, wallet: string): WalletActivity {
  const type = String(tx.type ?? '')
  const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : []
  const relevant = transfers.filter((t: any) => t.fromUserAccount === wallet || t.toUserAccount === wallet)
  const legs = relevant.flatMap((t: any) => {
    if (typeof t.mint !== 'string' || !Number.isFinite(t.tokenAmount) || t.tokenAmount <= 0 || t.fromUserAccount === t.toUserAccount) return []
    return [{ mint: t.mint, amount: t.tokenAmount, direction: t.toUserAccount === wallet ? 'in' as const : 'out' as const }]
  })
  // Net routed token legs so temporary intermediate assets are not reported as purchases.
  const net = new Map<string, number>()
  for (const leg of legs) net.set(leg.mint, (net.get(leg.mint) ?? 0) + (leg.direction === 'in' ? leg.amount : -leg.amount))
  const tokens = [...net].filter(([, amount]) => amount !== 0).map(([mint, amount]) => ({ mint, amount: Math.abs(amount), direction: amount > 0 ? 'in' as const : 'out' as const }))
  const native = (Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : []).filter((t: any) => t.fromUserAccount === wallet || t.toUserAccount === wallet)
  const nativeSolDelta = native.length ? native.reduce((sum: number, t: any) => sum + (Number.isFinite(t.amount) ? (t.toUserAccount === wallet ? t.amount : 0) - (t.fromUserAccount === wallet ? t.amount : 0) : 0), 0) / 1e9 : null
  const ownMovements = [...relevant, ...native]
  const internal = ownMovements.length > 0 && ownMovements.every((t: any) => t.fromUserAccount === wallet && t.toUserAccount === wallet)
  const kind: WalletActivity['kind'] = tx.transactionError ? 'failed' : /LIQUIDITY/.test(type) ? 'liquidity' : internal ? 'internal' : type === 'SWAP' && tx.events?.swap && tokens.length ? 'swap' : type === 'TRANSFER' && ownMovements.length ? 'transfer' : 'unknown'
  return { signature: String(tx.signature ?? ''), wallet, at: Number(tx.timestamp) * 1000, kind, tokens, nativeSolDelta, feeSol: Number.isFinite(tx.fee) ? tx.fee / 1e9 : null }
}
export type EarlyBuyer = { wallet: string; token: string; pool: string; at: number; signature: string }
export function earlyBuyers(activities: WalletActivity[], pools: Array<{ network: string; address: string; tokenAddress: string | null; createdAt: number }>, windowMs = 600000): EarlyBuyer[] {
  const found = new Map<string, EarlyBuyer>()
  for (const activity of activities) {
    if (activity.kind !== 'swap') continue
    for (const token of activity.tokens.filter(t => t.direction === 'in')) for (const pool of pools) {
      if (pool.network !== 'solana' || !pool.tokenAddress || assetKey('solana', token.mint) !== assetKey(pool.network, pool.tokenAddress) || activity.at < pool.createdAt || activity.at > pool.createdAt + windowMs) continue
      const key = `${activity.wallet}:${assetKey(pool.network, pool.address)}`
      const entry = { wallet: activity.wallet, token: token.mint, pool: assetKey(pool.network, pool.address), at: activity.at, signature: activity.signature }
      if (!found.has(key) || found.get(key)!.at > entry.at) found.set(key, entry)
    }
  }
  return [...found.values()]
}
export function accumulationPatterns(activities: WalletActivity[], minimumSwaps = 3, windowMs = 3600000, now = Date.now()) {
  const grouped = new Map<string, { mint: string; bought: number; sold: number; count: number }>()
  for (const activity of activities) if (activity.kind === 'swap' && activity.at >= now - windowMs && activity.at <= now) for (const token of activity.tokens) {
    const item = grouped.get(token.mint) ?? { mint: token.mint, bought: 0, sold: 0, count: 0 }
    item[token.direction === 'in' ? 'bought' : 'sold'] += token.amount; item.count++; grouped.set(token.mint, item)
  }
  return [...grouped.values()].filter(t => t.count >= minimumSwaps && t.bought !== t.sold).map(t => ({ ...t, pattern: t.bought > t.sold ? 'accumulation' : 'distribution', note: 'Repeated directional swaps in the observed hour; not a statistical anomaly score' }))
}
