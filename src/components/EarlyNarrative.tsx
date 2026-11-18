import { narrativeMomentumChart } from '../lib/narrative-momentum'
import { rankNarratives, CATEGORY_SIGNAL_LABELS } from '../lib/narrative-ranking'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, ArrowUpRight, Bell, Check, ExternalLink, Radar, RefreshCw, Search, Settings2, ShieldCheck, X } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DEFAULT_NARRATIVE_RULES, narrativeScoreFreshness, detectedNarrativeTokenIds, narrativeStage, type Narrative, type NarrativeSnapshot, type NarrativeToken, type NarrativeRules, type NarrativeSource } from '../lib/early-narrative'
import { formatCompact } from './market-data'
import './EarlyNarrative.css'

type Props = { onNavigate: (destination: string) => void; onOpenAsset: (id: string) => void; availableAssetIds: string[]; assetLogos?: Record<string, string> }
type Preferences = { sensitivity: number; alerts: boolean; rules: NarrativeRules }
const defaultPreferences: Preferences = { sensitivity: 30, alerts: true, rules: DEFAULT_NARRATIVE_RULES }
const colors = ['#a9f76b', '#6cceef', '#e6be6c', '#b6a4ef']
const ranges = [{ label: '1H', hours: 1 }, { label: '6H', hours: 6 }, { label: '24H', hours: 24 }, { label: '7D', hours: 168 }, { label: '30D', hours: 720 }]
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
const percent = (value: number | null | undefined) => value == null ? '—' : `${value >= 0 ? '+' : ''}${number(value)}%`
const money = (value: number | null | undefined) => value == null ? '—' : formatCompact(value)
const date = (time: number | null | undefined) => time ? new Date(time).toLocaleString() : 'Not yet observed'
function preferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('blocksonar-narrative-preferences') || 'null')
    if (saved && [20, 30, 50, 70].includes(saved.sensitivity) && typeof saved.alerts === 'boolean') return { ...defaultPreferences, ...saved, rules: DEFAULT_NARRATIVE_RULES }
  } catch { /* Use defaults if storage is unavailable. */ }
  return defaultPreferences
}

function TokenLogo({ token }: { token: NarrativeToken }) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const imageKey = `${token.image}:${token.observedAt}`
  return token.image && failedImage !== imageKey ? <img className="en-coin-logo" src={token.image} alt={`${token.name} logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(imageKey)} />
    : <span className="en-coin-logo en-coin-logo-fallback" aria-hidden="true">{token.symbol.slice(0, 2)}</span>
}

export default function EarlyNarrative({ onNavigate, onOpenAsset, availableAssetIds, assetLogos = {} }: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const [data, setData] = useState<NarrativeSnapshot | null>(null)
  const [sourceHealth, setSourceHealth] = useState<NarrativeSource[] | null>(null)
  const [sourcesConnected, setSourcesConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compared, setCompared] = useState<string[]>([])
  const [range, setRange] = useState(24)
  const [search, setSearch] = useState('')
  const [narrativePage, setNarrativePage] = useState(0)
  const [cap, setCap] = useState('all')
  const coinDialog = useRef<HTMLDialogElement>(null)
  const radarConsole = useRef<HTMLElement>(null)
  const [scanRevision, setScanRevision] = useState(0)
  const [tokensNarrativeId, setTokensNarrativeId] = useState<string | null>(null)
  const [tokens, setTokens] = useState<NarrativeToken[]>([])
  const tokenCache = useRef(new Map<string, { tokens: NarrativeToken[]; message: string }>())
  const [tokenMessage, setTokenMessage] = useState('Select a narrative to inspect verified category members.')
  const [tokensLoading, setTokensLoading] = useState(false)
  const [identity, setIdentity] = useState<Record<string, { chains: { chain: string; address: string }[]; source: string }>>({})
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(preferences)
  const [settings, setSettings] = useState(false)
  const [storageMessage, setStorageMessage] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController(); let active = true, busy = false
    let requestRefresh = true
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await fetch(`/api/narratives${requestRefresh ? '?refresh=1' : ''}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
        if (!response.ok) throw new Error('Narrative data service is unavailable. Please retry.')
        const snapshot = await response.json() as NarrativeSnapshot
        if (snapshot.version !== 1 || !Array.isArray(snapshot.narratives) || !Array.isArray(snapshot.sources)) throw new Error('Invalid narrative service response.')
        if (active) { setData(snapshot); setError(null); requestRefresh = false }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'Unable to load narrative data.') }
      finally { busy = false; if (active) setLoading(false) }
    }
    void load(); const timer = window.setInterval(() => void load(), 30000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    const stream = new EventSource('/api/narratives/sources/stream')
    stream.onopen = () => setSourcesConnected(true)
    stream.addEventListener('sources', event => {
      try {
        const payload = JSON.parse((event as MessageEvent).data)
        if (Array.isArray(payload.sources)) setSourceHealth(payload.sources)
      } catch { /* Keep the last valid source status. */ }
    })
    stream.onerror = () => { setSourcesConnected(false); setSourceHealth(null) }
    return () => stream.close()
  }, [])
  useEffect(() => {
    try { localStorage.setItem('blocksonar-narrative-preferences', JSON.stringify(prefs)); setStorageMessage(null) }
    catch { setStorageMessage('Preferences apply this session; browser storage is unavailable.') }
  }, [prefs])

  const narratives = rankNarratives(data?.narratives ?? []).map(item => ({ ...item, score: item.liveRanking?.score ?? null, change1h: item.liveRanking?.change1h ?? null, change24h: item.liveRanking?.change24h ?? null }))
  const selected = narratives.find(item => item.id === selectedId) ?? narratives[0] ?? null
  const rules = { ...(data?.rules ?? DEFAULT_NARRATIVE_RULES), early: prefs.sensitivity, accelerating: Math.min(90, prefs.sensitivity + 20), trending: Math.min(100, prefs.sensitivity + 40) }
  const stage = (item: Narrative) => narrativeStage(item.score, item.score != null && item.change1h != null ? item.score - item.change1h : null,
    ((data?.updatedAt ?? Date.now()) - item.firstSeen) / 3600000, item.points.at(-1)?.sources ?? 0, rules)
  useEffect(() => {
    const cached = selected ? tokenCache.current.get(selected.id) : undefined
    const initialTokens = cached?.tokens ?? selected?.tokenPreview ?? []
    setTokens(initialTokens); setTokensNarrativeId(selected?.id ?? null); setIdentityError(null)
    if (!selected) return
    const controller = new AbortController(); let active = true
    setTokensLoading(true)
    setTokenMessage(cached?.message ?? (initialTokens.length ? 'Showing previously verified coins while the full category list loads…' : 'Loading verified category members…'))
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await fetch(`/api/narratives/tokens?id=${encodeURIComponent(selected.id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Related tokens unavailable')
        const message = `${result.message} Automatic refresh every 60 seconds. Last updated ${date(result.updatedAt)}.`
        tokenCache.current.set(selected.id, { tokens: result.tokens, message })
        if (active) { setTokens(result.tokens); setTokenMessage(message) }
      } catch (failure) { if (active) setTokenMessage(failure instanceof Error ? failure.message : 'Related tokens unavailable') }
      finally { busy = false; if (active) setTokensLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
  }, [selected?.id, refresh])

  async function loadIdentity(id: string) {
    setIdentityError(null)
    try {
      const response = await fetch(`/api/narratives/identity?id=${encodeURIComponent(id)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Identity data unavailable')
      setIdentity(current => ({ ...current, [id]: result }))
    } catch (failure) { setIdentityError(failure instanceof Error ? failure.message : 'Identity data unavailable') }
  }
  const compareIds = [...new Set([selected?.id, ...compared].filter((id): id is string => !!id))].slice(0, 4)
  const comparison = narratives.filter(item => compareIds.includes(item.id))
  const chart = useMemo(() => narrativeMomentumChart(data?.narratives ?? [], compareIds, data?.updatedAt ?? Date.now(), range), [data, range, selected?.id, compared])
  const hasMomentum = chart.some(row => compareIds.some(id => typeof row[id] === 'number'))
  function selectNarrative(id: string) {
    setSelectedId(id)
    setScanRevision(value => value + 1)
    radarConsole.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  function showCoins(id: string) {
    setSelectedId(id)
    setScanRevision(value => value + 1)
    setCap('all')
    if (!coinDialog.current?.open) coinDialog.current?.showModal()
  }
  const selectedTokens = tokensNarrativeId === selected?.id ? tokens.map(token => ({
    ...token,
    image: token.image || selected?.tokenPreview?.find(preview => preview.id === token.id)?.image || assetLogos[token.id] || null,
  })) : []
  const hologramTokens = (selectedTokens.length ? selectedTokens : selected?.tokenPreview ?? []).slice(0, 6)
  const scanKey = `${selected?.id}:${scanRevision}:${hologramTokens.map(token => token.id).join(',')}`
  const coinsLoading = tokensLoading || !!selected && tokensNarrativeId !== selected.id
  const filteredTokens = selectedTokens.filter(token => cap === 'all' || token.marketCap !== null && (cap === 'low' ? token.marketCap < 100000000 : cap === 'mid' ? token.marketCap >= 100000000 && token.marketCap < 1000000000 : token.marketCap >= 1000000000))
  const visible = narratives.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(narrativePage, pageCount - 1)
  const displayedNarratives = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const recentSources = new Set(narratives.flatMap(item => item.evidence.map(source => source.publisher))).size
  const aiLive = data?.sources.some(source => source.id === 'ai' && source.status === 'live')
  const freshness = narrativeScoreFreshness(data?.updatedAt, now)
  const stale = freshness === 'delayed'
  const alerts = prefs.alerts ? (data?.alerts ?? []).filter(alert => alert.kind === 'New narrative' || alert.score !== null && alert.score >= prefs.sensitivity) : []

  return <section className="early-narrative" aria-label="Early Narrative Radar">
    <dialog ref={coinDialog} className="en-coin-dialog" aria-labelledby="en-coin-dialog-title" onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close() } }}>
      <div className="en-coin-dialog-heading"><div><span className="panel-overline">NARRATIVE COINS</span><h2 id="en-coin-dialog-title">{selected?.name ?? 'Related coins'}</h2></div><button type="button" className="en-button" aria-label="Close narrative coins" onClick={() => coinDialog.current?.close()}><X size={17} /></button></div>
      <p className="en-muted" role="status">{coinsLoading && !selectedTokens.length ? 'Loading verified related coins…' : tokenMessage}</p>
      <div className="en-coin-popup-grid">{selectedTokens.map(token => <a key={token.id} className="en-coin-card" href={token.source} target="_blank" rel="noreferrer"><TokenLogo token={token} /><div><strong>{token.symbol}</strong><span>{token.name}</span><small>{token.id}</small></div><ExternalLink size={12} /></a>)}</div>
      {!coinsLoading && !selectedTokens.length && <div className="en-empty"><ShieldCheck size={24} /><strong>No verified coins available</strong><p>Coins will appear when a verified category association and market data are available.</p></div>}
    </dialog>
    <header className="en-header"><div><div className="section-kicker"><span className="en-status-dot" /> NARRATIVE INTELLIGENCE</div><h1>Early Narrative <span>Radar</span></h1><p>Follow emerging themes. Inspect the evidence before the crowd.</p></div><div className="en-header-actions"><span className="en-update">{stale ? 'Delayed scores · ' : freshness === 'live' ? data?.scoring?.status === 'unavailable' ? 'Sources unavailable · ' : data?.scoring?.status === 'partial' ? 'Live scores · partial sources · ' : 'Live scores · ' : ''}{data?.updatedAt ? `Calculated ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Awaiting first collection'}</span><button type="button" className="en-button" onClick={() => setSettings(value => !value)} aria-expanded={settings}><Settings2 size={14} /> Settings</button><button type="button" className="en-button" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}><RefreshCw size={14} className={loading ? 'spinning' : ''} /> Refresh</button></div></header>
    {(error || data?.error) && <div className="en-notice" role="alert">{error || data?.error}</div>}
    {settings && <div className="en-settings en-panel"><label>Alert sensitivity<select value={prefs.sensitivity} onChange={event => setPrefs(value => ({ ...value, sensitivity: Number(event.target.value) }))}><option value={20}>Sensitive · 20 points</option><option value={30}>Normal · 30 points</option><option value={50}>Selective · 50 points</option><option value={70}>Strict · 70 points</option></select></label><label><input type="checkbox" checked={prefs.alerts} onChange={event => setPrefs(value => ({ ...value, alerts: event.target.checked }))} /> Show in-app alerts</label><p>Local stage thresholds: Early {rules.early} · Accelerating {rules.accelerating} · Trending {rules.trending}. At least {rules.minimumSources} independent sources and {rules.minimumAgeHours} observed hour required. Server alert records preserve their original thresholds.</p>{storageMessage && <p>{storageMessage}</p>}</div>}
    <p className="en-muted" role="status">Scores recalculate every minute from received evidence. {data?.updatedAt && !stale ? `Next calculation expected ${new Date((data.scoring?.nextUpdateAt ?? data.updatedAt + 60000)).toLocaleTimeString()}.` : 'Waiting for a current calculation.'} Ranked highest score first. Scores use category momentum, trading turnover, volume trend and recent news. Market data refreshes up to every 5 minutes; unchanged source data can produce the same score.</p>
    <div className="en-metrics"><div><span>DISCOVERED THEMES</span><strong>{narratives.length}</strong><small>Source-backed groups & candidates</small></div><div><span>INDEPENDENT PUBLISHERS</span><strong>{recentSources}</strong><small>After duplicate removal</small></div><div><span>CONNECTED SOURCES</span><strong>{data?.sources.filter(source => source.status === 'live').length ?? 0}<em> / {data?.sources.length ?? 7}</em></strong><small>Missing inputs remain unavailable</small></div><div><span>CLASSIFICATION</span><strong className="en-method">{aiLive ? 'Local AI + rules' : 'Evidence rules'}</strong><small>{aiLive ? 'Source-referenced model grouping' : 'AI is not configured'}</small></div></div>
    <div className="en-top-grid">
      <article className="en-panel en-rank"><div className="en-panel-heading"><div><span className="panel-overline">EARLY DISCOVERY</span><h2>Emerging narratives</h2></div><span className="en-chip">{visible.length} themes</span></div><label className="en-search"><Search size={14} /><input value={search} onChange={event => { setSearch(event.target.value); setNarrativePage(0) }} placeholder="Find a narrative…" aria-label="Find a narrative" /></label><div className="en-table-wrap"><table><thead><tr><th>Narrative / detected</th><th>Activity score / 100</th><th>1h Δ</th><th>24h Δ</th><th>Social growth</th><th>Headline tone</th><th>Tokens</th><th>Stage</th></tr></thead><tbody>{displayedNarratives.map(item => <tr key={item.id} className={selected?.id === item.id ? 'en-selected' : ''}><td><button type="button" className="en-link" onClick={() => selectNarrative(item.id)}>{item.name}</button><small>{date(item.firstSeen)} · {item.method === 'candidate' ? 'Unverified topic candidate' : item.method}</small></td><td><strong className="en-score">{number(item.score)}</strong><small>{item.liveRanking?.status === 'delayed' ? 'Market data delayed' : item.liveRanking?.status === 'news-only' ? 'News signals' : item.score === null ? 'Awaiting live data' : 'Category activity'}</small></td><td>{item.change1h === null ? '—' : `${item.change1h >= 0 ? '+' : ''}${number(item.change1h)}`}</td><td>{item.change24h === null ? '—' : `${item.change24h >= 0 ? '+' : ''}${number(item.change24h)}`}</td><td>{percent(item.mentionGrowth)}</td><td>{item.sentiment === null ? '—' : item.sentiment > .2 ? 'Positive' : item.sentiment < -.2 ? 'Negative' : 'Neutral'}</td><td><button type="button" className="en-link en-table-coins" aria-label={`Show live coins for ${item.name}`} aria-haspopup="dialog" onClick={() => showCoins(item.id)}>
      {(item.tokenPreview?.length ? item.tokenPreview : selected?.id === item.id ? selectedTokens.slice(0, 3) : []).map(token => <span className="en-table-ticker" key={token.id} title={token.name}><TokenLogo token={token} />{token.symbol}</span>)}
      <small>{detectedNarrativeTokenIds(item, selected?.id === item.id ? selectedTokens : []).length} coins</small>
    </button>{item.tokensUpdatedAt && <small title={date(item.tokensUpdatedAt)}>{Date.now() - item.tokensUpdatedAt > 3 * 60000 ? 'Last received · ' : 'Updated '}{new Date(item.tokensUpdatedAt).toLocaleTimeString()}</small>}</td><td><button type="button" className={`en-stage en-stage-button ${stage(item).toLowerCase().replaceAll(' ', '-')}`} onClick={() => showCoins(item.id)} aria-haspopup="dialog" aria-label={`Show coins for ${item.name}: ${stage(item)}`}>{stage(item)}</button></td></tr>)}</tbody></table>{!visible.length && <div className="en-empty"><Radar size={28} /><strong>{loading ? 'Connecting to narrative sources…' : 'Listening for emerging narratives'}</strong><p>{search ? 'No themes match your search.' : 'Collected headlines and market categories appear here as sources become available. No sample narratives are displayed.'}</p></div>}</div>
      {visible.length > pageSize && <div className="en-category-pages"><span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, visible.length)} of {visible.length} narratives</span><button type="button" className="en-button" disabled={currentPage === 0} onClick={() => setNarrativePage(currentPage - 1)}>Previous</button><button type="button" className="en-button" disabled={currentPage === pageCount - 1} onClick={() => setNarrativePage(currentPage + 1)}>Next</button></div>}
      </article>
      <article ref={radarConsole} className="en-panel en-radar-console"><div className="en-panel-heading"><div><span className="panel-overline">BLOCKSONAR / NARRATIVE ARRAY</span><h2>Discovery radar</h2></div><span className="en-console-status"><i />{narratives.some(item => item.evidence.length) ? 'SIGNALS OBSERVED' : 'AWAITING SIGNALS'}</span></div>
      <div className="en-console-scene">
        <svg className="en-console-circuit" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <g className="en-circuit-traces" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M0 70H120L155 105H310V165H400 M0 95H100L140 135H280V190H380 M0 120H80L120 160H245V225H355 M0 360H110L155 315H290V265H390 M0 390H135L180 345H320V295H420 M0 420H165L205 375H350V320H450" />
            <path d="M1000 60H870L830 100H690V165H600 M1000 90H890L850 130H720V195H625 M1000 120H915L875 160H755V225H650 M1000 350H900L860 310H730V265H620 M1000 385H875L835 345H700V295H590 M1000 420H845L800 375H670V325H565" />
            <path d="M230 0V45L275 90H430V155 M265 0V25L305 65H455V135 M770 0V40L725 85H570V155 M735 0V20L695 60H545V135 M200 500V450L255 395H435V345 M240 500V470L290 420H460V365 M800 500V450L745 395H565V345 M760 500V470L710 420H540V365" />
            <rect x="465" y="205" width="70" height="65" rx="5" />
          </g>
          <g className="en-circuit-nodes" fill="#0b1710" stroke="currentColor" strokeWidth="1.5">
            {[[120,70],[80,120],[155,315],[205,375],[870,60],[875,160],[860,310],[800,375],[275,90],[725,85],[255,395],[745,395],[400,165],[600,165],[450,320],[565,325]].map(([cx,cy]) => <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="4" />)}
          </g>
        </svg>
        <div className="en-console-orbit" aria-hidden="true" />
        <div className="en-console-deck">
          <div className="en-console-map" aria-hidden="true" />
          <div className="en-console-deck-label">NARRATIVE SCAN / 01</div>
          <div className="en-radar"><div key={scanKey} className="en-radar-sweep" /><i className="en-radar-axis horizontal" /><i className="en-radar-axis vertical" /><span className="en-radar-center" />
            <div key={`coins:${scanKey}`} className="en-coin-holograms" aria-hidden="true">
              {hologramTokens.map((token, index) => {
                const slots = [[27, 44], [52, 25], [74, 43], [38, 72], [68, 70], [23, 66]]
                const [left, top] = slots[index]
                // The sweep starts at twelve o'clock and rotates clockwise.
                const angle = (Math.atan2(left - 50, 50 - top) * 180 / Math.PI + 360) % 360
                return <div className="en-holo-coin" key={token.id} style={{ left: `${left}%`, top: `${top}%`, '--holo-delay': `${angle / 360 * 15}s` } as CSSProperties}>
                  <div className="en-holo-face"><TokenLogo token={token} /><span>{token.symbol}</span></div><i className="en-holo-projection" />
                </div>
              })}
            </div>
          </div>
        </div>
        <div className="en-console-glass en-console-glass-left"><span className="en-console-panel-label">SOURCE TELEMETRY</span><strong>{recentSources} independent publishers</strong>{(data?.sources ?? []).filter(source => source.kind === 'news' || source.kind === 'market').slice(0, 3).map(source => <div key={source.id}><i className={`en-source-dot ${source.status}`} /><span>{source.name}</span><small>{source.status === 'live' ? 'CONNECTED' : source.status === 'error' ? 'RETRYING' : 'WAITING'}</small></div>)}<span className="en-console-glass-foot">{data?.updatedAt ? `OBSERVED ${new Date(data.updatedAt).toLocaleTimeString()}` : 'NO OBSERVATIONS YET'}</span></div>
        <div className="en-console-glass en-console-glass-right"><span className="en-console-panel-label">SELECTED CONTACT</span><strong>{selected?.name ?? 'Listening for signals'}</strong><div className="en-console-score"><span>{number(selected?.score)}</span><small>CATEGORY ACTIVITY / 100</small></div><p>{selected?.evidence.at(-1)?.title ?? 'Source-backed contacts appear as evidence is collected.'}</p><button type="button" className="en-link" disabled={!selected} onClick={() => { if (selected) showCoins(selected.id) }}>Inspect related coins <ArrowUpRight size={12} /></button></div>
      </div>
      <p className="en-muted">Select a category below. Its detected coin holograms appear as the sweep passes, then fade until the next scan.</p>
      {selected && <div className="en-radar-coins"><div><strong>{selected.name}</strong><button type="button" className="en-link" onClick={() => showCoins(selected.id)} aria-haspopup="dialog">View coins <ArrowUpRight size={12} /></button></div>
        <div className="en-radar-tickers">{selectedTokens.slice(0, 6).map(token => <button type="button" key={token.id} onClick={() => showCoins(selected.id)} title={`${token.name} (${token.symbol})`}><TokenLogo token={token} /><span>{token.symbol}</span></button>)}</div>
        {!selectedTokens.length && <p className="en-muted" role="status">{coinsLoading ? 'Loading related coins…' : 'No verified coins available for this narrative.'}</p>}
      </div>}</article>
    </div>
    <article className="en-panel en-chart-panel"><div className="en-panel-heading"><div><span className="panel-overline">RECORDED CATEGORY ACTIVITY</span><h2>Narrative momentum</h2></div><div className="en-segmented">{ranges.map(item => <button key={item.label} type="button" aria-pressed={range === item.hours} onClick={() => setRange(item.hours)}>{item.label}</button>)}</div></div><div className="en-comparison">{narratives.slice(0, 16).map(item => <label key={item.id}><input type="checkbox" checked={compareIds.includes(item.id)} disabled={selected?.id === item.id || compareIds.length >= 4 && !compareIds.includes(item.id)} onChange={event => setCompared(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.name}</label>)}</div>{hasMomentum ? <div className="en-chart" aria-label="Narrative activity score history"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid stroke="#1c2c23" strokeDasharray="3 5" /><XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => range <= 24 ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(value).toLocaleDateString()} stroke="#779184" fontSize={10} /><YAxis domain={[0, 100]} allowDecimals={false} stroke="#779184" fontSize={10} /><Legend wrapperStyle={{fontSize:10}} /><Tooltip formatter={(value, name) => [`${number(Number(value))} / 100`, name]} labelFormatter={value => date(Number(value))} contentStyle={{ background: '#0b1510', border: '1px solid #34503c', color: '#d8e9de' }} />{comparison.map((item, index) => <Line key={item.id} type="linear" dataKey={row => row[item.id]} name={item.name} stroke={colors[index]} strokeWidth={2} dot={chart.filter(row => typeof row[item.id] === 'number').length < 3} connectNulls={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div> : <div className="en-empty"><Activity size={25} /><strong>Historical baseline is collecting</strong><p>Chart points are recorded prospectively. Earlier scores are not reconstructed from current market data.</p></div>}<p className="en-muted">Recorded category activity score (0–100), using the same market momentum, turnover and news signals as the ranking. Updates every minute. Gaps mean unavailable observations; history begins when collection starts.</p></article>
    <div className="en-detail-grid">
      <article className="en-panel"><div className="en-panel-heading"><div><span className="panel-overline">{selected?.name ?? 'SELECT A NARRATIVE'}</span><h2>Intelligence brief</h2></div><ShieldCheck size={18} /></div>{selected ? <><div className="en-brief-label">{selected.summary && selected.method === 'ai' ? 'LOCAL AI SYNTHESIS · VERIFY SOURCES' : 'EVIDENCE SUMMARY · RULE-BASED'}</div><p className="en-summary">{selected.summary || `${selected.name} has ${selected.evidence.length} deduplicated source items in retained history, with ${selected.points.at(-1)?.attention ?? 0} published in the latest hour. ${selected.change1h === null ? 'An hourly momentum baseline is not ready.' : `The measured score changed ${number(selected.change1h)} points over the last hour.`}`}</p><dl className="en-evidence-facts"><div><dt>Trading confirmation</dt><dd>{selected.components.volume === null ? 'Awaiting a comparable historical volume observation' : `Volume component ${number(selected.components.volume)}/100 · category rolling 24h volume ${money(selected.volume)}`}</dd></div><div><dt>Already moved?</dt><dd>{selected.categoryChange === null ? 'Category market-cap change unavailable' : `${percent(selected.categoryChange)} category market-cap change over 24h; this is not a token price return`}</dd></div><div><dt>Contradictions & gaps</dt><dd>{selected.change1h !== null && selected.change1h < 0 ? 'Measured momentum is cooling. ' : ''}Social coverage, wallet activity, executed-trade confirmation, and search interest are unavailable unless a permitted provider is connected. News attention can diverge from price.</dd></div></dl><h3 className="en-subheading">Live score breakdown</h3><div className="en-components">{selected.liveRanking?.inputs.map(input => <div key={input.key}><span>{CATEGORY_SIGNAL_LABELS[input.key]}</span><div className="en-component-track"><i style={{ width: `${input.value}%` }} /></div><strong>{number(input.value)}</strong></div>)}</div><p className="en-muted">The category activity index averages available market and news signals. Missing inputs are omitted. It measures observed activity, not a probability of profit. {selected.liveRanking?.observedAt ? `Market/news observation: ${date(selected.liveRanking.observedAt)}.` : 'Awaiting a usable observation.'}</p><h3 className="en-subheading">Supporting sources</h3><div className="en-evidence-list">{selected.evidence.length ? selected.evidence.slice(-12).reverse().map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}<ExternalLink size={11} /></span><small>{item.publisher} · Published {date(item.publishedAt)} · Collected {date(item.collectedAt)}{selected.summarySourceIds.includes(item.id) ? ' · AI reference' : ''}</small></a>) : <p className="en-muted">This theme is present in market categories; no supporting news headline has been observed.</p>}</div></> : <div className="en-empty"><Search size={24} /><p>Select a narrative to inspect its supporting evidence.</p></div>}</article>
      <article className="en-panel"><div className="en-panel-heading"><div><span className="panel-overline">IDENTITY BEFORE TICKERS</span><h2>Related token discovery</h2></div><select aria-label="Token market capitalization" value={cap} onChange={event => setCap(event.target.value)}><option value="all">All caps</option><option value="low">Low · &lt; $100M</option><option value="mid">Mid · $100M–$1B</option><option value="large">Large · ≥ $1B</option></select></div><p className="en-muted" role="status">{tokenMessage}</p>{identityError && <p className="en-notice" role="alert">{identityError}</p>}<div className="en-token-list">{filteredTokens.map(token => <div className="en-token" key={token.id}><div className="en-token-heading"><a className="en-token-name" href={token.source} target="_blank" rel="noreferrer"><TokenLogo token={token} /><div><strong>{token.name}</strong><span>{token.symbol} · {token.id}</span></div></a><span className={(token.change24h ?? 0) >= 0 ? 'positive' : 'negative'}>{percent(token.change24h)}</span></div><div className="en-token-stats"><span>Market cap<strong>{money(token.marketCap)}</strong></span><span>24h volume<strong>{money(token.volume)}</strong></span><span>Liquidity<strong>Unavailable</strong></span><span>Relevance<strong>Category member</strong></span></div><div className="en-token-identity">{identity[token.id] ? identity[token.id].chains.length ? identity[token.id].chains.map(chain => <p key={chain.chain}><strong>{chain.chain}</strong><code>{chain.address}</code></p>) : <span>No token contract reported by the identity source; inspect the project reference.</span> : <button type="button" className="en-link" onClick={() => void loadIdentity(token.id)}>Load chain & contract identity <ArrowUpRight size={12} /></button>}</div><small>Observed {date(token.observedAt)} · Numeric relevance not calculated</small>{availableAssetIds.includes(token.id) && <button className="en-link" type="button" onClick={() => onOpenAsset(token.id)}>Open BlockSonar market report <ArrowUpRight size={12} /></button>}</div>)}{!filteredTokens.length && <div className="en-empty"><ShieldCheck size={24} /><p>{tokensLoading ? 'Loading verified category tokens…' : tokens.length ? 'No tokens match this market-cap filter.' : 'No verified related tokens are available yet.'}</p></div>}</div><div className="en-confirmation"><h3>Independent market checks</h3><p>Keep narrative evidence and market signals separate. The heatmap and Sonar Walls support BTC, ETH and SOL; the separate order book covers BTC.</p><button type="button" className="en-button" onClick={() => onNavigate('Liquidation / Heatmap')}>BTC heatmap & Sonar Walls <ArrowUpRight size={13} /></button><button type="button" className="en-button" onClick={() => onNavigate('Sonar')}>Market scanner & research <ArrowUpRight size={13} /></button><p>Liquidity pressure and executed order flow aren’t connected to this narrative model.</p></div></article>
    </div>
    <article className="en-panel"><div className="en-panel-heading"><div><span className="panel-overline">TIMESTAMPED AT DISCOVERY</span><h2><Bell size={17} /> Alert & performance journal</h2></div><span className="en-chip">{prefs.alerts ? `${alerts.length} visible alerts` : 'Alerts hidden'}</span></div><p className="en-muted">Evidence-model scores, coverage, rules, and available token prices are frozen at alert time; these historical alerts are separate from the live category activity ranking. Later returns use the first observed quote within 15 minutes after each horizon. A dash means no valid observation, not a zero return.</p><div className="en-table-wrap"><table><thead><tr><th>Narrative / event</th><th>Original evidence score</th><th>Observed</th><th>1h return</th><th>6h return</th><th>24h return</th><th>7d return</th><th>Outcome</th></tr></thead><tbody>{alerts.slice(0, 40).map(alert => {
      const mean = (label: string) => { const values = Object.values(alert.performance[label] ?? {}).filter((value): value is number => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
      const dayReturn = mean('24h')
      return <tr key={alert.id}><td><button className="en-link" type="button" onClick={() => selectNarrative(alert.narrativeId)}>{alert.name}</button><small>{alert.kind} · {alert.stage}</small></td><td>{number(alert.score)}<small>{alert.coverage}% coverage · early threshold {alert.rules.early}</small></td><td>{date(alert.time)}</td>{['1h', '6h', '24h', '7d'].map(label => <td key={label}>{percent(mean(label))}</td>)}<td>{dayReturn === null ? Object.keys(alert.tokenPrices).length ? 'Awaiting horizon quotes' : 'No original token prices' : dayReturn <= 0 ? 'Attention without a positive 24h return' : 'Positive observed 24h return'}</td></tr>
    })}</tbody></table>{!alerts.length && <div className="en-empty"><Bell size={24} /><p>{prefs.alerts ? 'No alerts match the current sensitivity. Alerts appear as actual observations qualify.' : 'Enable in-app alerts in Settings to view the journal.'}</p></div>}</div></article>
    <article className="en-panel en-sources"><div className="en-panel-heading"><div><span className="panel-overline">COVERAGE & PROVENANCE</span><h2>Source health</h2><p className="en-muted" role="status">{sourcesConnected ? 'Live status updates connected' : 'Connecting live status · dashboard polling remains active'}</p></div><Check size={17} /></div><div className="en-source-grid">{(sourceHealth ?? data?.sources ?? []).map(source => <div key={source.id}><span className={`en-source-dot ${source.status}`} /><div><strong>{source.name}{source.checking ? ' · Checking…' : ''}</strong><p>{source.message}</p><small>{source.updatedAt ? `Last successful collection ${date(source.updatedAt)}` : 'No successful collection yet'}</small>{source.checkedAt && <small>Status checked {date(source.checkedAt)} · {Math.max(0, Math.floor((now-source.checkedAt)/1000))}s ago</small>}</div></div>)}</div><p className="en-muted">Scores and news refresh every 60 seconds; source health streams live; dashboard checks every 30 seconds; category requests are cached for 5 minutes. History starts with the first collection. Candidate phrases require three unique headlines across at least two publishers and do not automatically imply token relevance. <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">Market data by CoinGecko <ExternalLink size={10} /></a></p></article>
  </section>
}
