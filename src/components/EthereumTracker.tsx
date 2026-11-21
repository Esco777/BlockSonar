import type { WhaleSonarFeed } from '../lib/whale-sonar'
import PrivateSaveStatus from './PrivateSaveStatus'
import { usePrivatePreference } from '../hooks/use-private-preference'
import WalletHologram from './WalletHologram'
import { directoryBalanceEntries, walletAsset } from '../lib/wallet-hologram'
import type { HolderDirectory } from '../lib/holder-rankings'
import WalletHolderList from './WalletHolderList'
import { useEffect, useState } from 'react'
import { validAddress } from '../lib/token-identity'
import { ethereumTokenLink, type EthereumSnapshot } from '../lib/ethereum-wallet'
type Watch = { address: string; label: string }
const usd = (n: number | null) =>
  n === null
    ? 'Unpriced'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(n)
const short = (s: string) => `${s.slice(0, 7)}…${s.slice(-5)}`
export default function EthereumTracker() {
  const privateLists = usePrivatePreference('wallets-ethereum', () => ({ wallets: [] as Watch[] }))
  const wallets = privateLists.value.wallets
  const setWallets = (next: (current: Watch[]) => Watch[]) =>
    privateLists.setValue((current) => ({ wallets: next(current.wallets) }))
  const [whaleFeed, setWhaleFeed] = useState<WhaleSonarFeed | null>(null)
  const [directory, setDirectory] = useState<HolderDirectory | null>(null)
  const [selected, setSelected] = useState('')
  const [address, setAddress] = useState(''),
    [label, setLabel] = useState('')
  const [data, setData] = useState<EthereumSnapshot | null>(null)
  const [error, setError] = useState('')
  const storageError = privateLists.error
  const [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0)
  const [holdingThreshold, setHoldingThreshold] = useState(100000),
    [buyThreshold, setBuyThreshold] = useState(25000)
  const [includeUnpriced, setIncludeUnpriced] = useState(false)
  const [holderRefresh, setHolderRefresh] = useState(0),
    [holdersLoading, setHoldersLoading] = useState(true)
  useEffect(() => {
    setData(null)
    setError('')
    if (!selected) return
    const controller = new AbortController()
    let busy = false
    const run = async () => {
      if (busy) return
      busy = true
      setLoading(true)
      try {
        const response = await fetch(
          `/api/wallet-tracker/ethereum?address=${encodeURIComponent(selected)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) }
        )
        const value = await response.json()
        if (!response.ok) throw new Error(value.error ?? 'Ethereum provider unavailable')
        if (!controller.signal.aborted) {
          setData(value)
          setError('')
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Ethereum provider unavailable')
      } finally {
        busy = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void run()
    const interval = window.setInterval(() => void run(), 60000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [selected, refresh])
  const track = (value: string, name = '') => {
    if (!privateLists.ready) {
      setError('Wait for your private lists to load before tracking a wallet.')
      return
    }
    value = value.trim().toLowerCase()
    if (!validAddress('ethereum', value)) {
      setError('Enter an Ethereum mainnet public address (0x…).')
      return
    }
    if (wallets.length >= 25 && !wallets.some((w) => w.address === value)) {
      setError('Maximum 25 Ethereum wallets.')
      return
    }
    setWallets((current) =>
      current.some((w) => w.address === value)
        ? current
        : [...current, { address: value, label: name.trim().slice(0, 64) || short(value) }]
    )
    setSelected(value)
    setError('')
  }
  const largeHoldings =
    data?.holdings.filter((h) =>
      h.valueUsd !== null ? h.valueUsd >= holdingThreshold : includeUnpriced
    ) ?? []
  const buys = (data?.activities ?? [])
    .filter((a) => a.kind === 'swap')
    .flatMap((a) =>
      a.tokenValues
        .filter((t) => t.purchased)
        .map((t) => ({ ...t, signature: a.signature, at: a.at, verification: a.verification }))
    )
  const largeBuys = buys.filter((b) =>
    b.valueUsd !== null ? b.valueUsd >= buyThreshold : includeUnpriced
  )
  return (
    <div className='discover-page wallet-tracker'>
      <PrivateSaveStatus sync={privateLists} />
      <header className='discover-header'>
        <div>
          <div className='section-kicker'>ETHEREUM MAINNET · LARGE HOLDINGS &amp; BUYS</div>
          <h1>Ethereum Wallet Tracker</h1>
          <p>
            Find large ETH holders, watch public addresses, and inspect supported confirmed token
            purchases.
          </p>
        </div>
        <button
          className='refresh-button'
          disabled={loading || !selected}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {loading ? 'Loading…' : 'Refresh wallet'}
        </button>
      </header>
      <WalletHologram
        whaleFeed={whaleFeed}
        wallets={
          directory?.holders.map((holder) => ({
            address: holder.address.toLowerCase(),
            label: holder.label || short(holder.address),
          })) ?? []
        }
        walletSource='Large ETH holders'
        onWalletChange={setSelected}
        key={selected || 'ethereum-directory'}
        chain='ethereum'
        selected={selected}
        observedAt={selected ? data?.at : directory?.at}
        loading={selected ? loading : holdersLoading}
        scope={directory?.scope}
        entries={
          selected
            ? data?.address === selected
              ? data.holdings.map((h) => ({
                  id: h.mint,
                  mint: h.mint,
                  ...walletAsset('ethereum', h.mint, h.symbol),
                  amount: h.amount,
                  usd: h.valueUsd,
                  owner: selected,
                  logo: h.logo,
                }))
              : []
            : directoryBalanceEntries('ethereum', directory)
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
          aria-label='Ethereum wallet address'
          placeholder='Enter an Ethereum Mainnet public address'
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          aria-label='Ethereum wallet label'
          placeholder='Optional label'
          maxLength={64}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className='refresh-button'>Track Ethereum wallet</button>
        <button
          type='button'
          className='refresh-button'
          disabled={holdersLoading}
          onClick={() => {
            setSelected('')
            setHolderRefresh((n) => n + 1)
          }}
        >
          {holdersLoading ? 'Finding holders…' : 'Find large ETH holders'}
        </button>
      </form>
      <WalletHolderList
        onWhaleFeedChange={setWhaleFeed}
        chain='ethereum'
        onTrack={track}
        refreshKey={holderRefresh}
        onLoadingChange={setHoldersLoading}
        onDirectoryChange={setDirectory}
      />
      {error && <p role='alert'>{error}</p>}
      {storageError && <p role='alert'>{storageError}</p>}
      <div className='discover-chain-tabs'>
        {wallets.map((w) => (
          <div key={w.address}>
            <button
              aria-pressed={selected === w.address}
              title={w.address}
              onClick={() => setSelected(w.address)}
            >
              {w.label}
            </button>
            <button
              aria-label={`Remove Ethereum wallet ${w.label}`}
              onClick={() => {
                setWallets((current) => current.filter((x) => x.address !== w.address))
                if (selected === w.address)
                  setSelected(wallets.find((x) => x.address !== w.address)?.address ?? '')
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!selected && (
        <p className='discover-empty'>
          Add an Ethereum address or select a large holder above. Wallet balances and activity use
          the configured provider; global holder discovery uses Blockscout.
        </p>
      )}
      {selected && (
        <p className='discover-address'>
          <a href={`https://etherscan.io/address/${selected}`} target='_blank' rel='noreferrer'>
            {selected} ↗
          </a>
        </p>
      )}
      {data && (
        <>
          <p className='discover-context'>
            Updated {new Date(data.at).toLocaleString()} · selected wallet refreshes every 60
            seconds while this tab is open.{' '}
            <a
              href={
                data.source === 'alchemy' ? 'https://www.alchemy.com' : 'https://eth.blockscout.com'
              }
              target='_blank'
              rel='noreferrer'
            >
              Wallet data by {data.source === 'alchemy' ? 'Alchemy' : 'Blockscout'}
            </a>{' '}
            · prices by{' '}
            <a href='https://defillama.com' target='_blank' rel='noreferrer'>
              DefiLlama
            </a>
            .
          </p>
          {data.warnings.map((warning, i) => (
            <p role='status' key={i}>
              {warning}
            </p>
          ))}
          <div className='discover-status-grid'>
            <div>
              <strong>{usd(data.pricedSubtotalUsd)}</strong>
              <span>Priced holdings subtotal · {data.unpricedCount} unpriced assets</span>
            </div>
            <div>
              <strong>{buys.length}</strong>
              <span>Supported purchases in observed history</span>
            </div>
            <div>
              <strong>{data.activities.length}</strong>
              <span>Observed transactions retained</span>
            </div>
          </div>
          <div className='discover-toolbar'>
            <label>
              Large holding ≥ USD
              <input
                type='number'
                min={0}
                max={1000000000000}
                value={holdingThreshold}
                onChange={(e) =>
                  setHoldingThreshold(Math.max(0, Math.min(1e12, Number(e.target.value) || 0)))
                }
              />
            </label>
            <label>
              Large buy ≥ USD
              <input
                type='number'
                min={0}
                max={1000000000000}
                value={buyThreshold}
                onChange={(e) =>
                  setBuyThreshold(Math.max(0, Math.min(1e12, Number(e.target.value) || 0)))
                }
              />
            </label>
            <label>
              <input
                type='checkbox'
                checked={includeUnpriced}
                onChange={(e) => setIncludeUnpriced(e.target.checked)}
              />
              Include unpriced assets separately
            </label>
          </div>
          <section className='wallet-section'>
            <h2>Large crypto holdings</h2>
            <p>
              Sorted by available USD estimate. Native ETH and observed ERC-20 balances; excludes
              NFTs and unobserved DeFi positions.
            </p>
            <div className='wallet-table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Quantity</th>
                    <th>Current value</th>
                    <th>Price time</th>
                  </tr>
                </thead>
                <tbody>
                  {largeHoldings.map((h) => (
                    <tr key={h.mint}>
                      <td>
                        <a
                          href={ethereumTokenLink(h.mint)}
                          title={h.mint}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {h.symbol}
                        </a>
                        <small>{h.mint === 'ETH' ? 'Native ETH' : short(h.mint)}</small>
                      </td>
                      <td>{h.amount}</td>
                      <td>{usd(h.valueUsd)}</td>
                      <td>
                        {h.priceAt ? new Date(h.priceAt).toLocaleTimeString() : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!largeHoldings.length && (
              <p>No priced holdings meet this threshold in the observed data.</p>
            )}
          </section>
          <section className='wallet-section'>
            <h2>Large confirmed token buys</h2>
            <p>
              Successful wallet-funded Uniswap v2/v3 swaps with an authenticated pool event and a
              token-transfer path into the watched wallet. USD size uses the current quote at this
              refresh, not the execution-time price.
            </p>
            <div className='wallet-table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Purchased token</th>
                    <th>Quantity</th>
                    <th>Current-value estimate</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {largeBuys.map((b, i) => (
                    <tr key={`${b.signature}:${b.mint}:${i}`}>
                      <td>{new Date(b.at).toLocaleString()}</td>
                      <td>
                        <a
                          href={ethereumTokenLink(b.mint)}
                          title={b.mint}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {b.symbol}
                        </a>
                      </td>
                      <td>{b.amount.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</td>
                      <td>{usd(b.valueUsd)}</td>
                      <td>
                        <a
                          title={b.verification}
                          href={`https://etherscan.io/tx/${b.signature}`}
                          target='_blank'
                          rel='noreferrer'
                        >
                          Inspect buy ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!largeBuys.length && (
              <p>No supported confirmed purchases meet this threshold in observed history.</p>
            )}
            <p>
              {buys.filter((b) => b.valueUsd === null).length} confirmed purchase entries have no
              reliable current USD quote.
            </p>
          </section>
          <section className='wallet-section'>
            <h2>Ethereum activity history</h2>
            <div className='wallet-table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Classification</th>
                    <th>Observed movements</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activities.map((a) => (
                    <tr key={a.signature}>
                      <td>
                        <a
                          href={`https://etherscan.io/tx/${a.signature}`}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {new Date(a.at).toLocaleString()} ↗
                        </a>
                      </td>
                      <td>{a.kind}</td>
                      <td>
                        {a.nativeEthDelta != null && a.nativeEthDelta !== 0 && (
                          <div>Top-level ETH transfer: {a.nativeEthDelta}</div>
                        )}
                        {a.tokenValues.map((t) => (
                          <div key={t.mint}>
                            {t.direction}{' '}
                            {t.amount.toLocaleString(undefined, { maximumSignificantDigits: 6 })}{' '}
                            {t.symbol}
                          </div>
                        ))}
                      </td>
                      <td>{a.verification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{data.coverage}</p>
            <p>
              Transfers and liquidity actions are separate from buys. No profitability or “smart
              money” label is assigned. Unsupported DEXes and incomplete logs remain unconfirmed.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
