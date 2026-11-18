import type { SonarAsset } from './sonar-research.js'

export const SONAR_ASSET_LIMIT = 1500
const PAGE_SIZE = 250
// Allow replacement records for duplicate IDs or missing price/change data.
export const MAX_SCAN_PAGES = 12

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
function parseAssets(rows: unknown[]): SonarAsset[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const price = Number(row.current_price)
    const changeValue = row.price_change_percentage_24h ?? row.price_change_percentage_24h_in_currency
    const change = changeValue == null ? NaN : Number(changeValue)
    if (typeof row.id !== 'string' || !Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) return []
    const sparkline = (row.sparkline_in_7d as { price?: unknown } | undefined)?.price
    return [{ id: row.id, name: String(row.name ?? row.id), symbol: String(row.symbol ?? '').toUpperCase(), image: String(row.image ?? ''), price, change, marketCap: Number(row.market_cap), volume: Number(row.total_volume), sparkline: Array.isArray(sparkline) ? sparkline.map((p) => typeof p === 'number' ? p : NaN) : [] }]
  })
}

export async function loadMarketUniverse(
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  fetcher: typeof fetch = fetch,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = wait,
) {
  const assets = new Map<string, SonarAsset>()
  let updatedAt: number | null = null
  let errorMessage: string | null = null
  let apiMode = 'unknown'
  let stale = false
  for (let page = 1; page <= MAX_SCAN_PAGES && assets.size < SONAR_ASSET_LIMIT; page++) {
    try {
      signal.throwIfAborted()
      const url = `/api/market/coins?page=${page}`
      let response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) })
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After')
        const seconds = retry ? Number(retry) : NaN
        const delay = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 60000
        await pause(Math.max(60000, Math.min(300000, Number.isFinite(delay) ? delay : 60000)), signal)
        response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) })
      }
      const mode = response.headers.get('X-Market-API-Mode')
      if (mode === 'demo' || mode === 'pro' || mode === 'public') apiMode = mode
      if (!response.ok) {
        const details = await response.json().catch(() => null)
        throw new Error(typeof details?.error === 'string' ? details.error : `Market data HTTP ${response.status}`)
      }
      const rows: unknown = await response.json()
      if (!Array.isArray(rows)) throw new Error('Invalid market response')
      for (const coin of parseAssets(rows)) {
        if (assets.size >= SONAR_ASSET_LIMIT) break
        assets.set(coin.id, coin)
      }
      const at = Number(response.headers.get('X-Market-Updated-At'))
      if (Number.isFinite(at) && at > 0) updatedAt = updatedAt === null ? at : Math.min(updatedAt, at)
      stale ||= response.headers.get('X-Market-Stale') === '1'
      onProgress(assets.size)
      signal.throwIfAborted()
      if (rows.length < PAGE_SIZE) break
    } catch (error) {
      if (signal.aborted) throw error
      errorMessage = error instanceof Error ? error.message : 'CoinGecko connection unavailable'
      break
    }
  }
  const complete = assets.size === SONAR_ASSET_LIMIT
  if (!complete && !errorMessage) errorMessage = 'Scan ended before 1,500 eligible coins were found.'
  return { coins: [...assets.values()], complete, stale, updatedAt, errorMessage, apiMode }
}
