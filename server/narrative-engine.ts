import { scoreNarrative, pointAt, percentageGrowth, narrativeStage, type Narrative, type NarrativePoint, type NarrativeRules, type NarrativeCategory, type NarrativeEvidence, type NarrativeAlert } from '../src/lib/early-narrative.js'
import type { TopicCluster } from './narrative-classifier.js'
const HOUR = 3600000
const clamp = (value: number) => Math.max(0, Math.min(100, value))
/** Preserve recorded points across 31 days without multiplying storage at minute cadence. */
export function compactNarrativePoints(points: NarrativePoint[], now: number): NarrativePoint[] {
  const buckets = new Map<string, NarrativePoint>()
  for (const point of points) {
    const age = now - point.time
    if (age < 0 || age > 31 * 24 * HOUR) continue
    const step = age <= 24 * HOUR ? 60000 : age <= 7 * 24 * HOUR ? 5 * 60000 : HOUR
    const key = `${step}:${Math.floor(point.time / step)}`
    const prior = buckets.get(key)
    if (!prior || point.time > prior.time) buckets.set(key, point)
  }
  return [...buckets.values()].sort((a,b) => a.time - b.time)
}
export function calculateNarratives(clusters: TopicCluster[], previous: Narrative[], categories: NarrativeCategory[], now: number, startedAt: number, rules: NarrativeRules, newsAvailable = true): Narrative[] {
  return clusters.map(cluster => {
    const old = previous.find(item => item.id === cluster.id)
    const points = old?.points.filter(point => point.time >= now - 31 * 24 * HOUR) ?? []
    const candidateCategory = categories.find(item => item.id === cluster.categoryId)
    const category = candidateCategory && candidateCategory.updatedAt <= now && now - candidateCategory.updatedAt < 30 * 60000 ? candidateCategory : undefined
    const visible = cluster.evidence.filter(item => item.collectedAt <= now && item.publishedAt <= now)
    const inWindow = (item: NarrativeEvidence, start: number, end: number) => item.publishedAt > start && item.publishedAt <= end
    const recent = visible.filter(item => inWindow(item, now - HOUR, now))
    const social = (end: number) => visible.filter(item => item.kind === 'social' && inWindow(item, end - HOUR, end)).length
    const currentSocial = social(now), priorSocial = social(now - HOUR), olderSocial = social(now - 2 * HOUR)
    const socialReady = now - startedAt >= 3 * HOUR && visible.some(item => item.kind === 'social')
    const firstSeen = old?.firstSeen ?? now
    const previousHour = pointAt(points, now - HOUR), previousDay = pointAt(points, now - 24 * HOUR)
    const sourceCount = new Set(recent.map(item => item.publisher)).size
    const components = {
      social: socialReady && priorSocial > 0 && olderSocial > 0 ? clamp(50 + ((currentSocial / priorSocial - 1) - (priorSocial / olderSocial - 1)) * 25) : null,
      diversity: newsAvailable ? clamp(sourceCount / 5 * 100) : null,
      volume: category?.volume != null && now - category.updatedAt < 30 * 60000 && previousHour?.volume && previousHour.volume > 0 && now - startedAt >= HOUR ? clamp(50 + Math.log2(Math.max(.001, category.volume / previousHour.volume)) * 50) : null,
      onchain: null,
      sentiment: newsAvailable && cluster.sentiment !== null && previousHour?.sentiment != null ? clamp(50 + (cluster.sentiment - previousHour.sentiment) * 50) : null,
    }
    const computed = scoreNarrative(components)
    const point: NarrativePoint = { time: now, attention: recent.length, social: currentSocial, sources: sourceCount, volume: category?.volume ?? null, sentiment: cluster.sentiment, ...computed }
    const priorPoint = points.filter(item => item.time < now).at(-1)
    const nextPoints = compactNarrativePoints([...points.filter(item => item.time !== now), point], now)
    const stage = narrativeStage(computed.score, previousHour?.score ?? null, (now - firstSeen) / HOUR, sourceCount, rules)
    return { ...cluster, scoredAt: now, changeSinceUpdate: computed.score !== null && priorPoint?.score != null ? computed.score - priorPoint.score : null, firstSeen, evidence: visible.slice(-150), points: nextPoints, components, ...computed,
      change1h: previousHour?.score != null && computed.score !== null ? computed.score - previousHour.score : null,
      change24h: previousDay?.score != null && computed.score !== null ? computed.score - previousDay.score : null,
      mentionGrowth: socialReady ? percentageGrowth(currentSocial, priorSocial) : null,
      stage, volume: category?.volume ?? null, categoryChange: category?.change24h ?? null,
      tokenIds: category?.topCoinIds ?? [],
    }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.evidence.length - a.evidence.length)
}
export function createNarrativeAlerts(current: Narrative[], previous: Narrative[], alerts: NarrativeAlert[], now: number, rules: NarrativeRules, tokenPrices: Record<string, number>): NarrativeAlert[] {
  const created: NarrativeAlert[] = []
  for (const narrative of current) {
    const prior = previous.find(item => item.id === narrative.id)
    const kinds: string[] = []
    if (!prior && narrative.evidence.length) kinds.push('New narrative')
    if (narrative.score !== null && narrative.score >= rules.early && (prior?.score ?? 0) < rules.early) kinds.push('Momentum threshold')
    if (narrative.components.social !== null && narrative.components.social >= 75 && (prior?.components.social ?? 0) < 75) kinds.push('Discussion acceleration')
    if (narrative.components.volume !== null && narrative.components.volume >= 65 && (prior?.components.volume ?? 0) < 65) kinds.push('Volume confirmation')
    if (narrative.sentiment !== null && prior?.sentiment != null && narrative.sentiment - prior.sentiment <= -.5) kinds.push('Headline tone reversal')
    if (narrative.categoryChange !== null && narrative.categoryChange > 25 && narrative.stage === 'Trending') kinds.push('Potentially overheated')
    for (const kind of kinds) {
      if (alerts.some(alert => alert.narrativeId === narrative.id && alert.kind === kind && now - alert.time < 6 * HOUR)) continue
      created.push({ id: `${narrative.id}:${kind}:${now}`, narrativeId: narrative.id, name: narrative.name, kind, time: now, score: narrative.score, coverage: narrative.coverage, stage: narrative.stage, rules: { ...rules }, tokenPrices: Object.fromEntries(narrative.tokenIds.filter(id => tokenPrices[id] > 0).map(id => [id, tokenPrices[id]])), performance: {} })
    }
  }
  return [...created, ...alerts].slice(0, 1000)
}
export function evaluateAlertPerformance(alerts: NarrativeAlert[], quotes: Array<{ time: number; prices: Record<string, number> }>, now: number) {
  return alerts.map(alert => {
    const performance = { ...alert.performance }
    for (const [label, duration] of [['1h', HOUR], ['6h', 6 * HOUR], ['24h', 24 * HOUR], ['7d', 168 * HOUR]] as const) {
      if (performance[label] || now < alert.time + duration) continue
      // The first actually observed quote at/after the horizon, with bounded lag.
      const quote = quotes.find(item => item.time >= alert.time + duration && item.time <= alert.time + duration + 15 * 60000)
      if (!quote) continue
      performance[label] = Object.fromEntries(Object.entries(alert.tokenPrices).map(([id, price]) => [id, quote.prices[id] > 0 ? (quote.prices[id] / price - 1) * 100 : null]))
    }
    return { ...alert, performance }
  })
}
