import test from 'node:test'
import assert from 'node:assert/strict'
import { rankLiquidityZones } from './dist/src/lib/sonar-walls.js'
const frame = { bucketSize: 25, levels: [{ price: 60000, bidUsd: 400000, askUsd: 100000 }, { price: 60025, bidUsd: 0, askUsd: 1200000 }, { price: 59975, bidUsd: 0, askUsd: 0 }] }
test('walls rank the same combined bid/ask buckets as the heatmap', () => {
  const walls = rankLiquidityZones(frame)
  assert.equal(walls.length, 2)
  assert.equal(walls[0].price, 60025)
  assert.equal(walls[0].upperPrice, 60050)
  assert.equal(walls[0].notional, 1200000)
  assert.equal(walls[1].notional, 500000)
})
test('thresholds and limits apply to observed liquidity without fabricating walls', () => {
  assert.equal(rankLiquidityZones(frame, 1000000).length, 1)
  assert.equal(rankLiquidityZones(frame, 2000000).length, 0)
  assert.equal(rankLiquidityZones(frame, 0, 1).length, 1)
  assert.deepEqual(rankLiquidityZones(undefined), [])
})
