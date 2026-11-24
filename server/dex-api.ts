import { DexPriceQuotes } from './dex-price-quotes.js'
import { validAddress } from '../src/lib/token-identity.js'
import { SolanaDexWorker, solanaDexConfig } from './solana-dex-worker.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { dexChains } from '../src/lib/dex-intell.js'
import { DexStore, type SwapFilters } from './dex-store.js'
import { DexConfigurationError, DexWorker, dexConfig } from './dex-worker.js'

export function parseDexFilters(url: URL): SwapFilters {
  const p = url.searchParams
  const integer = (name: string, fallback: number, max: number) => {
    const raw = p.get(name) ?? String(fallback)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw new Error(`Invalid ${name}`)
    return Number(raw)
  }
  const filters: SwapFilters = { offset: integer('offset', 0, 10000), limit: integer('limit', 50, 100) }
  if (filters.limit < 1) throw new Error('Invalid limit')
  const pathChain = /^\/api\/dex\/swaps\/([^/]+)$/.exec(url.pathname)?.[1]
  filters.chain = pathChain ?? p.get('chain') ?? undefined
  if (filters.chain && !dexChains.some(c => c.key === filters.chain)) throw new Error('Unsupported chain')
  for (const key of ['token', 'wallet', 'pool'] as const) {
    const value = p.get(key)
    if (value) { if (!/^0x[0-9a-f]{40}$/i.test(value) && !(filters.chain === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))) throw new Error(`Invalid ${key}`); filters[key] = value.startsWith('0x') ? value.toLowerCase() : value }
  }
  const dex = p.get('dex')
  if (dex) { if (!/^[a-z0-9-]{1,80}$/.test(dex)) throw new Error('Invalid DEX'); filters.dex = dex }
  for (const key of ['from', 'to'] as const) {
    const value = p.get(key)
    if (value) { if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key}`); filters[key] = new Date(value).toISOString() }
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('Invalid date range')
  const min = p.get('minUsd')
  if (min) { if (!/^\d{1,20}(\.\d{1,8})?$/.test(min)) throw new Error('Invalid minimum USD value'); filters.minUsd = min }
  return filters
}
export class DexApi {
  private prices: DexPriceQuotes
  private store?: DexStore
  private workers: Array<DexWorker | SolanaDexWorker> = []
  private workerStatus: Record<string, string> = {}
  private ready?: Promise<void>
  private initializationRetry?: ReturnType<typeof setTimeout>
  private stopped = false
  private windows = new Map<string, { until: number; count: number }>()
  private streams = new Set<ServerResponse>()
  constructor(private env = process.env) { this.prices = new DexPriceQuotes(env) }
  start() {
    if (!this.env.DEX_DATABASE_URL || this.store || this.stopped) return
    this.store = new DexStore(this.env.DEX_DATABASE_URL)
    this.initialize()
  }
  private initialize() {
    this.ready = (async () => {
      await this.store!.migrate()
      if (this.stopped) return
      for (const chain of ['base', 'ethereum', 'bsc'] as const) {
        try {
          const config = dexConfig(this.env, chain)
          this.workerStatus[chain] = config ? 'started' : 'not configured'
          if (config) { const worker = new DexWorker(this.store!, config); this.workers.push(worker); worker.start() }
        } catch (error) {
          this.workerStatus[chain] = 'invalid configuration'
          const details = error instanceof DexConfigurationError
            ? { setting: error.setting, message: error.message }
            : {}
          console.error(JSON.stringify({ service: 'dex', event: 'worker_configuration_failed', chain, ...details }))
        }
      }
      try {
        const config = solanaDexConfig(this.env)
        this.workerStatus.solana = config ? 'started' : 'not configured'
        if (config) { const worker = new SolanaDexWorker(this.store!, config); this.workers.push(worker); worker.start() }
      } catch {
        this.workerStatus.solana = 'invalid configuration'
        console.error(JSON.stringify({ service: 'dex', event: 'worker_configuration_failed', chain: 'solana' }))
      }
    })()
    this.ready.catch(() => {
      console.error(JSON.stringify({ service: 'dex', event: 'initialization_failed', retryInMs: 15000 }))
      if (!this.stopped) this.initializationRetry = setTimeout(() => this.initialize(), 15000)
    })
  }
  handle(req: IncomingMessage, res: ServerResponse, url: URL, membershipVerified = false): boolean {
    const path = url.pathname
    if (!(path === '/api/chains' || path.startsWith('/api/dex/') || path === '/api/data/coverage')) return false
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
    const send = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)) }
    const secret = this.env.DEX_READ_TOKEN
    if (!membershipVerified && this.env.NODE_ENV === 'production' && !secret) { send(503, { error: 'DEX subscriber access has not been configured' }); return true }
    if (secret && !membershipVerified) {
      const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(req.headers.authorization ?? '')
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { send(401, { error: 'DEX access token required' }); return true }
    }
    const now = Date.now(), key = req.socket.remoteAddress ?? 'unknown'
    for (const [ip, window] of this.windows) if (window.until < now) this.windows.delete(ip)
    const window = this.windows.get(key) ?? { until: now + 60000, count: 0 }
    this.windows.set(key, window)
    if (++window.count > 90 || this.windows.size > 10000) { res.setHeader('Retry-After', '60'); send(429, { error: 'DEX query limit reached' }); return true }
    if (path === '/api/chains') { send(200, { chains: dexChains }); return true }
    let filters: SwapFilters
    try { filters = parseDexFilters(url) } catch (error) { send(400, { error: (error as Error).message }); return true }
    if (path === '/api/dex/stream') {
      if (this.streams.size >= 100) { send(503, { error: 'DEX stream capacity reached' }); return true }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders()
      this.streams.add(res)
      const update = () => { if (res.writableLength > 65536) res.destroy(); else res.write(`event: refresh\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`) }
      update(); const timer = setInterval(update, 15000)
      res.on('close', () => { clearInterval(timer); this.streams.delete(res) })
      return true
    }
    void (async () => {
      try {
        if (path === '/api/dex/prices') {
          const chain = filters.chain, tokens = url.searchParams.get('tokens')?.split(',') ?? []
          if (!chain || !tokens.length || tokens.length > 2 || tokens.some(token => !validAddress(chain, token))) { send(400, { error: 'Provide a supported chain and one or two token addresses' }); return }
          try { send(200, await this.prices.getQuotes(chain, tokens)) }
          catch { send(503, { error: 'USD quote service unavailable' }) }
          return
        }
        await this.ready
        const configured = Boolean(this.store)
        const note = 'Configured pools only: Base Uniswap V3; Ethereum Uniswap V2/V3; BNB PancakeSwap V2/V3; Solana Orca Whirlpool/Raydium CPMM. Amounts are raw token integers. Wallet attribution can be unavailable. Current USD estimates use provider quotes where available. V4, other protocol adapters and historical scores are pending. Ambiguous V2 swaps are retained separately without direction.'
        if (path === '/api/data/coverage') {
          send(200, { configured, workers: this.workerStatus, workerHealth: Object.fromEntries(this.workers.map(worker => [worker.chainName, worker.health])), coverage: await this.store?.coverage() ?? [], jobs: this.store ? (await this.store.db.query('SELECT * FROM backfill_jobs ORDER BY chain,pool')).rows : [], unclassified: this.store ? (await this.store.db.query('SELECT chain,pool,count(*)::text AS count FROM dex_unclassified_swaps GROUP BY chain,pool')).rows : [], note }); return
        }
        if (path === '/api/dex/pools/new') {
          send(200, { configured, pools: [], note: 'Factory pool-creation indexing is pending. Configured pools are not labeled newly created.' }); return
        }
        if (!/^\/api\/dex\/swaps(?:\/(base|ethereum|bsc|solana))?$/.test(path)) { send(404, { error: 'Unknown DEX endpoint' }); return }
        const rows = await this.store?.swaps(filters) ?? []
        send(200, { configured, swaps: rows.slice(0, filters.limit), coverage: await this.store?.coverage() ?? [], nextOffset: rows.length > filters.limit ? filters.offset + filters.limit : null, note })
      } catch { send(503, { error: 'DEX historical database unavailable. Check server configuration and migration status.' }) }
    })()
    return true
  }
  async stop() {
    this.stopped = true
    if (this.initializationRetry) clearTimeout(this.initializationRetry)
    for (const res of this.streams) res.end()
    await this.ready?.catch(() => {})
    await Promise.all(this.workers.map(worker => worker.stop()))
    await this.store?.close()
  }
}
