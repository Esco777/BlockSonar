import type { CandleTimeframe } from '../lib/liquidity-types'
export type { DepthLevel, DepthSnapshot, LiquidationEvent, Candle, StreamStatus, CandleTimeframe } from '../lib/liquidity-types'

export const candleTimeframes: Array<{ value: CandleTimeframe; label: string; minutes: number; apiInterval: number }> = [
  { value: '1m', label: '1m', minutes: 1, apiInterval: 1 },
  { value: '2m', label: '2m', minutes: 2, apiInterval: 1 },
  { value: '5m', label: '5m', minutes: 5, apiInterval: 5 },
  { value: '15m', label: '15m', minutes: 15, apiInterval: 15 },
  { value: '1h', label: '1h', minutes: 60, apiInterval: 60 },
  { value: '4h', label: '4h', minutes: 240, apiInterval: 240 },
  { value: '1D', label: '1D', minutes: 1_440, apiInterval: 1_440 },
  { value: '1W', label: '1W', minutes: 10_080, apiInterval: 10_080 },
]

export const formatCurrency = (value: number, compact = false) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2,
  notation: compact ? 'compact' : 'standard',
}).format(value)

export const formatCompact = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
}).format(value)

