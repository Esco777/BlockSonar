import { useEffect, useState } from 'react'
import type { WalletActivity } from '../lib/wallet-intelligence'
import type { WalletValuation } from '../lib/wallet-valuation'
const usd = (value: number | null) =>
  value === null
    ? 'Unpriced'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value)
const short = (value: string) =>
  value === 'SOL' ? 'SOL' : `${value.slice(0, 7)}…${value.slice(-5)}`
const WSOL = 'So11111111111111111111111111111111111111112'
export default function SolanaWalletMetrics({
  address,
  at,
  activities,
  onValuation,
}: {
  onValuation?: (value: { address: string; data: WalletValuation | null }) => void
  address: string
  at?: number
  activities: WalletActivity[]
}) {
  const [data, setData] = useState<WalletValuation | null>(null),
    [error, setError] = useState('')
  const [holdingThreshold, setHoldingThreshold] = useState(100000),
    [buyThreshold, setBuyThreshold] = useState(25000),
    [unpriced, setUnpriced] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    void (async () => {
      try {
        const response = await fetch(
          `/api/wallet-tracker/valuation?address=${encodeURIComponent(address)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }
        )
        const value = await response.json()
        if (!response.ok || !value.available)
          throw new Error(value.error ?? 'Current pricing unavailable')
        if (!controller.signal.aborted) setData(value)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Current pricing unavailable')
      }
    })()
    return () => controller.abort()
  }, [address, at])
  useEffect(() => {
    onValuation?.({ address, data })
  }, [address, data, onValuation])
  const quotes = new Map(data?.balances.map((b) => [b.mint, b.priceUsd]))
  if (quotes.has('SOL')) quotes.set(WSOL, quotes.get('SOL')!)
  const holdings = (data?.balances ?? [])
    .filter((b) => (b.valueUsd !== null ? b.valueUsd >= holdingThreshold : unpriced))
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
  const buys = activities
    .filter((a) => a.kind === 'swap')
    .flatMap((a) =>
      a.tokens
        .filter((t) => t.direction === 'in')
        .map((t) => {
          const price = quotes.get(t.mint),
            value = price == null ? null : price * t.amount
          return {
            ...t,
            value: value !== null && Number.isFinite(value) ? value : null,
            signature: a.signature,
            at: a.at,
          }
        })
    )
  const filteredBuys = buys
    .filter((b) => (b.value !== null ? b.value >= buyThreshold : unpriced))
    .sort((a, b) => b.at - a.at)
  return (
    <>
      <div className='discover-status-grid'>
        <div>
          <strong>{usd(data?.pricedSubtotalUsd ?? null)}</strong>
          <span>Priced holdings subtotal · {data?.unpricedCount ?? '—'} unpriced assets</span>
        </div>
        <div>
          <strong>{buys.length}</strong>
          <span>Supported purchases in observed history</span>
        </div>
        <div>
          <strong>{activities.length}</strong>
          <span>Observed transactions retained</span>
        </div>
      </div>
      <div className='discover-toolbar'>
        <label>
          Large holding ≥ USD
          <input
            type='number'
            min={0}
            max={1e12}
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
            max={1e12}
            value={buyThreshold}
            onChange={(e) =>
              setBuyThreshold(Math.max(0, Math.min(1e12, Number(e.target.value) || 0)))
            }
          />
        </label>
        <label>
          <input
            type='checkbox'
            checked={unpriced}
            onChange={(e) => setUnpriced(e.target.checked)}
          />
          Include unpriced assets separately
        </label>
      </div>
      {error && <p role='status'>{error}. Balances, activity and alerts remain available below.</p>}
      <section className='wallet-section'>
        <h2>Large crypto holdings</h2>
        <p>
          Observed SOL and SPL holdings, sorted by available current USD estimate. Missing quotes
          remain unpriced.
        </p>
        <div className='wallet-table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Token / mint</th>
                <th>Quantity</th>
                <th>Current value</th>
                <th>Price time</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.mint}>
                  <td>
                    <a
                      href={
                        h.mint === 'SOL'
                          ? 'https://solscan.io'
                          : `https://solscan.io/token/${h.mint}`
                      }
                      title={h.mint}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {short(h.mint)}
                    </a>
                  </td>
                  <td>{h.amount}</td>
                  <td>{usd(h.valueUsd)}</td>
                  <td>{h.priceAt ? new Date(h.priceAt).toLocaleTimeString() : 'Unavailable'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!holdings.length && <p>No observed holdings match this threshold and price coverage.</p>}
      </section>
      <section className='wallet-section'>
        <h2>Large confirmed token buys</h2>
        <p>
          Supported swaps verified by the configured provider and observed incoming token movements.
          USD size uses current quotes, not historical execution prices.
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
              {filteredBuys.map((b, i) => (
                <tr key={`${b.signature}:${b.mint}:${i}`}>
                  <td>{new Date(b.at).toLocaleString()}</td>
                  <td>
                    <a
                      href={`https://solscan.io/token/${b.mint}`}
                      title={b.mint}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {short(b.mint)}
                    </a>
                  </td>
                  <td>{b.amount.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</td>
                  <td>{usd(b.value)}</td>
                  <td>
                    <a
                      href={`https://solscan.io/tx/${b.signature}`}
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
        {!filteredBuys.length && (
          <p>No supported confirmed purchases match this threshold and price coverage.</p>
        )}
      </section>
    </>
  )
}
