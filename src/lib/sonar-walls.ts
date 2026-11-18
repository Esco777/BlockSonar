import type { LiquidityFrame } from './liquidity-types.js'

/** Rank the same recorded price buckets used by the thermal heatmap. */
export function rankLiquidityZones(frame: LiquidityFrame | undefined, minimum = 0, limit = 10) {
  if (!frame) return []
  return frame.levels.map((level) => ({ ...level, upperPrice: level.price + frame.bucketSize, notional: level.bidUsd + level.askUsd }))
    .filter((zone) => zone.notional > 0 && zone.notional >= minimum)
    .sort((a, b) => b.notional - a.notional || a.price - b.price)
    .slice(0, limit)
}
