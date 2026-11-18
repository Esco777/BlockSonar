import { recentWhalePurchase, type WhaleSonarFeed } from '../lib/whale-sonar'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { filterHolders, compareNativeBalances, holderTier, type HolderView, type HolderDirectory } from '../lib/holder-rankings'
import { holderSearchQuery, parseHolderSearch, type HolderSearchParams, type HolderSearchResult } from '../lib/holder-search'
export default function WalletHolderList({ chain, onTrack, refreshKey = 0, onLoadingChange, onDirectoryChange, onWhaleFeedChange }: { onWhaleFeedChange?: (feed: WhaleSonarFeed) => void; chain: 'ethereum' | 'solana'; onTrack: (address: string, label?: string) => void; refreshKey?: number; onLoadingChange?: (loading: boolean) => void; onDirectoryChange?: (directory: HolderDirectory) => void }) {
  const defaults: HolderSearchParams = { minimum: chain === 'ethereum' ? '100' : '1000', whaleMinimum: chain === 'ethereum' ? '1000' : '10000', view: 'largest', size: 'all', days: 7, hidePrograms: false }
  const [data, setData] = useState<HolderDirectory | null>(null), [result, setResult] = useState<HolderSearchResult | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [hidePrograms, setHidePrograms] = useState(false), [view, setView] = useState<HolderView>('largest')
  const [minimum, setMinimum] = useState(defaults.minimum), [whaleMinimum, setWhaleMinimum] = useState(defaults.whaleMinimum), [days, setDays] = useState(7), [size, setSize] = useState<HolderSearchParams['size']>('all')
  const [request, setRequest] = useState<{ query: string } | null>(null)
  const normalize = (value: string) => value.replace(/\.$/, '').replace(/^\./, '0.') || '0'
  const largeCutoff = normalize(minimum), whaleCutoff = normalize(whaleMinimum)
  const thresholdsValid = compareNativeBalances(whaleCutoff, largeCutoff) <= 0 && compareNativeBalances(whaleCutoff, '0') < 0
  const applied = result?.parameters ?? defaults
  const rows = useMemo(() => result ? result.holders : filterHolders(data?.holders ?? [], 'largest', chain === 'ethereum' ? '100' : '1000', 7, Date.now(), false), [data, result, chain])
  const dirty = holderSearchQuery({ minimum: largeCutoff, whaleMinimum: whaleCutoff, days, size, view, hidePrograms }) !== holderSearchQuery(applied)
  const lastBuy = useRef<{ scope: string; purchase: WhaleSonarFeed['latest'] }>({ scope: '', purchase: null })
  const activeSearch = request !== null
  useEffect(() => {
    const scope = result ? `${chain}:${holderSearchQuery(result.parameters)}` : ''
    const latest = recentWhalePurchase(chain, result, lastBuy.current.scope === scope ? lastBuy.current.purchase : null)
    lastBuy.current = { scope, purchase: latest }
    onWhaleFeedChange?.({ latest, active: activeSearch, checking: activeSearch && (loading || result?.purchaseStatus === 'loading'), delayed: !!error || result?.purchaseStatus === 'partial' || result?.purchaseStatus === 'unavailable', checked: result?.whalesChecked ?? 0, targeted: result?.whalesTargeted ?? 0, observedAt: result?.at ?? null })
  }, [chain, result, loading, error, activeSearch, onWhaleFeedChange])
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])
  useEffect(() => { if (data) onDirectoryChange?.({ ...data, holders: rows }) }, [data, rows, onDirectoryChange])
  const symbol = chain === 'ethereum' ? 'ETH' : 'SOL', explorer = chain === 'ethereum' ? 'https://etherscan.io/address/' : 'https://solscan.io/account/', txExplorer = chain === 'ethereum' ? 'https://etherscan.io/tx/' : 'https://solscan.io/tx/'
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined, id: string | null = null
    const run = async () => {
      setLoading(true)
      let next = 60000
      try {
        const url = request ? `/api/wallet-tracker/${chain}/holder-search?${id ? `id=${id}` : request.query}` : `/api/wallet-tracker/${chain}/holders`
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(request ? 90000 : 30000)]) })
        const value = await response.json()
        if (response.status === 404) id = null
        if (!response.ok || !Array.isArray(value.holders)) throw new Error(value.error ?? 'Holder directory unavailable')
        if (!controller.signal.aborted) {
          setData(value); setResult(request ? value : null); setError('')
          id = value.purchaseStatus === 'loading' ? value.id : null
          if (id) next = 5000
        }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Holder search unavailable'); next = 30000 }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = window.setTimeout(() => void run(), next) } }
    }
    void run()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [chain, refreshKey, request])
  const search = (event: FormEvent) => {
    event.preventDefault()
    try { const params = parseHolderSearch(new URLSearchParams(holderSearchQuery({ minimum: largeCutoff, whaleMinimum: whaleCutoff, days, size, view, hidePrograms }))); setRequest({ query: holderSearchQuery(params) }); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid search parameters') }
  }
  return <>
    <section className="wallet-section" aria-label={`Large ${symbol} holders`}>
      <h2>Whales &amp; large {symbol} holders</h2>
      <p>Set your parameters and click Search to check finalized blockchain balances. Results refresh every minute; purchase checks update as they finish.</p>
      <form className="discover-toolbar" onSubmit={search}>
        <label>Holder size<select aria-label="Holder size" value={size} onChange={e => setSize(e.target.value as HolderSearchParams['size'])}><option value="all">Whales &amp; large holders</option><option value="whales">Whales only</option><option value="large">Other large holders</option></select></label>
        <label>Show<select aria-label="Large wallet discovery view" value={view} onChange={e => setView(e.target.value as HolderView)}><option value="discovered">Newly discovered large wallets</option><option value="recent-activity">Recent first activity</option><option value="largest">Largest balances</option></select></label>
        <label>Large holder minimum {symbol}<input aria-label={`Minimum ${symbol} balance`} type="text" inputMode="decimal" value={minimum} onChange={e => { if (/^\d{0,30}(\.\d{0,18})?$/.test(e.target.value)) setMinimum(e.target.value) }} /></label>
        <label>Whale minimum {symbol}<input aria-label={`Whale minimum ${symbol} balance`} type="text" inputMode="decimal" value={whaleMinimum} onChange={e => { if (/^\d{0,30}(\.\d{0,18})?$/.test(e.target.value)) setWhaleMinimum(e.target.value) }} /></label>
        <button type="submit" className="refresh-button" style={{ alignSelf: 'end' }} disabled={!thresholdsValid || !!request && loading}><Search size={14} />{request && loading ? 'Searching…' : 'Search'}</button>
        {view === 'recent-activity' && <label>First recorded activity<select aria-label="First activity window" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>}
      </form>
      <label><input type="checkbox" checked={hidePrograms} onChange={e => setHidePrograms(e.target.checked)} />Hide {chain === 'ethereum' ? 'contract' : 'stake and program-owned'} addresses</label>
      {!thresholdsValid && <p role="alert">Whale minimum must be positive and at least the large-holder minimum.</p>}
      {dirty && !(request && loading) && <p role="status">Parameters changed. Click Search to apply them; displayed results still use the last applied parameters.</p>}
      {loading && request && <p role="status">Checking the blockchain with your applied search parameters…</p>}
      {result && <p className="discover-context">{result.checked} addresses checked · {result.holders.length} matches · large holders ≥ {applied.minimum} {symbol} · whales ≥ {applied.whaleMinimum} {symbol}.</p>}
      <p>Whale labels use native {symbol} balance, not total wealth. Discovery dates begin when BlockSonar first records an address; first recorded activity is not a verified creation date. Unknown ages are excluded from the recent-activity view.</p>
      {data && <p className="discover-context">{data.source} · checked {new Date(data.at).toLocaleTimeString()} · {data.scope}</p>}
      {error && <p role="status">{error}{data ? ' Keeping the last successful results; they may be stale.' : ''}</p>}
      {result?.warnings.map((warning, i) => <p role="status" key={`${i}:${warning}`}>{warning}</p>)}
      {data?.delayed && <p role="status">Global ranking is unavailable. Only recently observed addresses are ranked here.</p>}
      <div className="wallet-table-wrap"><table><thead><tr><th>Rank</th><th>Address / name</th><th>{symbol} held</th><th>Size</th><th>Type</th><th>First discovered</th><th>First recorded activity</th><th>Watch</th></tr></thead><tbody>{rows.map((h, i) => <tr key={h.address}><td>#{i + 1}</td><td><a href={`${explorer}${h.address}`} title={h.address} target="_blank" rel="noreferrer">{h.label ?? `${h.address.slice(0, 7)}…${h.address.slice(-5)}`}</a></td><td title={`${h.amount} ${symbol}`}>{Number(h.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>{holderTier(h.amount, applied.minimum, applied.whaleMinimum)}</td><td>{h.accountType}</td><td>{h.firstSeenAt ? new Date(h.firstSeenAt).toLocaleString() : 'Unknown'}</td><td title={h.activityBasis}>{h.firstActivityAt ? new Date(h.firstActivityAt).toLocaleString() : 'Unknown / checking'}</td><td><button className="refresh-button" onClick={() => onTrack(h.address, h.label ?? '')}>Track</button></td></tr>)}</tbody></table></div>
      {!loading && !rows.length && <p>No addresses match the applied filters in the available coverage. For recent-activity searches, unknown wallet ages are excluded.</p>}
      <p>Exchange, custody, contract and staking addresses may appear. A large balance does not establish personal ownership or trading skill. Tracking remains opt-in.</p>
    </section>
    <section className="wallet-section" aria-label={`${symbol} whale purchases`}>
      <h2>Whale purchases · last 24 hours</h2>
      <p>Verified token purchases by up to three non-contract whale wallets from the applied search, prioritizing recently active addresses. Whale status uses the balance at search time, not at purchase time. Checks cover up to eight recent Ethereum transactions or five Solana transactions per wallet, plus any retained Ethereum history. Only supported, authenticated swap protocols are included.</p>
      {!result ? <p>Click Search to discover whale wallets and check their purchases.</p> : <>
        <p role="status">{result.purchaseStatus === 'loading' ? 'Checking purchase history…' : result.purchaseStatus === 'complete' ? 'Purchase checks finished.' : 'Some purchase history is unavailable.'} {result.whalesChecked} / {result.whalesTargeted} whale wallets checked.</p>
        <div className="wallet-table-wrap"><table><thead><tr><th>Time</th><th>Whale wallet</th><th>{symbol} balance at search</th><th>Token purchased</th><th>Amount acquired</th><th>Transaction</th><th>Watch</th></tr></thead><tbody>{result.purchases.map(p => <tr key={`${p.wallet}:${p.signature}:${p.token}`}><td>{new Date(p.at).toLocaleString()}</td><td><a href={`${explorer}${p.wallet}`} target="_blank" rel="noreferrer" title={p.wallet}>{p.wallet.slice(0, 7)}…{p.wallet.slice(-5)}</a></td><td title={p.balance}>{Number(p.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td><a href={`https://dexscreener.com/${chain}/${p.token}`} target="_blank" rel="noreferrer" title={p.token}>{p.symbol}</a></td><td>{p.amount}</td><td><a href={`${txExplorer}${p.signature}`} target="_blank" rel="noreferrer">Inspect ↗</a></td><td><button type="button" className="refresh-button" onClick={() => onTrack(p.wallet, `Whale ${p.wallet.slice(0, 7)}…`)}>Track</button></td></tr>)}</tbody></table></div>
        {!result.purchases.length && <p>{result.purchaseStatus === 'loading' ? 'Verified purchases will appear as checks complete.' : result.whalesTargeted === 0 ? 'No matching non-contract whales were available to inspect with these parameters.' : 'No verified purchases found within this search’s coverage. This does not establish that whales made no purchases.'}</p>}
      </>}
    </section>
  </>
}
