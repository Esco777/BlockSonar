import { createHash } from 'node:crypto'
import { safeNarrativeUrl, type NarrativeEvidence, type NarrativeCategory, type NarrativeToken } from '../src/lib/early-narrative.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20)
function text(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}
export function parseNewsFeed(xml: string, publisher: string, collectedAt: number): NarrativeEvidence[] {
  // Parse only publisher-provided headlines/links/timestamps; no article scraping,
  // external entity expansion, embedded markup, or full-text replication.
  if (/<!ENTITY/i.test(xml)) throw new Error('Feed entities are unsupported')
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>|<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? []
  return blocks.slice(0, 100).flatMap(block => {
    const tag = (name: string) => text(block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '')
    const title = tag('title').slice(0, 350)
    const url = safeNarrativeUrl(tag('link') || block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || '')
    const publishedAt = Date.parse(tag('pubDate') || tag('published') || tag('updated'))
    if (!title || !url || !Number.isFinite(publishedAt) || publishedAt > collectedAt + 300000) return []
    return [{ id: digest(url), title, url, publisher, kind: 'news' as const, publishedAt, collectedAt }]
  })
}
export function parseCategories(payload: unknown, now: number): NarrativeCategory[] {
  if (!Array.isArray(payload)) throw new Error('Invalid category response')
  return payload.flatMap(row => {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return []
    const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
    return [{ id: row.id, name: row.name, volume: numeric(row.volume_24h), marketCap: numeric(row.market_cap), change24h: numeric(row.market_cap_change_24h), updatedAt: Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : now, topCoinIds: Array.isArray(row.top_3_coins_id) ? row.top_3_coins_id.filter((id: unknown) => typeof id === 'string') : [] }]
  })
}
export function parseNarrativeTokens(payload: unknown, now: number): NarrativeToken[] {
  if (!Array.isArray(payload)) throw new Error('Invalid token response')
  return payload.flatMap(row => {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.symbol !== 'string') return []
    const num = (key: string) => typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : null
    return [{ id: row.id, name: row.name, symbol: row.symbol.toUpperCase(), image: typeof row.image === 'string' ? safeNarrativeUrl(row.image) : null, price: num('current_price'), marketCap: num('market_cap'), volume: num('total_volume'), change24h: num('price_change_percentage_24h'), liquidity: null, relevance: null, source: `https://www.coingecko.com/en/coins/${encodeURIComponent(row.id)}`, observedAt: now, chains: [] }]
  })
}
export class NarrativeSourceHttpError extends Error {
  constructor(readonly status: number, readonly cloudflare = false) {
    super(cloudflare ? `Source blocked by Cloudflare (HTTP ${status})` : `Source returned HTTP ${status}`)
  }
}
export class NarrativeHttpClient {
  private cache = new Map<string, { value: string; at: number }>()
  private cooldown = new Map<string, { until: number; failures: number }>()
  private lastRequest = new Map<string, number>()
  private pending = new Map<string, Promise<string>>()
  constructor(private fetcher: typeof fetch = fetch) {}
  cachedAt(url: string): number | null { return this.cache.get(url)?.at ?? null }
  async get(url: string, ttl: number, headers: Record<string, string> = {}): Promise<string> {
    const cached = this.cache.get(url)
    if (cached && Date.now() - cached.at < ttl) return cached.value
    const pending = this.pending.get(url)
    if (pending) return pending
    const task = this.request(url, headers)
    this.pending.set(url, task)
    try { return await task } finally { this.pending.delete(url) }
  }
  private async request(url: string, headers: Record<string, string>) {
    const host = new URL(url).host, now = Date.now()
    const cooldown = this.cooldown.get(host)
    if (cooldown && cooldown.until > now) throw new Error('Source cooling down; retry scheduled')
    const minimum = host.includes('coingecko') ? 6500 : 1500
    const scheduled = Math.max(now, (this.lastRequest.get(host) ?? 0) + minimum)
    if (scheduled - now > 20000) throw new Error('Source request budget reached; retry shortly')
    this.lastRequest.set(host, scheduled)
    if (scheduled > now) await new Promise(resolve => setTimeout(resolve, scheduled - now))
    try {
      const response = await this.fetcher(url, { headers: { 'User-Agent': process.env.NARRATIVE_USER_AGENT || 'BlockSonar/0.1 (narrative research)', ...headers }, signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        const retry = response.headers.get('retry-after')
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0
        if (response.status === 429) this.cooldown.set(host, { until: Date.now() + Math.max(60000, Math.min(3600000, delay || 60000)), failures: cooldown?.failures ?? 0 })
        const cloudflare = response.status === 403 && (response.headers.get('cf-mitigated') === 'challenge' || /text\/html/i.test(response.headers.get('content-type') || '') && (response.headers.has('cf-ray') || /cloudflare/i.test(response.headers.get('server') || '')))
        throw new NarrativeSourceHttpError(response.status, cloudflare)
      }
      // Bound external responses before allocating their text buffers.
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Empty source response')
      const chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4_000_000) throw new Error('Source response too large'); chunks.push(next.value) }
      } catch (error) { await reader.cancel(); throw error }
      const value = Buffer.concat(chunks).toString('utf8')
      this.cache.set(url, { value, at: Date.now() }); this.cooldown.delete(host)
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!)
      return value
    } catch (error) {
      if (!this.cooldown.has(host)) {
        const failures = (cooldown?.failures ?? 0) + 1
        this.cooldown.set(host, { failures, until: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(failures, 6)) })
      }
      throw error
    }
  }
}
