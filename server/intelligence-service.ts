import { AlchemyDexPrices } from './alchemy-dex-prices.js'
import { AlchemyPools } from './alchemy-pools.js'
import { newestPoolNotifications } from '../src/lib/notifications.js'
import { DefiLlama } from './defillama.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fetchNewPools, type DiscoverNetwork, type DiscoveredPool } from '../src/lib/discover-markets.js'
import { assetKey, deduplicatePools } from '../src/lib/token-identity.js'
import { accumulationPatterns, earlyBuyers, type WalletActivity } from '../src/lib/wallet-intelligence.js'
import { DexScreener, type DexEnrichment, type DexObservation } from './dex-screener.js'
import { HeliusProvider, type WalletProvider } from './helius-provider.js'
import { AlchemySolanaWalletProvider } from './alchemy-solana-wallet.js'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { ProviderCache } from './provider-cache.js'
type Pool = DiscoveredPool & { dexData?: DexEnrichment | null; enrichmentError?: string }
type Wallet = { source?: string; activities: WalletActivity[]; balances: Array<{ mint: string; amount: string }>; at: number; before: string | null; complete: boolean }
type BuyerObservation = { at: number; count: number }
type State = { buyerCounts?: Record<string, BuyerObservation[]>; version: 1; pools: Pool[]; observations: Record<string, DexObservation[]>; wallets: Record<string, Wallet> }
export class IntelligenceService {
  private state: State = { version: 1, pools: [], observations: {}, wallets: {} }
  private ready: Promise<void>
  private saving: Promise<void> = Promise.resolve()
  private cache = new ProviderCache()
  private alchemyPoolPrices = new AlchemyDexPrices(process.env.ALCHEMY_API_KEY,this.cache)
  private alchemyPools = new AlchemyPools(process.env.ALCHEMY_API_KEY,this.cache)
  private dex = new DexScreener(this.cache)
  private llama = new DefiLlama(this.cache)
  private pending = new Map<string, Promise<unknown>>()
  private provider: WalletProvider | null
  constructor(private filename = process.env.INTELLIGENCE_STORE_PATH ?? 'data/intelligence.json', provider?: WalletProvider | null) {
    this.provider = provider === undefined ? process.env.ALCHEMY_API_KEY ? new AlchemySolanaWalletProvider(new AlchemyWalletRpc(process.env.ALCHEMY_API_KEY,'solana-mainnet',this.cache)) : process.env.HELIUS_API_KEY ? new HeliusProvider(process.env.HELIUS_API_KEY, this.cache) : null : provider
    this.ready = this.load()
    void this.ready.catch(() => {}) // Report corrupt persistence through API errors without crashing unrelated features.
  }
  private async load() {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8'))
      if (state.version !== 1 || !Array.isArray(state.pools) || !state.observations || !state.wallets) throw new Error('Invalid intelligence store')
      this.state = state
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  private save() {
    const data = JSON.stringify(this.state)
    const write = this.saving.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true })
      await writeFile(`${this.filename}.tmp`, data, { mode: 0o600 }); await rename(`${this.filename}.tmp`, this.filename)
    })
    this.saving = write
    return write
  }
  private async discoveryPools(network:DiscoverNetwork,page:number):Promise<DiscoveredPool[]> {
    try { return await this.alchemyPools.pools(network,page) }
    catch (error) {
      const notice=error instanceof Error && error.message.startsWith('Alchemy pool discovery unavailable') ? error.message : 'Alchemy pool discovery unavailable'
      const data=await this.cache.get<any>(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?include=base_token%2Cquote_token%2Cdex&page=${page}`,'gecko-discovery',24)
      const pools=await fetchNewPools(network,page,new AbortController().signal,async()=>new Response(JSON.stringify(data)))
      const tokens=[...new Set(pools.flatMap(pool=>pool.tokenAddress?[pool.tokenAddress]:[]))].slice(0,25)
      let quotes:Array<{token:string;priceUsd:number|null}>=[]
      try { if(tokens.length)quotes=(await this.alchemyPoolPrices.getQuotes(network==='eth'?'ethereum':network,tokens)).quotes } catch { /* Preserve separately attributed discovery values. */ }
      return pools.map(pool=>{const quote=quotes.find(quote=>network==='solana'?quote.token===pool.tokenAddress:quote.token.toLowerCase()===pool.tokenAddress?.toLowerCase());return {...pool,source:'GeckoTerminal',observedAt:Date.now(),feedNotice:`${notice}. Showing GeckoTerminal discovery.`,...(quote?.priceUsd!=null?{price:quote.priceUsd,priceSource:'Alchemy' as const}:{})}})
    }
  }
  async pools(network: DiscoverNetwork, page: number) {
    await this.ready
    const enriched:Pool[] = (await this.discoveryPools(network,page)).map(({dexData, ...pool}) => pool)
    this.state.pools = deduplicatePools([...this.state.pools, ...enriched]).sort((a,b) => b.createdAt-a.createdAt).slice(0, 500)
    const retained = new Set(this.state.pools.map(p => assetKey(p.network,p.address)))
    for (const key of Object.keys(this.state.observations)) if (!retained.has(key)) delete this.state.observations[key]
    await this.save()
    return enriched
  }
  async notificationPools() {
    await this.ready
    const networks: DiscoverNetwork[] = ['eth','solana','bsc']
    const results = await Promise.allSettled(networks.map(async network => {
      return this.discoveryPools(network,1)
    }))
    const rows = results.flatMap((result,index) => result.status === 'fulfilled' ? result.value : this.state.pools.filter(pool=>pool.network===networks[index]))
    return { pools: newestPoolNotifications(rows), checkedAt: results.some(r=>r.status==='fulfilled') ? Date.now() : null, delayed: results.some(r=>r.status==='rejected') }
  }
  async wallet(address: string, before?: string) {
    await this.ready
    if (!this.provider) return { configured: false, error: 'Set ALCHEMY_API_KEY or HELIUS_API_KEY on the server to enable Solana monitoring', activities: [], balances: [], complete: false }
    const cached = this.state.wallets[address]
    if (!before && cached && Date.now() - cached.at < 60000 && (cached.source??'helius')===(this.provider.source??'helius')) return this.walletView(cached)
    const key = `${address}:${before ?? ''}`
    if (this.pending.has(key)) return this.pending.get(key)
    const run = async () => {
      const history = await this.provider!.history(address, before)
      const balances = await this.provider!.balances(address)
      const previous = this.state.wallets[address]
      const activities = [...new Map([...(previous?.activities ?? []), ...history.activities].map(a => [a.signature, a])).values()].sort((a,b) => b.at-a.at).slice(0, 10000)
      // A bounded history is never asserted to be complete for cost-basis purposes.
      const wallet = { source:this.provider!.source??'helius', activities, balances, at: Date.now(), before: history.before, complete: false }
      if (Object.keys(this.state.wallets).length >= 100 && !previous) delete this.state.wallets[Object.keys(this.state.wallets)[0]]
      this.state.wallets[address] = wallet
      await this.save()
      return this.walletView(wallet)
    }
    const promise = run().finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }
  private walletView(wallet: Wallet) {
    const buyers = earlyBuyers(wallet.activities, this.state.pools)
    return { configured: true, ...wallet, earlyBuys: buyers, patterns: accumulationPatterns(wallet.activities), pnl: { realized: null, reason: 'Historical execution prices and complete cost basis are unavailable' }, coverage: this.provider?.coverage??'Observed finalized transactions only; history may be incomplete' }
  }
  async valuation(address: string) {
    await this.ready
    const wallet = this.state.wallets[address]
    if (!wallet) return { available: false, error: 'Load wallet balances first. DefiLlama provides prices, not wallet balances.' }
    return { available: true, ...await this.llama.valueBalances('solana', wallet.balances, wallet.at) }
  }
  async token(mint: string) {
    await this.ready
    const pairs = await this.dex.pair('solana', mint, true)
    let concentration: unknown = { available: false, reason: 'Holder concentration provider is not configured' }
    try { if (this.provider?.concentration) concentration = await this.provider.concentration(mint) }
    catch { concentration = { available: false, reason: 'Holder data unavailable; retry later' } }
    return { mint, pairs, concentration }
  }
  async intelligence() {
    await this.ready
    const activities = Object.values(this.state.wallets).flatMap(w => w.activities)
    const buyers = earlyBuyers(activities, this.state.pools)
    const counts = this.state.buyerCounts ??= {}
    const now = Date.now()
    const summaries = this.state.pools.map(pool => {
      const key = assetKey(pool.network, pool.address)
      const poolBuyers = buyers.filter(b => b.pool === key)
      const count = new Set(poolBuyers.map(b => b.wallet)).size
      const history = counts[key] ?? []
      if (!history.length || now - history.at(-1)!.at >= 60000) history.push({ at: now, count })
      counts[key] = history.slice(-1440)
      const previous = counts[key].filter(o => o.at < now - 60000).at(-1)
      return { ...pool, observedBuyerCount: count, buyerCountDelta: previous ? count - previous.count : null, buyerObservations: counts[key], earlyBuyers: poolBuyers }
    })
    for (const key of Object.keys(counts)) if (!summaries.some(p => assetKey(p.network,p.address) === key)) delete counts[key]
    await this.save()
    const wallets = [...new Set(buyers.map(b => b.wallet))].map(wallet => ({ wallet, tokenCount: new Set(buyers.filter(b => b.wallet === wallet).map(b => b.token)).size }))
    return { configured: !!this.provider, earlyBuyers: buyers, repeatEarlyBuyers: wallets.filter(w => w.tokenCount > 1), pools: summaries, coverage: 'Buyers observed in queried wallet histories within 10 minutes of pool creation; not all market buyers', holderConcentration: null, holderConcentrationReason: 'A complete holder and owner-level supply snapshot is not available' }
  }
}
