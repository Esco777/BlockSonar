import { NarrativeOnchain } from './narrative-onchain.js'
import { calculateCategoryRankings } from './narrative-ranking.js'
import path from 'node:path'
import { DEFAULT_NARRATIVE_RULES, deduplicateEvidence, detectedNarrativeTokenIds, type NarrativeToken, type NarrativeSnapshot, type NarrativeSource, type NarrativeRules } from '../src/lib/early-narrative.js'
import { NarrativeHttpClient, parseNewsFeed, parseCategories, parseNarrativeTokens } from './narrative-collectors.js'
import { classifyNarratives, aiNarratives } from './narrative-classifier.js'
import { calculateNarratives, createNarrativeAlerts, evaluateAlertPerformance } from './narrative-engine.js'
import { NarrativeStore, type NarrativeState } from './narrative-store.js'

const MINUTE = 60000, DAY = 86400000
const sources: NarrativeSource[] = [
  { id: 'coindesk', name: 'CoinDesk RSS', kind: 'news', status: 'unconfigured', message: 'Waiting for collection', updatedAt: null },
  { id: 'cointelegraph', name: 'Cointelegraph RSS', kind: 'news', status: 'unconfigured', message: 'Waiting for collection', updatedAt: null },
  { id: 'coingecko', name: 'CoinGecko categories', kind: 'market', status: 'unconfigured', message: 'Waiting for collection', updatedAt: null },
  { id: 'reddit', name: 'Reddit', kind: 'social', status: 'unconfigured', message: 'Approved API access is not configured', updatedAt: null },
  { id: 'x', name: 'X / Twitter', kind: 'social', status: 'unconfigured', message: 'API access is not configured', updatedAt: null },
  { id: 'onchain', name: 'Wallet / on-chain activity', kind: 'onchain', status: 'unconfigured', message: 'No verified wallet activity provider connected', updatedAt: null },
  { id: 'ai', name: 'Local AI classification', kind: 'ai', status: 'unconfigured', message: 'Using labeled topic rules and candidate phrases; local AI is optional', updatedAt: null },
]
function configuredRules(): NarrativeRules {
  try {
    const value = process.env.NARRATIVE_RULES_JSON ? JSON.parse(process.env.NARRATIVE_RULES_JSON) : {}
    const rules = { ...DEFAULT_NARRATIVE_RULES, ...value }
    if (Object.keys(rules).some(key => typeof rules[key] !== 'number' || !Number.isFinite(rules[key]))
      || rules.early < 0 || rules.trending > 100 || rules.early >= rules.accelerating || rules.accelerating >= rules.trending
      || rules.minimumSources < 1 || rules.minimumAgeHours < 0) throw new Error('Invalid narrative rules')
    return rules
  } catch { throw new Error('NARRATIVE_RULES_JSON must contain valid ascending score thresholds from 0 to 100') }
}
export class NarrativeService {
  private store = new NarrativeStore(process.env.NARRATIVE_DATA_FILE || path.join(process.cwd(), 'data', 'early-narrative.json'))
  private onchain: NarrativeOnchain
  private client: NarrativeHttpClient
  private state: NarrativeState
  private lastRefreshStartedAt: number | null = null
  private refreshing: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private tokenTimer: ReturnType<typeof setInterval> | undefined
  private tokenRefresh: Promise<void> | null = null
  private tokenRequests = new Map<string, Promise<{ tokens: NarrativeToken[]; updatedAt: number | null; message: string }>>()
  private previewCursor = 0
  private ready: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  private sourceListeners = new Set<(sources: NarrativeSource[]) => void>()
  constructor(fetcher: typeof fetch = fetch) {
    this.onchain = new NarrativeOnchain(process.env.ALCHEMY_API_KEY, fetcher)
    this.client = new NarrativeHttpClient(fetcher)
    this.state = { snapshot: { version: 1, updatedAt: null, startedAt: Date.now(), sources: structuredClone(sources), narratives: [], alerts: [], rules: configuredRules(), error: null }, evidence: [], categories: [], tokenCache: {}, quotes: [] }
    this.ready = this.store.load().then(value => { if (value) { this.state = value; this.state.snapshot.rules = configuredRules(); this.state.snapshot.sources = sources.map(source => { const prior=value.snapshot.sources.find(item=>item.id===source.id); return {...source,updatedAt:prior?.updatedAt??null,checkedAt:prior?.checkedAt??null} }) } }).catch(() => { this.state.snapshot.error = 'Stored narrative history could not be read. Collection is disabled to avoid overwriting it; inspect the data file.'; this.storageBlocked = true })
  }
  private storageBlocked = false
  async start() {
    await this.ready
    if (this.storageBlocked || this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), MINUTE)
    this.timer.unref()
    this.tokenTimer = setInterval(() => { void this.refreshTokenPreviews() }, MINUTE)
    this.tokenTimer.unref()
  }
  stop() { if (this.timer) clearInterval(this.timer); if (this.tokenTimer) clearInterval(this.tokenTimer); this.timer = undefined; this.tokenTimer = undefined }
  async snapshot(): Promise<NarrativeSnapshot> {
    await this.ready
    const snapshot = structuredClone(this.state.snapshot)
    const onchain = snapshot.sources.find(source => source.id === 'onchain')
    if (onchain?.status === 'live' && (onchain.updatedAt === null || Date.now() - onchain.updatedAt > 3 * MINUTE)) { onchain.status = 'error'; onchain.message = 'Alchemy on-chain collection is stale; awaiting the next successful sample.' }
    const activeSources = snapshot.sources.filter(source => ['news', 'market'].includes(source.kind))
    const freshSources = activeSources.filter(source => source.status === 'live' && source.updatedAt !== null && Date.now() - source.updatedAt <= this.sourceFreshness(source))
    snapshot.scoring = { status: freshSources.length === activeSources.length ? 'live' : freshSources.length ? 'partial' : 'unavailable', intervalMs: MINUTE, newsIntervalMs: MINUTE, marketCacheMs: 5 * MINUTE, nextUpdateAt: snapshot.updatedAt === null ? null : (this.lastRefreshStartedAt ?? snapshot.updatedAt) + MINUTE }
    for (const narrative of snapshot.narratives) {
      narrative.detectedTokenIds = detectedNarrativeTokenIds(narrative, this.state.tokenCache[narrative.id]?.tokens ?? [])
    }
    return snapshot
  }
  private currentSources() {
    return structuredClone(this.state.snapshot.sources).map(source=>{
      if(source.status==='live'&&(source.updatedAt===null||Date.now()-source.updatedAt>this.sourceFreshness(source))){source.status='error';source.message='Last successful collection is stale; awaiting a successful refresh.'}
      return source
    })
  }
  async sourceHealth() { await this.ready; return this.currentSources() }
  subscribeSources(listener: (sources: NarrativeSource[]) => void) {
    this.sourceListeners.add(listener)
    return () => { this.sourceListeners.delete(listener) }
  }
  private publishSources() {
    for(const listener of this.sourceListeners){try{listener(this.currentSources())}catch{/* A disconnected observer must not interrupt collection. */}}
  }
  private checking(id: string) {
    const source=this.state.snapshot.sources.find(item=>item.id===id)
    if(source){source.checking=true;this.publishSources()}
  }
  private status(id: string, status: NarrativeSource['status'], message: string, observedAt = Date.now()) {
    const source = this.state.snapshot.sources.find(item => item.id === id)
    if (source) { source.status = status; source.message = message; source.checking=false;source.checkedAt=Date.now();if (status === 'live') source.updatedAt = observedAt;this.publishSources() }
  }
  private headers(): Record<string, string> { return process.env.COINGECKO_DEMO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_DEMO_API_KEY } : {} }
  private sourceFreshness(source: NarrativeSource) {
    return (source.kind==='market'?30:3)*MINUTE
  }
  private save() {
    const snapshot = structuredClone(this.state)
    this.writes = this.writes.catch(() => undefined).then(() => this.store.save(snapshot))
    return this.writes
  }
  async refresh() {
    await this.ready
    if (this.refreshing || this.storageBlocked) return this.refreshing
    if (this.lastRefreshStartedAt !== null && Date.now() - this.lastRefreshStartedAt < MINUTE) return
    this.lastRefreshStartedAt = Date.now()
    this.refreshing = this.collect().catch(() => { this.state.snapshot.error = 'Narrative collection failed; keeping the latest available history.' }).finally(() => { this.refreshing = null })
    return this.refreshing
  }
  private async collect() {
    this.checking('onchain')
    const onchain = this.onchain.collect().then(result => { this.status('onchain', result.status, result.message, result.updatedAt ?? Date.now()) }).catch(() => { this.status('onchain','error','Alchemy on-chain collection unavailable; retrying each minute') })
    let now = Date.now()
    const feeds = [
      { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
      { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
    ]
    const collected = await Promise.allSettled(feeds.map(async feed => {
      this.checking(feed.id)
      try {
        const xml = await this.client.get(feed.url, MINUTE)
        const rows = parseNewsFeed(xml, feed.name, now)
        if (!rows.length) throw new Error('No dated headlines returned')
        this.status(feed.id, 'live', `${rows.length} dated headlines retrieved`, this.client.cachedAt(feed.url) ?? now)
        return rows
      } catch (error) { this.status(feed.id, 'error', error instanceof Error ? error.message : 'Collection failed'); return [] }
    }))
    this.state.evidence = deduplicateEvidence([...this.state.evidence, ...collected.flatMap(result => result.status === 'fulfilled' ? result.value : [])])
      .filter(item => item.publishedAt >= now - 31 * DAY).slice(-10000)
    try {
      this.checking('coingecko')
      const payload = JSON.parse(await this.client.get('https://api.coingecko.com/api/v3/coins/categories', 5 * MINUTE, this.headers()))
      this.state.categories = parseCategories(payload, this.client.cachedAt('https://api.coingecko.com/api/v3/coins/categories') ?? now)
      this.status('coingecko', 'live', `${this.state.categories.length} source-defined categories; token associations use category IDs`, this.client.cachedAt('https://api.coingecko.com/api/v3/coins/categories') ?? now)
    } catch (error) { this.status('coingecko', 'error', error instanceof Error ? error.message : 'Category collection failed') }
    await onchain
    // No Reddit/X scraping or unapproved data access. Their absence is explicit.
    let clusters = classifyNarratives(this.state.evidence, this.state.categories)
    if (process.env.NARRATIVE_OLLAMA_MODEL) {
      this.checking('ai')
      try {
        const ai = await aiNarratives(this.state.evidence.filter(item => item.kind === 'news'), this.state.categories)
        const byId = new Map(clusters.map(cluster => [cluster.id, cluster]))
        for (const cluster of ai) {
          const old = byId.get(cluster.id)
          byId.set(cluster.id, { ...cluster, categoryId: cluster.categoryId ?? old?.categoryId ?? null, evidence: deduplicateEvidence([...(old?.evidence ?? []), ...cluster.evidence]) })
        }
        clusters = [...byId.values()]
        this.status('ai', 'live', 'Local model grouping; summaries cite supplied headlines; tone is model-estimated')
      } catch (error) { this.status('ai', 'error', error instanceof Error ? error.message : 'Local AI unavailable; using topic rules') }
    }
    now = Date.now() // Score at completion, using only evidence already observed.
    const previous = this.state.snapshot.narratives
    // Persist previously discovered topics even after they cool or disappear.
    for (const prior of previous) if (!clusters.some(item => item.id === prior.id)) clusters.push({ id: prior.id, name: prior.name, method: prior.method, categoryId: prior.categoryId, evidence: [], summary: null, summarySourceIds: [], sentiment: null })
    const newsAvailable = this.state.snapshot.sources.some(source => source.kind === 'news' && source.status === 'live' && source.updatedAt !== null && now - source.updatedAt <= this.sourceFreshness(source))
    const narratives = calculateCategoryRankings(calculateNarratives(clusters, previous, this.state.categories, now, this.state.snapshot.startedAt, this.state.snapshot.rules, newsAvailable), this.state.categories, now, newsAvailable)
    // Retain verified members loaded on demand when narrative scores refresh.
    for (const narrative of narratives) {
      const cached = this.state.tokenCache[narrative.id]
      if (cached) narrative.tokenIds = [...new Set([...narrative.tokenIds, ...cached.tokens.map(token => token.id)])]
      const prior = previous.find(item => item.id === narrative.id)
      if (prior?.tokenPreview) { narrative.tokenPreview = prior.tokenPreview; narrative.tokensUpdatedAt = prior.tokensUpdatedAt }
    }
    const freshQuotes = Object.values(this.state.tokenCache).filter(item => now - item.at < 15 * MINUTE).flatMap(item => item.tokens)
    const prices = Object.fromEntries(freshQuotes.filter(token => token.price !== null && token.price > 0).map(token => [token.id, token.price!]))
    const alerts = createNarrativeAlerts(narratives, previous, this.state.snapshot.alerts, now, this.state.snapshot.rules, prices)
    const trackedIds = [...new Set(alerts.flatMap(alert => Object.keys(alert.tokenPrices)))].slice(0, 100)
    if (trackedIds.length) {
      try {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(trackedIds.join(','))}&sparkline=false`
        const tokens = parseNarrativeTokens(JSON.parse(await this.client.get(url, 4 * MINUTE, this.headers())), Date.now())
        this.state.quotes.push({ time: Date.now(), prices: Object.fromEntries(tokens.filter(token => token.price !== null && token.price > 0).map(token => [token.id, token.price!])) })
      } catch { /* Missing horizon quotes stay unavailable, never interpolate. */ }
    }
    this.state.quotes = this.state.quotes.filter(quote => quote.time > now - 31 * DAY)
    this.state.snapshot = { ...this.state.snapshot, updatedAt: now, narratives, alerts: evaluateAlertPerformance(alerts, this.state.quotes, now), error: null }
    try { await this.save() } catch { this.state.snapshot.error = 'Narrative data is live but history could not be saved. Check the configured data directory.' }
    await this.refreshTokenPreviews()
  }
  async refreshTokenPreviews() {
    if (this.storageBlocked) return
    if (this.tokenRefresh) return this.tokenRefresh
    this.tokenRefresh = this.loadTokenPreviews().finally(() => { this.tokenRefresh = null })
    return this.tokenRefresh
  }
  private async loadTokenPreviews() {
    const allIds = [...new Set(this.state.snapshot.narratives.flatMap(item => item.tokenIds.slice(0, 3)))]
    if (!allIds.length) return
    const start = this.previewCursor % allIds.length
    const ids = [...allIds.slice(start), ...allIds.slice(0, start)].slice(0, 100)
    try {
      // One shared market request populates all narrative rows, not one call per row.
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&sparkline=false`
      const tokens = parseNarrativeTokens(JSON.parse(await this.client.get(url, MINUTE, this.headers())), Date.now())
      const byId = new Map(tokens.map(token => [token.id, token]))
      for (const narrative of this.state.snapshot.narratives) {
        if (!narrative.tokenIds.slice(0, 3).some(id => byId.has(id))) continue
        const prior = new Map((narrative.tokenPreview ?? []).map(token => [token.id, token]))
        for (const id of narrative.tokenIds.slice(0, 3)) if (byId.has(id)) prior.set(id, byId.get(id)!)
        narrative.tokenPreview = narrative.tokenIds.slice(0, 3).flatMap(id => prior.has(id) ? [prior.get(id)!] : [])
        narrative.tokensUpdatedAt = Date.now()
      }
      this.previewCursor = (start + ids.length) % allIds.length
      await this.save()
    } catch { /* Preserve the last verified preview; its timestamp exposes stale data. */ }
  }
  async tokens(id: string) {
    await this.ready
    const narrative = this.state.snapshot.narratives.find(item => item.id === id)
    if (!narrative) throw new Error('Unknown narrative')
    if (!narrative.categoryId) return { tokens: [], updatedAt: null, message: 'No verified CoinGecko category association. Token matches are not inferred from ticker mentions.' }
    const cached = this.state.tokenCache[id]
    if (cached) {
      const stale = Date.now() - cached.at >= MINUTE
      if (stale) void this.loadTokens(id).catch(() => {})
      return { tokens: cached.tokens, updatedAt: cached.at, message: stale
        ? 'Showing last verified category members; refreshing in the background. Prices reflect the displayed observation time.'
        : 'Verified category membership; relevance and pool liquidity are unavailable.' }
    }
    return this.loadTokens(id)
  }
  private loadTokens(id: string) {
    const pending = this.tokenRequests.get(id)
    if (pending) return pending
    const task = this.fetchTokens(id).finally(() => { this.tokenRequests.delete(id) })
    this.tokenRequests.set(id, task)
    return task
  }
  private async fetchTokens(id: string) {
    const narrative = this.state.snapshot.narratives.find(item => item.id === id)!
    const cached = this.state.tokenCache[id]
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${encodeURIComponent(narrative.categoryId!)}&order=market_cap_desc&per_page=30&page=1&sparkline=false`
    const now = Date.now()
    let tokens
    try {
      tokens = parseNarrativeTokens(JSON.parse(await this.client.get(url, MINUTE, this.headers())), now)
    } catch (error) {
      if (!cached) throw error
      // Keep known coin identities visible during provider backoff; use only
      // verified matching-ID images when a previously cached record lacks one.
      const previews = new Map(this.state.snapshot.narratives.flatMap(item => item.tokenPreview ?? []).map(token => [token.id, token.image]))
      return { tokens: cached.tokens.map(token => ({ ...token, image: token.image || previews.get(token.id) || null })), updatedAt: cached.at,
        message: 'Showing last received verified coins while CoinGecko is unavailable or rate limited; automatic refresh will retry.' }
    }
    this.state.tokenCache[id] = { at: now, tokens }
    // Only token prices known now can be attached to future alerts, never earlier ones.
    const current = this.state.snapshot.narratives.find(item => item.id === id)
    if (current) current.tokenIds = [...new Set([...current.tokenIds, ...tokens.map(token => token.id)])]
    try { await this.save() } catch { this.state.snapshot.error = 'Token history could not be saved.' }
    return { tokens, updatedAt: now, message: 'Category membership verified by CoinGecko ID. Chain/address details load separately; liquidity and numeric relevance are unavailable.' }
  }
  async identity(id: string) {
    await this.ready
    if (!Object.values(this.state.tokenCache).some(item => item.tokens.some(token => token.id === id))) throw new Error('Load the verified narrative token list first')
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`
    const row = JSON.parse(await this.client.get(url, DAY, this.headers())) as { id?: string; asset_platform_id?: string; platforms?: Record<string, unknown> }
    if (row.id !== id) throw new Error('Token identity did not match')
    const chains = Object.entries(row.platforms ?? {}).flatMap(([chain, address]) => chain && typeof address === 'string' && address ? [{ chain, address }] : [])
    return { id, chains, nativeChain: row.asset_platform_id ?? null, source: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` }
  }
}
