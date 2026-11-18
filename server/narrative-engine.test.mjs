import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreNarrative, detectedNarrativeTokenIds, DEFAULT_NARRATIVE_RULES as rules } from './dist/src/lib/early-narrative.js'
import { calculateNarratives, createNarrativeAlerts, evaluateAlertPerformance } from './dist/server/narrative-engine.js'
const HOUR = 3600000
const cluster = { id: 'ai', name: 'AI', method: 'rules', categoryId: 'ai', summary: null, summarySourceIds: [], sentiment: null, evidence: [{ id: 'a', title: 'Artificial intelligence', kind: 'news', publisher: 'One', publishedAt: 1000, collectedAt: 1000 }] }
test('missing inputs are never renormalized into a seemingly complete momentum score', () => {
  assert.deepEqual(scoreNarrative({ social: null, diversity: 100, volume: null, onchain: null, sentiment: null }), { score: 20, coverage: 20 })
  assert.deepEqual(scoreNarrative({ social: null, diversity: null, volume: null, onchain: null, sentiment: null }), { score: null, coverage: 0 })
})
test('baselines warm up prospectively, future evidence is excluded, and unavailable social stays missing', () => {
  const current = calculateNarratives([{ ...cluster, evidence: [...cluster.evidence, { ...cluster.evidence[0], id: 'future', collectedAt: HOUR * 5 }] }], [], [{ id: 'ai', volume: 10, updatedAt: 1000, topCoinIds: [] }], 1000, 1000, rules)[0]
  assert.equal(current.components.volume, null); assert.equal(current.components.social, null); assert.equal(current.evidence.length, 1); assert.equal(current.stage, 'Newly Detected')
  const next = calculateNarratives([cluster], [current], [{ id: 'ai', volume: 20, updatedAt: HOUR + 1000, topCoinIds: [] }], HOUR + 1000, 1000, rules)[0]
  assert.equal(next.components.volume, 100); assert.equal(current.points.length, 1); assert.equal(next.points.length, 2)
})
test('alerts freeze original score, rules, and prices and evaluate only later observed horizons', () => {
  const narrative = { ...cluster, firstSeen: 1, score: 55, coverage: 40, stage: 'Accelerating', tokenIds: ['id'], components: { social: null, volume: 50 }, categoryChange: 2 }
  const alerts = createNarrativeAlerts([narrative], [], [], 1000, rules, { id: 10 })
  assert.equal(alerts[0].tokenPrices.id, 10)
  const evaluated = evaluateAlertPerformance(alerts, [{ time: 500, prices: { id: 100 } }, { time: HOUR + 1000, prices: { id: 12 } }], HOUR + 1000)
  assert.ok(Math.abs(evaluated[0].performance['1h'].id - 20) < .0001)
  assert.equal(alerts[0].performance['1h'], undefined)
  assert.equal(createNarrativeAlerts([narrative], [], alerts, 2000, rules, {}).length, alerts.length)
})


test('category token hints do not count as detected coins until token records are returned', () => {
  assert.deepEqual(detectedNarrativeTokenIds({ tokenIds: ['hint-a', 'hint-b'] }), [])
  assert.deepEqual(detectedNarrativeTokenIds({ tokenPreview: [{ id: 'a' }] }, [{ id: 'a' }, { id: 'b' }]), ['a', 'b'])
  assert.deepEqual(detectedNarrativeTokenIds({ detectedTokenIds: ['a', 'b'], tokenPreview: [] }), ['a', 'b'])
})

test('live score responds to observed independent publishers and reports calculation deltas', () => {
  const time = 100000
  const initial = calculateNarratives([cluster], [], [], time, time, rules)[0]
  const additional = { ...cluster.evidence[0], id: 'second', publisher: 'Two', collectedAt: time+60000, publishedAt: time+60000 }
  const next = calculateNarratives([{ ...cluster, evidence: [...cluster.evidence, additional] }], [initial], [], time+60000, time, rules)[0]
  assert.equal(initial.score,4)
  assert.equal(next.score,8)
  assert.equal(next.changeSinceUpdate,4)
  assert.equal(next.scoredAt,time+60000)
  assert.equal(next.coverage,20)
  const cooled = calculateNarratives([{ ...cluster, evidence: [...cluster.evidence,additional] }], [next], [], time+2*HOUR,time,rules)[0]
  assert.equal(cooled.score,0)
  assert.equal(cooled.changeSinceUpdate,-8)
})
test('unavailable news and stale/future market data do not fabricate current inputs or future baselines', () => {
  const time = 5*HOUR
  const category = { id: 'ai', volume: 200, updatedAt: time-31*60000, topCoinIds: [] }
  const stale = calculateNarratives([cluster],[],[category],time,0,rules,false)[0]
  assert.equal(stale.score,null)
  assert.equal(stale.coverage,0)
  assert.equal(stale.points[0].volume,null)
  const future = calculateNarratives([cluster],[],[{ ...category, updatedAt:time+1 }],time,0,rules,false)[0]
  assert.equal(future.volume,null)
  const next = calculateNarratives([cluster],[stale],[{ ...category,updatedAt:time+HOUR }],time+HOUR,0,rules,false)[0]
  assert.equal(next.components.volume,null)
})
test('score freshness uses calculation time rather than dashboard fetch time', async () => {
  const { narrativeScoreFreshness } = await import('./dist/src/lib/early-narrative.js')
  assert.equal(narrativeScoreFreshness(null,1000000),'waiting')
  assert.equal(narrativeScoreFreshness(1000000,1060000),'live')
  assert.equal(narrativeScoreFreshness(1000000,1200000),'delayed')
})

test('minute cadence retains a month of actual observations with bounded historical sampling', async () => {
  const { compactNarrativePoints } = await import('./dist/server/narrative-engine.js')
  const now = 32*24*HOUR
  const points = Array.from({length:32*24*60},(_,i)=>({time:now-i*60000,attention:i,social:0,sources:1,volume:1,sentiment:null,score:4,coverage:20})).reverse()
  const sampled = compactNarrativePoints(points,now)
  assert.ok(sampled.length < 4000)
  assert.ok(sampled.some(p=>p.time<=now-30*24*HOUR))
  assert.ok(sampled.every(p=>points.includes(p)))
  assert.equal(sampled.at(-1).time,now)
})
