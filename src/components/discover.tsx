import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Search, Sparkles } from 'lucide-react'
import { DISCOVER_NETWORKS, fetchEnrichedNewPools, type DiscoverNetwork, type DiscoveredPool } from '../lib/discover-markets'
import { analyticsNetworks, type AnalyticsNetwork } from '../lib/analytics-networks'
import { useWallet } from './WalletProvider'
import { formatCompact } from './market-data'

type ChainState = { pools: DiscoveredPool[]; updatedAt: number | null; error: string | null; page: number; hasMore: boolean }
const initialChain = (): ChainState => ({ pools: [], updatedAt: null, error: null, page: 0, hasMore: true })
const money = (n: number | null) => n === null ? '—' : formatCompact(n)
function ageLabel(createdAt: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60000))
  return minutes < 1 ? 'Just created' : minutes < 60 ? `${minutes}m old` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m old` : `${Math.floor(minutes / 1440)}d old`
}

export default function Discover() {
  const [intelligence, setIntelligence] = useState<any>(null)
  const [chains, setChains] = useState<Record<DiscoverNetwork, ChainState>>({ eth: initialChain(), base: initialChain(), solana: initialChain(), bsc: initialChain() })
  const { analyticsNetwork } = useWallet()
  const [override, setOverride] = useState<{ selected: AnalyticsNetwork; filter: DiscoverNetwork | 'all' } | null>(null)
  const network = override?.selected === analyticsNetwork ? override.filter : analyticsNetworks[analyticsNetwork].discovery
  const setNetwork = (filter: DiscoverNetwork | 'all') => setOverride({ selected: analyticsNetwork, filter })
  useEffect(() => { setOverride(null) }, [analyticsNetwork])
  const [search, setSearch] = useState('')
  const [ageHours, setAgeHours] = useState(48)
  const [sort, setSort] = useState<'newest' | 'liquidity' | 'volume'>('newest')
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [refresh, setRefresh] = useState(0)
  const [loadMore, setLoadMore] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/intelligence', { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(data => { if (data) setIntelligence(data) }).catch(() => {})
    return () => controller.abort()
  }, [chains])
  const states = useRef(chains)
  states.current = chains

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let retry: number | undefined
    const load = async () => {
      setLoading(true)
      const selected = DISCOVER_NETWORKS.filter((chain) => !loadMore || network === 'all' || chain.id === network)
      const results = await Promise.allSettled(selected.map(async (chain) => {
        const previous = states.current[chain.id]
        const page = loadMore ? previous.page + 1 : 1
        if (loadMore && (!previous.hasMore || page > 3)) return
        try {
          const pools = await fetchEnrichedNewPools(chain.id, page, controller.signal)
          if (!active) return
          setChains((current) => {
            const all = loadMore ? [...current[chain.id].pools, ...pools] : pools
            const merged = [...new Map(all.map((pool) => [pool.id, pool])).values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
            return { ...current, [chain.id]: { pools: merged, updatedAt: Date.now(), error: null, page, hasMore: pools.length > 0 && page < 3 } }
          })
        } catch (error) {
          if (active) setChains((current) => ({ ...current, [chain.id]: { ...current[chain.id], error: error instanceof Error ? error.message : 'Feed unavailable' } }))
        }
      }))
      // Inspect rejected tasks as well as per-chain request failures.
      if (results.some((result) => result.status === 'rejected') && active) setChains((current) => ({ ...current, ...Object.fromEntries(selected.map((chain) => [chain.id, { ...current[chain.id], error: 'Feed unavailable' }])) }))
      if (active) {
        setLoading(false)
        retry = window.setTimeout(() => { setLoadMore(false); setRefresh((value) => value + 1) }, 60000)
      }
    }
    void load()
    return () => { active = false; controller.abort(); window.clearTimeout(retry) }
  }, [refresh, loadMore])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer) }, [])

  const pools = useMemo(() => DISCOVER_NETWORKS.flatMap((chain) => chains[chain.id].pools), [chains])
  const visible = pools.filter((pool) => (network === 'all' || pool.network === network) && pool.createdAt <= now && now - pool.createdAt <= ageHours * 3600000 && `${pool.name} ${pool.symbol} ${pool.address} ${pool.tokenAddress ?? ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'liquidity' ? (b.liquidity ?? -1) - (a.liquidity ?? -1) : sort === 'volume' ? (b.volume ?? -1) - (a.volume ?? -1) : b.createdAt - a.createdAt)
  const canLoadMore = DISCOVER_NETWORKS.some((chain) => (network === 'all' || chain.id === network) && chains[chain.id].hasMore)

  return <div className="discover-page">
    <header className="discover-header"><div><div className="section-kicker"><Sparkles size={14} /> DISCOVER NEW MARKETS</div><h1>Fresh pools. Early discovery.</h1><p>Recently created liquidity pools across Ethereum, Base, Solana, and BNB Smart Chain.</p></div><button type="button" className="refresh-button" disabled={loading} onClick={() => { setLoadMore(false); setRefresh((value) => value + 1) }}><RefreshCw size={15} className={loading ? 'spinning' : ''} />{loading ? 'Scanning chains…' : 'Refresh'}</button></header>
    <div className="discover-chain-tabs" role="group" aria-label="Filter discovery chain"><button type="button" aria-pressed={network === 'all'} onClick={() => setNetwork('all')}>All chains <span>{pools.length}</span></button>{DISCOVER_NETWORKS.map((chain) => <button type="button" key={chain.id} aria-pressed={network === chain.id} onClick={() => setNetwork(chain.id)}>{chain.name} <span>{chains[chain.id].pools.length}</span></button>)}</div>
    <div className="discover-status-grid">{DISCOVER_NETWORKS.map((chain) => <div key={chain.id}><strong>{chain.short}</strong><span className={chains[chain.id].error ? 'negative' : chains[chain.id].updatedAt ? 'positive' : ''}>{chains[chain.id].error ?? (chains[chain.id].updatedAt ? `Updated ${new Date(chains[chain.id].updatedAt!).toLocaleTimeString()}` : 'Waiting for data')}</span></div>)}</div>
    <div className="discover-toolbar"><label className="discover-search"><Search size={15} /><input aria-label="Search new pools" placeholder="Search token, pair, or address" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label>Pool age<select value={ageHours} onChange={(e) => setAgeHours(Number(e.target.value))}><option value={1}>Last hour</option><option value={6}>Last 6 hours</option><option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option></select></label><label>Sort<select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="newest">Newest first</option><option value="liquidity">Highest liquidity</option><option value="volume">Highest volume</option></select></label><span>{visible.length} pools</span></div>
    <p className="discover-context">Pool creation time is not token creation time. Existing tokens can appear in new pools. Prices, volume, and liquidity are reported pool data; token age and contract safety are not verified.</p>
    <section className="discover-grid" aria-label="Newly created token pools">{visible.map((pool) => {
      const cross = intelligence?.pools?.find((p: any) => p.id === pool.id)
      const dex = pool.dexData
      pool = dex ? { ...pool, price: dex.price ?? pool.price, liquidity: dex.observation.liquidity ?? pool.liquidity, volume: dex.observation.volume ?? pool.volume, fdv: dex.fdv ?? pool.fdv, buys: dex.observation.buys ?? pool.buys, sells: dex.observation.sells ?? pool.sells } : pool
      const chain = DISCOVER_NETWORKS.find((item) => item.id === pool.network)!
      return <article className="discover-card" key={pool.id}>
        <div className="discover-card-top"><span className={`discover-chain discover-chain-${pool.network}`}>{chain.short}</span><time dateTime={new Date(pool.createdAt).toISOString()} title={new Date(pool.createdAt).toLocaleString()}>{ageLabel(pool.createdAt, now)}</time></div>
        <div className="discover-token">{pool.image ? <img src={pool.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <span className="discover-token-placeholder">{pool.symbol.slice(0, 2) || '?'}</span>}<div><h2>{pool.name}</h2><small>{pool.dex}</small></div></div>
        <div className="discover-price"><strong>{pool.price === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 6 }).format(pool.price)}</strong><span className={pool.change === null ? '' : pool.change >= 0 ? 'positive' : 'negative'}>{pool.change === null ? 'No 24h change' : `${pool.change >= 0 ? '+' : ''}${pool.change.toFixed(2)}% · 24h`}</span></div>
        <dl className="discover-metrics"><div><dt>LIQUIDITY</dt><dd>{money(pool.liquidity)}</dd></div><div><dt>24H VOLUME</dt><dd>{money(pool.volume)}</dd></div><div><dt>FDV · ESTIMATE</dt><dd>{money(pool.fdv)}</dd></div><div><dt>24H BUYS / SELLS</dt><dd>{pool.buys ?? '—'} / {pool.sells ?? '—'}</dd></div></dl>
        {dex && <><p className="discover-context">DEX Screener · {dex.promotion === 'boosted' ? 'Promoted: active boost observed' : dex.promotion === 'paid-order-observed' ? 'Paid promotion order observed' : dex.promotion === 'not-observed' ? 'No approved promotion order observed' : 'Promotion status unknown'}</p><dl className="discover-metrics"><div><dt>MARKET CAP</dt><dd>{money(dex.marketCap)}</dd></div><div><dt>LIQUIDITY Δ</dt><dd>{money(dex.liquidityDelta)}</dd></div><div><dt>ROLLING 24H VOLUME Δ</dt><dd>{money(dex.volumeDelta)}</dd></div></dl><a className="discover-pool-link" href={dex.url} target="_blank" rel="noreferrer">DEX Screener ↗</a><small>Observed {new Date(dex.observation.at).toLocaleTimeString()}. Deltas compare successive observations, not interval trading totals.</small></>}
        {cross && pool.network === 'solana' && <div className="discover-context"><p>{cross.observedBuyerCount} observed early buyers · change {cross.buyerCountDelta ?? 'Awaiting comparison'}</p>{cross.earlyBuyers?.slice(0,3).map((buyer: any) => <p key={buyer.wallet}><a href={`https://solscan.io/account/${buyer.wallet}`} target="_blank" rel="noreferrer">{buyer.wallet.slice(0,6)}…{buyer.wallet.slice(-5)}</a> · bought {new Date(buyer.at).toLocaleTimeString()}{intelligence.repeatEarlyBuyers?.some((w: any) => w.wallet === buyer.wallet) ? ' · repeat early buyer' : ''}</p>)}<a href="#/dex-intell">Open DEX Intell</a><small>Observed queried wallets only · first 10 minutes after pool creation.</small></div>}
        {pool.source && <p className="discover-context">{pool.source === 'Alchemy' ? 'Alchemy Trading API' : `${pool.source} discovery`}{pool.priceSource === 'Alchemy' ? ' · USD price by Alchemy' : ''} · observed {pool.observedAt ? new Date(pool.observedAt).toLocaleTimeString() : 'time unavailable'}</p>}
        {pool.enrichmentError && <p role="status">{pool.enrichmentError}</p>}
        {pool.tokenAddress && <a className="discover-address" href={`${chain.explorer}${encodeURIComponent(pool.tokenAddress)}`} target="_blank" rel="noreferrer" title={pool.tokenAddress}>Base token: {pool.tokenAddress.slice(0, 7)}…{pool.tokenAddress.slice(-5)} <ExternalLink size={12} /></a>}
        <a className="discover-pool-link" href={`https://dexscreener.com/${pool.network === 'eth' ? 'ethereum' : pool.network}/${encodeURIComponent(pool.address)}`} target="_blank" rel="noreferrer">Inspect pool <ExternalLink size={13} /></a>
      </article>
    })}</section>
    {!visible.length && <div className="discover-empty" role="status">{loading ? 'Scanning new pools across the selected chains…' : pools.length ? 'No pools match these filters.' : 'No pool data available. Check the chain feed status above; the page retries automatically.'}</div>}
    {canLoadMore && <button className="discover-load-more" type="button" disabled={loading} onClick={() => { setLoadMore(true); setRefresh((value) => value + 1) }}>Load more pools</button>}
    <p className="discover-context">Pool data by CoinGecko and GeckoTerminal. Automatic refresh every 60 seconds.</p>
  </div>
}
