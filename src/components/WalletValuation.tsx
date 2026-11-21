import { useEffect, useState } from 'react'
import type { WalletValuation as Valuation } from '../lib/wallet-valuation'
const usd = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(value)
export default function WalletValuation({
  address,
  balancesAt,
}: {
  address: string
  balancesAt: number | undefined
}) {
  const [data, setData] = useState<Valuation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    setLoading(true)
    void (async () => {
      try {
        const response = await fetch(
          `/api/wallet-tracker/valuation?address=${encodeURIComponent(address)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }
        )
        const value = await response.json()
        if (!response.ok || !value.available)
          throw new Error(value.error ?? 'DefiLlama valuation unavailable')
        if (!controller.signal.aborted) setData(value)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'DefiLlama valuation unavailable')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [address, balancesAt])
  return (
    <section className='wallet-section' aria-label='DefiLlama wallet valuation'>
      <h2>Holdings value · DefiLlama</h2>
      <p>
        Market prices for observed wallet balances. Values exclude DeFi positions, NFTs, and
        unobserved assets.
      </p>
      {loading && <p role='status'>Loading DefiLlama prices…</p>}
      {error && <p role='status'>{error}. Activity tracking continues.</p>}
      {data && (
        <>
          <p>
            <strong>
              {data.totalUsd !== null
                ? `Observed holdings: ${usd(data.totalUsd)}`
                : `Priced holdings subtotal: ${usd(data.pricedSubtotalUsd)}`}
            </strong>{' '}
            · {data.pricedCount} of {data.balances.length} balance entries priced
            {data.unpricedCount > 0 ? ` · ${data.unpricedCount} unavailable` : ''}
          </p>
          {data.error && <p role='status'>{data.error}</p>}
          <p className='discover-context'>
            Balances observed{' '}
            {data.balancesAt ? new Date(data.balancesAt).toLocaleString() : 'at an unknown time'} ·
            prices checked {new Date(data.at).toLocaleString()}. Native SOL uses the wrapped SOL
            market quote.
          </p>
          <div className='wallet-table-wrap'>
            <table>
              <thead>
                <tr>
                  <th>Token / mint</th>
                  <th>Balance</th>
                  <th>Price USD</th>
                  <th>Value USD</th>
                  <th>Price timestamp / coverage</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((row, i) => (
                  <tr key={`${row.mint}:${i}`}>
                    <td>{row.mint}</td>
                    <td>{row.amount}</td>
                    <td>{usd(row.priceUsd)}</td>
                    <td>{usd(row.valueUsd)}</td>
                    <td>
                      {row.reason ??
                        (row.priceAt ? new Date(row.priceAt).toLocaleString() : 'Unavailable')}
                      {row.confidence !== null && (
                        <small>Price confidence: {Math.round(row.confidence * 100)}%</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Missing, low-confidence, or stale prices are excluded. These estimates do not establish
            profit or cost basis.
          </p>
        </>
      )}
      <a href='https://defillama.com' target='_blank' rel='noreferrer'>
        Price data by DefiLlama ↗
      </a>
    </section>
  )
}
