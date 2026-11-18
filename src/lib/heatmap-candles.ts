import type { LiquidityFrame } from './liquidity-types.js'

export type HeatmapCandle = { time: number; open: number; high: number; low: number; close: number; count: number }

export function candleRequest(feed: Pick<LiquidityFrame, 'exchange' | 'market' | 'symbol'>, seconds: number) {
  const supported = feed.exchange === 'coinbase' ? [60, 300, 900, 3600, 21600, 86400]
    : feed.exchange === 'gemini' ? [60, 300, 900, 1800, 3600, 21600, 86400]
    : [60, 300, 900, 1800, 3600, 14400, 86400, 604800]
  const base = supported.filter(value => value <= seconds).at(-1) ?? 60
  const interval = base >= 604800 ? '1w' : base >= 86400 ? '1d' : base >= 3600 ? `${base / 3600}h` : `${base / 60}m`
  const bybitInterval = base === 604800 ? 'W' : base === 86400 ? 'D' : String(base / 60)
  const okxInterval = base === 604800 ? '1Wutc' : base === 86400 ? '1Dutc' : base >= 3600 ? `${base / 3600}H` : interval
  switch (feed.exchange) {
    case 'coinbase': return `https://api.exchange.coinbase.com/products/${feed.symbol}/candles?granularity=${base}`
    case 'gemini': return `https://api.gemini.com/v2/candles/${feed.symbol.toLowerCase()}/${interval}`
    case 'bybit': return `https://api.bybit.com/v5/market/kline?category=${feed.market === 'futures' ? 'linear' : 'spot'}&symbol=${feed.symbol}&interval=${bybitInterval}&limit=300`
    case 'okx': return `https://www.okx.com/api/v5/market/candles?instId=${feed.symbol}&bar=${okxInterval}&limit=300`
    case 'binance': return `${feed.market === 'futures' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3'}/klines?symbol=${feed.symbol}&interval=${interval}&limit=300`
  }
}

export function parseHeatmapCandles(exchange: LiquidityFrame['exchange'], payload: unknown, seconds: number): HeatmapCandle[] {
  const data = payload as { retCode?: number; code?: string; result?: { list?: unknown }; data?: unknown }
  if (exchange === 'bybit' && data?.retCode !== 0 || exchange === 'okx' && data?.code !== '0') throw new Error('Exchange rejected candle request')
  const rows = exchange === 'bybit' ? data?.result?.list : exchange === 'okx' ? data?.data : payload
  if (!Array.isArray(rows)) throw new Error('Invalid candle response')
  const parsed = rows.flatMap((row): HeatmapCandle[] => {
    if (!Array.isArray(row) || row.length < 5) return []
    const values = row.slice(0, 5).map(Number)
    const [timestamp, a, b, c, d] = values
    const [open, high, low, close] = exchange === 'coinbase' ? [c, b, a, d] : [a, b, c, d]
    if (!values.every(Number.isFinite) || timestamp <= 0 || Math.min(open, high, low, close) <= 0
      || low > Math.min(open, close) || high < Math.max(open, close) || low > high) return []
    return [{ time: exchange === 'coinbase' ? timestamp * 1000 : timestamp, open, high, low, close, count: 1 }]
  }).sort((a, b) => a.time - b.time)
  const buckets = new Map<number, HeatmapCandle>()
  for (const candle of parsed) {
    const offset = seconds === 604800 ? 4 * 86400000 : 0 // UTC Monday for weekly bars.
    const time = Math.floor((candle.time - offset) / (seconds * 1000)) * seconds * 1000 + offset
    const prior = buckets.get(time)
    if (prior) { prior.high = Math.max(prior.high, candle.high); prior.low = Math.min(prior.low, candle.low); prior.close = candle.close; prior.count++ }
    else buckets.set(time, { ...candle, time })
  }
  return [...buckets.values()]
}
