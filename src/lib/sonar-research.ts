export type SonarAsset = {
  id: string; name: string; symbol: string; image: string
  price: number; change: number; marketCap: number; volume: number; sparkline: number[]
}
export type SignalRules = { momentum: number; zScore: number; turnover: number }
export type DailyBaseline = { day: string; observedAt: number; ranks: Record<string, number>; leaderId: string }

export function researchDay(time: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
}
export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
}
function std(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length
  return Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1))
}
export function priceResearch(prices: number[]) {
  // Preserve gaps; do not compute a return across a missing or invalid sample.
  const valid = (n: number) => Number.isFinite(n) && n > 0
  const returns = prices.slice(1).flatMap((p, i) => valid(p) && valid(prices[i]) ? [(p / prices[i] - 1) * 100] : [])
  const usable = prices.filter(valid)
  let peak = usable[0] ?? 0
  let maxDrawdown = 0
  for (const price of usable) { peak = Math.max(peak, price); maxDrawdown = Math.min(maxDrawdown, (price / peak - 1) * 100) }
  return { volatility: std(returns), maxDrawdown: usable.length >= 2 ? maxDrawdown : null, momentum: usable.length >= 2 ? (usable[usable.length - 1] / usable[0] - 1) * 100 : null }
}
export function rankAssets(assets: SonarAsset[]) {
  return [...assets].filter((coin) => Number.isFinite(coin.change)).sort((a, b) => b.change - a.change || a.id.localeCompare(b.id))
}
export function createBaseline(assets: SonarAsset[], time: number): DailyBaseline {
  const ranked = rankAssets(assets)
  return { day: researchDay(time), observedAt: time, ranks: Object.fromEntries(ranked.map((coin, i) => [coin.id, i + 1])), leaderId: ranked[0]?.id ?? '' }
}
export function analyzeAssets(assets: SonarAsset[], rules: SignalRules) {
  const ranked = rankAssets(assets)
  const changes = ranked.map((coin) => coin.change)
  const mean = changes.length ? changes.reduce((sum, n) => sum + n, 0) / changes.length : 0
  const deviation = std(changes)
  return ranked.map((coin, i) => {
    const zScore = deviation && deviation > 0 ? (coin.change - mean) / deviation : null
    const turnover = coin.marketCap > 0 && coin.volume >= 0 && Number.isFinite(coin.volume) && Number.isFinite(coin.marketCap) ? coin.volume / coin.marketCap * 100 : null
    const stats = priceResearch(coin.sparkline)
    const flags: string[] = []
    if (Math.abs(coin.change) >= rules.momentum) flags.push(coin.change >= 0 ? 'Positive momentum' : 'Negative momentum')
    if (zScore !== null && Math.abs(zScore) >= rules.zScore) flags.push(zScore > 0 ? 'Relative outperformer' : 'Relative underperformer')
    if (turnover !== null && turnover >= rules.turnover) flags.push('Elevated turnover')
    if (stats.maxDrawdown !== null && stats.maxDrawdown <= -10) flags.push('Drawdown ≥ 10%')
    return { ...coin, ...stats, zScore, turnover, rank: i + 1, flags, score: flags.length }
  })
}

export const DEFAULT_SIGNAL_RULES: SignalRules = { momentum: 5, zScore: 1.5, turnover: 5 }
export function compareSonarSignals(a: ReturnType<typeof analyzeAssets>[number], b: ReturnType<typeof analyzeAssets>[number]): number {
  return b.score - a.score || Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0) || a.rank - b.rank
}
