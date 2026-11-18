import type { LiquidityExchange } from './liquidity-exchanges.js'
import type { UTCTimestamp } from 'lightweight-charts'

export type DepthLevel = { price: number; quantity: number; notional: number }
export type DepthSnapshot = { bids: DepthLevel[]; asks: DepthLevel[]; midPrice: number; updatedAt: number }
export type LiquidationEvent = { id: string; exchange: string; side: 'Long' | 'Short'; price: number; notional: number; receivedAt: number }
export type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number }
export type StreamStatus = 'connecting' | 'live' | 'reconnecting'
export type CandleTimeframe = '1m' | '2m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W'

export type Market = 'spot' | 'futures'
export type LiquidityMarket = Market
export type LiquiditySymbol = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'

export type Level = [string, string]

export type DepthEvent = {
  U: number
  u: number
  pu?: number
  b: Level[]
  a: Level[]
}

export type Snapshot = {
  lastUpdateId: number
  bids: Level[]
  asks: Level[]
}

export type LiquidityWall = {
  price: number
  quantity: number
  notional: number
  side: 'bid' | 'ask'
}

export type LiquidityFrame = {
  exchange: LiquidityExchange
  quote: 'USD' | 'USDT'
  bucketSize: number
  depth: DepthSnapshot
  time: number
  market: Market
  symbol: string
  price: number
  levels: { price: number; bidUsd: number; askUsd: number }[]
  walls: LiquidityWall[]
}
