import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorType,
  CrosshairMode,
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type Logical,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts'
import { CandlestickHeatmap as HeatMap, DepthHeatMap, type HeatMapChart } from './LiquidityHeatmap'
import {
  candleTimeframes,
  formatCurrency,
  formatCompact,
  type Candle,
  type CandleTimeframe,
  type DepthSnapshot,
  type LiquidationEvent,
  type StreamStatus,
} from './market-data'
import {
  LIQUIDATION_EXCHANGES,
  groupLiquidationEvents,
  type LiquidationExchange,
  type LiquidationFeedStatus,
} from '../lib/liquidation-feeds'
import { Activity, CircleHelp, ExternalLink, Eye, EyeOff, Maximize2, Minimize2 } from 'lucide-react'

type PositionedLiquidationBlock = {
  key: string
  time: UTCTimestamp
  candleIndex: number
  price: number
  side: LiquidationEvent['side']
  exchange: string
  notional: number
  count: number
  latestAt: number
  x: number
  y: number
  width: number
}
function displayLiquidationSide(side: LiquidationEvent['side']): LiquidationEvent['side'] {
  return side
}

export default function LiquidationBlock({
  status,
  feedStatus,
  depth,
  depthHistory,
  liquidations,
  candles,
  timeframe,
  onTimeframeChange,
}: {
  status: StreamStatus
  feedStatus: LiquidationFeedStatus
  depth: DepthSnapshot | null
  depthHistory: DepthSnapshot[]
  liquidations: LiquidationEvent[]
  candles: Candle[]
  timeframe: CandleTimeframe
  onTimeframeChange: (timeframe: CandleTimeframe) => void
}) {
  const [exchanges, setExchanges] = useState<LiquidationExchange[]>([...LIQUIDATION_EXCHANGES])
  const visibleLiquidations = liquidations.filter((event) =>
    exchanges.includes(event.exchange as LiquidationExchange)
  )
  const [showCandles, setShowCandles] = useState(true)
  const [showLiquidations, setShowLiquidations] = useState(true)
  const bidTotal = depth?.bids.reduce((sum, level) => sum + level.notional, 0) ?? 0
  const askTotal = depth?.asks.reduce((sum, level) => sum + level.notional, 0) ?? 0
  const recentLiquidations = [...visibleLiquidations].sort((a, b) => b.receivedAt - a.receivedAt)
  const lastLiquidation = recentLiquidations[0]
  const timeframeOption =
    candleTimeframes.find((item) => item.value === timeframe) ?? candleTimeframes[2]

  return (
    <section
      className='live-intel'
      id='live-market-intel'
      aria-label='Bitcoin liquidation block map'
    >
      <div className='live-intel-heading'>
        <div>
          <div className='section-kicker'>
            LIVE DERIVATIVES DATA <span className='live-count'>BTCUSDT</span>
          </div>
          <h2>Liquidation Block Map</h2>
          <p>Binance order book with liquidation prints from Binance, Bybit, and OKX.</p>
        </div>
        <span className={`stream-badge stream-${status}`}>
          <i /> BINANCE DEPTH ·{' '}
          {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}
        </span>
      </div>
      <div className='liquidation-exchanges' role='group' aria-label='Liquidation exchange filters'>
        {LIQUIDATION_EXCHANGES.map((exchange) => {
          const events = liquidations.filter((event) => event.exchange === exchange)
          const connected = feedStatus[exchange] === 'live'
          return (
            <button
              key={exchange}
              type='button'
              className={`liquidation-exchange ${exchanges.includes(exchange) ? 'selected' : ''}`}
              aria-pressed={exchanges.includes(exchange)}
              onClick={() =>
                setExchanges((current) =>
                  current.includes(exchange)
                    ? current.filter((item) => item !== exchange)
                    : [...current, exchange]
                )
              }
            >
              <strong>{exchange}</strong>
              <span className={connected ? 'positive' : ''}>
                {connected
                  ? 'Connected'
                  : feedStatus[exchange] === 'connecting'
                  ? 'Connecting'
                  : 'Reconnecting'}
              </span>
              <small>
                {events.length} events ·{' '}
                {formatCompact(events.reduce((sum, event) => sum + event.notional, 0))}
              </small>
            </button>
          )
        })}
      </div>
      <div className='live-metrics'>
        <div>
          <span>BTC mid price</span>
          <strong>{depth ? formatCurrency(depth.midPrice) : 'Waiting for book'}</strong>
        </div>
        <div>
          <span>Bid depth · top 20</span>
          <strong className='positive'>{bidTotal ? formatCompact(bidTotal) : '—'}</strong>
        </div>
        <div>
          <span>Ask depth · top 20</span>
          <strong className='negative'>{askTotal ? formatCompact(askTotal) : '—'}</strong>
        </div>
        <div>
          <span>Latest liquidation</span>
          <strong>
            {lastLiquidation ? formatCompact(lastLiquidation.notional) : 'No events yet'}
          </strong>
        </div>
      </div>
      <div className='live-intel-grid'>
        <div className='live-book-panel'>
          <div className='live-panel-heading'>
            <div>
              <span className='panel-overline'>BTCUSDT PERPETUAL · ORDER BOOK</span>
              <h3>Liquidity heat map</h3>
            </div>
            <span className='book-freshness'>
              {depth
                ? `Updated ${new Date(depth.updatedAt).toLocaleTimeString()}`
                : 'Awaiting depth snapshot'}
            </span>
          </div>
          <div className='heatmap-legend'>
            <span>Binance BTCUSDT perpetual · resting orders</span>
            <span className='thermal-legend'>
              <span>Lower</span>
              <i />
              <span>Higher USD liquidity</span>
            </span>
          </div>
          <div className='candle-chart-heading'>
            <strong>BTCUSD spot · {timeframe} candles</strong>
            <div className='candle-chart-controls'>
              <button
                type='button'
                className={`liquidation-visibility-toggle ${showLiquidations ? 'is-on' : ''}`}
                role='switch'
                aria-checked={showLiquidations}
                aria-label='Show liquidation blocks'
                onClick={() => setShowLiquidations((visible) => !visible)}
              >
                <span className='visibility-track'>
                  <i />
                </span>
                <span>Liquidation Blocks</span>
                {showLiquidations ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                type='button'
                className={`liquidation-visibility-toggle ${showCandles ? 'is-on' : ''}`}
                role='switch'
                aria-checked={showCandles}
                aria-label='Show candlestick chart'
                onClick={() => setShowCandles((visible) => !visible)}
              >
                <span className='visibility-track'>
                  <i />
                </span>
                <span>Candlestick Chart</span>
                {showCandles ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
          </div>
          <div className='candle-timeframes' role='group' aria-label='Candlestick timeframe'>
            {candleTimeframes.map((item) => (
              <button
                key={item.value}
                type='button'
                className={timeframe === item.value ? 'selected' : ''}
                aria-pressed={timeframe === item.value}
                onClick={() => onTimeframeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div>
            <CandlestickLiquidityChart
              candles={candles}
              liquidations={visibleLiquidations}
              depthHistory={depthHistory}
              midPrice={depth?.midPrice ?? 0}
              timeframeSeconds={timeframeOption.minutes * 60}
              showCandles={showCandles}
              showLiquidationBlocks={showLiquidations}
            />
          </div>
          <div className='live-depth-note'>
            Thermal bands show recorded Binance resting liquidity; yellow/red marks larger USD
            concentrations. Blocks show reported liquidations.
          </div>
          <DepthHeatMap depth={depth} />
        </div>

        <aside className='liquidation-panel'>
          <div className='live-panel-heading'>
            <div>
              <span className='panel-overline'>CROSS-EXCHANGE FORCE ORDERS</span>
              <h3>Live liquidations</h3>
            </div>
            <span className='event-count'>
              {visibleLiquidations.length} <small>events</small>
            </span>
          </div>
          <div className='liquidation-summary'>
            <span>
              Observed notional{' '}
              <strong>
                {formatCompact(visibleLiquidations.reduce((sum, item) => sum + item.notional, 0))}
              </strong>
            </span>
            <span>
              Latest{' '}
              <strong>
                {lastLiquidation ? new Date(lastLiquidation.receivedAt).toLocaleTimeString() : '—'}
              </strong>
            </span>
          </div>
          <div className='liquidation-table-head'>
            <span>EXCHANGE / SIDE</span>
            <span>PRICE</span>
            <span>USD / TIME</span>
          </div>
          <div className='liquidation-feed'>
            {recentLiquidations.length ? (
              recentLiquidations.slice(0, 12).map((item) => (
                <div key={item.id} className='liquidation-row'>
                  <span className={`liq-side ${item.side.toLowerCase()}`}>
                    {item.exchange} · {displayLiquidationSide(item.side)}
                  </span>
                  <strong>{formatCurrency(item.price)}</strong>
                  <span>{formatCompact(item.notional)}</span>
                  <small>{new Date(item.receivedAt).toLocaleTimeString()}</small>
                </div>
              ))
            ) : (
              <div className='liquidation-empty'>
                <Activity size={18} />
                <strong>Listening across Binance, Bybit, and OKX</strong>
                <span>Each event will show its exchange, price, dollar amount, and time.</span>
              </div>
            )}
          </div>
          <div className='liquidation-footnote'>
            Recent exchange events received this session · BTCUSDT perpetual
          </div>
        </aside>
      </div>
      <div className='live-data-caveat'>
        <CircleHelp size={13} />
        <span>
          Liquidation coverage uses Binance, Bybit, and OKX public feeds where reachable. Exchange
          buttons show subscription status and filter recorded events. Resting orders can be
          cancelled or moved; red blocks show reported events only.
        </span>
        <a
          href='https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation'
          target='_blank'
          rel='noreferrer'
        >
          Stream docs <ExternalLink size={11} />
        </a>
      </div>
    </section>
  )
}

function CandlestickLiquidityChart({
  candles,
  liquidations,
  depthHistory,
  midPrice,
  timeframeSeconds,
  showCandles,
  showLiquidationBlocks,
}: {
  candles: Candle[]
  liquidations: LiquidationEvent[]
  depthHistory: DepthSnapshot[]
  midPrice: number
  timeframeSeconds: number
  showCandles: boolean
  showLiquidationBlocks: boolean
}) {
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  async function toggleFullscreen() {
    const wrapper = fullscreenRef.current
    if (!wrapper) return
    if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen().catch(() => undefined)
    } else if (isFullscreen) {
      setIsFullscreen(false)
    } else {
      try {
        await wrapper.requestFullscreen()
      } catch {
        setIsFullscreen(true)
      }
    }
  }

  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current)
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setIsFullscreen(false)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])
  const [heatmapChart, setHeatmapChart] = useState<HeatMapChart | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ReturnType<IChartApi['addCandlestickSeries']> | null>(null)
  const fittedTimeframeRef = useRef<number | null>(null)
  const countdownPriceLineRef = useRef<IPriceLine | null>(null)
  const midPriceRef = useRef(midPrice)
  const [clock, setClock] = useState(Date.now())
  const [countdownTop, setCountdownTop] = useState<number | null>(null)
  const [priceScaleWidth, setPriceScaleWidth] = useState(104)
  const [cursorPrice, setCursorPrice] = useState<{ price: number; y: number } | null>(null)
  const [positionedBlocks, setPositionedBlocks] = useState<PositionedLiquidationBlock[]>([])
  midPriceRef.current = midPrice

  const liquidationBlocks = useMemo(() => {
    if (!showLiquidationBlocks) return []
    return groupLiquidationEvents(liquidations, candles, timeframeSeconds)
  }, [candles, liquidations, timeframeSeconds, showLiquidationBlocks])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth || 320,
      height: container.clientHeight || 300,
      layout: {
        background: { type: ColorType.Solid, color: '#141d19' },
        textColor: '#839188',
        fontFamily: 'DM Mono, monospace',
        fontSize: 12,
      },
      grid: { vertLines: { color: '#26332c' }, horzLines: { color: '#26332c' } },
      rightPriceScale: {
        borderColor: '#34433b',
        minimumWidth: 104,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#34433b',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 7,
        minBarSpacing: 0.5,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#71857a' },
        horzLine: { color: '#71857a', labelVisible: false },
      },
      localization: { priceFormatter: (price: number) => formatCurrency(price) },
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#51c69b',
      downColor: '#e27969',
      borderUpColor: '#51c69b',
      borderDownColor: '#e27969',
      wickUpColor: '#51c69b',
      wickDownColor: '#e27969',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    setHeatmapChart({ chart, series: candleSeries, container })
    const clearCursorPrice = () => setCursorPrice(null)
    const updateCursorPrice = (event: MouseEventParams) => {
      const point = event.point
      if (
        !point ||
        point.x < 0 ||
        point.y < 0 ||
        point.x >= chart.timeScale().width() ||
        point.y >= container.clientHeight - chart.timeScale().height()
      ) {
        clearCursorPrice()
        return
      }
      const price = candleSeries.coordinateToPrice(point.y)
      if (price === null || !Number.isFinite(price)) {
        clearCursorPrice()
        return
      }
      setPriceScaleWidth(chart.priceScale('right').width())
      setCursorPrice({ price, y: point.y })
    }
    chart.subscribeCrosshairMove(updateCursorPrice)
    container.addEventListener('pointerleave', clearCursorPrice)
    const resizeObserver = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect
      if (size?.width && size.height) chart.applyOptions({ width: size.width, height: size.height })
    })
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chart.unsubscribeCrosshairMove(updateCursorPrice)
      container.removeEventListener('pointerleave', clearCursorPrice)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      countdownPriceLineRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    if (!chart || !series) return
    series.setData(candles)
    if (!candles.length) fittedTimeframeRef.current = null
    if (candles.length && fittedTimeframeRef.current !== timeframeSeconds) {
      // Set the initial view once per timeframe; refreshes preserve user zoom/pan.
      const last = candles.length - 1
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - 119), to: last + 4 })
      fittedTimeframeRef.current = timeframeSeconds
    }
  }, [candles, timeframeSeconds])

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { visible: true },
      layout: { background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' } },
    })
    candleSeriesRef.current?.applyOptions({
      upColor: showCandles ? '#51c69b' : 'transparent',
      downColor: showCandles ? '#e27969' : 'transparent',
      borderUpColor: showCandles ? '#51c69b' : 'transparent',
      borderDownColor: showCandles ? '#e27969' : 'transparent',
      wickUpColor: showCandles ? '#51c69b' : 'transparent',
      wickDownColor: showCandles ? '#e27969' : 'transparent',
    })
  }, [showCandles])

  useEffect(() => {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const container = containerRef.current
    if (!chart || !series || !container) return

    const updateBlocks = () => {
      const blocks = liquidationBlocks.flatMap((block) => {
        const x = chart.timeScale().logicalToCoordinate(block.candleIndex as Logical)
        const y = series.priceToCoordinate(block.price)
        if (
          x === null ||
          y === null ||
          x < 0 ||
          x > chart.timeScale().width() ||
          y < 0 ||
          y > container.clientHeight
        )
          return []
        const width = 24
        const venueOffset = Math.max(0, ['Binance', 'Bybit', 'OKX'].indexOf(block.exchange)) * 28
        const sideOffset =
          (block.side === 'Long' ? -18 : 18) + (block.side === 'Long' ? -venueOffset : venueOffset)
        return [
          {
            ...block,
            x: Math.max(width / 2, Math.min(container.clientWidth - width / 2, x + sideOffset)),
            y: Math.max(13, Math.min(container.clientHeight - 13, y)),
            width,
          },
        ]
      })
      setPositionedBlocks(blocks)
    }

    updateBlocks()
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateBlocks)
    const timer = window.setInterval(updateBlocks, 1_000)
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateBlocks)
      window.clearInterval(timer)
    }
  }, [liquidationBlocks])

  function zoomCandles(factor: number) {
    const scale = chartRef.current?.timeScale()
    const range = scale?.getVisibleLogicalRange()
    if (!scale || !range) return
    const span = Math.max(10, Math.min(candles.length + 8, (range.to - range.from) * factor))
    scale.setVisibleLogicalRange({ from: range.to - span, to: range.to })
  }

  function positionTooltip(block: HTMLDivElement) {
    const container = containerRef.current
    const tooltip = block.querySelector<HTMLElement>('.liquidation-tooltip')
    if (!container || !tooltip) return
    const bounds = container.getBoundingClientRect()
    const target = block.getBoundingClientRect()
    const gap = 10,
      margin = 8
    tooltip.style.width = `${Math.max(0, Math.min(220, bounds.width - margin * 2))}px`
    const popup = tooltip.getBoundingClientRect()
    const right = target.right - bounds.left + gap
    const left = target.left - bounds.left - gap - popup.width
    // Prefer the right side, then flip left near the chart's right edge.
    const preferred = right + popup.width <= bounds.width - margin ? right : left
    const x = Math.max(margin, Math.min(bounds.width - popup.width - margin, preferred))
    const y = Math.max(
      margin,
      Math.min(
        bounds.height - popup.height - margin,
        (target.top + target.bottom) / 2 - bounds.top - popup.height / 2
      )
    )
    tooltip.style.left = `${x + bounds.left - target.left}px`
    tooltip.style.top = `${y + bounds.top - target.top}px`
  }

  const lastCandle = candles[candles.length - 1]
  const closeAt = lastCandle ? (Number(lastCandle.time) + timeframeSeconds) * 1_000 : 0
  const secondsToClose = closeAt ? Math.max(0, Math.ceil((closeAt - clock) / 1_000)) : 0
  const hoursToClose = Math.floor(secondsToClose / 3_600)
  const minutesToClose = Math.floor((secondsToClose % 3_600) / 60)
  const secondsRemainder = secondsToClose % 60
  const countdown =
    hoursToClose > 0
      ? `${String(hoursToClose).padStart(2, '0')}:${String(minutesToClose).padStart(
          2,
          '0'
        )}:${String(secondsRemainder).padStart(2, '0')}`
      : `${String(minutesToClose).padStart(2, '0')}:${String(secondsRemainder).padStart(2, '0')}`

  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series || !lastCandle) return
    const price = midPriceRef.current || lastCandle.close
    const options = {
      price,
      color: '#f5f7f5',
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      axisLabelColor: '#f5f7f5',
      axisLabelTextColor: '#101916',
      title: '',
    }
    if (countdownPriceLineRef.current) countdownPriceLineRef.current.applyOptions(options)
    else countdownPriceLineRef.current = series.createPriceLine(options)
    setCountdownTop(series.priceToCoordinate(price))
    const scaleWidth = chartRef.current?.priceScale('right').width()
    if (scaleWidth) setPriceScaleWidth(scaleWidth)
  }, [candles, countdown, lastCandle])

  return (
    <div
      ref={fullscreenRef}
      className={`candle-chart-wrap is-heatmap${isFullscreen ? ' is-expanded' : ''}`}
    >
      <div className='candle-history-controls' role='group' aria-label='Candle history zoom'>
        <button
          type='button'
          onClick={() => zoomCandles(1.5)}
          aria-label='Zoom out to see more candles'
        >
          −
        </button>
        <button type='button' onClick={() => zoomCandles(1 / 1.5)} aria-label='Zoom in on candles'>
          +
        </button>
        <button type='button' onClick={() => chartRef.current?.timeScale().fitContent()}>
          Fit history
        </button>
        <span>{candles.length} candles</span>
      </div>
      <div className='candle-chart' ref={containerRef}>
        {!candles.length && <div className='candle-chart-loading'>Loading recent BTC candles…</div>}
        {heatmapChart && (
          <HeatMap chartContext={heatmapChart} depthHistory={depthHistory} candles={candles} />
        )}
        {showLiquidationBlocks && (
          <div className='liquidation-overlay'>
            {positionedBlocks.map((block) => (
              <div
                key={block.key}
                className={`liquidation-block ${block.side.toLowerCase()}`}
                style={{ left: `${block.x}px`, top: `${block.y}px`, width: `${block.width}px` }}
                onPointerEnter={(event) => positionTooltip(event.currentTarget)}
                onPointerMove={(event) => positionTooltip(event.currentTarget)}
                onFocus={(event) => positionTooltip(event.currentTarget)}
                role='button'
                tabIndex={0}
                aria-label={`${displayLiquidationSide(block.side)} liquidation at ${formatCurrency(
                  block.price
                )}, ${formatCurrency(block.notional)} on ${block.exchange}`}
              >
                <span className='liquidation-venue-label' aria-hidden='true'>
                  {block.exchange === 'Binance'
                    ? 'BIN'
                    : block.exchange === 'Bybit'
                    ? 'BYB'
                    : block.exchange}
                </span>
                <span className='liquidation-tooltip' role='tooltip'>
                  <strong>{formatCurrency(block.price)}</strong>
                  <span>Liquidated {formatCurrency(block.notional)}</span>
                  <small>
                    {displayLiquidationSide(block.side)} · {block.exchange}
                  </small>
                  <small>
                    {block.count} event{block.count === 1 ? '' : 's'} ·{' '}
                    {new Date(block.latestAt).toLocaleTimeString()}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}
        {lastCandle && (
          <aside
            className='candle-close-rail'
            aria-live='off'
            style={{ top: `${countdownTop ?? 8}px`, width: `${priceScaleWidth}px` }}
          >
            <strong className='candle-close-price'>
              {formatCurrency(midPrice || lastCandle.close)}
            </strong>
            <div className='candle-close-time'>
              <span>:</span>
              <strong>{countdown}</strong>
            </div>
          </aside>
        )}
        {cursorPrice && (
          <div
            className='candle-cursor-price'
            style={{ top: `${cursorPrice.y}px`, width: `${priceScaleWidth}px` }}
          >
            {formatCurrency(cursorPrice.price)}
          </div>
        )}
      </div>
      <button
        type='button'
        className='chart-fullscreen-button'
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Make chart fullscreen'}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Make chart fullscreen'}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
      </button>
    </div>
  )
}
