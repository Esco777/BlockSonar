/** Process-wide upstream budgets, in-flight coalescing, bounded cache and Retry-After backoff. */
export class ProviderCache {
  private cache = new Map<string, { at: number; value: unknown }>()
  private pending = new Map<string, Promise<any>>()
  private windows = new Map<string, { start: number; count: number; blocked: number }>()
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}
  async get<T>(url: string, group: string, limit: number, ttl = 60000, init?: RequestInit): Promise<T> {
    const key = `${url}:${init?.body ?? ''}`
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.at < ttl) return cached.value as T
    if (this.pending.has(key)) return this.pending.get(key)!
    const run = async () => {
      const now = this.now()
      let budget = this.windows.get(group)
      if (!budget) { budget = { start: now, count: 0, blocked: 0 }; this.windows.set(group, budget) }
      if (now - budget.start >= 60000) { budget.start = now; budget.count = 0 }
      if (budget.blocked > now || budget.count >= limit) throw new Error('Provider rate limited; retry after the next refresh')
      budget.count++
      let response: Response
      try { response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(15000) }) }
      catch { throw new Error('Provider connection unavailable') }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after')
        const seconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? '') - now
        budget.blocked = now + Math.max(60000, Number.isFinite(seconds) ? seconds : 60000)
      }
      if (!response.ok) throw new Error(`Provider unavailable (HTTP ${response.status})`)
      const value = await response.json()
      if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(key, { at: this.now(), value })
      return value as T
    }
    const promise = run().finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }
}
