import test from 'node:test'
import assert from 'node:assert/strict'
import { priceResearch, analyzeAssets, createBaseline, researchDay, median } from './dist/src/lib/sonar-research.js'
const asset = (id, change, sparkline = []) => ({ id, name: id, symbol: id.toUpperCase(), image: '', price: 100, change, marketCap: 1000000, volume: 100000, sparkline })

test('research computes peak-to-trough drawdown and sample return volatility', () => {
  const stats = priceResearch([100, 120, 90, 99])
  assert.equal(stats.maxDrawdown, -25)
  assert.ok(Math.abs(stats.momentum + 1) < 1e-10)
  assert.ok(Math.abs(stats.volatility - 23.629078131263) < 1e-8)
})

test('missing samples do not fabricate volatility or bridge invalid price gaps', () => {
  assert.deepEqual(priceResearch([]), { volatility: null, maxDrawdown: null, momentum: null })
  assert.equal(priceResearch([100, NaN, 200]).volatility, null)
  assert.equal(priceResearch([100]).maxDrawdown, null)
})

test('relative scores handle zero dispersion and thresholds are configurable', () => {
  const coins = [asset('a', 10), asset('b', 10)]
  const rows = analyzeAssets(coins, { momentum: 5, zScore: 1.5, turnover: 5 })
  assert.equal(rows[0].zScore, null)
  assert.equal(rows[0].turnover, 10)
  assert.equal(rows[0].score, 2)
  assert.equal(analyzeAssets(coins, { momentum: 15, zScore: 2, turnover: 20 })[0].score, 0)
})

test('daily ranking baseline follows Los Angeles calendar and ties are stable', () => {
  const time = Date.parse('2026-11-10T02:00:00Z')
  assert.equal(researchDay(time), '2026-11-09')
  const baseline = createBaseline([asset('b', 3), asset('a', 3), asset('c', -1)], time)
  assert.equal(baseline.leaderId, 'a')
  assert.deepEqual(baseline.ranks, { a: 1, b: 2, c: 3 })
  assert.equal(median([5, 1, 3, 2]), 2.5)
})
