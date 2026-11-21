import { useEffect, useState } from 'react'
import type { SonarDefi as Snapshot } from '../lib/sonar-defi'
import type { MarketSnapshot } from '../lib/market-snapshot'
import { formatCompact } from './market-data'
export default function SonarDefi() {
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true)
  const [sentiment, setSentiment] = useState<MarketSnapshot['sentiment']>(null)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const request = async (url: string) => {
          const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          })
          if (!response.ok) throw Error()
          return response.json()
        }
        await Promise.allSettled([
          request('/api/market/defi')
            .then((snapshot: Snapshot) => {
              if (!controller.signal.aborted) setData(snapshot)
            })
            .catch(() => {
              if (!controller.signal.aborted) setData(null)
            }),
          request('/api/market/snapshot')
            .then((snapshot: MarketSnapshot) => {
              const value = snapshot.sentiment
              if (!controller.signal.aborted)
                setSentiment(
                  value &&
                    Number.isInteger(value.value) &&
                    value.value >= 0 &&
                    value.value <= 100 &&
                    value.at <= Date.now() + 60000 &&
                    Date.now() - value.at <= 48 * 3600000
                    ? value
                    : null
                )
            })
            .catch(() => {
              if (!controller.signal.aborted) setSentiment(null)
            }),
        ])
      } catch {
        if (!controller.signal.aborted) setData(null)
      } finally {
        pending = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 300000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])
  const metrics = [
    { label: 'ETHEREUM TVL', row: data?.ethereum, value: data?.ethereum?.tvl },
    { label: 'SOLANA TVL', row: data?.solana, value: data?.solana?.tvl },
    { label: 'REPORTED DEX VOLUME · 24H', row: data?.dex, value: data?.dex?.volume24h },
  ]
  return (
    <section className='sonar-section' aria-label='DeFi and market sentiment context'>
      <div className='section-kicker'>
        DEFI CONTEXT ·{' '}
        <a href='https://defillama.com' target='_blank' rel='noreferrer'>
          DefiLlama ↗
        </a>
      </div>
      <p className='sonar-muted'>
        Total value locked (TVL) and reported DEX activity. Refreshes every 5 minutes. DEX volume
        covers tracked decentralized exchanges; it is separate from CoinGecko market volume.
      </p>
      <div className='sonar-pulse'>
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>
              {metric.value === undefined
                ? loading
                  ? 'Loading…'
                  : 'Unavailable'
                : formatCompact(metric.value)}
            </strong>
            <small>
              {metric.row
                ? `Fetched ${new Date(metric.row.fetchedAt).toLocaleTimeString()}`
                : 'Waiting for provider data'}
            </small>
          </article>
        ))}
        <article>
          <span>FEAR &amp; GREED INDEX · DAILY BTC</span>
          <div className='sonar-fear-greed-score'>
            <strong>
              {sentiment ? (
                <>
                  {sentiment.value}
                  <span className='sonar-fear-greed-total'> / 100</span>
                </>
              ) : loading ? (
                'Loading…'
              ) : (
                'Unavailable'
              )}
            </strong>
            {sentiment && (
              <div
                className='sonar-fear-greed-meter'
                role='meter'
                aria-label='Bitcoin Fear and Greed Index'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={sentiment.value}
                aria-valuetext={`${sentiment.value} out of 100: ${sentiment.label}`}
              >
                <div className='sonar-fear-greed-track'>
                  <i style={{ left: `${sentiment.value}%` }} />
                </div>
                <div className='sonar-fear-greed-labels' aria-hidden='true'>
                  <span>Fear</span>
                  <span>Greed</span>
                </div>
              </div>
            )}
          </div>
          <small>
            {sentiment
              ? `${sentiment.label} · Published ${new Date(sentiment.at).toLocaleString()}`
              : 'Waiting for sentiment data'}
            <br />
            <a
              href='https://alternative.me/crypto/fear-and-greed-index/'
              target='_blank'
              rel='noreferrer'
            >
              Alternative.me ↗
            </a>
          </small>
        </article>
      </div>
    </section>
  )
}
