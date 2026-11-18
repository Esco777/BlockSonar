import type { CategoryRanking } from './narrative-ranking.js'
export type NarrativeStage = 'Newly Detected' | 'Early Momentum' | 'Accelerating' | 'Trending' | 'Cooling Down'
export type NarrativeSource = { id: string; name: string; kind: 'news' | 'social' | 'market' | 'ai' | 'onchain'; status: 'live' | 'error' | 'unconfigured'; message: string; updatedAt: number | null; checkedAt?: number | null; checking?: boolean }
export type NarrativeEvidence = { id: string; title: string; url: string; publisher: string; kind: 'news' | 'social'; publishedAt: number; collectedAt: number }
export type NarrativeCategory = { id: string; name: string; volume: number | null; marketCap: number | null; change24h: number | null; updatedAt: number; topCoinIds: string[] }
export type NarrativePoint = { liveScore?: number | null; scoreModel?: string; time: number; attention: number; social: number; sources: number; volume: number | null; sentiment: number | null; score: number | null; coverage: number }
export type NarrativeComponents = { social: number | null; diversity: number | null; volume: number | null; onchain: number | null; sentiment: number | null }
export type NarrativeToken = { id: string; name: string; symbol: string; image?: string | null; price: number | null; marketCap: number | null; volume: number | null; change24h: number | null; liquidity: number | null; relevance: number | null; source: string; observedAt: number; chains: { chain: string; address: string }[] }
export type Narrative = { liveRanking?: CategoryRanking; scoredAt?: number; changeSinceUpdate?: number | null; id: string; name: string; firstSeen: number; method: 'rules' | 'ai' | 'category' | 'candidate'; categoryId: string | null; evidence: NarrativeEvidence[]; points: NarrativePoint[]; components: NarrativeComponents; score: number | null; coverage: number; change1h: number | null; change24h: number | null; mentionGrowth: number | null; sentiment: number | null; stage: NarrativeStage; summary: string | null; summarySourceIds: string[]; volume: number | null; categoryChange: number | null; tokenIds: string[]; detectedTokenIds?: string[]; tokenPreview?: NarrativeToken[]; tokensUpdatedAt?: number }
export type NarrativeAlert = { id: string; narrativeId: string; name: string; kind: string; time: number; score: number | null; coverage: number; stage: NarrativeStage; rules: NarrativeRules; tokenPrices: Record<string, number>; performance: Record<string, Record<string, number | null>> }
export type NarrativeRules = { early: number; accelerating: number; trending: number; minimumSources: number; minimumAgeHours: number }
export const DEFAULT_NARRATIVE_RULES: NarrativeRules = { early: 30, accelerating: 50, trending: 70, minimumSources: 2, minimumAgeHours: 1 }
export const NARRATIVE_WEIGHTS: Record<keyof NarrativeComponents, number> = { social: .30, diversity: .20, volume: .20, onchain: .15, sentiment: .15 }
export type NarrativeSnapshot = { scoring?: { status: 'live' | 'partial' | 'unavailable'; intervalMs: number; newsIntervalMs: number; marketCacheMs: number; nextUpdateAt: number | null }; version: 1; updatedAt: number | null; startedAt: number; sources: NarrativeSource[]; narratives: Narrative[]; alerts: NarrativeAlert[]; rules: NarrativeRules; error: string | null }

export const NARRATIVE_TOPICS = [
  { id: 'artificial-intelligence', name: 'Artificial Intelligence', terms: ['artificial intelligence', 'machine learning', 'ai tokens', 'ai crypto'] },
  { id: 'ai-agents', name: 'AI Agents', terms: ['ai agents', 'ai agent', 'autonomous agents', 'agentic'] },
  { id: 'quantum-computing', name: 'Quantum Computing', terms: ['quantum computing', 'quantum resistant', 'post quantum', 'quantum'] },
  { id: 'real-world-assets', name: 'Real World Assets', terms: ['real world assets', 'real-world asset', 'rwa', 'tokenized treasuries'] },
  { id: 'depin', name: 'DePIN', terms: ['depin', 'decentralized physical infrastructure'] },
  { id: 'layer-2', name: 'Layer 2 Scaling', terms: ['layer 2', 'layer-2', 'rollups', 'rollup', 'scaling'] },
  { id: 'gaming', name: 'Gaming / GameFi', terms: ['gaming', 'gamefi', 'blockchain games', 'web3 games'] },
  { id: 'storage', name: 'Decentralized Storage', terms: ['decentralized storage', 'distributed storage'] },
  { id: 'privacy', name: 'Privacy', terms: ['privacy', 'zero knowledge', 'zero-knowledge', 'zk proofs'] },
  { id: 'robotics', name: 'Robotics', terms: ['robotics', 'robot economy', 'humanoid'] },
  { id: 'defi', name: 'Decentralized Finance', terms: ['decentralized finance', 'defi', 'decentralized exchange', 'lending protocol'] },
  { id: 'tokenized-stocks', name: 'Tokenized Stocks', terms: ['tokenized stocks', 'tokenized equities', 'tokenised stocks', 'tokenized shares'] },
] as const
const normalizedText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function matchesTopic(text: string, terms: readonly string[]) {
  const normalized = ` ${normalizedText(text)} `
  return terms.some(term => normalized.includes(` ${normalizedText(term)} `))
}
export function safeNarrativeUrl(value: string): string | null {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null; return url.href } catch { return null }
}
export function deduplicateEvidence(items: NarrativeEvidence[]) {
  const seenUrls = new Set<string>(), seenTitles = new Set<string>()
  return [...items].sort((a, b) => a.collectedAt - b.collectedAt).filter(item => {
    const link = safeNarrativeUrl(item.url)
    if (!link) return false
    const url = new URL(link); url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key)
    const title = normalizedText(item.title), canonical = url.href.replace(/\/$/, '')
    if (!title || seenUrls.has(canonical) || seenTitles.has(title)) return false
    seenUrls.add(canonical); seenTitles.add(title); return true
  })
}
export function scoreNarrative(components: NarrativeComponents) {
  let score = 0, coverage = 0
  for (const key of Object.keys(NARRATIVE_WEIGHTS) as Array<keyof NarrativeComponents>) {
    const value = components[key]
    if (value === null || !Number.isFinite(value)) continue
    score += Math.max(0, Math.min(100, value)) * NARRATIVE_WEIGHTS[key]
    coverage += NARRATIVE_WEIGHTS[key]
  }
  return { score: coverage ? Math.round(score * 10) / 10 : null, coverage: Math.round(coverage * 100) }
}
export function percentageGrowth(current: number, previous: number | null) { return previous !== null && previous > 0 ? (current / previous - 1) * 100 : null }
export function pointAt(points: NarrativePoint[], time: number, tolerance = 15 * 60000) {
  return [...points].reverse().find(point => point.time <= time && time - point.time <= tolerance) ?? null
}
export function narrativeStage(score: number | null, previous: number | null, ageHours: number, sources: number, rules = DEFAULT_NARRATIVE_RULES): NarrativeStage {
  if (ageHours < rules.minimumAgeHours || score === null) return 'Newly Detected'
  if (previous !== null && previous - score >= 10) return 'Cooling Down'
  if (sources < rules.minimumSources) return 'Newly Detected'
  if (score >= rules.trending) return 'Trending'
  if (score >= rules.accelerating) return 'Accelerating'
  return score >= rules.early ? 'Early Momentum' : 'Newly Detected'
}

/** Candidate discovery uses repeated non-ticker phrases; it makes no token associations. */
export function discoverCandidateTopics(evidence: NarrativeEvidence[]) {
  const stops = new Set('the a an and of for to in on with from as is are has have new says crypto cryptocurrency bitcoin ethereum price news market markets today after before this that how why will could over amid about its into out more than us'.split(' '))
  const phrases = new Map<string, NarrativeEvidence[]>()
  for (const item of evidence) {
    const words = normalizedText(item.title).split(' ')
    const local = new Set<string>()
    for (let i = 0; i < words.length - 1; i++) {
      if (stops.has(words[i]) || stops.has(words[i + 1]) || words[i].length < 4 || words[i + 1].length < 4) continue
      const phrase = `${words[i]} ${words[i + 1]}`
      if (!local.has(phrase)) phrases.set(phrase, [...(phrases.get(phrase) ?? []), item]); local.add(phrase)
    }
  }
  return [...phrases].filter(([, rows]) => rows.length >= 3 && new Set(rows.map(row => row.publisher)).size >= 2)
    .sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([name, rows]) => ({ id: `candidate-${name.replace(/ /g, '-')}`, name: name.replace(/\b\w/g, c => c.toUpperCase()), evidence: rows }))
}

/** Count only returned token records; category ID hints alone are not detections. */
export function detectedNarrativeTokenIds(narrative: Pick<Narrative, 'detectedTokenIds' | 'tokenPreview'>, tokens: NarrativeToken[] = []) {
  return [...new Set([...(narrative.detectedTokenIds ?? []), ...(narrative.tokenPreview ?? []).map(token => token.id), ...tokens.map(token => token.id)])]
}

/** A newly fetched snapshot is not proof that its underlying score is current. */
export function narrativeScoreFreshness(updatedAt: number | null | undefined, now: number): 'waiting' | 'live' | 'delayed' {
  return updatedAt == null ? 'waiting' : updatedAt > now + 60000 || now - updatedAt > 3 * 60000 ? 'delayed' : 'live'
}
