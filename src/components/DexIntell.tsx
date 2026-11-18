import { dexHealth, type WorkerHealth } from '../lib/dex-health'
import { useDexPrices } from '../hooks/useDexPrices'
import { estimateSwapUsd } from '../lib/swap-valuation'
import { WalletHologramTarget } from './WalletHologram'
import SwapHologram from './SwapHologram'
import { useEffect, useState } from 'react'
import { Activity, ArrowDownUp, Database, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import WalletTracker from './WalletTracker'
import { dexChains, dexProtocols, type DexSnapshot } from '../lib/dex-intell'
import './DexIntell.css'

const short = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`
type CoverageResponse = { workers?: Record<string, string>; workerHealth?: Record<string, WorkerHealth>; unclassified?: Array<{ chain: string; pool: string; count: string }>; configured: boolean; coverage: DexSnapshot['coverage']; jobs: Array<{ chain: string; pool: string; status: string; last_error: string | null; updated_at: string }> }
export default function DexIntell() {
  const [walletHologramTarget, setWalletHologramTarget] = useState<HTMLDivElement | null>(null)
  const [tab, setTab] = useState<'swaps' | 'coverage' | 'wallets'>('swaps')
  const [chain, setChain] = useState('ethereum')
  const [token, setToken] = useState(''), [wallet, setWallet] = useState(''), [minimum, setMinimum] = useState('')
  const [protocol, setProtocol] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [query, setQuery] = useState('chain=ethereum'), [offset, setOffset] = useState(0)
  const [access, setAccess] = useState(''), [draftAccess, setDraftAccess] = useState('')
  const [snapshot, setSnapshot] = useState<DexSnapshot | null>(null)
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0), [stream, setStream] = useState('Connecting')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setSnapshot(null); setCoverage(null)
    const headers: Record<string, string> = access ? { Authorization: `Bearer ${access}` } : {}
    const get = async (path: string) => {
      const response = await fetch(path, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'DEX data unavailable')
      return data
    }
    void Promise.all([get(`/api/dex/swaps?${query}&offset=${offset}`), get('/api/data/coverage')]).then(([swaps, status]) => {
      if (!controller.signal.aborted) { setSnapshot(swaps); setCoverage(status) }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, offset, refresh, access])
  useEffect(() => {
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      try {
        const response = await fetch('/api/dex/stream', { headers: access ? { Authorization: `Bearer ${access}` } : {}, signal: controller.signal })
        if (!response.ok || !response.body) throw new Error('Stream unavailable')
        setStream('Connected · 15s updates')
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let pending = '', initial = true
        while (!controller.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          pending += decoder.decode(chunk.value, { stream: true })
          let end: number
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const event = pending.slice(0, end); pending = pending.slice(end + 2)
            if (event.startsWith('event: refresh')) { if (!initial) setRefresh(n => n + 1); initial = false }
          }
        }
      } catch { /* Reconnect without exposing authorization details. */ }
      if (!controller.signal.aborted) { setStream('Disconnected · retrying'); retry = setTimeout(connect, 15000) }
    }
    void connect()
    return () => { controller.abort(); if (retry) clearTimeout(retry) }
  }, [access])
  const quotes = useDexPrices(tab === 'swaps' ? snapshot?.swaps ?? [] : [], access)
  const collection = error ? 'Data service unavailable' : coverage ? dexHealth(coverage.configured, coverage.workers?.[chain], coverage.workerHealth?.[chain], coverage.jobs.filter(job => job.chain === chain)) : 'Checking collection…'
  const lastSuccess = coverage?.workerHealth?.[chain]?.lastSuccessAt
  const activeCoverage = coverage?.coverage.filter(c => c.chain === chain) ?? []
  return <div className="discover-page dex-intell">
    <header className="discover-header"><div><div className="section-kicker">ON-CHAIN INTELLIGENCE / BLOCKSONAR</div><h1>DEX Intell<span className="dex-beta">EARLY ACCESS</span></h1><p>Follow the swaps. Inspect the history. Know what your data covers.</p></div><button className="refresh-button" disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} className={loading ? 'spinning' : ''} />Refresh</button></header>
    {tab === 'wallets' && <div ref={setWalletHologramTarget} />}
    {tab === 'swaps' && <SwapHologram quotes={quotes} key={`${query}:${offset}`} swaps={snapshot?.swaps ?? []} chain={chain} historical={offset > 0 || Boolean(from || to)} loading={loading} error={Boolean(error)} />}
    <div className="dex-summary">
      <section><Activity size={18} /><small>UPDATE CONNECTION</small><strong>{stream}</strong></section>
      <section><ArrowDownUp size={18} /><small>OBSERVED SWAPS</small><strong>{snapshot ? snapshot.swaps.length : '—'} <span>on this page</span></strong></section>
      <section><Database size={18} /><small>INDEXED POOLS · {chain.toUpperCase()}</small><strong>{coverage ? activeCoverage.length : '—'} <span>with saved coverage</span></strong></section>
      <section><ShieldCheck size={18} /><small>SWAP COLLECTION</small><strong>{collection}</strong><small>{lastSuccess ? `Last successful check ${new Date(lastSuccess).toLocaleTimeString()}` : 'Awaiting a successful indexing check'}</small></section>
    </div>
    <div className="dex-tabs" role="group" aria-label="DEX Intell view">{([{ id: 'swaps', label: 'DEX swaps', icon: ArrowDownUp }, { id: 'coverage', label: 'Data coverage', icon: Database }, { id: 'wallets', label: 'Wallet intelligence', icon: Wallet }] as const).map(t => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}><t.icon size={15} />{t.label}</button>)}</div>
    {tab !== 'wallets' && <>
      <div className="dex-chains" role="group" aria-label="Blockchain">{dexChains.map(c => <button key={c.key} aria-pressed={chain === c.key} onClick={() => { setChain(c.key); setQuery(new URLSearchParams({ chain: c.key }).toString()); setOffset(0); setToken(''); setWallet(''); setMinimum(''); setProtocol(''); setFrom(''); setTo('') }}>{c.name}<small>{String(c.status) === 'planned' ? 'Adapter pending' : c.key === 'solana' ? 'Orca / Raydium' : c.key !== 'base' ? 'V2 / V3 adapters' : 'V3 adapter'}</small></button>)}</div>
      <details className="dex-access"><summary>Restricted data access</summary><form onSubmit={e => { e.preventDefault(); setAccess(draftAccess); setDraftAccess('') }}><label>DEX access token<input type="password" autoComplete="off" value={draftAccess} onChange={e => setDraftAccess(e.target.value)} /></label><button className="refresh-button">Connect</button>{access && <button type="button" className="refresh-button" onClick={() => setAccess('')}>Clear token</button>}<small>Kept in memory for this page only. Production access requires server configuration.</small></form></details>
      {error && <p role="alert" className="dex-notice">{error}</p>}
      {snapshot && !snapshot.configured && <div className="dex-notice" role="status"><Database size={19} /><div><strong>Historical engine is not connected</strong><p>Configure PostgreSQL, a chain RPC endpoint, verified pool addresses, and a start block on the server to begin collecting. No sample trades or synthetic history are shown.</p></div></div>}
      {String(dexChains.find(c => c.key === chain)?.status) === 'planned' && <p className="dex-notice">{dexChains.find(c => c.key === chain)?.name} indexing is pending. No chain-wide coverage is claimed.</p>}
    </>}
    {tab === 'swaps' && <section className="dex-panel">
      <div className="dex-panel-heading"><div><h2>Swap activity</h2><p>Finalized events from verified, configured pools.</p></div><span className="dex-tag">RAW RPC → OWN DATABASE</span></div>
      <form className="dex-filters" onSubmit={e => { e.preventDefault(); const p = new URLSearchParams({ chain }); if (token.trim()) p.set('token', token.trim()); if (wallet.trim()) p.set('wallet', wallet.trim()); if (minimum) p.set('minUsd', minimum); if (protocol) p.set('dex', protocol); if (from) p.set('from', new Date(from).toISOString()); if (to) p.set('to', new Date(to).toISOString()); setQuery(p.toString()); setOffset(0) }}>
        <label>Token address<input placeholder="All tokens" value={token} onChange={e => setToken(e.target.value)} /></label><label>Wallet address<input placeholder="All identifiable wallets" value={wallet} onChange={e => setWallet(e.target.value)} /></label><label>DEX<select value={protocol} onChange={e => setProtocol(e.target.value)}><option value="">All protocols</option>{dexProtocols.filter(d => d.chain === chain).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label><label>Minimum USD<input type="number" min="0" step="any" placeholder="Any size" value={minimum} onChange={e => setMinimum(e.target.value)} /></label><label>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label><button className="refresh-button">Apply filters</button>
      </form>
      <div className="dex-table-wrap"><table><thead><tr><th>Time / chain</th><th>DEX / pool</th><th>Swap direction</th><th>Amounts · raw integers</th><th>USD value / wallet</th><th>Transaction</th></tr></thead><tbody>{snapshot?.swaps.map(s => <tr key={`${s.chain}:${s.tx_hash}:${s.log_index}`}><td>{new Date(s.at).toLocaleString()}<small>{s.chain} · {s.finality}</small></td><td>{s.protocol}<small title={s.pool}>{short(s.pool)}</small></td><td><span title={s.token_in}>{short(s.token_in)}</span> → <span title={s.token_out}>{short(s.token_out)}</span></td><td><span>{s.amount_in} in</span><small>{s.amount_out} out</small></td><td>{s.usd_value != null ? `$${s.usd_value}` : estimateSwapUsd(s, quotes) ? <span className="dex-usd-estimate" title={`${estimateSwapUsd(s, quotes)!.source ? `${estimateSwapUsd(s, quotes)!.source} · ` : ''}Quote ${new Date(estimateSwapUsd(s, quotes)!.priceAt).toLocaleString()}; current value, not historical execution value`}>{new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(estimateSwapUsd(s, quotes)!.value)}<small>Current estimate</small></span> : 'USD unavailable'}<small>{s.wallet ? short(s.wallet) : 'Trader not attributed'}</small></td><td><a href={`${dexChains.find(c => c.key === s.chain)?.explorer ?? 'https://basescan.org'}/tx/${s.tx_hash}`} target="_blank" rel="noreferrer">{short(s.tx_hash)} ↗</a></td></tr>)}</tbody></table></div>
      {loading && <p className="dex-empty" role="status">Reading indexed history…</p>}{!loading && !snapshot?.swaps.length && <div className="dex-empty"><ArrowDownUp size={28} /><h3>{error ? 'Swap history unavailable' : 'No indexed swaps in this view'}</h3><p>{error ? 'Retry after the service is available.' : 'Trades will appear after the worker indexes matching pool events. An empty result does not establish zero trading activity.'}</p></div>}
      <div className="dex-pagination"><button className="refresh-button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}</span><button className="refresh-button" disabled={snapshot?.nextOffset == null || loading} onClick={() => setOffset(snapshot!.nextOffset!)}>Next</button></div>
      <p className="dex-footnote">{snapshot?.note ?? 'USD filters exclude unpriced swaps. Router senders are never labeled as traders. Token decimal metadata and price provenance are required before human-readable values can be calculated.'}</p>
    </section>}
    {tab === 'coverage' && <section className="dex-panel"><div className="dex-panel-heading"><div><h2>Historical data coverage</h2><p>Contiguous saved block ranges, reported separately for each configured pool.</p><p>Worker: {coverage?.workers?.[chain] ?? (coverage?.configured ? 'not configured' : 'database not configured')}</p></div></div>{loading && <p role="status">Loading coverage…</p>}{!loading && !activeCoverage.length && <p className="dex-empty">No completed indexed ranges for {chain}. Collection start and historical scores remain unavailable.</p>}{activeCoverage.map(c => <div className="dex-coverage" key={`${c.chain}:${c.pool}`}><strong>{c.pool}</strong><p>{c.chain === 'solana' ? 'Slots' : 'Blocks'} {c.start_block}–{c.end_block} · {c.chain === 'solana' ? 'collection observation time' : 'first block time'} {new Date(c.started_at).toLocaleString()}</p><p>{c.scope}</p><small>Last saved {new Date(c.updated_at).toLocaleString()}</small></div>)}{coverage?.jobs.filter(j => j.chain === chain).map(j => <div className="dex-coverage" key={j.pool}><strong>{short(j.pool)} · {j.status}</strong>{j.last_error && <p role="status">{j.last_error}</p>}<small>Updated {new Date(j.updated_at).toLocaleString()}</small></div>)}{coverage?.unclassified?.filter(u => u.chain === chain).map(u => <p className="dex-footnote" key={u.pool}>{u.count} unclassified swap events retained for {short(u.pool)}. Direction is not established; these are excluded from the swap feed.</p>)}<p className="dex-footnote">Coverage applies to configured pools only. Historical scores, category momentum, new pool discovery, and additional protocol adapters are pending. Existing coin analytics and narrative feeds retain their current sources.</p></section>}
    {tab === 'wallets' && <WalletHologramTarget.Provider value={walletHologramTarget}><WalletTracker /></WalletHologramTarget.Provider>}
  </div>
}
