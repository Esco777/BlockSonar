import test from 'node:test'
import assert from 'node:assert/strict'
import { sampledCandles, horizontalLiquidityBands, heatmapWindowDuration } from './dist/src/lib/heatmap-layout.js'
const frame = (time, price, levels = [{ price: 100, bidUsd: 1000, askUsd: 0 }]) => ({ time, price, levels })

test('sampled candles use real observed open, high, low and close per interval', () => {
  const candles = sampledCandles([frame(3000, 105), frame(1000, 100), frame(2000, 98), frame(11000, 103)], 10000)
  assert.deepEqual(candles, [{ time: 0, open: 100, high: 105, low: 98, close: 105, count: 3 }, { time: 10000, open: 103, high: 103, low: 103, close: 103, count: 1 }])
})

test('liquidity at a stable price forms a continuous horizontal band across adjacent samples', () => {
  const bands = horizontalLiquidityBands([frame(1000, 100), frame(2000, 101), frame(3000, 100)])
  assert.equal(bands.length, 1)
  assert.equal(bands[0].price, 100)
  assert.equal(bands[0].start, 1000)
  assert.equal(bands[0].end, 4000)
})

test('removed liquidity and feed outages break bands rather than fabricate history', () => {
  const removed = horizontalLiquidityBands([frame(1000, 100), frame(2000, 100, []), frame(3000, 100)])
  assert.equal(removed.length, 2)
  assert.equal(removed[0].end, 2000)
  const gap = horizontalLiquidityBands([frame(1000, 100), frame(10000, 100)])
  assert.equal(gap.length, 2)
  assert.equal(gap[0].end, 3000)
  assert.deepEqual(sampledCandles([], 10000), [])
})

test('hover lookup uses the observed sample and leaves outages and future history empty', async () => {
  const { liquiditySampleAt } = await import('./dist/src/lib/heatmap-layout.js')
  const frames = [frame(1000, 100), frame(2000, 101), frame(10000, 102)]
  assert.equal(liquiditySampleAt(frames, 1500), frames[0])
  assert.equal(liquiditySampleAt(frames, 2000), frames[1])
  assert.equal(liquiditySampleAt(frames, 5000), null)
  assert.equal(liquiditySampleAt(frames, 900), null)
  assert.equal(liquiditySampleAt(frames, 11000), null)
})


test('later peaks and losses do not repaint recorded intensity; red walls reflect remaining liquidity', () => {
  const first = frame(1000, 100, [{ price: 100, bidUsd: 2000000, askUsd: 0 }])
  const before = horizontalLiquidityBands([first])[0]
  const half = frame(2000, 100, [{ price: 100, bidUsd: 1000000, askUsd: 0 }])
  const peak = frame(3000, 100, [{ price: 200, bidUsd: 10000000, askUsd: 0 }])
  const bands = horizontalLiquidityBands([first, half, peak])
  assert.equal(bands[0].strength, before.strength)
  assert.equal(bands[0].color, before.color)
  assert.equal(bands[1].color, 4)
  assert.equal(bands[1].strength, .5)
  assert.equal(bands[0].end, 2000)
  assert.equal(horizontalLiquidityBands([half, peak])[0].strength, .5)
  const replenished = frame(4000, 100, first.levels)
  assert.equal(horizontalLiquidityBands([first, half, replenished]).at(-1).strength, 1)
})

const depthFrame = (time, mid, quantity, far = 130) => ({
  ...frame(time, mid), exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', bucketSize: 10,
  depth: { bids: [{ price: 90, quantity: 5 }], asks: [
    ...(quantity ? [{ price: 105, quantity }] : []), { price: far, quantity: 5 }
  ] }
})

test('particles require real depth quantity loss and sampled contact, not a candle touch', async () => {
  const { liquidityReductions } = await import('./dist/src/lib/heatmap-layout.js')
  const red = new Set([100])
  const before = depthFrame(1000, 99, 10)
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 105, 10), red), [])
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 105, 5), red), [{ price: 100, fraction: .5, contact: true }])
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 99, 5), red), [{ price: 100, fraction: .5, contact: false }])
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 111, 0), red), [{ price: 100, fraction: 1, contact: true }])
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 105, 15), red), [])
})

test('truncated depth, outages, and feed changes cannot create dissolve bursts', async () => {
  const { liquidityReductions } = await import('./dist/src/lib/heatmap-layout.js')
  const before = depthFrame(1000, 99, 10), red = new Set([100])
  assert.deepEqual(liquidityReductions(before, depthFrame(2000, 105, 0, 108), red), [])
  assert.deepEqual(liquidityReductions(before, depthFrame(5000, 105, 5), red), [])
  assert.deepEqual(liquidityReductions(before, { ...depthFrame(2000, 105, 5), exchange: 'bybit' }, red), [])
})


test('only combined liquidity of one million or more is red, even after a red wall decreases', () => {
  const first = frame(1000, 100, [
    { price: 90, bidUsd: 999999, askUsd: 0 },
    { price: 100, bidUsd: 600000, askUsd: 400000 },
    { price: 110, bidUsd: 0, askUsd: 5000000 },
  ])
  const bands = horizontalLiquidityBands([first])
  assert.notEqual(bands[0].color, 4)
  assert.notEqual(bands[1].color, 4)
  assert.equal(bands[2].color, 4)
  const reduced = frame(2000, 100, [{ price: 100, bidUsd: 999999, askUsd: 0 }])
  assert.notEqual(horizontalLiquidityBands([first, reduced]).at(-1).color, 4)
  assert.equal(horizontalLiquidityBands([first])[2].color, 4)
})


test('spot and futures share colors regardless of earlier liquidity peaks', () => {
  const levels = [10000, 100000, 300000, 700000, 1000000].map((value, index) => ({ price: 100 + index * 10, bidUsd: value, askUsd: 0 }))
  const spot = { ...frame(2000, 100, levels), market: 'spot' }
  const futures = { ...frame(2000, 100, levels), market: 'futures' }
  const earlierPeak = { ...frame(1000, 100, [{ price: 200, bidUsd: 100000000, askUsd: 0 }]), market: 'futures' }
  const spotColors = horizontalLiquidityBands([spot]).map(band => band.color)
  const futuresColors = horizontalLiquidityBands([earlierPeak, futures]).filter(band => band.start === 2000).map(band => band.color)
  assert.deepEqual(spotColors, [0, 1, 2, 3, 4])
  assert.deepEqual(futuresColors, spotColors)
})


test('large futures books retain a gradient even when every bucket exceeds one million', () => {
  const values = [1100000, 5000000, 15000000, 25000000, 50000000]
  const sample = { ...frame(1000, 100, values.map((value, index) => ({ price: 100 + index * 10, bidUsd: value, askUsd: 0 }))), market: 'futures' }
  assert.deepEqual(horizontalLiquidityBands([sample]).map(band => band.color), [0, 1, 2, 3, 4])
})


test('higher timeframes fit available heatmap history instead of squeezing it into the live edge', () => {
  const frames = [frame(0, 100), frame(899000, 101)]
  assert.equal(heatmapWindowDuration(frames, 300), 900000)
  assert.equal(heatmapWindowDuration(frames, 3600), 900000)
  assert.equal(heatmapWindowDuration(frames, 5), 120000)
  assert.equal(heatmapWindowDuration([frame(1000, 100)], 300), 1000)
  assert.equal(heatmapWindowDuration([], 300), 1000)
})
