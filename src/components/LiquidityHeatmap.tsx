"use client";

import { liquidityPixelDirection, liquidityPixelOffset, type LiquidityPixelDirection } from '../lib/liquidity-impact'
import { candleRequest, parseHeatmapCandles, type HeatmapCandle } from '../lib/heatmap-candles'

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { IChartApi, Logical } from 'lightweight-charts'
import { formatCurrency, formatCompact, type Candle, type DepthSnapshot } from './market-data'

import { horizontalLiquidityBands, sampledCandles, liquiditySampleAt, liquidityReductions, heatmapWindowDuration } from '../lib/heatmap-layout'

import type { LiquidityMarket, LiquiditySymbol, LiquidityFrame } from '../lib/liquidity-types'

export type HeatMapMarket = LiquidityMarket
export type HeatMapSymbol = LiquiditySymbol

export function HeatMapMarketSelector({ symbol, market, onSymbolChange, onMarketChange }: {
  symbol: HeatMapSymbol
  market: HeatMapMarket
  onSymbolChange: (symbol: HeatMapSymbol) => void
  onMarketChange: (market: HeatMapMarket) => void
}) {
  return <div className="heatmap-market-toolbar">
    <label>Symbol<select value={symbol} onChange={(event) => onSymbolChange(event.target.value as HeatMapSymbol)}>
      <option value="BTCUSDT">BTCUSDT</option>
      <option value="ETHUSDT">ETHUSDT</option>
      <option value="SOLUSDT">SOLUSDT</option>
    </select></label>
    <label>Market<select value={market} onChange={(event) => onMarketChange(event.target.value as HeatMapMarket)}>
      <option value="spot">Spot</option>
      <option value="futures">USDT-M Perpetual Futures</option>
    </select></label>
  </div>
}

export type HeatMapChart = {
  chart: IChartApi
  series: ReturnType<IChartApi['addCandlestickSeries']>
  container: HTMLDivElement
}

export function CandlestickHeatmap({ chartContext, depthHistory, candles }: {
  chartContext: HeatMapChart
  depthHistory: DepthSnapshot[]
  candles: Candle[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const { container, chart, series } = chartContext
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const drawHeatmap = () => {
      const ratio = window.devicePixelRatio || 1
      const width = container.clientWidth
      const height = container.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (!depthHistory.length || !candles.length) return
      const samples = depthHistory.slice(-300)
      const bucketSize = 5
      const buckets = samples.map((snapshot) => {
        const levels = new Map<number, number>()
        for (const level of [...snapshot.bids, ...snapshot.asks]) {
          const price = Math.round(level.price / bucketSize) * bucketSize
          levels.set(price, (levels.get(price) ?? 0) + level.notional)
        }
        return [...levels].map(([price, notional]) => ({ price, notional }))
      })
      const maxNotional = Math.max(1, ...buckets.flatMap((levels) => levels.map((level) => level.notional)))
      const interval = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 60
      // Map recorded exchange timestamps to the candle axis, including the current open candle.
      const xAt = (timestamp: number) => {
        const seconds = timestamp / 1000
        let index = candles.length - 1
        while (index > 0 && candles[index].time > seconds) index -= 1
        const duration = candles[index + 1] ? candles[index + 1].time - candles[index].time : interval
        return chart.timeScale().logicalToCoordinate((index + (seconds - candles[index].time) / duration) as Logical)
      }
      const plotWidth = chart.timeScale().width()
      const plotHeight = height - (chart.timeScale().options().visible ? chart.timeScale().height() : 0)
      context.save()
      context.beginPath()
      context.rect(0, 0, plotWidth, plotHeight)
      context.clip()
      samples.forEach((snapshot, index) => {
        const x = xAt(snapshot.updatedAt)
        // Never paint an old snapshot across an outage or backfill unobserved history.
        const end = Math.min(samples[index + 1]?.updatedAt ?? snapshot.updatedAt + 1000, snapshot.updatedAt + 2000)
        const nextX = xAt(end)
        if (x === null || nextX === null || nextX < 0 || x > plotWidth) return
        const cellWidth = Math.max(1, nextX - x)
        buckets[index].forEach((level) => {
          const y = series.priceToCoordinate(level.price)
          const upper = series.priceToCoordinate(level.price + bucketSize / 2)
          const lower = series.priceToCoordinate(level.price - bucketSize / 2)
          if (y === null || upper === null || lower === null || y < 0 || y > plotHeight) return
          const strength = Math.sqrt(level.notional / maxNotional)
          if (strength < .12) return
          // Purple → blue → green → yellow → red as observed USD liquidity increases.
          const stops = [[61, 17, 112], [35, 72, 231], [0, 201, 156], [240, 235, 40], [255, 53, 30]]
          const scaled = Math.min(stops.length - 1, strength * (stops.length - 1))
          const base = Math.min(stops.length - 2, Math.floor(scaled))
          const mix = scaled - base
          const rgb = stops[base].map((value, channel) => Math.round(value + (stops[base + 1][channel] - value) * mix))
          const color = `rgba(${rgb.join(',')}, ${.15 + strength * .65})`
          const bandHeight = Math.max(3, Math.abs(lower - upper))
          context.fillStyle = color
          context.shadowColor = color
          context.shadowBlur = strength > .65 ? 7 : 0
          context.fillRect(x, y - bandHeight / 2, cellWidth, bandHeight)
        })
      })
      context.restore()
    }

    let frame = 0
    const scheduleDraw = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawHeatmap() })
    }

    const resizeObserver = new ResizeObserver(scheduleDraw)
    resizeObserver.observe(container)
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw)
    container.addEventListener('wheel', scheduleDraw, { passive: true })
    container.addEventListener('pointermove', scheduleDraw)
    const refresh = window.setInterval(scheduleDraw, 500)
    scheduleDraw()
    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(refresh)
      container.removeEventListener('wheel', scheduleDraw)
      container.removeEventListener('pointermove', scheduleDraw)
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw)
    }
  }, [candles, chartContext, depthHistory])

  return <>
    <canvas className="orderbook-heatmap-canvas" ref={canvasRef} aria-label="Recent order-book liquidity heatmap" />

  </>
}

export function DepthHeatMap({ depth }: { depth: DepthSnapshot | null }) {
  const allLevels = [...(depth?.bids ?? []), ...(depth?.asks ?? [])]
  const maxNotional = Math.max(1, ...allLevels.map((level) => level.notional))
  const rows = depth ? [
    ...depth.asks.slice().reverse().map((level) => ({ side: 'ask' as const, level })),
    { side: 'mid' as const, level: { price: depth.midPrice, quantity: 0, notional: 0 } },
    ...depth.bids.map((level) => ({ side: 'bid' as const, level })),
  ] : []
  const zones = depth ? [
    ...depth.asks.map((level) => ({ ...level, side: 'ask' as const })),
    ...depth.bids.map((level) => ({ ...level, side: 'bid' as const })),
  ].sort((a, b) => b.notional - a.notional).slice(0, 4) : []
  const zoneKeys = new Set(zones.map((zone) => `${zone.side}-${zone.price}`))

  return <>
        <div className="heatmap-axis"><span>ASK DEPTH</span><span>PRICE</span><span>BID DEPTH</span></div>
        <div className="heatmap-rows">{rows.length ? rows.map(({ side, level }) => {
          const intensity = level.notional / maxNotional
          const width = `${Math.max(3, intensity * 100)}%`
          const isZone = zoneKeys.has(`${side}-${level.price}`)
          return <div key={`${side}-${level.price}`} className={`heatmap-row ${side === 'mid' ? 'mid-row' : ''} ${isZone ? 'zone-hot' : ''}`}>
            <div className="heatmap-cell ask-cell">{side === 'ask' && <span style={{ width, opacity: .3 + intensity * .7 }} />}</div>
            <span className="heatmap-price">{side === 'mid' ? 'MID' : formatCurrency(level.price)}</span>
            <div className="heatmap-cell bid-cell">{side === 'bid' && <span style={{ width, opacity: .3 + intensity * .7 }} />}</div>
          </div>
        }) : <div className="heatmap-empty">Connecting to the live BTC order book…</div>}</div>
        <div className="liquidity-zones"><div className="zones-heading"><strong>Nearby liquidity zones</strong><span>Largest visible orders in current snapshot</span></div><div className="zone-list">{zones.length ? zones.map((zone) => <div key={`${zone.side}-${zone.price}`} className="zone-row"><span className={`zone-side ${zone.side}`}>{zone.side === 'bid' ? 'BID' : 'ASK'}</span><strong>{formatCurrency(zone.price)}</strong><span>{formatCompact(zone.notional)}</span><small>{depth ? `${Math.abs((zone.price / depth.midPrice - 1) * 100).toFixed(2)}% from mid` : ''}</small><div className="zone-intensity"><span style={{ width: `${zone.notional / maxNotional * 100}%` }} /></div></div>) : <div className="zone-empty">Zones will appear when order-book data arrives.</div>}</div></div>
  </>
}

type Props = { frames: LiquidityFrame[] }

export default function LiquidityHeatmap({ frames }: Props) {
  const screenRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  async function toggleExpanded() {
    const screen = screenRef.current
    if (!screen) return
    if (document.fullscreenElement === screen) await document.exitFullscreen().catch(() => undefined)
    else if (expanded) setExpanded(false)
    else {
      try { await screen.requestFullscreen() } catch { setExpanded(true) }
    }
  }
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === screenRef.current)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.fullscreenElement) setExpanded(false) }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('keydown', escape) }
  }, [])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const impactPixelsRef = useRef<Array<{ price: number; time: number; born: number; seed: number; fraction: number; direction: LiquidityPixelDirection; color: 'red' | 'yellow' }>>([])
  const dimRef = useRef(new Map<number, { born: number; fraction: number }>())
  const impactRef = useRef<LiquidityFrame | null>(null)
  const transitionRef = useRef<{ born: number; previous: ReturnType<typeof horizontalLiquidityBands>; time: number } | null>(null)
  const [dissolve, setDissolve] = useState(true)
  const [intensity, setIntensity] = useState('Medium')
  const [speed, setSpeed] = useState('Normal')
  const [opacity, setOpacity] = useState(1)
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [candleHistory, setCandleHistory] = useState<{ key: string; candles: HeatmapCandle[] } | null>(null)
  const [candleError, setCandleError] = useState<string | null>(null)
  const selected = frames.at(-1)
  const historyKey = `${selected?.exchange}:${selected?.market}:${selected?.symbol}:${intervalSeconds}`
  const historicalCandles = candleHistory?.key === historyKey ? candleHistory.candles : []
  useEffect(() => {
    setCandleError(null)
    if (!selected || intervalSeconds < 60) return
    const controller = new AbortController()
    let active = true
    const load = async () => {
      try {
        const response = await fetch(candleRequest(selected, intervalSeconds), { signal: controller.signal })
        if (!response.ok) throw new Error('Candle request failed')
        const candles = parseHeatmapCandles(selected.exchange, await response.json(), intervalSeconds)
        if (!candles.length) throw new Error('No candle history returned')
        if (active) { setCandleHistory({ key: historyKey, candles }); setCandleError(null) }
      } catch {
        if (active) setCandleError('Exchange candle history unavailable; showing available candles and live samples.')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
    // Reload only when the selected feed or interval changes, not on every depth tick.
  }, [historyKey])
  const [timeStretch, setTimeStretch] = useState(1)
  const [horizontalStretch, setHorizontalStretch] = useState(1)
  const [zoom, setZoom] = useState(1)
  const recordedDuration = Math.max(1000, (frames.at(-1)?.time ?? 0) - Math.min(frames[0]?.time ?? 0, historicalCandles[0]?.time ?? Infinity) + 1000)
  const baseWindow = heatmapWindowDuration(frames, intervalSeconds)
  const minimumZoom = Math.min(1, baseWindow * timeStretch / horizontalStretch / recordedDuration)
  const changeZoom = (factor: number) => setZoom((current) => Math.max(minimumZoom, Math.min(16, current * factor)))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      setZoom((current) => Math.max(minimumZoom, Math.min(16, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [minimumZoom])


  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sampled = sampledCandles(frames, intervalSeconds * 1000)
    const candles = historicalCandles.length ? [...historicalCandles, ...sampled.filter(candle => candle.time > historicalCandles[historicalCandles.length - 1].time)] : sampled
    const bands = horizontalLiquidityBands(frames)
    const duration = speed === 'Slow' ? 800 : speed === 'Fast' ? 300 : 550

    const draw = () => {
      const width = canvas.clientWidth || 1000
      const height = canvas.clientHeight || 600
      const left = 75, right = 25, top = 20, bottom = 40
      const plotW = width - left - right, plotH = height - top - bottom
      const ratio = window.devicePixelRatio || 1
      const pixelW = Math.round(width * ratio), pixelH = Math.round(height * ratio)
      if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH }
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      if (!frames.length) {
        ctx.fillStyle = '#a6b8c9'; ctx.font = '16px monospace'
        ctx.fillText('Waiting for exchange liquidity data…', left, height / 2)
        return
      }
      const latest = frames[frames.length - 1]
      const intervalMs = intervalSeconds * 1000
      const previous = impactRef.current
      const feedChanged = previous && (previous.exchange !== latest.exchange || previous.market !== latest.market || previous.symbol !== latest.symbol || previous.bucketSize !== latest.bucketSize || latest.time < previous.time)
      if (feedChanged) { impactPixelsRef.current = []; transitionRef.current = null; dimRef.current.clear() }
      if (!previous || feedChanged || latest.time > previous.time) {
        if (previous && !feedChanged && dissolve && !motion.matches && !document.hidden
          && Math.abs(Date.now() - latest.time) < 5000 && latest.time - previous.time <= 2000) {
          const oldBands = horizontalLiquidityBands([previous]).filter(band => band.end > previous.time)
          const hotBands = new Map(oldBands.filter(band => band.color === 4 || band.color === 3).map(band => [band.price, band.color]))
          const reductions = liquidityReductions(previous, latest, new Set(oldBands.map(band => band.price)))
          for (const change of reductions) if (change.contact) dimRef.current.set(change.price, { born: performance.now(), fraction: change.fraction })
          // Replenishment restores brightness immediately.
          const priorSizes = new Map(previous.levels.map(level => [level.price, level.bidUsd + level.askUsd]))
          for (const level of latest.levels) if (level.bidUsd + level.askUsd > (priorSizes.get(level.price) ?? 0)) dimRef.current.delete(level.price)
          // Pixels lift opposite the sampled candle movement at observed liquidity loss/contact.
          const direction = liquidityPixelDirection(previous.price, latest.price)
          for (const change of reductions.filter(change => direction && change.contact && hotBands.has(change.price))) {
            if (impactPixelsRef.current.length >= 12) break
            impactPixelsRef.current.push({ price: change.price + latest.bucketSize / 2, time: latest.time,
              born: performance.now(), seed: Math.random() * 100, fraction: change.fraction, direction: direction!,
              color: hotBands.get(change.price) === 3 ? 'yellow' : 'red' })
          }
          // Changes away from price still fade, without an execution-like burst.
          transitionRef.current = { born: performance.now(), previous: oldBands, time: latest.time }
        }
        impactRef.current = latest
      }
      if (!dissolve || motion.matches || document.hidden) { impactPixelsRef.current = []; transitionRef.current = null; dimRef.current.clear() }
      const historyStart = Math.min(frames[0].time, candles[0]?.time ?? Infinity)
      const visibleStart = latest.time + 1000 - Math.min(latest.time + 1000 - historyStart, baseWindow * timeStretch / zoom / horizontalStretch)
      let min = Infinity, max = -Infinity
      for (const candle of candles) {
        if (candle.time + intervalMs < visibleStart) continue
        min = Math.min(min, candle.low); max = Math.max(max, candle.high)
      }
      for (const frame of frames) {
        min = Math.min(min, frame.price); max = Math.max(max, frame.price)
        for (const level of frame.levels) { min = Math.min(min, level.price); max = Math.max(max, level.price + frame.bucketSize) }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return
      const padding = Math.max((max - min) * .06, latest.bucketSize)
      min -= padding; max += padding
      // Zoom both axes around the newest observed price and timestamp.
      const fullMin = min, fullSpan = Math.max(max - min, 1)
      const priceRatio = (latest.price - fullMin) / fullSpan
      // Fit all observed prices when zooming out rather than adding empty range.
      // Compress Bybit's price spacing within the shared chart dimensions.
      const priceSpacing = latest.exchange === 'bybit' ? 1.5 : 1
      const span = fullSpan * priceSpacing / Math.max(1, zoom / 2)
      min = latest.price - span * priceRatio
      max = min + span
      // Fit the observed history, even when it is shorter than a candle interval.
      // Long intervals must not reserve empty future candles off to the right.
      const baseStart = historyStart
      const baseEnd = Math.max(baseStart + 1000, latest.time + 1000)
      // Higher stretch reveals more recorded history and more candles.
      // Longer candle intervals also request a proportionally longer window.
      const visibleDuration = Math.min(baseEnd - baseStart, baseWindow * timeStretch / zoom / horizontalStretch)
      const endTime = baseEnd
      const startTime = endTime - visibleDuration
      // Reserve a clearly separated current-book lane ahead of the candles.
      // It displays the latest resting orders, not fabricated future snapshots.
      const liveLaneWidth = Math.min(72, plotW * .15)
      const historyWidth = plotW - liveLaneWidth
      const liveLaneX = left + historyWidth
      const x = (time: number) => left + (time - startTime) / (endTime - startTime) * historyWidth
      const y = (price: number) => top + (max - price) / span * plotH
      const candleX = (time: number) => x((Math.max(time, baseStart) + Math.min(time + intervalMs, baseEnd)) / 2)

      ctx.save(); ctx.beginPath(); ctx.rect(left, top, plotW, plotH); ctx.clip()
      ctx.strokeStyle = '#17251d'; ctx.lineWidth = 1
      for (let i = 0; i <= 5; i++) { const py = top + i / 5 * plotH; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(width - right, py); ctx.stroke() }
      const colors = ['#125077', '#2278da', '#31dc72', '#ffd83d', '#ff4438']
      // A dim blue floor marks the sampled book's covered price range,
      // including empty buckets between observed levels. Never backfill beyond
      // that range, across outages, or into older price-only candle history.
      ctx.fillStyle = '#07354f'
      ctx.globalAlpha = .38 * opacity
      ctx.shadowBlur = 0
      for (let index = 0; index < frames.length; index++) {
        const sample = frames[index]
        if (!sample.levels.length) continue
        let lower = Infinity, upper = -Infinity
        for (const level of sample.levels) {
          lower = Math.min(lower, level.price)
          upper = Math.max(upper, level.price + sample.bucketSize)
        }
        const end = Math.min(frames[index + 1]?.time ?? sample.time + 1000, sample.time + 2000)
        if (end < startTime || sample.time > endTime) continue
        ctx.fillRect(x(sample.time), y(upper), Math.max(1, x(end) - x(sample.time)), y(lower) - y(upper))
      }
      ctx.globalAlpha = 1
      const now = performance.now()
      for (const [price, dim] of dimRef.current) if (now - dim.born >= 700) dimRef.current.delete(price)
      const transition = transitionRef.current
      const progress = transition ? Math.min(1, (now - transition.born) / duration) : 1
      const eased = progress * progress * (3 - 2 * progress)
      const alpha = (band: typeof bands[number]) => opacity * (band.color === 4 ? .71 * band.strength : .16 + band.strength * .55)
      // Keep pending red orders legible ahead of price, including after partial
      // depletion. The curve still falls to zero with remaining liquidity.
      const liveAlpha = (band: typeof bands[number]) => band.color === 4
        ? opacity * .85 * Math.sqrt(Math.max(0, Math.min(1, band.strength))) : alpha(band)
      const paintBand = (band: typeof bands[number], start: number, end: number, value: number, lane = false) => {
        const bandY = y(band.price + latest.bucketSize / 2)
        // Fill each recorded price row, leaving just a small separation.
        // The cells retain their actual time extent; no unobserved backfill.
        const rowSpacing = Math.abs(y(band.price) - y(band.price + latest.bucketSize))
        const bandHeight = Math.max(.25, rowSpacing * .95)
        ctx.fillStyle = colors[band.color]
        // Use the same band opacity for spot and futures, with data-driven
        // dimming restricted to the live edge.
        const dim = lane || start >= latest.time ? dimRef.current.get(band.price) : undefined
        const dimming = dim ? 1 - .18 * Math.sqrt(dim.fraction) * Math.sin(Math.PI * Math.min(1, (now - dim.born) / 700)) : 1
        ctx.globalAlpha = Math.min(1, value) * dimming
        ctx.shadowColor = colors[band.color]
        ctx.shadowBlur = band.color >= 3 ? Math.min(3, rowSpacing * .12) : 0
        ctx.fillRect(lane ? liveLaneX + 4 : x(start), bandY - bandHeight / 2,
          lane ? liveLaneWidth - 8 : Math.max(1, x(end) - x(start)), bandHeight)
      }
      // Historical geometry and alpha always use the recorded sample. Interpolate
      // only the newest observed column, including confirmed removal to zero.
      const live = new Map(bands.filter(band => band.end > latest.time && band.start <= latest.time).map(band => [band.price, band]))
      const old = new Map(transition?.previous.map(band => [band.price, band]) ?? [])
      for (const band of bands) {
        if (band.end <= latest.time) paintBand(band, band.start, band.end, alpha(band))
        else if (progress === 1) {
          if (band.start < latest.time) paintBand(band, band.start, latest.time, alpha(band))
          paintBand(band, latest.time, band.end, alpha(band))
        } else {
          if (band.start < latest.time) paintBand(band, band.start, latest.time, alpha(band))
          const from = old.get(band.price)
          const target = alpha(band)
          paintBand(band, latest.time, band.end, (from ? alpha(from) * (1 - eased) + target * eased : target))
        }
      }
      if (progress < 1) for (const band of old.values()) {
        if (!live.has(band.price)) paintBand(band, latest.time, latest.time + 1000, alpha(band) * (1 - eased))
      }
      // Every live wall is shown before price contact; only measured changes
      // affect its intensity. The adjacent lane stays separate from history.
      const fresh = Math.abs(Date.now() - latest.time) < 5000
      if (fresh) {
        for (const band of live.values()) {
          const from = old.get(band.price)
          const value = progress < 1 ? (from ? liveAlpha(from) * (1 - eased) + liveAlpha(band) * eased : liveAlpha(band)) : liveAlpha(band)
          paintBand(band, 0, 0, value, true)
        }
        if (progress < 1) for (const band of old.values()) {
          if (!live.has(band.price)) paintBand(band, 0, 0, liveAlpha(band) * (1 - eased), true)
        }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0
      ctx.strokeStyle = '#344b3e'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(liveLaneX, top); ctx.lineTo(liveLaneX, top + plotH); ctx.stroke()
      ctx.fillStyle = '#a6b8c9'; ctx.font = '10px monospace'
      ctx.fillText(fresh ? 'LIVE BOOK' : 'STALE', liveLaneX + 5, top + 11)
      if (progress === 1) transitionRef.current = null
      ctx.globalAlpha = 1; ctx.shadowBlur = 0
      const candleWidth = Math.max(3, Math.min(40, intervalMs / (endTime - startTime) * historyWidth * .7))
      for (const candle of candles) {
        const cx = candleX(candle.time)
        const color = candle.close >= candle.open ? '#5bffc2' : '#ff786d'
        const bodyY = Math.min(y(candle.open), y(candle.close))
        const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)))
        // Dark outline keeps wicks and bodies readable over the bright thermal bands.
        ctx.strokeStyle = '#000'; ctx.lineWidth = 4
        ctx.beginPath(); ctx.moveTo(cx, y(candle.high)); ctx.lineTo(cx, y(candle.low)); ctx.stroke()
        ctx.strokeStyle = color; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(cx, y(candle.high)); ctx.lineTo(cx, y(candle.low)); ctx.stroke()
        ctx.fillStyle = '#000'; ctx.fillRect(cx - candleWidth / 2 - 1, bodyY - 1, candleWidth + 2, bodyHeight + 2)
        ctx.fillStyle = color; ctx.fillRect(cx - candleWidth / 2, bodyY, candleWidth, bodyHeight)
      }
      impactPixelsRef.current = motion.matches ? [] : impactPixelsRef.current.filter(burst => now - burst.born < duration)
      for (const burst of impactPixelsRef.current) {
        const age = (now - burst.born) / duration
        const originX = x(burst.time), originY = y(burst.price)
        const count = Math.max(1, Math.round((intensity === 'Low' ? 16 : intensity === 'High' ? 44 : 28) * burst.fraction))
        const colors = burst.color === 'yellow' ? ['#ffe65b', '#ffd83d'] : ['#ff6258', '#ff3028']
        ctx.shadowBlur = 0
        for (let i = 0; i < count; i++) {
          const pixel = liquidityPixelOffset(burst.direction, i, burst.seed, age)
          if (!pixel.size) continue
          ctx.globalAlpha = pixel.alpha * opacity
          ctx.fillStyle = colors[i % colors.length]
          ctx.fillRect(Math.round(originX + pixel.x - pixel.size / 2), Math.round(originY + pixel.y - pixel.size / 2), pixel.size, pixel.size)
        }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0
      const currentY = y(latest.price)
      ctx.setLineDash([5, 5]); ctx.strokeStyle = '#55ff99'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(left, currentY); ctx.lineTo(width - right, currentY); ctx.stroke(); ctx.setLineDash([])
      ctx.restore()
      ctx.fillStyle = '#a6b8c9'; ctx.font = '13px monospace'
      for (let i = 0; i <= 5; i++) { const price = min + span * i / 5; ctx.fillText(price.toFixed(latest.bucketSize < 1 ? 2 : 0), 5, y(price) + 4) }
      ctx.fillStyle = '#65ff9b'; ctx.fillText(`${latest.price.toFixed(2)} ${latest.quote}`, width - 170, Math.max(15, currentY - 8))
      ctx.fillStyle = '#a6b8c9'
      for (let i = 0; i <= 5; i++) { const time = startTime + (endTime - startTime) * i / 5; ctx.fillText((intervalSeconds >= 3600 ? new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : new Date(time).toLocaleTimeString()), Math.min(width - 105, x(time)), height - 12) }
      const pointer = hoverRef.current
      if (pointer && pointer.x >= left && pointer.x <= width - right && pointer.y >= top && pointer.y <= height - bottom) {
        const inLiveLane = pointer.x >= liveLaneX
        const hoverTime = startTime + (pointer.x - left) / historyWidth * (endTime - startTime)
        const sample = inLiveLane ? (fresh ? latest : null) : liquiditySampleAt(frames, hoverTime)
        const nearest = sample?.levels.filter((level) => level.bidUsd + level.askUsd > 0).sort((a, b) => Math.abs(y(a.price + sample.bucketSize / 2) - pointer.y) - Math.abs(y(b.price + sample.bucketSize / 2) - pointer.y))[0]
        const hit = nearest && Math.abs(y(nearest.price + sample!.bucketSize / 2) - pointer.y) <= 10 ? nearest : null
        const crossY = hit ? y(hit.price + sample!.bucketSize / 2) : pointer.y
        ctx.save()
        ctx.strokeStyle = hit ? '#f9ed8b' : '#a6b8c9'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(pointer.x, top); ctx.lineTo(pointer.x, height - bottom); ctx.moveTo(left, crossY); ctx.lineTo(width - right, crossY); ctx.stroke(); ctx.setLineDash([])
        const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })
        const price = max - (crossY - top) / plotH * span
        ctx.fillStyle = '#1d3527'; ctx.fillRect(0, crossY - 10, left - 3, 20)
        ctx.fillStyle = '#edfff3'; ctx.font = '11px monospace'; ctx.fillText(number(hit ? hit.price : price), 4, crossY + 4)
        if (hit && sample) {
          const peak = sample.levels.reduce((best, level) => level.bidUsd + level.askUsd > best.bidUsd + best.askUsd ? level : best, hit)
          const lines = [
            `${number(hit.price)}–${number(hit.price + sample.bucketSize)} ${sample.quote}`,
            `Total liquidity: ${number(hit.bidUsd + hit.askUsd)} ${sample.quote}`,
            `Bids: ${number(hit.bidUsd)}  Asks: ${number(hit.askUsd)}`,
            `Largest zone: ${number(peak.price)}–${number(peak.price + sample.bucketSize)}`,
            `Largest total: ${number(peak.bidUsd + peak.askUsd)} ${sample.quote}`,
            `${sample.exchange.toUpperCase()} · ${new Date(sample.time).toLocaleTimeString()}`,
          ]
          ctx.font = '12px monospace'
          const boxW = Math.min(plotW, Math.max(280, ...lines.map((line) => ctx.measureText(line).width + 24)))
          const boxH = 138
          const boxX = Math.max(left, Math.min(width - right - boxW, pointer.x + 16))
          const boxY = Math.max(top, Math.min(height - bottom - boxH, pointer.y + 16))
          ctx.fillStyle = 'rgba(6, 15, 10, .96)'; ctx.fillRect(boxX, boxY, boxW, boxH)
          ctx.strokeStyle = '#89b89a'; ctx.strokeRect(boxX, boxY, boxW, boxH)
          lines.forEach((line, i) => { ctx.fillStyle = i === 0 ? '#fff1a5' : i >= 3 && i <= 4 ? '#b8e889' : '#c1d8ca'; ctx.fillText(line, boxX + 12, boxY + 22 + i * 20) })
        }
        ctx.restore()
      }

      if (impactPixelsRef.current.length || transitionRef.current || dimRef.current.size) scheduleDraw()
    }
    let animation = 0
    const scheduleDraw = () => {
      if (!animation) animation = requestAnimationFrame(() => { animation = 0; draw() })
    }
    const onMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      hoverRef.current = {
        x: (event.clientX - bounds.left) / bounds.width * canvas.clientWidth,
        y: (event.clientY - bounds.top) / bounds.height * canvas.clientHeight,
      }
      scheduleDraw()
    }
    const onLeave = () => { hoverRef.current = null; scheduleDraw() }
    motion.addEventListener('change', scheduleDraw)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    draw()
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    return () => { observer.disconnect(); cancelAnimationFrame(animation); motion.removeEventListener('change', scheduleDraw); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave) }

  }, [frames, intervalSeconds, zoom, timeStretch, baseWindow, horizontalStretch, dissolve, intensity, speed, opacity, candleHistory, historyKey])

  return <div ref={screenRef} className={`thermal-candlestick-chart${expanded ? ' heatmap-expanded' : ''}`}>
    <div className="thermal-candle-controls"><span>Red ≥ $1M per price band · current resting orders ahead of candles in LIVE BOOK · hover for price and size</span><label>Candle interval <select value={intervalSeconds} onChange={(event) => {
      setIntervalSeconds(Number(event.target.value))
      setZoom(1)
      setTimeStretch(1)
      setHorizontalStretch(1)
      impactPixelsRef.current = []
    }}>{[{ seconds: 1, label: '1s' }, { seconds: 2, label: '2s' }, { seconds: 5, label: '5s' }, { seconds: 10, label: '10s' }, { seconds: 30, label: '30s' }, { seconds: 60, label: '1m' }, { seconds: 120, label: '2m' }, { seconds: 300, label: '5m' }, { seconds: 600, label: '10m' }, { seconds: 900, label: '15m' }, { seconds: 1800, label: '30m' }, { seconds: 3600, label: '1h' }, { seconds: 14400, label: '4h' }, { seconds: 86400, label: '1D' }, { seconds: 604800, label: '1W' }].map(({ seconds, label }) => <option key={seconds} value={seconds}>{label}</option>)}</select></label></div>
    <div className="heatmap-zoom-controls" role="group" aria-label="Heatmap zoom">
      <button type="button" aria-label="Zoom out" disabled={zoom <= minimumZoom} onClick={() => changeZoom(1 / 1.25)}>−</button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 16} onClick={() => changeZoom(1.25)}>+</button>
      <button type="button" onClick={() => { setZoom(1); setTimeStretch(1); setHorizontalStretch(1) }}>Reset view</button>
      <button type="button" onClick={() => { setTimeStretch(1); setHorizontalStretch(1); setZoom(baseWindow / Math.max(1000, (frames.at(-1)?.time ?? 0) - (frames[0]?.time ?? 0) + 1000)) }}>Fit heatmap</button>
      <button type="button" onClick={() => setZoom(minimumZoom)}>Fit price history</button>
      <label>History window <select aria-label="History window" value={timeStretch} onChange={(event) => {
        const stretch = Number(event.target.value)
        setTimeStretch(stretch)
        setZoom(1)
      }}>
        {[1, 2, 4, 8, 16, 32].map((stretch) => <option key={stretch} value={stretch}>{stretch}×</option>)}
      </select></label>
      <label>Horizontal stretch <input aria-label="Horizontal candle stretch" type="range" min="0.5" max="8" step="0.25" value={horizontalStretch} onChange={event => setHorizontalStretch(Number(event.target.value))} /><output>{horizontalStretch}×</output></label>
      <span>Scroll to zoom · + / − keys · 0 to reset</span>
    </div>
    <div className="thermal-candle-controls heatmap-dissolve-controls" role="group" aria-label="Liquidity wall appearance">
      <label>Liquidity Pixels <input type="checkbox" checked={dissolve} onChange={event => setDissolve(event.target.checked)} />{dissolve ? 'ON' : 'OFF'}</label>
      <label>Pixel Intensity <select value={intensity} disabled={!dissolve} onChange={event => setIntensity(event.target.value)}>{['Low', 'Medium', 'High'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Pixel Speed <select value={speed} disabled={!dissolve} onChange={event => setSpeed(event.target.value)}>{['Slow', 'Normal', 'Fast'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Liquidity Opacity <input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={event => setOpacity(Number(event.target.value) / 100)} /><output>{Math.round(opacity * 100)}%</output></label>
    </div>
    {intervalSeconds >= 60 && <p className="liquidity-muted">{historicalCandles.length ? `${historicalCandles.length} exchange price candles loaded. The default view fits recorded liquidity. Use Fit price history to see older candles without heatmap data.` : 'Loading exchange price history; candles currently use retained live mid-price samples.'}</p>}
    {intervalSeconds < 60 && <p className="liquidity-muted">Second-based candles use recorded live samples; older second-based exchange history is not loaded.</p>}
    {candleError && <p className="liquidity-muted" role="status">{candleError}</p>}
    <div className="heatmap-canvas-stage">
    {selected?.market === 'futures' && <div className="futures-sonar" aria-hidden="true">
      <svg viewBox="0 0 600 300" className="futures-sonar-rings">
        {[70, 140, 210, 290].map(radius => <circle key={radius} cx="300" cy="300" r={radius} />)}
        {[0, 30, 60, 90, 120, 150, 180].map(angle => <line key={angle} x1="300" y1="300" x2={300 + 290 * Math.cos(angle * Math.PI / 180)} y2={300 - 290 * Math.sin(angle * Math.PI / 180)} />)}
      </svg>
      <div className="futures-sonar-sweep" />
    </div>}
    <canvas ref={canvasRef} className="historical-liquidity-heatmap" aria-label="Horizontal resting liquidity zones with sampled mid-price candlesticks. Scroll or use plus and minus to zoom, zero to reset." tabIndex={0} onKeyDown={(event) => {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1.25) }
      else if (event.key === '-') { event.preventDefault(); changeZoom(1 / 1.25) }
      else if (event.key === '0') { event.preventDefault(); setZoom(1); setTimeStretch(1); setHorizontalStretch(1) }
    }} role="img" />
    </div>
    <div className="heatmap-screen-footer"><button type="button" className="heatmap-expand-button" aria-label={expanded ? 'Exit enhanced screen' : 'Enhance heatmap screen'} title={expanded ? 'Exit fullscreen (Esc)' : 'Expand heatmap to fullscreen'} aria-pressed={expanded} onClick={toggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div>
  </div>
}
