import type { WhaleSonarFeed } from '../lib/whale-sonar'
import PrivateSaveStatus from './PrivateSaveStatus'
import { usePrivatePreference } from '../hooks/use-private-preference'
import type { WalletValuation as WalletValuationData } from '../lib/wallet-valuation'
import WalletHologram from './WalletHologram'
import { directoryBalanceEntries, walletAsset } from '../lib/wallet-hologram'
import type { HolderDirectory } from '../lib/holder-rankings'
import WalletHolderList from './WalletHolderList'
import SolanaWalletMetrics from './SolanaWalletMetrics'
import EthereumTracker from './EthereumTracker'
import WalletValuation from './WalletValuation'
import { useEffect, useRef, useState } from 'react'
import { validAddress } from '../lib/token-identity'
import { type WalletActivity } from '../lib/wallet-intelligence'
type Watch = { address: string; label: string }
type Settings = { swaps: boolean; transfers: boolean; patterns: boolean; minimumSwaps: number }
type Snapshot = {
  source?: string
  configured: boolean
  error?: string
  activities: WalletActivity[]
  balances: Array<{ mint: string; amount: string }>
  at?: number
  before?: string | null
  coverage?: string
  earlyBuys?: Array<{ token: string; at: number }>
  patterns?: Array<{ mint: string; pattern: string; count: number; note: string }>
  pnl?: { realized: number | null; reason: string }
}
const mintLink = (mint: string) => `https://dexscreener.com/solana/${encodeURIComponent(mint)}`
function SolanaWalletTracker() {
  const [valuation, setValuation] = useState<{
    address: string
    data: WalletValuationData | null
  } | null>(null)
  const privateLists = usePrivatePreference('wallets-solana', () => ({
    wallets: [] as Watch[],
    settings: { swaps: true, transfers: false, patterns: true, minimumSwaps: 3 } as Settings,
  }))
  const [whaleFeed, setWhaleFeed] = useState<WhaleSonarFeed | null>(null)
  const [directory, setDirectory] = useState<HolderDirectory | null>(null)
  const { wallets, settings } = privateLists.value
  const setWallets = (next: (current: Watch[]) => Watch[]) =>
    privateLists.setValue((current) => ({ ...current, wallets: next(current.wallets) }))
  const setSettings = (next: (current: Settings) => Settings) =>
    privateLists.setValue((current) => ({ ...current, settings: next(current.settings) }))
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const storageError = privateLists.error
  const [refresh, setRefresh] = useState(0)
  const [holderRefresh, setHolderRefresh] = useState(0),
    [holdersLoading, setHoldersLoading] = useState(true)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tokenData, setTokenData] = useState<any>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const backgroundOffset = useRef(0)
  const [intelligence, setIntelligence] = useState<any>(null)
  useEffect(() => {
    if (!selected) {
      setSnapshot(null)
      return
    }
    const controller = new AbortController()
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(
          `/api/wallet-tracker?address=${selected}${cursor ? `&before=${cursor}` : ''}`,
          { signal: controller.signal }
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Wallet service unavailable')
        if (!controller.signal.aborted) setSnapshot(data)
        const cross = await fetch('/api/intelligence', { signal: controller.signal })
        if (cross.ok) setIntelligence(await cross.json())
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Wallet service unavailable')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void run()
    const interval = window.setInterval(() => {
      if (!cursor) void run()
    }, 60000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [selected, cursor, refresh])
  useEffect(() => {
    const controller = new AbortController()
    const others = wallets.filter((w) => w.address !== selected)
    let running = false
    const poll = async () => {
      if (running || !others.length) return
      running = true
      try {
        const batch = Array.from(
          { length: Math.min(5, others.length) },
          (_, i) => others[(backgroundOffset.current + i) % others.length]
        )
        backgroundOffset.current = (backgroundOffset.current + batch.length) % others.length
        for (const wallet of batch) {
          if (controller.signal.aborted) break
          const response = await fetch(`/api/wallet-tracker?address=${wallet.address}`, {
            signal: controller.signal,
          })
          if (!response.ok) break
          const data = await response.json()
          if (!data.configured) break
        }
      } catch {
        /* Selected-wallet status reports provider errors; background polling retries next minute. */
      } finally {
        running = false
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 60000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [wallets, selected])
  const inspectToken = async (mint: string) => {
    setTokenLoading(true)
    setTokenData(null)
    try {
      const response = await fetch(`/api/intelligence/token?mint=${encodeURIComponent(mint)}`)
      if (!response.ok) throw new Error('Token intelligence unavailable')
      setTokenData(await response.json())
    } catch {
      setError('Token market or holder data unavailable; retry later.')
    } finally {
      setTokenLoading(false)
    }
  }
  const choose = (value: string) => {
    setSelected(value)
    setSnapshot(null)
    setCursor(null)
  }
  const track = (value: string, name = '') => {
    if (!privateLists.ready) {
      setError('Wait for your private lists to load before tracking a wallet.')
      return
    }
    value = value.trim()
    if (!validAddress('solana', value)) {
      setError('Enter a valid Solana public address.')
      return
    }
    if (wallets.length >= 25 && !wallets.some((w) => w.address === value)) {
      setError('Maximum 25 watched wallets.')
      return
    }
    setWallets((ws) =>
      ws.some((w) => w.address === value)
        ? ws
        : [...ws, { address: value, label: name.trim().slice(0, 64) || value }]
    )
    choose(value)
    setAddress('')
    setLabel('')
    setError('')
  }
  const activities = snapshot?.activities ?? []
  const recent = activities.filter((a) => a.kind === 'swap').slice(0, 10)
  const patterns = (snapshot?.patterns ?? []).filter((p) => p.count >= settings.minimumSwaps)
  const alerts = activities
    .filter(
      (a) =>
        a.at >= Date.now() - 3600000 &&
        ((settings.swaps && a.kind === 'swap') || (settings.transfers && a.kind === 'transfer'))
    )
    .slice(0, 20)
  const related =
    intelligence?.pools?.filter(
      (pool: any) =>
        pool.network === 'solana' &&
        activities.some((a) => a.tokens.some((t) => t.mint === pool.tokenAddress))
    ) ?? []
  return (
    <div className='discover-page wallet-tracker'>
      <PrivateSaveStatus sync={privateLists} />
      <header className='discover-header'>
        <div>
          <div className='section-kicker'>SOLANA · PUBLIC ADDRESS MONITORING</div>
          <h1>Solana Wallet Tracker</h1>
          <p>
            Find large SOL holders, watch public addresses, and inspect supported confirmed token
            purchases.
          </p>
        </div>
        <button
          className='refresh-button'
          disabled={loading || !selected}
          onClick={() => {
            setCursor(null)
            setRefresh((v) => v + 1)
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>
      <WalletHologram
        whaleFeed={whaleFeed}
        wallets={
          directory?.holders.map((holder) => ({
            address: holder.address,
            label: holder.label || `${holder.address.slice(0, 7)}…${holder.address.slice(-5)}`,
          })) ?? []
        }
        walletSource='Large SOL holders'
        onWalletChange={choose}
        key={selected || 'solana-directory'}
        chain='solana'
        selected={selected}
        observedAt={selected ? snapshot?.at : directory?.at}
        loading={selected ? loading : holdersLoading}
        scope={directory?.scope}
        entries={
          selected
            ? snapshot?.balances.map((b) => ({
                id: b.mint,
                mint: b.mint,
                ...walletAsset('solana', b.mint),
                amount: b.amount,
                usd:
                  valuation?.address === selected && valuation.data?.balancesAt === snapshot.at
                    ? valuation.data?.balances.find((v) => v.mint === b.mint)?.valueUsd ?? null
                    : null,
                owner: selected,
              })) ?? []
            : directoryBalanceEntries('solana', directory)
        }
      />
      <form
        className='discover-toolbar'
        onSubmit={(e) => {
          e.preventDefault()
          track(address, label)
        }}
      >
        <input
          aria-label='Solana public wallet address'
          placeholder='Solana public address'
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          aria-label='Wallet label'
          placeholder='Optional label'
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
        />
        <button className='refresh-button'>Track Solana wallet</button>
        <button
          type='button'
          className='refresh-button'
          disabled={holdersLoading}
          onClick={() => {
            setSelected('')
            setHolderRefresh((n) => n + 1)
          }}
        >
          {holdersLoading ? 'Finding holders…' : 'Find large SOL holders'}
        </button>
      </form>
      <WalletHolderList
        onWhaleFeedChange={setWhaleFeed}
        chain='solana'
        onTrack={track}
        refreshKey={holderRefresh}
        onLoadingChange={setHoldersLoading}
        onDirectoryChange={setDirectory}
      />
      {storageError && <p role='alert'>{storageError}</p>}
      {error && <p role='alert'>{error}</p>}
      <div className='discover-chain-tabs'>
        {wallets.map((w) => (
          <div key={w.address}>
            <button
              aria-pressed={selected === w.address}
              onClick={() => choose(w.address)}
              title={w.address}
            >
              {w.label === w.address ? `${w.address.slice(0, 6)}…${w.address.slice(-5)}` : w.label}
            </button>
            <button
              aria-label={`Remove ${w.label}`}
              onClick={() => {
                setWallets((ws) => ws.filter((x) => x.address !== w.address))
                if (selected === w.address)
                  choose(wallets.find((x) => x.address !== w.address)?.address ?? '')
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!wallets.length && (
        <p className='discover-empty'>
          Add a public Solana wallet to begin. Watchlists and alert preferences are saved privately
          for your signed-in wallet.
        </p>
      )}
      {selected && <p className='discover-address'>{selected}</p>}
      {snapshot && !snapshot.configured && (
        <p role='status'>
          {snapshot.error}. DefiLlama supplies token prices; wallet balances and transactions
          require a configured Alchemy or Helius provider.
        </p>
      )}
      {snapshot?.configured && (
        <>
          <p className='discover-context'>
            Wallet data by {snapshot.source === 'alchemy' ? 'Alchemy' : 'Helius'} ·{' '}
            {snapshot.coverage} ·{' '}
            {snapshot.at ? `Updated ${new Date(snapshot.at).toLocaleString()}` : ''}. Polls this
            wallet every 60 seconds and up to five other watched wallets per minute. Previously
            loaded history is retained by this BlockSonar server.
          </p>
          <SolanaWalletMetrics
            onValuation={setValuation}
            address={selected}
            at={snapshot.at}
            activities={activities}
          />
          <section className='wallet-section'>
            <h2>Activity alerts</h2>
            <div className='discover-toolbar'>
              {(['swaps', 'transfers', 'patterns'] as const).map((key) => (
                <label key={key}>
                  <input
                    type='checkbox'
                    checked={settings[key]}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
                  />
                  {key}
                </label>
              ))}
              <label>
                Directional swap threshold
                <input
                  type='number'
                  min={3}
                  max={100}
                  value={settings.minimumSwaps}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      minimumSwaps: Math.max(3, Math.min(100, Number(e.target.value) || 3)),
                    }))
                  }
                />
              </label>
            </div>
            <p>
              In-app alerts for observed activity in the last hour. Monitoring runs while this
              dashboard is open; alerts below apply to the selected wallet.
            </p>
            <ul>
              {alerts.map((a) => (
                <li key={a.signature}>
                  {a.kind} · {new Date(a.at).toLocaleTimeString()} ·{' '}
                  <a href={`https://solscan.io/tx/${a.signature}`} target='_blank' rel='noreferrer'>
                    Transaction ↗
                  </a>
                </li>
              ))}
              {settings.patterns &&
                patterns.map((p) => (
                  <li key={p.mint}>
                    {p.pattern} · {p.count} token legs ·{' '}
                    <a href={mintLink(p.mint)} target='_blank' rel='noreferrer'>
                      {p.mint}
                    </a>
                    <small>{p.note}</small>
                  </li>
                ))}
            </ul>
            {!alerts.length && (!settings.patterns || !patterns.length) && (
              <p>No matching alerts in observed activity.</p>
            )}
          </section>
          <div className='discover-grid'>
            <section className='discover-card'>
              <h2>Balances</h2>
              {snapshot.balances.map((b, i) => (
                <p key={`${b.mint}:${i}`}>
                  <a
                    href={b.mint === 'SOL' ? 'https://solscan.io' : mintLink(b.mint)}
                    target='_blank'
                    rel='noreferrer'
                  >
                    {b.mint}
                  </a>
                  <strong> {b.amount}</strong>
                  {b.mint !== 'SOL' && (
                    <button
                      className='refresh-button'
                      disabled={tokenLoading}
                      onClick={() => void inspectToken(b.mint)}
                    >
                      Market &amp; holders
                    </button>
                  )}
                </p>
              ))}
            </section>
            <section className='discover-card'>
              <h2>Estimated realized P&amp;L</h2>
              <strong>
                {snapshot.pnl?.realized == null
                  ? 'Unavailable'
                  : `$${snapshot.pnl.realized.toFixed(2)}`}
              </strong>
              <p>{snapshot.pnl?.reason}</p>
              <p>Current token prices are never substituted for historical execution prices.</p>
            </section>
          </div>
          <WalletValuation address={selected} balancesAt={snapshot.at} />
          {tokenLoading && <p role='status'>Loading token market data and holder concentration…</p>}
          {tokenData && (
            <section className='wallet-section'>
              <h2>Token market &amp; holder concentration</h2>
              <p>{tokenData.mint}</p>
              {tokenData.pairs?.length ? (
                tokenData.pairs.map((pair: any) => (
                  <p key={pair.pairAddress}>
                    <a href={mintLink(pair.pairAddress)} target='_blank' rel='noreferrer'>
                      {pair.dexId} · {pair.pairAddress}
                    </a>{' '}
                    · liquidity ${pair.liquidity?.usd ?? 'Unavailable'} · 24h volume $
                    {pair.volume?.h24 ?? 'Unavailable'}
                  </p>
                ))
              ) : (
                <p>No DEX Screener pools returned.</p>
              )}
              {tokenData.concentration?.available ? (
                <>
                  <p>{tokenData.concentration.scope}</p>
                  {tokenData.concentration.holders.map((holder: any) => (
                    <p key={holder.owner}>
                      {holder.owner} · {holder.percentOfSupply.toFixed(2)}% of supply
                    </p>
                  ))}
                </>
              ) : (
                <p>{tokenData.concentration?.reason}</p>
              )}
            </section>
          )}
          <section className='wallet-section'>
            <h2>Recently purchased / sold tokens</h2>
            {recent.length ? (
              recent.map((a) => (
                <div key={a.signature}>
                  {a.tokens.map((t, i) => (
                    <p key={i}>
                      {t.direction === 'in' ? 'Purchased' : 'Sold'} · {t.amount}{' '}
                      <a href={mintLink(t.mint)} target='_blank' rel='noreferrer'>
                        {t.mint} ↗
                      </a>
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p>No supported swaps observed.</p>
            )}
          </section>
          <section className='wallet-section'>
            <h2>Early purchases · first 10 minutes</h2>
            {snapshot.earlyBuys?.length ? (
              snapshot.earlyBuys.map((b, i) => (
                <p key={i}>
                  <a href={mintLink(b.token)} target='_blank' rel='noreferrer'>
                    {b.token}
                  </a>{' '}
                  · {new Date(b.at).toLocaleString()}
                </p>
              ))
            ) : (
              <p>No early purchases matched the pools discovered by this server.</p>
            )}
            <p>
              Repeat early buyers across different tokens:{' '}
              {intelligence?.repeatEarlyBuyers
                ?.map((w: any) => `${w.wallet} (${w.tokenCount} tokens)`)
                .join(', ') || 'None observed'}
            </p>
          </section>
          <section className='wallet-section'>
            <h2>Related liquidity pools</h2>
            <a href='#/discover'>Open New Liquidity Pools</a>
            {related.map((p: any) => (
              <div className='discover-card' key={p.id}>
                <h3>{p.name}</h3>
                <p>
                  {p.observedBuyerCount} observed early buyers (change{' '}
                  {p.buyerCountDelta ?? 'awaiting comparison'}) · liquidity{' '}
                  {p.dexData?.observation.liquidity ?? p.liquidity ?? 'Unavailable'} USD · 24h
                  volume {p.dexData?.observation.volume ?? p.volume ?? 'Unavailable'} USD
                </p>
                <p>
                  Liquidity change: {p.dexData?.liquidityDelta ?? 'Unavailable'} · rolling volume
                  change: {p.dexData?.volumeDelta ?? 'Unavailable'}
                </p>
                <a href={mintLink(p.address)} target='_blank' rel='noreferrer'>
                  DEX Screener ↗
                </a>
              </div>
            ))}
            <p>
              Large-holder concentration: {intelligence?.holderConcentrationReason ?? 'Unavailable'}
            </p>
            <p>{intelligence?.coverage}</p>
          </section>
          <section className='wallet-section'>
            <h2>Activity history</h2>
            <div className='wallet-table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Classification</th>
                    <th>Token movements</th>
                    <th>Fee (SOL)</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.signature}>
                      <td>{new Date(a.at).toLocaleString()}</td>
                      <td>{a.kind}</td>
                      <td>
                        {a.nativeSolDelta != null && (
                          <div>Native transfer net: {a.nativeSolDelta} SOL</div>
                        )}
                        {a.tokens.map((t, i) => (
                          <div key={i}>
                            {t.direction} {t.amount}{' '}
                            <a href={mintLink(t.mint)} target='_blank' rel='noreferrer'>
                              {t.mint}
                            </a>
                          </div>
                        ))}
                      </td>
                      <td>{a.feeSol ?? 'Unavailable'}</td>
                      <td>
                        <a
                          href={`https://solscan.io/tx/${a.signature}`}
                          target='_blank'
                          rel='noreferrer'
                        >
                          Inspect ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!activities.length && (
              <p>No transactions returned. This does not prove the wallet has no activity.</p>
            )}
            {snapshot.before && (
              <button
                className='refresh-button'
                disabled={loading}
                onClick={() => setCursor(snapshot.before!)}
              >
                Load older history
              </button>
            )}
            <p>
              Unknown transactions are retained. Failed transaction movements are excluded from
              trading intelligence. Internal movements can only be recognized when ownership is
              known.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

export default function WalletTracker() {
  const [network, setNetwork] = useState<'solana' | 'ethereum'>('ethereum')
  return (
    <>
      <div className='discover-chain-tabs' role='group' aria-label='Wallet tracker network'>
        <button aria-pressed={network === 'ethereum'} onClick={() => setNetwork('ethereum')}>
          Ethereum
        </button>
        <button aria-pressed={network === 'solana'} onClick={() => setNetwork('solana')}>
          Solana
        </button>
      </div>
      {network === 'ethereum' ? <EthereumTracker /> : <SolanaWalletTracker />}
    </>
  )
}
