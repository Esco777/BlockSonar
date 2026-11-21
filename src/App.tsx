import MarketSnapshot from './components/MarketSnapshot'
import WalletMenu from './components/WalletMenu'
import DexIntellIcon from './components/DexIntellIcon'
import Notifications from './components/Notifications'
import NetworkSelector from './components/NetworkSelector'
import DexIntell from './components/DexIntell'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from './components/WalletProvider'
import { type UTCTimestamp } from 'lightweight-charts'
import LiquidityPage from './app/liquidity/page'
import Sonar from './components/Sonar'
import EarlyNarrative from './components/EarlyNarrative'
import AppearanceSettings from './components/AppearanceSettings'
import Watchlist from './components/Watchlist'
import { useWatchlists } from './hooks/use-watchlists'
import Discover from './components/discover'
import OverviewSonar from './components/OverviewSonar'
import { useLiquidationFeeds } from './hooks/use-liquidation-feeds'
import { parseLiquidationSide } from './lib/liquidation-feeds'
import { loadMarketUniverse } from './lib/market-universe'
import type { SonarAsset } from './lib/sonar-research'
import { candleTimeframes, formatCurrency, formatCompact, type Candle, type CandleTimeframe, type DepthSnapshot, type LiquidationEvent, type StreamStatus } from './components/market-data'
import {
  Activity, ArrowRight, Radar, Bookmark,
  ChevronDown, CircleHelp, Command, Compass, ExternalLink, Eye,
  Layers3, Menu, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  SlidersHorizontal, Droplets, Sparkles, Wallet, X,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'


type Coin = SonarAsset




const starterCoins: Coin[] = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png', price: 67482.16, change: 3.82, marketCap: 1330000000000, volume: 28700000000, sparkline: [] },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', image: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png', price: 3528.42, change: 2.16, marketCap: 423000000000, volume: 14200000000, sparkline: [] },
  { id: 'solana', name: 'Solana', symbol: 'SOL', image: 'https://assets.coingecko.com/coins/images/4128/large/solana.png', price: 184.73, change: 8.43, marketCap: 82000000000, volume: 3900000000, sparkline: [] },
  { id: 'chainlink', name: 'Chainlink', symbol: 'LINK', image: 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png', price: 17.26, change: 5.17, marketCap: 10100000000, volume: 347000000, sparkline: [] },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ARB', image: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg', price: 1.14, change: -1.32, marketCap: 3980000000, volume: 186000000, sparkline: [] },
  { id: 'uniswap', name: 'Uniswap', symbol: 'UNI', image: 'https://assets.coingecko.com/coins/images/12504/large/uni.jpg', price: 11.83, change: 4.12, marketCap: 7100000000, volume: 218000000, sparkline: [] },
  { id: 'avalanche-2', name: 'Avalanche', symbol: 'AVAX', image: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png', price: 38.64, change: 2.78, marketCap: 15300000000, volume: 341000000, sparkline: [] },
]

const navItems = [
  { label: 'Overview', icon: Compass },
  { label: 'Sonar', icon: Radar },
  { label: 'Discover', icon: Droplets },
  { label: 'DEX Intell', icon: DexIntellIcon },
  { label: 'Early Narrative Radar', icon: Activity },
  { label: 'Liquidation / Heatmap', icon: Layers3 },
  { label: 'Watchlist', icon: Bookmark },
]

function loadStoredLiquidations(): LiquidationEvent[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem('block-sonar-liquidations-v2') ?? '[]') as unknown
    if (!Array.isArray(stored)) return []
    return stored.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return []
      const event = value as Record<string, unknown>
      const side = parseLiquidationSide(event.side)
      const price = Number(event.price)
      const notional = Number(event.notional)
      const receivedAt = Number(event.receivedAt)
      if (!side || typeof event.exchange !== 'string' || price <= 0 || notional <= 0 || receivedAt <= 0) return []
      return [{ id: String(event.id), exchange: event.exchange, side, price, notional, receivedAt }]
    }).slice(0, 1_000)
  } catch {
    return []
  }
}

function makeSeries(coin: Coin, points = 48) {
  const source = coin.sparkline.length > 0 ? coin.sparkline : Array.from({ length: 168 }, (_, index) => {
    const trend = (index / 168 - 0.5) * coin.change * 0.007
    const wave = Math.sin(index * 0.62) * 0.006 + Math.cos(index * 0.23) * 0.004
    return coin.price * (1 - trend + wave - coin.change * 0.003)
  })
  const values = source.slice(-Math.min(points, source.length))
  const isWeek = values.length > 24
  return values.map((price, index) => ({
    time: isWeek ? `D${Math.round(index / Math.max(1, values.length - 1) * 7)}` : `${String(index).padStart(2, '0')}:00`,
    price,
    index: (price / (values[0] || price) - 1) * 100,
  }))
}

function aggregateTwoMinuteCandles(candles: Candle[]) {
  const grouped = new Map<number, Candle>()
  candles.forEach((candle) => {
    const time = Math.floor(candle.time / 120) * 120
    const current = grouped.get(time)
    if (current) {
      current.high = Math.max(current.high, candle.high)
      current.low = Math.min(current.low, candle.low)
      current.close = candle.close
    } else {
      grouped.set(time, { ...candle, time: time as UTCTimestamp })
    }
  })
  return [...grouped.values()].sort((a, b) => a.time - b.time)
}

function App({ onSignOut }: { onSignOut: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exploreOpen, setExploreOpen] = useState(false)
  const exploreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exploreOpen) return
    const outside = (event: PointerEvent) => { if (!exploreRef.current?.contains(event.target as Node)) setExploreOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExploreOpen(false); exploreRef.current?.querySelector('button')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [exploreOpen])
  const [coins, setCoins] = useState(starterCoins)
  const [activeCoinId, setActiveCoinId] = useState('solana')
  const [reportCoinId, setReportCoinId] = useState<string | null>(null)
  const [activeNav, setActiveNavState] = useState(() => window.location.hash === '#/liquidity' ? 'Liquidation / Heatmap' : window.location.hash === '#/narratives' ? 'Early Narrative Radar' : window.location.hash === '#/sonar' ? 'Sonar' : window.location.hash === '#/discover' ? 'Discover' : ['#/dex-intell', '#/wallet-tracker'].includes(window.location.hash) ? 'DEX Intell' : window.location.hash === '#/watchlists' ? 'Watchlist' : 'Overview')
  const [timeframe, setTimeframe] = useState('7D')
  const [search, setSearch] = useState('')
  const watchlists = useWatchlists()
  const watchlist = watchlists.activeList?.assetIds ?? []
  const toggleWatch = watchlists.toggleAsset
  const [watchlistFocus, setWatchlistFocus] = useState(0)
  const { wallet: connectedWallet, connectWallet: requestWalletConnection, walletBusy } = useWallet()
  const [visibleBalanceAccount,setVisibleBalanceAccount]=useState<string|null>(null)
  const balanceVisible=!!connectedWallet&&visibleBalanceAccount===connectedWallet.account
  useEffect(()=>setVisibleBalanceAccount(null),[connectedWallet?.account])
  const wallet = connectedWallet ? { ...connectedWallet, address: `${connectedWallet.account.slice(0, 6)}...${connectedWallet.account.slice(-4)}` } : null
  const [walletMessage, setWalletMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [dataSource, setDataSource] = useState<'sample' | 'live'>('sample')
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<number | null>(null)
  const [marketStale, setMarketStale] = useState(false)
  const [marketError, setMarketError] = useState(false)
  const [marketErrorMessage, setMarketErrorMessage] = useState<string | null>(null)
  const [marketAPI, setMarketAPI] = useState('unknown')
  const [marketLoadCount, setMarketLoadCount] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [depth, setDepth] = useState<DepthSnapshot | null>(null)
  const [depthHistory, setDepthHistory] = useState<DepthSnapshot[]>([])
  const [liquidations, setLiquidations] = useState<LiquidationEvent[]>(loadStoredLiquidations)
  const liquidationFeedStatus = useLiquidationFeeds((events) => {
    setLiquidations((current) => {
      const ids = new Set(current.map((event) => event.id))
      return [...events.filter((event) => !ids.has(event.id)), ...current].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 1000)
    })
  })
  const [candles, setCandles] = useState<Candle[]>([])
  const [liquidationViewRequest,setLiquidationViewRequest]=useState(0)
  const [candleTimeframe, setCandleTimeframe] = useState<CandleTimeframe>('5m')
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting')

  const activeCoin = coins.find((coin) => coin.id === activeCoinId) ?? coins[0]
  const reportCoin = coins.find((coin) => coin.id === reportCoinId)
  const filteredCoins = coins.filter((coin) => `${coin.name} ${coin.symbol}`.toLowerCase().includes(search.toLowerCase()))
  const watchlistCoins = watchlist.flatMap((id) => { const coin = coins.find((item) => item.id === id); return coin ? [coin] : [] })
  const series = useMemo(() => makeSeries(activeCoin, timeframe === '24H' ? 24 : 168), [activeCoin, timeframe])
  const chartDelta = series.length > 1 ? ((series[series.length - 1].price / series[0].price) - 1) * 100 : activeCoin.change
  const leadingCoins = [...coins].sort((a, b) => b.change - a.change).slice(0, 3)

  useEffect(() => {
    try {
      sessionStorage.setItem('block-sonar-liquidations-v2', JSON.stringify(liquidations))
    } catch {
      return
    }
  }, [liquidations])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeframe = candleTimeframes.find((item) => item.value === candleTimeframe) ?? candleTimeframes[2]
    setCandles([])

    const loadCandles = () => {
      fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${timeframe.apiInterval}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Candle data unavailable')
          return response.json() as Promise<{ error?: string[]; result?: Record<string, unknown> }>
        })
        .then((payload) => {
          if (!active || payload.error?.length) return
          const result = payload.result ?? {}
          const seriesKey = Object.keys(result).find((key) => key !== 'last')
          const rows = seriesKey ? result[seriesKey] : null
          if (!Array.isArray(rows)) return
          const history: Candle[] = rows.flatMap((row) => {
            if (!Array.isArray(row)) return []
            const [time, open, high, low, close] = row.map(Number)
            if (![time, open, high, low, close].every(Number.isFinite)) return []
            return [{ time: time as UTCTimestamp, open, high, low, close }]
          })
          const intervalCandles = candleTimeframe === '2m' ? aggregateTwoMinuteCandles(history) : history
          setCandles(intervalCandles)
        })
        .catch(() => undefined)
    }

    loadCandles()
    const candleRefresh = window.setInterval(loadCandles, 60_000)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(candleRefresh)
    }
  }, [candleTimeframe])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    let refreshTimer: number | undefined
    let hasCompleteMarketScan = false
    const loadMarkets = async () => {
      setLoading(true)
      setMarketLoadCount(0)
      let complete = false
      try {
        const result = await loadMarketUniverse(controller.signal, (count) => { if (active) setMarketLoadCount(count) })
        if (!active) return
        complete = result.complete
        setMarketErrorMessage(result.errorMessage); setMarketAPI(result.apiMode)
        setMarketError(!result.complete || !result.coins.length)
        if (result.coins.length && (result.complete || !hasCompleteMarketScan)) {
          hasCompleteMarketScan ||= result.complete
          // Commit one consistent batch, so daily ranks do not track intermediate pages.
          setCoins(result.coins)
          setDataSource('live')
          setMarketUpdatedAt(result.updatedAt)
          setMarketStale(result.stale)
          setActiveCoinId((current) => result.coins.some((coin) => coin.id === current) ? current : result.coins[0].id)
        }
      } catch {
        if (active) setMarketError(true)
      } finally {
        if (active) {
          setLoading(false)
          refreshTimer = window.setTimeout(loadMarkets, complete ? 60000 : 120000)
        }
      }
    }
    void loadMarkets()
    return () => { active = false; controller.abort(); window.clearTimeout(refreshTimer) }
  }, [])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | undefined
    let reconnectTimer: number | undefined
    let attempts = 0
    let lastDepthUpdate = 0
    setDepth(null)
    setDepthHistory([])
    const connect = () => {
      if (disposed) return
      setStreamStatus(attempts ? 'reconnecting' : 'connecting')
      socket = new WebSocket('wss://fstream.binance.com/public/stream?streams=btcusdt@depth20@100ms')
      socket.onopen = () => { attempts = 0; setStreamStatus('live') }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)).data
          if (!payload || Date.now() - lastDepthUpdate < 500) return
          const readLevels = (rows: unknown) => Array.isArray(rows) ? rows.flatMap((row) => {
            if (!Array.isArray(row)) return []
            const price = Number(row[0]), quantity = Number(row[1])
            return Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0 ? [{ price, quantity, notional: price * quantity }] : []
          }) : []
          const bids = readLevels(payload.b).sort((a, b) => b.price - a.price)
          const asks = readLevels(payload.a).sort((a, b) => a.price - b.price)
          if (!bids.length || !asks.length) return
          lastDepthUpdate = Date.now()
          const snapshot = { bids, asks, midPrice: (bids[0].price + asks[0].price) / 2, updatedAt: lastDepthUpdate }
          setDepth(snapshot)
          setDepthHistory((current) => {
            const latest = current.at(-1)
            return latest && snapshot.updatedAt - latest.updatedAt < 1000 ? current : [...current, snapshot].slice(-300)
          })
        } catch { setStreamStatus('reconnecting') }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (disposed) return
        setStreamStatus('reconnecting')
        attempts++
        reconnectTimer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)))
      }
    }
    connect()
    return () => { disposed = true; window.clearTimeout(reconnectTimer); socket?.close() }
  }, [])


  function setActiveNav(label: string) {
    const destination = label === 'Live data' ? 'Liquidation / Heatmap' : label
    setActiveNavState(destination)
    const hash = destination === 'Liquidation / Heatmap' ? '#/liquidity' : destination === 'Early Narrative Radar' ? '#/narratives' : destination === 'Sonar' ? '#/sonar' : destination === 'Discover' ? '#/discover' : destination === 'DEX Intell' ? '#/dex-intell' : destination === 'Watchlist' ? '#/watchlists' : '#/'
    if (window.location.hash !== hash) window.history.pushState(null, '', hash)
  }

  useEffect(() => {
    const syncPage = () => {
      setActiveNavState(window.location.hash === '#/liquidity' ? 'Liquidation / Heatmap' : window.location.hash === '#/narratives' ? 'Early Narrative Radar' : window.location.hash === '#/sonar' ? 'Sonar' : window.location.hash === '#/discover' ? 'Discover' : ['#/dex-intell', '#/wallet-tracker'].includes(window.location.hash) ? 'DEX Intell' : window.location.hash === '#/watchlists' ? 'Watchlist' : 'Overview')
      setReportCoinId(null)
      setMobileNavOpen(false)
    }
    window.addEventListener('popstate', syncPage)
    window.addEventListener('hashchange', syncPage)
    return () => {
      window.removeEventListener('popstate', syncPage)
      window.removeEventListener('hashchange', syncPage)
    }
  }, [])

  async function connectWallet() {
    setWalletMessage('')
    try { await requestWalletConnection() }
    catch (error) { setWalletMessage(error instanceof Error ? error.message : 'Wallet connection was cancelled.') }
  }

  function openWatchlists(id?: string, create = false) {
    if (id) watchlists.select(id)
    setActiveNav('Watchlist')
    setReportCoinId(null)
    setMobileNavOpen(false)
    if (create) setWatchlistFocus((current) => current + 1)
  }

  return (
    <div className="app-shell">
      <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSignOut={onSignOut} />
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><img className="sidebar-brand-dark" src="/block-sonar-logo.svg" alt="Block Sonar — Discover what’s moving beneath the surface" /><img className="sidebar-brand-light" src="/block-sonar-logo-light.svg" alt="Block Sonar — Discover what’s moving beneath the surface" /></div>
        <div className="workspace-label">WORKSPACE <button aria-label="Workspace options"><ChevronDown size={13} /></button></div>
        <div className="workspace-row"><div className="workspace-avatar">A</div><div><strong>Alpha desk</strong><small>Personal workspace</small></div><ChevronDown size={14} className="workspace-caret" /></div>
        <div className="nav-caption">ANALYZE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} aria-current={activeNav === label ? 'page' : undefined} onClick={() => { setActiveNav(label); setReportCoinId(null); setMobileNavOpen(false) }}><Icon size={17} /><span>{label === 'Discover' ? 'Liquidity Pools' : label}</span>{label === 'Discover' && <span className="nav-new">NEW</span>}</button>)}
        </nav>
        <div className="nav-caption list-caption">YOUR LISTS <button aria-label="Add list" onClick={() => openWatchlists(undefined, true)}><Plus size={14} /></button></div>
        <div className="sidebar-watchlists">{watchlists.lists.map((list) => <button key={list.id} className={`list-nav-item ${activeNav === 'Watchlist' && watchlists.activeId === list.id ? 'selected-watchlist' : ''}`} onClick={() => openWatchlists(list.id)}><span className="list-dot mint-dot" /><span className="sidebar-watchlist-name">{list.name}</span><span className="list-count">{list.assetIds.length}</span></button>)}</div>
        <div className="sidebar-bottom">
          <div className="plan-card"><div className="plan-top"><span>SONAR PRO</span><Sparkles size={14} /></div><strong>Go deeper on-chain</strong><small>Unlock protocol flows and more.</small><button>Explore plans <ArrowRight size={13} /></button><div className="plan-orbit orbit-one" /><div className="plan-orbit orbit-two" /></div>
          <button className="nav-item settings-item" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"><Settings2 size={17} /><span>Settings</span></button>
          <div className="profile-row lifetime-member"><div className="profile-avatar"><ShieldCheck size={17} /></div><strong>Lifetime member</strong></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{reportCoin ? `${reportCoin.name} report` : activeNav === 'Discover' ? 'Liquidity Pools' : activeNav}</strong></div>
          <div className="topbar-actions">
            <a className="join-topbar-link" href="#/join">Home page</a>
            <div className="search-container"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets..." aria-label="Search assets" /><kbd><Command size={11} /> K</kbd></div>{search && <div className="search-results">{filteredCoins.length ? filteredCoins.slice(0, 6).map((coin) => <button key={coin.id} onClick={() => { setActiveCoinId(coin.id); setReportCoinId(coin.id); setActiveNav('Report'); setSearch('') }}><img src={coin.image} alt="" /><span><strong>{coin.name}</strong><small>{coin.symbol}</small></span><ArrowRight size={13} /></button>) : <span className="search-empty">No matching assets</span>}</div>}</div>
            <Notifications liquidations={liquidations} candles={candles} liquidationTimeframeSeconds={(candleTimeframes.find(item=>item.value===candleTimeframe)?.minutes??5)*60} onOpenLiquidations={()=>{setLiquidationViewRequest(value=>value+1);setActiveNav('Liquidation / Heatmap');setReportCoinId(null);setMobileNavOpen(false)}} coins={coins} dataSource={dataSource} updatedAt={marketUpdatedAt} marketError={marketError} onNavigate={destination => { setActiveNav(destination); setReportCoinId(null); setMobileNavOpen(false) }} onOpenAsset={id => { setActiveCoinId(id); setReportCoinId(id); setActiveNav('Report') }} />
            <NetworkSelector />
            <WalletMenu busy={walletBusy} wallet={connectedWallet} balanceVisible={balanceVisible} onToggleBalance={()=>setVisibleBalanceAccount(balanceVisible?null:connectedWallet?.account??null)} onConnect={connectWallet} onSignOut={onSignOut} />
          </div>
        </header>

        <div className="page-content">
          {activeNav === 'Overview' && !reportCoin ? <OverviewSonar coins={coins} dataSource={dataSource} updatedAt={marketUpdatedAt} onOpenAsset={(id) => { setActiveCoinId(id); setReportCoinId(id); setActiveNav('Report') }} onNavigate={destination => { setActiveNav(destination); setReportCoinId(null); setMobileNavOpen(false) }} /> : activeNav !== 'Liquidation / Heatmap' && activeNav !== 'Sonar' && activeNav !== 'Discover' && activeNav !== 'Watchlist' && activeNav !== 'Early Narrative Radar' && activeNav !== 'DEX Intell' && <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> MARKET INTELLIGENCE <span className="live-dot" /> <span className="data-label">{dataSource === 'live' ? 'LIVE DATA' : 'SAMPLE DATA'}</span></div><h1>See what’s moving.<br className="mobile-break" /> <span>Understand why.</span></h1><p className="welcome-subtitle">Context for your next move, never a signal to follow blindly.</p></div><button className="refresh-button" onClick={() => window.location.reload()} title="Refresh market data"><RefreshCw size={15} className={loading ? 'spinning' : ''} /><span>Refresh</span><span className="refresh-time">Updated just now</span></button></div>}

          {walletMessage && <div className="wallet-message"><CircleHelp size={15} /><span>{walletMessage}</span><button aria-label="Dismiss message" onClick={() => setWalletMessage('')}><X size={14} /></button></div>}

          {activeNav === 'Early Narrative Radar' ? <EarlyNarrative assetLogos={dataSource === 'live' ? Object.fromEntries(coins.map(coin => [coin.id, coin.image])) : {}} availableAssetIds={dataSource === 'live' ? coins.map(coin => coin.id) : []} onNavigate={setActiveNav} onOpenAsset={(id) => { setActiveCoinId(id); setReportCoinId(id); setActiveNav('Report') }} /> : activeNav === 'Watchlist' ? <Watchlist ready={watchlists.ready} coins={coins} lists={watchlists.lists} activeId={watchlists.activeId} focusRequest={watchlistFocus} storageError={watchlists.storageError} deletedName={watchlists.deletedName} onSelect={watchlists.select} onCreate={watchlists.create} onRename={watchlists.rename} onDelete={watchlists.remove} onUndoDelete={watchlists.undoDelete} onMoveList={watchlists.reorderLists} onToggleAsset={toggleWatch} onMoveAsset={watchlists.reorderAssets} onOpenAsset={(id) => { setActiveCoinId(id); setReportCoinId(id); setActiveNav('Report') }} /> : activeNav === 'DEX Intell' ? <DexIntell /> : activeNav === 'Discover' ? <Discover /> : activeNav === 'Sonar' ? <Sonar cachedStale={marketStale} errorMessage={marketErrorMessage} apiMode={marketAPI} coins={coins} dataSource={dataSource} updatedAt={marketUpdatedAt} error={marketError} loading={loading} loadedCount={marketLoadCount} onOpenAsset={(id) => { setActiveCoinId(id); setReportCoinId(id); setActiveNav('Report') }} /> : activeNav === 'Liquidation / Heatmap' ? <LiquidityPage showLiquidationsRequest={liquidationViewRequest} feedStatus={liquidationFeedStatus} status={streamStatus} depth={depth} depthHistory={depthHistory} liquidations={liquidations} candles={candles} timeframe={candleTimeframe} onTimeframeChange={setCandleTimeframe} /> : reportCoin ? <AssetReport coin={reportCoin} coins={coins} dataSource={dataSource} isWatched={watchlist.includes(reportCoin.id)} onBack={() => { setReportCoinId(null); setActiveNav('Overview') }} onToggleWatch={() => toggleWatch(reportCoin.id)} /> : <>

          <MarketSnapshot />

          <div className="section-heading"><div><div className="section-kicker">SIGNALS TO INVESTIGATE <span className="signal-count">{leadingCoins.length}</span></div><h2>Worth a closer look</h2></div><div className="overview-explore" ref={exploreRef} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setExploreOpen(false) }}>
            <button type="button" className="text-action" aria-expanded={exploreOpen} aria-controls="overview-explore-options" onClick={() => setExploreOpen(open => !open)}>Explore all signals <ChevronDown size={15} /></button>
            {exploreOpen && <nav id="overview-explore-options" className="overview-explore-options" aria-label="Explore BlockSonar">{navItems.map(({ label, icon: Icon }) => <button type="button" key={label} aria-current={activeNav === label ? 'page' : undefined} onClick={() => { setExploreOpen(false); setActiveNav(label); setReportCoinId(null); setMobileNavOpen(false) }}><Icon size={16} /><span>{label === 'Discover' ? 'Liquidity Pools' : label}</span></button>)}</nav>}
          </div></div>
          <section className="signal-grid" aria-label="Assets with notable market activity">
            {leadingCoins.map((coin, index) => {
              const isActive = coin.id === activeCoinId
              return <button key={coin.id} className={`signal-card ${isActive ? 'signal-selected' : ''}`} onClick={() => { setActiveCoinId(coin.id); setReportCoinId(coin.id); setActiveNav('Report') }}>
                <div className="signal-card-head"><span className={`signal-index index-${index + 1}`}>0{index + 1}</span><span className="signal-kind">{index === 0 ? 'MOMENTUM' : index === 1 ? 'VOLUME SHIFT' : 'TREND STRENGTH'}</span><button className={`bookmark-button ${watchlist.includes(coin.id) ? 'bookmarked' : ''}`} aria-label={`${watchlist.includes(coin.id) ? 'Remove' : 'Add'} ${coin.name} ${watchlist.includes(coin.id) ? 'to' : 'from'} watchlist`} onClick={(event) => { event.stopPropagation(); toggleWatch(coin.id) }}><Bookmark size={15} fill={watchlist.includes(coin.id) ? 'currentColor' : 'none'} /></button></div>
                <div className="signal-asset"><img src={coin.image} alt="" /><div><strong>{coin.name}</strong><span>{coin.symbol}</span></div><div className="signal-change"><strong className={coin.change >= 0 ? 'positive' : 'negative'}>{coin.change >= 0 ? '+' : ''}{coin.change.toFixed(2)}%</strong><small>24H CHANGE</small></div></div>
                <p className="signal-reason">{coin.change > 6 ? 'Price strength is outpacing large-cap peers, with elevated market participation.' : 'Price action is holding above its recent range as market activity picks up.'}</p>
                <div className="signal-card-foot"><span><span className="tiny-pulse" /> {index === 0 ? 'Largest 24h move' : index === 1 ? '2nd largest 24h move' : '3rd largest 24h move'}</span><span className="signal-score">#{index + 1} <small>of {coins.length}</small></span></div>
              </button>
            })}
          </section>

          <div className="analysis-grid">
            <section className="chart-panel">
              <div className="panel-heading"><div><span className="panel-overline">ASSET DEEP DIVE</span><div className="asset-title"><img src={activeCoin.image} alt="" /><h2>{activeCoin.name}</h2><span className="asset-symbol">{activeCoin.symbol}</span><button className={`asset-bookmark ${watchlist.includes(activeCoin.id) ? 'bookmarked' : ''}`} aria-label="Toggle watchlist" onClick={() => toggleWatch(activeCoin.id)}><Bookmark size={15} fill={watchlist.includes(activeCoin.id) ? 'currentColor' : 'none'} /></button></div></div><button className="chart-options" aria-label="Chart options"><SlidersHorizontal size={15} /></button></div>
              <div className="price-line"><strong>{formatCurrency(activeCoin.price)}</strong><span className={chartDelta >= 0 ? 'positive' : 'negative'}>{chartDelta >= 0 ? '+' : ''}{chartDelta.toFixed(2)}% <span className="price-period">{timeframe}</span></span></div>
              <div className="chart-meta"><span><i className="legend-dot price-dot" /> Price</span><span><i className="legend-dot volume-dot" /> Volume</span><span className="chart-source"><ShieldCheck size={12} /> Market data</span></div>
              <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 10, right: 2, left: 0, bottom: 0 }}>
                <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35c7a2" stopOpacity={0.22} /><stop offset="95%" stopColor="#35c7a2" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#283732" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#788781', fontSize: 10 }} minTickGap={45} />
                <YAxis orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tickLine={false} axisLine={false} tick={{ fill: '#788781', fontSize: 10 }} tickFormatter={(value: number) => formatCompact(value)} width={64} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="price" stroke="#46d3ad" strokeWidth={2} fill="url(#priceFill)" activeDot={{ r: 4, strokeWidth: 0, fill: '#adf0db' }} />
              </AreaChart></ResponsiveContainer></div>
              <div className="chart-bottom"><span>Source: CoinGecko {dataSource === 'sample' && '· illustrative sample values'}</span><div className="timeframe-control">{['24H', '7D'].map((item) => <button key={item} className={timeframe === item ? 'selected' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}</div></div>
            </section>

            <section className="watch-panel">
              <div className="watch-heading"><div><span className="panel-overline">KEEP AN EYE ON</span><h2>{watchlists.activeList?.name ?? 'Your watchlist'} <span>{watchlistCoins.length}</span></h2></div><button className="watch-add" aria-label="Add current asset to watchlist" title="Add current asset" onClick={() => toggleWatch(activeCoin.id)}><Plus size={16} /></button></div>
              <div className="watch-table-head"><span>ASSET</span><span>PRICE</span><span>24H</span></div>
              <div className="watch-rows">{watchlistCoins.slice(0, 6).map((coin) => <button key={coin.id} className={`watch-row ${coin.id === activeCoinId ? 'watch-active' : ''}`} onClick={() => { setActiveCoinId(coin.id); setReportCoinId(coin.id); setActiveNav('Report') }}><div className="watch-coin"><img src={coin.image} alt="" /><span><strong>{coin.symbol}</strong><small>{coin.name}</small></span></div><strong className="watch-price">{formatCurrency(coin.price)}</strong><span className={`watch-change ${coin.change >= 0 ? 'positive' : 'negative'}`}>{coin.change >= 0 ? '+' : ''}{coin.change.toFixed(2)}%</span></button>)}</div>
              <div className="watch-footer"><Eye size={14} /><span>Tracking {watchlistCoins.length} assets</span><button onClick={() => setActiveNav('Watchlist')}>Manage <ArrowRight size={13} /></button></div>
            </section>
          </div>

          <section className="context-row"><div className="context-icon"><Layers3 size={17} /></div><div className="context-copy"><strong>More context, less noise.</strong><span>Signals surface changes in activity. They don’t account for your risk, time horizon, or portfolio.</span></div><button onClick={() => setActiveNav('Discover')}>How signals work <ArrowRight size={14} /></button><span className="context-art"><span /><span /><span /><span /><span /></span></section>


          <footer className="page-footer"><span><span className="footer-status" /> All systems operational</span><span>{wallet ? <><Wallet size={12} /> {wallet.network} · {balanceVisible?wallet.balance:'••••'} {wallet.currency}</> : 'Wallet disconnected'} <span className="footer-divider">·</span> Not financial advice</span><a href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">Data by CoinGecko <ExternalLink size={11} /></a></footer>
          </>}
        </div>
      </main>
    </div>
  )
}

function AssetReport({ coin, coins, dataSource, isWatched, onBack, onToggleWatch }: {
  coin: Coin
  coins: Coin[]
  dataSource: 'sample' | 'live'
  isWatched: boolean
  onBack: () => void
  onToggleWatch: () => void
}) {
  const series = useMemo(() => makeSeries(coin, 168), [coin])
  const firstPrice = series[0]?.price ?? coin.price
  const lastPrice = series[series.length - 1]?.price ?? coin.price
  const weekChange = firstPrice ? (lastPrice / firstPrice - 1) * 100 : 0
  const peerMoves = [...coins].map((item) => item.change).sort((a, b) => a - b)
  const medianMove = peerMoves[Math.floor(peerMoves.length / 2)] ?? 0
  const relativeMove = coin.change - medianMove
  const rank = 1 + coins.filter((item) => item.change > coin.change).length
  const turnover = coin.marketCap ? coin.volume / coin.marketCap * 100 : 0
  const returnWord = weekChange >= 0 ? 'above' : 'below'
  const relativeWord = relativeMove >= 0 ? 'ahead of' : 'behind'

  return <section className="report-view">
    <button className="report-back" onClick={onBack}><ArrowRight size={14} /> Back to overview</button>
    <div className="report-header"><div className="report-title-group"><div className="report-token"><img src={coin.image} alt="" /></div><div><div className="report-kicker">ASSET INTELLIGENCE REPORT <span className="report-live"><i /> {dataSource === 'live' ? 'LIVE DATA' : 'SAMPLE DATA'}</span></div><h1>{coin.name} <span>{coin.symbol}</span></h1><p>Market behavior, evidence, and questions for further research.</p></div></div><button className={`report-watch ${isWatched ? 'report-watched' : ''}`} onClick={onToggleWatch}><Bookmark size={15} fill={isWatched ? 'currentColor' : 'none'} /> {isWatched ? 'On watchlist' : 'Add to watchlist'}</button></div>

    <div className="report-summary"><div className="summary-price"><span>Current price</span><strong>{formatCurrency(coin.price)}</strong><small className={coin.change >= 0 ? 'positive' : 'negative'}>{coin.change >= 0 ? '+' : ''}{coin.change.toFixed(2)}% <span>24H</span></small></div><div className="summary-divider" /><div className="summary-narrative"><div className="summary-label"><Activity size={14} /> WHAT THE DATA SHOWS</div><p>{coin.symbol} ranks <strong>#{rank} of {coins.length}</strong> by 24-hour price change in this tracked set, moving {Math.abs(relativeMove).toFixed(2)} percentage points {relativeWord} its median. Its seven-day sample is {Math.abs(weekChange).toFixed(2)}% {returnWord} its first observation. These are market observations, not evidence of a specific catalyst.</p></div></div>

    <div className="report-columns"><section className="report-section report-chart-section"><div className="report-section-head"><div><span className="panel-overline">PRICE CONTEXT</span><h2>Seven-day market path</h2></div><span className={`report-period-change ${weekChange >= 0 ? 'positive' : 'negative'}`}>{weekChange >= 0 ? '+' : ''}{weekChange.toFixed(2)}%</span></div><div className="report-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 10, right: 3, left: 0, bottom: 0 }}><defs><linearGradient id="reportFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35c7a2" stopOpacity={0.2} /><stop offset="95%" stopColor="#35c7a2" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#283732" /><XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#788781', fontSize: 9 }} minTickGap={45} /><YAxis orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tickLine={false} axisLine={false} tick={{ fill: '#788781', fontSize: 9 }} tickFormatter={(value: number) => formatCompact(value)} width={62} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="price" stroke="#46d3ad" strokeWidth={2} fill="url(#reportFill)" activeDot={{ r: 4, strokeWidth: 0, fill: '#adf0db' }} /></AreaChart></ResponsiveContainer></div><div className="report-chart-source">{dataSource === 'live' ? 'CoinGecko · 7-day price samples' : 'Illustrative sample values · not live market data'}</div></section>

      <section className="report-section"><div className="report-section-head"><div><span className="panel-overline">MEASURED EVIDENCE</span><h2>Market profile</h2></div></div><div className="evidence-list"><div><span>24h price change</span><strong className={coin.change >= 0 ? 'positive' : 'negative'}>{coin.change >= 0 ? '+' : ''}{coin.change.toFixed(2)}%</strong></div><div><span>24h trading volume</span><strong>{formatCompact(coin.volume)}</strong></div><div><span>Volume / market cap</span><strong>{turnover.toFixed(2)}%</strong></div><div><span>Market capitalization</span><strong>{formatCompact(coin.marketCap)}</strong></div><div><span>24h change rank</span><strong>#{rank} <small>of {coins.length}</small></strong></div></div><p className="evidence-footnote">Rank compares the assets currently loaded in Block Sonar; it is not a forecast or quality score.</p></section></div>

    <section className="research-section"><div className="report-section-head"><div><span className="panel-overline">NEXT STEPS FOR YOUR OWN ANALYSIS</span><h2>Questions worth investigating</h2></div><span className="research-note"><CircleHelp size={13} /> Leads, not confirmed catalysts</span></div><div className="research-grid"><article><span>01</span><strong>What changed?</strong><p>Check project announcements, governance proposals, and release notes around the observed move.</p></article><article><span>02</span><strong>Where is activity concentrated?</strong><p>Compare exchange liquidity and on-chain flows across venues before interpreting volume.</p></article><article><span>03</span><strong>What could change supply?</strong><p>Review unlock schedules, emissions, treasury movements, and upcoming token events.</p></article><article><span>04</span><strong>Does usage confirm the move?</strong><p>Compare active addresses, fees, and protocol usage with the price trend over the same period.</p></article></div></section>

    <div className="report-disclaimer"><ShieldCheck size={15} /><p><strong>Evidence boundary</strong> This report summarizes price, volume, and market-cap data. It does not verify news catalysts, on-chain activity, token unlocks, or contract risk. Sample data is illustrative; market data can be delayed or incomplete.</p></div>
  </section>
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span><strong>{formatCurrency(payload[0].value)}</strong></div>
}


export default App
