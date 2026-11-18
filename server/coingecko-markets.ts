import { MAX_SCAN_PAGES } from '../src/lib/market-universe.js'
import { coinGeckoConfig } from './coingecko-config.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
class MarketError extends Error { constructor(readonly status: number, message = 'CoinGecko market request unavailable') { super(message) } }
type Page = { rows: unknown[]; at: number; stale: boolean }
export class CoinGeckoMarkets {
  private pages = new Map<number, Page>()
  private pending = new Map<number, Promise<Page>>()
  private gate = Promise.resolve()
  private nextRequestAt = 0
  private blockedUntil = 0
  private stopped = false
  private controller = new AbortController()
  constructor(private env = process.env, private fetcher: typeof fetch = fetch, private now = Date.now, private pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })) {}
  page(page: number): Promise<Page> {
    if (!Number.isInteger(page) || page < 1 || page > MAX_SCAN_PAGES) return Promise.reject(new MarketError(400))
    if (this.stopped) return Promise.reject(new MarketError(503))
    const cached = this.pages.get(page)
    if (cached && this.now() - cached.at < 180000) return Promise.resolve({ ...cached, stale: false })
    const pending = this.pending.get(page)
    if (pending) return pending
    const task = this.load(page).catch(error => {
      if (cached) return { ...cached, stale: true }
      throw error
    }).finally(() => this.pending.delete(page))
    this.pending.set(page, task)
    return task
  }
  private async load(page: number): Promise<Page> {
    const config = coinGeckoConfig(this.env)
    const turn = this.gate.then(async () => {
      if (this.now() < this.blockedUntil) throw new MarketError(429)
      const delay = Math.max(0, this.nextRequestAt - this.now())
      if (delay) await this.pause(delay, this.controller.signal)
      if (this.now() < this.blockedUntil) throw new MarketError(429)
      this.nextRequestAt = this.now() + (config.configured ? 6500 : 12000)
    })
    this.gate = turn.catch(() => {})
    await turn
    const url = new URL(`${config.base}/coins/markets`)
    url.search = new URLSearchParams({ vs_currency: 'usd', order: 'market_cap_desc', per_page: '250', page: String(page), sparkline: 'true', price_change_percentage: '24h' }).toString()
    let response: Response
    try { response = await this.fetcher(url, { headers: config.headers, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]) }) }
    catch { throw new MarketError(503) }
    if (response.status === 429) {
      const retry = response.headers.get('retry-after')
      const delay = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - this.now()
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000))
      throw new MarketError(429)
    }
    if ([400, 401, 403].includes(response.status)) throw new MarketError(502, config.configured ? `CoinGecko rejected the configured ${config.mode === 'demo' ? 'Demo' : 'Pro'} API key. Verify the key and matching plan in the server environment.` : 'CoinGecko rejected the public API request.')
    if (!response.ok) throw new MarketError(503)
    let rows: unknown
    try { rows = await response.json() } catch { throw new MarketError(503) }
    if (!Array.isArray(rows) || rows.length > 250) throw new MarketError(503)
    const result = { rows, at: this.now(), stale: false }
    this.pages.set(page, result)
    return result
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname !== '/api/market/coins') return false
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'private, no-store')
    try { res.setHeader('X-Market-API-Mode', coinGeckoConfig(this.env).mode) }
    catch { res.writeHead(503); res.end(JSON.stringify({ error: 'Invalid CoinGecko API plan. Use demo or pro on the server.' })); return true }
    const raw = url.searchParams.get('page') ?? '1'
    const page = Number(raw)
    if (req.method !== 'GET' || !/^\d+$/.test(raw) || page < 1 || page > MAX_SCAN_PAGES) { res.writeHead(req.method !== 'GET' ? 405 : 400); res.end(JSON.stringify({ error: `Use GET with a page from 1 to ${MAX_SCAN_PAGES}` })); return true }
    try {
      const result = await this.page(page)
      res.setHeader('X-Market-Updated-At', String(result.at)); res.setHeader('X-Market-Stale', result.stale ? '1' : '0')
      res.end(JSON.stringify(result.rows))
    } catch (error) {
      const status = error instanceof MarketError ? error.status : 503
      if (status === 429) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000))))
      res.writeHead(status); res.end(JSON.stringify({ error: status === 429 ? 'CoinGecko rate limited. Shared requests are paused until retry.' : error instanceof MarketError && status === 502 ? error.message : 'CoinGecko market data unavailable; retry shortly.' }))
    }
    return true
  }
  stop() { this.stopped = true; this.controller.abort() }
}
