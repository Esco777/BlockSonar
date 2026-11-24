import { useEffect, useState } from 'react'
import { formatCompact } from './market-data'
import {
  GLOBAL_MARKET_DELAY_MS,
  GLOBAL_MARKET_MAX_AGE_MS,
  GLOBAL_MARKET_REFRESH_MS,
  type MarketSnapshot as Snapshot,
} from '../lib/market-snapshot'
export default function MarketSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null),
    [failed, setFailed] = useState(false),
    [clock, setClock] = useState(Date.now())
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/market/snapshot', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        })
        if (!response.ok) throw Error()
        const snapshot = await response.json()
        if (active) {
          setData(snapshot)
          setFailed(false)
          setClock(Date.now())
        }
      } catch {
        if (active) {
          setFailed(true)
        }
      } finally {
        pending = false
      }
    }
    void load()
    const timer = window.setInterval(() => {
      setClock(Date.now())
      void load()
    }, GLOBAL_MARKET_REFRESH_MS)
    return () => {
      active = false
      controller.abort()
      clearInterval(timer)
    }
  }, [])
  const global = data?.global && clock - data.global.at <= GLOBAL_MARKET_MAX_AGE_MS ? data.global : null,
    breadth = data?.breadth && clock - data.breadth.at <= 600000 ? data.breadth : null,
    sentiment = data?.sentiment && clock - data.sentiment.at <= 48 * 3600000 ? data.sentiment : null
  const unavailable = !data && !failed ? 'Loading…' : 'Unavailable'
  const date = (at: number) => new Date(at).toLocaleString()
  const globalDelayed = global && (failed || clock - global.at > GLOBAL_MARKET_DELAY_MS || data?.errors.includes('Global market totals unavailable'))
  const globalDetail = (value: number | null) =>
    globalDelayed ? <small>Delayed · CoinGecko</small> : change(value)
  const change = (value: number | null | undefined) =>
    value == null ? (
      <small>24h change unavailable</small>
    ) : (
      <small className={value >= 0 ? 'positive' : 'negative'}>
        {value >= 0 ? '+' : ''}
        {value.toFixed(2)}% · 24h
      </small>
    )
  return (
    <section className='market-strip' aria-label='Market summary' aria-live='polite'>
      <div className='strip-intro'>
        <span className='strip-label'>MARKET SNAPSHOT</span>
        <span className='strip-date'>{new Date(clock).toLocaleDateString()}</span>
        <span className='strip-date'>Checks CoinGecko every {GLOBAL_MARKET_REFRESH_MS / 1000}s</span>
        {global && <span className='strip-date'>Totals updated {new Date(global.at).toLocaleTimeString()}</span>}
      </div>
      <div
        className='market-metric'
        title={
          global ? `CoinGecko · Updated ${date(global.at)}` : 'CoinGecko global totals unavailable'
        }
      >
        <span>Total market cap</span>
        <strong>{global ? formatCompact(global.marketCap) : unavailable}</strong>
        {global ? globalDetail(global.capChange) : <small>CoinGecko</small>}
      </div>
      <div
        className='market-metric'
        title={
          global ? `CoinGecko · Updated ${date(global.at)}` : 'CoinGecko global volume unavailable'
        }
      >
        <span>24h volume</span>
        <strong>{global ? formatCompact(global.volume) : unavailable}</strong>
        {global ? globalDetail(global.volumeChange) : <small>CoinGecko</small>}
      </div>
      <div
        className='market-metric breadth-metric'
        title={
          breadth
            ? `CoinGecko top 100 by market cap; ${breadth.total} valid observations. ${
                breadth.declining
              } declining, ${breadth.unchanged} unchanged. Oldest observation ${date(breadth.at)}`
            : 'Top-100 breadth unavailable'
        }
      >
        <span>Market breadth</span>
        <strong>
          {breadth ? (
            <>
              {breadth.advancing}
              <small> / {breadth.total} advancing</small>
            </>
          ) : (
            unavailable
          )}
        </strong>
        <small>Top 100 · 24h · CoinGecko</small>
        {breadth && (
          <div className='breadth-track'>
            <i style={{ width: `${(breadth.advancing / breadth.total) * 100}%` }} />
          </div>
        )}
      </div>
      <div
        className='market-metric sentiment-metric'
        title={
          sentiment
            ? `Bitcoin Fear & Greed · Daily index · Published ${date(sentiment.at)}`
            : 'Daily Bitcoin sentiment unavailable'
        }
      >
        <span>Sentiment index</span>
        <strong>
          {sentiment ? (
            <>
              {sentiment.value}
              <small> {sentiment.label}</small>
            </>
          ) : (
            unavailable
          )}
        </strong>
        <small>
          <a
            href='https://alternative.me/crypto/fear-and-greed-index/'
            target='_blank'
            rel='noreferrer'
          >
            Alternative.me · Daily BTC
          </a>
        </small>
        {sentiment && (
          <div className='sentiment-track'>
            <i style={{ left: `${sentiment.value}%` }} />
          </div>
        )}
      </div>
    </section>
  )
}
