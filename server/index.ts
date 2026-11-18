import { loadCoinGeckoEnv } from './coingecko-config.js'
import {SonarDefiService} from './sonar-defi.js'
import { CoinGeckoMarkets } from './coingecko-markets.js'
import { HolderSearch } from './holder-search.js'
import { Backups } from './backups.js'
import { PrivatePreferences, preferenceOwner } from './private-preferences.js'
import {MarketSnapshotService} from './market-snapshot.js'
import { MembershipAuth } from './membership-auth.js'
import { createMembershipNetworks } from './membership-networks.js'
import { SolanaCheckout } from './solana-checkout.js'
import { AlchemyDexPrices } from './alchemy-dex-prices.js'
import { WalletHolderService } from './wallet-holders.js'
import 'dotenv/config'
import { DexApi } from './dex-api.js'
import { NotificationService } from './notification-service.js'
import { EthereumWalletService } from './ethereum-wallet-service.js'
import { IntelligenceService } from './intelligence-service.js'
import { validAddress } from '../src/lib/token-identity.js'
import { NarrativeService } from './narrative-service.js'
import {NarrativeSourceStream} from './narrative-source-stream.js'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { MAX_FRAMES } from '../src/lib/liquidity-stream.js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serveStaticSite } from './static-site.js'
import { LIQUIDITY_FEEDS, feedKey, findLiquidityFeed } from '../src/lib/liquidity-exchanges.js'
import type { LiquidityFrame } from '../src/lib/liquidity-types.js'
import { startExchangeCollector, type CollectorStatus } from './exchange-collector.js'

loadCoinGeckoEnv()
const PORT = Number(process.env.PORT ?? 4001)
const production = process.env.NODE_ENV === 'production'
const HOST = process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1')
const siteDirectory = fileURLToPath(new URL('../../../dist/', import.meta.url))
if (production && !existsSync(`${siteDirectory}/index.html`)) throw new Error('Frontend build missing. Run npm run build:production before npm start.')
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid PORT')
const history = new Map<string, LiquidityFrame[]>()
const statuses = new Map<string, CollectorStatus>()
const clients = new Map<ServerResponse, string>()
for (const feed of LIQUIDITY_FEEDS) { history.set(feedKey(feed), []); statuses.set(feedKey(feed), { status: 'connecting', error: null, lastFrameAt: null }) }
function broadcast(frame: LiquidityFrame) {
  const key = feedKey(frame)
  const frames = history.get(key)!
  frames.push(frame)
  if (frames.length > MAX_FRAMES) frames.shift()
  const payload = `data: ${JSON.stringify(frame)}\n\n`
  for (const [client, selected] of clients) if (key === selected) {
    if (client.destroyed || client.writableLength > 1024 * 1024) { clients.delete(client); client.destroy() }
    else client.write(payload)
  }
}
const marketSnapshot = new MarketSnapshotService()
const sonarDefi = new SonarDefiService()
// Sonar uses the public CoinGecko feed regardless of credentials for other features.
const coingeckoMarkets = new CoinGeckoMarkets({})
const walletSonarPrices = new AlchemyDexPrices(process.env.ALCHEMY_API_KEY)
const ethereumWallets = new EthereumWalletService()
const holderDirectory = new WalletHolderService(ethereumWallets)
const holderSearch = new HolderSearch(holderDirectory, ethereumWallets, process.env.ALCHEMY_API_KEY)
const intelligence = new IntelligenceService()
const narratives = new NarrativeService()
const narrativeSources = new NarrativeSourceStream(narratives)
const notifications = new NotificationService(intelligence,narratives)
const dex = new DexApi()
const backups = new Backups()
const privatePreferences = new PrivatePreferences(process.env.DEX_DATABASE_URL)
const membershipNetworks = createMembershipNetworks(process.env)
const membership = new MembershipAuth(membershipNetworks.ethereum,process.env,Date.now,[membershipNetworks.bnb,membershipNetworks.solana])
const solanaCheckout = new SolanaCheckout(membershipNetworks.solana,membership)
const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):(3000|5173|5174)$/.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const apiRequest = url.pathname === '/health' || url.pathname === '/stream' || url.pathname.startsWith('/api/')
  if (production && !apiRequest && (req.method === 'GET' || req.method === 'HEAD')) {
    void serveStaticSite(req, res, siteDirectory); return
  }
  if (await membership.handle(req,res,url)) return
  if (await solanaCheckout.handle(req,res,url)) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/stream') {
    try {
      const user = await membership.authorize(req,res,url)
      if (await holderSearch.handle(req,res,url,preferenceOwner(user))) return
      if (url.pathname.startsWith('/api/preferences/')) {
        if (req.method !== 'GET') membership.origin(req)
        await privatePreferences.handle(req,res,url,user); return
      }
    } catch(error) { membership.reject(res,error);return }
  }
  if (req.method !== 'GET') { res.writeHead(405, { Allow: production && !apiRequest ? 'GET, HEAD' : 'GET' }); res.end('Method not allowed'); return }
  if (url.pathname === '/api/operations/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await backups.status())); return }
  if (await coingeckoMarkets.handle(req,res,url)) return
  if (dex.handle(req, res, url, true)) return
  if(url.pathname==='/api/market/defi'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');res.end(JSON.stringify(await sonarDefi.snapshot()));return}
  if(url.pathname==='/api/market/snapshot'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await marketSnapshot.snapshot()));return}
  if (['/api/wallet-tracker/prices', '/api/discovery/pools', '/api/wallet-tracker', '/api/wallet-tracker/valuation', '/api/wallet-tracker/ethereum', '/api/wallet-tracker/ethereum/holders', '/api/wallet-tracker/solana/holders', '/api/intelligence', '/api/intelligence/token'].includes(url.pathname)) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
    void (async () => {
      try {
        let data: unknown
        if (url.pathname === '/api/wallet-tracker/prices') {
          const chain = url.searchParams.get('chain'), tokens = url.searchParams.get('tokens')?.split(',') ?? []
          if ((chain !== 'ethereum' && chain !== 'solana') || !tokens.length || tokens.length > 3 || tokens.some(token => !validAddress(chain, token))) { res.writeHead(400); res.end(JSON.stringify({error:'Provide Ethereum or Solana and up to three token addresses'})); return }
          data = await walletSonarPrices.getQuotes(chain, tokens)
        } else if (url.pathname === '/api/wallet-tracker/ethereum/holders') {
          data = await holderDirectory.ethereumHolders()
        } else if (url.pathname === '/api/wallet-tracker/solana/holders') {
          data = await holderDirectory.solanaHolders()
        } else if (url.pathname === '/api/wallet-tracker/ethereum') {
          const address = url.searchParams.get('address') ?? ''
          if (!validAddress('ethereum', address)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid Ethereum address' })); return }
          data = await ethereumWallets.wallet(address)
        } else if (url.pathname === '/api/discovery/pools') {
          const network = url.searchParams.get('network') ?? 'solana', page = Number(url.searchParams.get('page') ?? 1)
          if (!['eth', 'solana', 'bsc'].includes(network) || !Number.isInteger(page) || page < 1 || page > 3) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid discovery chain or page' })); return }
          data = await intelligence.pools(network as 'eth' | 'solana' | 'bsc', page)
        } else if (url.pathname === '/api/wallet-tracker/valuation') {
          const address = url.searchParams.get('address') ?? ''
          if (!validAddress('solana', address)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid Solana address' })); return }
          data = await intelligence.valuation(address)
        } else if (url.pathname === '/api/wallet-tracker') {
          const address = url.searchParams.get('address') ?? '', before = url.searchParams.get('before') ?? undefined
          if (!validAddress('solana', address) || (before && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(before))) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid Solana address or cursor' })); return }
          data = await intelligence.wallet(address, before)
        } else if (url.pathname === '/api/intelligence/token') {
          const mint = url.searchParams.get('mint') ?? ''
          if (!validAddress('solana', mint)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid Solana mint' })); return }
          data = await intelligence.token(mint)
        } else data = await intelligence.intelligence()
        res.end(JSON.stringify(data))
      } catch (error) { res.writeHead(503); res.end(JSON.stringify({ error: error instanceof Error && error.message.startsWith('Alchemy pool discovery unavailable') ? error.message : 'Intelligence provider unavailable; retry on the next refresh' })) }
    })()
    return
  }
  if (url.pathname === '/api/notifications') {
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    void notifications.snapshot().then(data=>res.end(JSON.stringify(data))).catch(()=>{res.writeHead(503);res.end(JSON.stringify({error:'Notification feeds unavailable'}))})
    return
  }
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: 'running' })); return }
  if(await narrativeSources.handle(req,res,url))return
  if (url.pathname === '/api/narratives' || url.pathname === '/api/narratives/tokens' || url.pathname === '/api/narratives/identity') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    void (async () => {
      try {
        const id = url.searchParams.get('id') ?? ''
        if (url.pathname !== '/api/narratives' && (!id || id.length > 160)) { res.writeHead(400); res.end(JSON.stringify({ error: 'A valid narrative or token ID is required' })); return }
        if (url.pathname === '/api/narratives' && url.searchParams.get('refresh') === '1') await narratives.refresh()
        const data = url.pathname === '/api/narratives' ? await narratives.snapshot() : url.pathname.endsWith('/tokens') ? await narratives.tokens(id) : await narratives.identity(id)
        res.end(JSON.stringify(data))
      } catch (error) { res.writeHead(503); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Narrative service unavailable' })) }
    })()
    return
  }
  const feed = findLiquidityFeed(url.searchParams.get('exchange') ?? 'coinbase', url.searchParams.get('market') ?? 'spot', url.searchParams.get('symbol') ?? undefined)
  if (!feed) { res.writeHead(400); res.end('Unsupported exchange or market'); return }
  const key = feedKey(feed)
  if (url.pathname === '/api/liquidity') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ feed, ...statuses.get(key), frame: history.get(key)?.at(-1) ?? null })); return }
  if (url.pathname !== '/stream' && url.pathname !== '/api/liquidity/stream') { res.writeHead(404); res.end('Not found'); return }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' })
  res.flushHeaders()
  res.write(`event: feed-status\ndata: ${JSON.stringify(statuses.get(key))}\n\n`)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  res.on('close', () => { clients.delete(res); if (heartbeat) clearInterval(heartbeat) })
  void (async () => {
    try {
      // Replay with backpressure so a full history does not disconnect healthy clients.
      for (const frame of [...history.get(key)!]) {
        if (res.destroyed) return
        if (!res.write(`data: ${JSON.stringify(frame)}\n\n`)) await once(res, 'drain', { signal: AbortSignal.timeout(10000) })
      }
      if (res.destroyed) return
      clients.set(res, key)
      heartbeat = setInterval(() => { if (res.writableLength > 1024 * 1024) res.destroy(); else res.write(': heartbeat\n\n') }, 15000)
    } catch { res.destroy() }
  })()
})
const collectors: Array<() => void> = []
server.listen(PORT, HOST, () => {
  dex.start()
  backups.start()
  void narratives.start()
  console.log(`BlockSonar ${production ? 'website and market data' : 'liquidity server'} listening on ${HOST}:${PORT}`)
  for (const feed of LIQUIDITY_FEEDS) collectors.push(startExchangeCollector(feed, broadcast, (status) => {
    const key = feedKey(feed)
    const previous = statuses.get(key)
    statuses.set(key, status)
    if (previous?.status !== status.status || previous?.error !== status.error) {
      for (const [client, selected] of clients) if (selected === key && !client.destroyed) {
        if (client.writableLength > 1024 * 1024) client.destroy()
        else client.write(`event: feed-status\ndata: ${JSON.stringify(status)}\n\n`)
      }
    }
  }))
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { membership.stop(); narrativeSources.stop(); narratives.stop(); coingeckoMarkets.stop(); void dex.stop(); void privatePreferences.stop(); void backups.stop(); void holderDirectory.stop(); void holderSearch.stop(); collectors.forEach((stop) => stop()); clients.forEach((_, client) => client.end()); server.close() })
