import type { LiquidityFrame } from './liquidity-types.js'

export function sampledCandles(frames: LiquidityFrame[], intervalMs: number) {
  const groups = new Map<number, { time: number; open: number; high: number; low: number; close: number; count: number }>()
  for (const frame of [...frames].sort((a, b) => a.time - b.time)) {
    const offset = intervalMs === 604800000 ? 4 * 86400000 : 0
    const time = Math.floor((frame.time - offset) / intervalMs) * intervalMs + offset
    const candle = groups.get(time)
    if (candle) { candle.high = Math.max(candle.high, frame.price); candle.low = Math.min(candle.low, frame.price); candle.close = frame.price; candle.count++ }
    else groups.set(time, { time, open: frame.price, high: frame.price, low: frame.price, close: frame.price, count: 1 })
  }
  return [...groups.values()]
}

/** Fit the observed order-book time span, rather than empty older candle history. */
export function heatmapWindowDuration(frames: LiquidityFrame[], intervalSeconds: number) {
  const duration = frames.length ? Math.max(1000, frames[frames.length - 1].time - frames[0].time + 1000) : 1000
  return Math.min(duration, Math.max(60000, intervalSeconds * 1000 * 24))
}

// Frame objects are immutable stream samples. Cache their visual values so later
// peaks and eviction of old samples cannot recolor already recorded columns.
const recordedBands = new WeakMap<LiquidityFrame, Array<{ price: number; strength: number; color: number; redPeak: number }>>()

export function horizontalLiquidityBands(frames: LiquidityFrame[]) {
  const bands: Array<{ price: number; start: number; end: number; strength: number; color: number }> = []
  let active = new Map<number, typeof bands[number]>()
  let redPeaks = new Map<number, number>()
  const ordered = [...frames].sort((a, b) => a.time - b.time)
  ordered.forEach((frame, index) => {
    if (index && frame.time - ordered[index - 1].time > 2000) redPeaks.clear()
    let recorded = recordedBands.get(frame)
    if (!recorded) {
      let scale = 1_000_000
      for (const level of frame.levels) scale = Math.max(scale, level.bidUsd + level.askUsd)
      recorded = frame.levels.filter(level => level.bidUsd + level.askUsd > 0).map(level => {
        const notional = level.bidUsd + level.askUsd
        // Both markets use the same relative scale within each recorded book.
        // $1M is a minimum for red, not a reason to saturate every larger wall.
        const normalized = Math.sqrt(notional / scale)
        const color = Math.min(notional >= 1_000_000 ? 4 : 3, Math.floor(normalized * 5))
        const priorPeak = redPeaks.get(level.price) ?? 0
        const redPeak = color === 4 || priorPeak ? Math.max(priorPeak, notional) : 0
        return { price: level.price, color, strength: redPeak ? notional / redPeak : normalized, redPeak }
      })
      recordedBands.set(frame, recorded)
    }
    redPeaks = new Map(recorded.filter(level => level.redPeak > 0).map(level => [level.price, level.redPeak]))
    const next = new Map<number, typeof bands[number]>()
    const end = Math.min(ordered[index + 1]?.time ?? frame.time + 1000, frame.time + 2000)
    for (const level of recorded) {
      const previous = active.get(level.price)
      // Merge identical intensity only; never brighten an older sample.
      if (previous && previous.end === frame.time && previous.color === level.color && previous.strength === level.strength) {
        previous.end = end; next.set(level.price, previous)
      } else {
        const band = { price: level.price, start: frame.time, end, strength: level.strength, color: level.color }
        bands.push(band); next.set(level.price, band)
      }
    }
    active = next
  })
  return bands
}

/** Confirm quantity loss only inside the depth actually included in both samples.
 * Missing buckets outside the visible depth are unknown, not cancellations.
 * Contact uses sampled mid-price crossings, never a whole historical candle.
 * This feed has no trade confirmations, so no change is classified as executed.
 */
export function liquidityReductions(previous: LiquidityFrame, current: LiquidityFrame, redPrices: Set<number>) {
  if (previous.exchange !== current.exchange || previous.market !== current.market || previous.symbol !== current.symbol
    || previous.bucketSize !== current.bucketSize || current.time <= previous.time || current.time - previous.time > 2000) return []
  const changes: Array<{ price: number; fraction: number; contact: boolean }> = []
  const size = current.bucketSize
  for (const price of redPrices) {
    let remaining = 0, total = 0
    for (const side of ['bids', 'asks'] as const) {
      const before = previous.depth[side], after = current.depth[side]
      if (!before.length || !after.length) continue
      // The best-price edge can move through the bucket; the far edge must
      // still cover it, otherwise loss could just be truncation of top-20 depth.
      const covered = side === 'bids'
        ? price >= Math.max(...[before, after].map(rows => Math.min(...rows.map(row => row.price))))
        : price + size <= Math.min(...[before, after].map(rows => Math.max(...rows.map(row => row.price))))
      if (!covered) continue
      const quantity = (rows: typeof before) => rows.reduce((sum, row) => sum + (row.price >= price && row.price < price + size ? row.quantity : 0), 0)
      const old = quantity(before), next = quantity(after)
      total += old
      remaining += next
    }
    if (total > 0 && remaining < total) changes.push({ price, fraction: (total - remaining) / total,
      contact: Math.min(previous.price, current.price) < price + size && Math.max(previous.price, current.price) >= price })
  }
  return changes
}

/** Match the recorded interval painted on the canvas; never extend across outages. */
export function liquiditySampleAt(frames: LiquidityFrame[], time: number) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]
    const end = Math.min(frames[i + 1]?.time ?? frame.time + 1000, frame.time + 2000)
    if (time >= frame.time && time < end) return frame
  }
  return null
}
