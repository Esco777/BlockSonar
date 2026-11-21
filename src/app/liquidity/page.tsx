'use client'

import { MAX_FRAMES } from '../../lib/liquidity-stream'

import { useEffect, useState, type ComponentProps } from 'react'
import LiquidityHeatmap from '../../components/LiquidityHeatmap'
import LiquidationBlock from '../../components/liquidation-block'
import { formatCurrency } from '../../components/market-data'
import {
  LIQUIDITY_FEEDS,
  feedKey,
  liquidityMarketFeed,
  type LiquidityExchange,
} from '../../lib/liquidity-exchanges'
import { rankLiquidityZones } from '../../lib/sonar-walls'
import type { Market } from '../../lib/liquidity-types'
import {
  appendLiquidityFrame,
  parseLiquidityFrame,
  type LiquidityHistory,
} from '../../lib/liquidity-stream'

export type LiquidityPageProps = ComponentProps<typeof LiquidationBlock> & {
  showLiquidationsRequest?: number
}

export default function LiquidityPage(props: LiquidityPageProps) {
  const [view, setView] = useState<'thermal' | 'liquidations'>('thermal')
  useEffect(() => {
    if (props.showLiquidationsRequest) setView('liquidations')
  }, [props.showLiquidationsRequest])
  const [asset, setAsset] = useState<'BTC' | 'ETH' | 'SOL'>('BTC')
  const [market, setMarket] = useState<Market>('spot')
  const [exchange, setExchange] = useState<LiquidityExchange>('coinbase')
  const [frames, setFrames] = useState<LiquidityHistory>({})
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting'
  )
  const [minimumWall, setMinimumWall] = useState(0)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const selectedFeed = LIQUIDITY_FEEDS.find(
    (feed) => feed.exchange === exchange && feed.market === market && feed.symbol.startsWith(asset)
  )!
  useEffect(() => {
    setConnection('connecting')
    setFeedError(null)
    const source = new EventSource(
      `/api/liquidity/stream?exchange=${exchange}&market=${market}&symbol=${encodeURIComponent(
        selectedFeed.symbol
      )}`
    )
    source.addEventListener('feed-status', (event) => {
      try {
        const status = JSON.parse(event.data)
        setFeedError(typeof status.error === 'string' ? status.error : null)
      } catch {
        /* Ignore malformed status messages. */
      }
    })
    source.onopen = () => setConnection('connected')
    source.onerror = () => setConnection('disconnected')
    source.onmessage = (event) => {
      const frame = parseLiquidityFrame(event.data)
      if (frame && feedKey(frame) === feedKey(selectedFeed))
        setFrames((previous) => appendLiquidityFrame(previous, frame))
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      source.close()
      window.clearInterval(timer)
    }
  }, [exchange, market, asset])

  const visible = frames[feedKey(selectedFeed)] ?? []
  const latest = visible.at(-1)
  const stale = !!latest && now - latest.time > 15_000
  const walls = rankLiquidityZones(latest, minimumWall)
  const quoteAmount = (amount: number) =>
    `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${
      selectedFeed.quote
    }`
  const status = feedError
    ? feedError
    : connection !== 'connected'
    ? connection === 'connecting'
      ? 'Connecting'
      : 'Disconnected · reconnecting'
    : !latest
    ? 'Connected · waiting for synchronized data'
    : stale
    ? 'Stale data · waiting for updates'
    : 'Stream live'

  return (
    <div className='liquidity-page liquidity-terminal'>
      <header className='liquidity-terminal-header'>
        <div>
          <div className='section-kicker'>BLOCKSONAR</div>
          <h1>Liquidity Intelligence Terminal</h1>
        </div>
        <span
          role='status'
          className={`liquidity-connection ${
            connection === 'connected' && latest && !stale && !feedError
              ? 'positive'
              : 'liquidity-muted'
          }`}
        >
          ● {status}
        </span>
      </header>
      <div className='liquidity-terminal-tabs' role='group' aria-label='Liquidity page view'>
        <button type='button' aria-pressed={view === 'thermal'} onClick={() => setView('thermal')}>
          Liquidity Heatmap
        </button>
        <button
          type='button'
          aria-pressed={view === 'liquidations'}
          onClick={() => setView('liquidations')}
        >
          Liquidation Blocks
        </button>
      </div>

      {view === 'thermal' ? (
        <>
          <div className='liquidity-terminal-tabs' role='group' aria-label='Liquidity asset'>
            {(
              [
                { id: 'BTC', name: 'Bitcoin' },
                { id: 'ETH', name: 'Ethereum' },
                { id: 'SOL', name: 'Solana' },
              ] as const
            ).map((option) => (
              <button
                type='button'
                key={option.id}
                aria-pressed={asset === option.id}
                onClick={() => {
                  const next = liquidityMarketFeed(option.id, market, exchange)
                  setAsset(option.id)
                  setExchange(next.exchange)
                  setMarket(next.market)
                }}
              >
                {option.name}
              </button>
            ))}
          </div>
          <div className='liquidity-terminal-tabs' role='group' aria-label='Exchange and market'>
            <label className='liquidity-exchange-select'>
              Exchange{' '}
              <select
                value={exchange}
                onChange={(event) => {
                  const next = event.target.value as LiquidityExchange
                  setExchange(next)
                  if (
                    !LIQUIDITY_FEEDS.some(
                      (feed) =>
                        feed.exchange === next &&
                        feed.market === market &&
                        feed.symbol.startsWith(asset)
                    )
                  )
                    setMarket('spot')
                }}
              >
                {(['coinbase', 'bybit', 'gemini', 'okx', 'binance'] as const)
                  .filter((value) =>
                    LIQUIDITY_FEEDS.some(
                      (feed) => feed.exchange === value && feed.symbol.startsWith(asset)
                    )
                  )
                  .map((value) => (
                    <option key={value} value={value}>
                      {LIQUIDITY_FEEDS.find((feed) => feed.exchange === value)!.name}
                    </option>
                  ))}
              </select>
            </label>
            <span className='liquidity-symbol'>{selectedFeed.symbol}</span>
            {(['spot', 'futures'] as const)
              .filter((option) =>
                LIQUIDITY_FEEDS.some(
                  (feed) => feed.market === option && feed.symbol.startsWith(asset)
                )
              )
              .map((option) => (
                <button
                  key={option}
                  type='button'
                  aria-pressed={market === option}
                  onClick={() => {
                    const next = liquidityMarketFeed(asset, option, exchange)
                    setExchange(next.exchange)
                    setMarket(next.market)
                  }}
                >
                  {option === 'spot' ? 'Spot' : 'USDT-M Futures'}
                </button>
              ))}
          </div>
          <div className='liquidity-terminal-grid'>
            <section className='liquidity-terminal-panel' aria-label='Thermal liquidity heatmap'>
              <div className='liquidity-panel-title'>
                <h2>Thermal Liquidity Heatmap</h2>
                <span className='positive'>
                  {latest ? formatCurrency(latest.price) : 'Waiting for data'}
                </span>
              </div>
              {visible.length ? (
                <LiquidityHeatmap frames={visible} />
              ) : (
                <div className='liquidity-waiting' role='status'>
                  {feedError ??
                    (connection === 'disconnected'
                      ? 'Reconnecting to the liquidity server…'
                      : 'Waiting for synchronized exchange order-book data…')}
                </div>
              )}
              <div className='thermal-legend liquidity-thermal-legend'>
                <span>Lower</span>
                <i />
                <span>Higher {selectedFeed.quote} liquidity</span>
              </div>
              {latest && (
                <p className='liquidity-muted'>
                  {stale || connection !== 'connected' ? 'Last received' : 'Updated'}{' '}
                  {new Date(latest.time).toLocaleTimeString()} · {selectedFeed.name} {market} ·{' '}
                  {selectedFeed.quote} quoted
                </p>
              )}
            </section>
            <aside className='liquidity-terminal-panel' aria-label='Sonar Walls'>
              <div className='liquidity-panel-title'>
                <h2>Sonar Walls</h2>
              </div>
              <p className='liquidity-muted'>
                Top 10 price zones by total resting liquidity · {selectedFeed.quote}
              </p>
              <label className='sonar-wall-threshold'>
                Minimum {selectedFeed.quote}
                <input
                  type='number'
                  min='0'
                  step='10000'
                  value={minimumWall}
                  onChange={(event) => setMinimumWall(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
              {(stale || feedError || connection === 'disconnected') && latest && (
                <p className='liquidity-muted'>Last received liquidity · waiting for fresh data</p>
              )}
              {!walls.length && (
                <p className='liquidity-muted'>
                  {latest
                    ? 'No zones above this threshold. Lower the minimum to see smaller concentrations.'
                    : 'Waiting for synchronized order-book data…'}
                </p>
              )}
              <div className='sonar-wall-list'>
                {walls.map((wall, index) => (
                  <div
                    key={wall.price}
                    className={`sonar-wall-card ${index === 0 ? 'sonar-wall-largest' : ''}`}
                  >
                    <span className={wall.bidUsd >= wall.askUsd ? 'positive' : 'negative'}>
                      {index === 0 ? 'LARGEST ZONE · ' : ''}
                      {wall.bidUsd && wall.askUsd
                        ? 'BIDS + ASKS'
                        : wall.bidUsd
                        ? 'BUY LIMIT ZONE'
                        : 'SELL LIMIT ZONE'}
                    </span>
                    <strong>
                      {wall.price.toLocaleString('en-US')}–{wall.upperPrice.toLocaleString('en-US')}{' '}
                      {selectedFeed.quote}
                    </strong>
                    <strong className='sonar-wall-notional'>{quoteAmount(wall.notional)}</strong>
                    <span className='liquidity-muted'>Bids: {quoteAmount(wall.bidUsd)}</span>
                    <span className='liquidity-muted'>Asks: {quoteAmount(wall.askUsd)}</span>
                    <div className='sonar-wall-strength' aria-hidden='true'>
                      <span style={{ width: `${(wall.notional / walls[0].notional) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className='liquidity-muted'>
                Aggregated price buckets, matching the heatmap. Amounts are visible resting
                liquidity, not individual orders.
              </p>
            </aside>
          </div>
          <p className='liquidity-terminal-footnote'>
            Visible resting limit orders only. Data covers the selected {selectedFeed.name} {market}{' '}
            book, with up to {selectedFeed.depth} visible levels per side. USD and USDT books are
            kept separate; USDT amounts are quote notional, not converted USD. Historical heatmap
            data begins when the collector starts; the most recent {MAX_FRAMES} frames per asset,
            exchange and market are retained in memory.
          </p>
        </>
      ) : (
        <LiquidationBlock {...props} />
      )}
    </div>
  )
}
