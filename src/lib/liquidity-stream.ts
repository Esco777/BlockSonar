import { feedKey, findLiquidityFeed } from './liquidity-exchanges.js'
import type { LiquidityFrame } from './liquidity-types.js'

export type LiquidityHistory = Record<string, LiquidityFrame[]>
export const MAX_FRAMES = 900

export function parseLiquidityFrame(data: string): LiquidityFrame | null {
  try {
    const value = JSON.parse(data) as LiquidityFrame
    if (!value) return null
    const feed = findLiquidityFeed(value.exchange, value.market, value.symbol)
    if (!feed || value.symbol !== feed.symbol || value.quote !== feed.quote || !Number.isFinite(value.bucketSize) || value.bucketSize <= 0) return null
    const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    if (!nonnegative(value.time) || !nonnegative(value.price) || value.price === 0) return null
    if (!Array.isArray(value.levels) || !Array.isArray(value.walls)) return null
    if (!value.levels.every((level) => level && nonnegative(level.price) && level.price > 0 && nonnegative(level.bidUsd) && nonnegative(level.askUsd))) return null
    if (!value.walls.every((wall) => wall && ['bid', 'ask'].includes(wall.side) && nonnegative(wall.price) && wall.price > 0 && nonnegative(wall.quantity) && nonnegative(wall.notional))) return null
    if (!value.depth || !nonnegative(value.depth.updatedAt) || !nonnegative(value.depth.midPrice) || !Array.isArray(value.depth.bids) || !Array.isArray(value.depth.asks)) return null
    if (![...value.depth.bids, ...value.depth.asks].every((level) => level && nonnegative(level.price) && level.price > 0 && nonnegative(level.quantity) && nonnegative(level.notional))) return null
    return value
  } catch {
    return null
  }
}

export function appendLiquidityFrame(previous: LiquidityHistory, frame: LiquidityFrame): LiquidityHistory {
  const key = feedKey(frame)
  const history = previous[key] ?? []
  // SSE reconnects replay history; retain one frame per timestamp in chronological order.
  const next = [...history.filter((item) => item.time !== frame.time), frame]
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_FRAMES)
  return { ...previous, [key]: next }
}
