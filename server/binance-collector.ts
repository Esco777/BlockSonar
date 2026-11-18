import WebSocket from 'ws'
import { OrderBook, type DepthEvent, type Snapshot } from './orderbook.js'
import { ExchangeOrderBook } from './exchange-orderbook.js'
import type { LiquidityFeed } from '../src/lib/liquidity-exchanges.js'
import type { LiquidityFrame, Level } from '../src/lib/liquidity-types.js'
import type { CollectorStatus } from './exchange-collector.js'

export function startBinanceCollector(feed: LiquidityFeed, publish: (frame: LiquidityFrame) => void, update: (status: CollectorStatus) => void) {
  let stopped = false, generation = 0, attempts = 0
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let controller: AbortController | undefined
  let lastFrameAt: number | null = null
  const clear = () => { if (timer) clearInterval(timer); controller?.abort(); socket?.terminate() }
  const restart = (error: string) => {
    if (stopped) return
    generation++; clear(); attempts++
    update({ status: 'reconnecting', error, lastFrameAt })
    retry = setTimeout(connect, Math.min(60000, 2000 * 2 ** Math.min(attempts - 1, 5)))
  }
  const connect = () => {
    if (stopped) return
    const id = ++generation
    controller = new AbortController()
    const book = new OrderBook(feed.market)
    const renderer = new ExchangeOrderBook(feed)
    let syncing = true, initialized = false, lastMessage = Date.now()
    const buffer: DepthEvent[] = []
    update({ status: attempts ? 'reconnecting' : 'connecting', error: null, lastFrameAt })
    const url = feed.market === 'spot' ? 'wss://stream.binance.com:9443/ws/btcusdt@depth@100ms' : 'wss://fstream.binance.com/public/ws/btcusdt@depth@100ms'
    socket = new WebSocket(url, { handshakeTimeout: 10000 })
    const current = socket
    const consume = (event: DepthEvent) => {
      if (!initialized) {
        if (event.u < book.lastId || (feed.market === 'spot' && event.u === book.lastId)) return
        if (!book.synchronize(event)) throw new Error('Snapshot bridge missing; resynchronizing')
        initialized = true
      } else if (!book.apply(event)) throw new Error('Depth sequence gap; resynchronizing')
    }
    current.on('message', (raw) => {
      if (id !== generation) return
      try {
        const event = JSON.parse(raw.toString()) as DepthEvent
        if (!Number.isSafeInteger(event.U) || !Number.isSafeInteger(event.u) || event.U > event.u || !Array.isArray(event.b) || !Array.isArray(event.a)) throw new Error('Invalid depth event')
        lastMessage = Date.now()
        if (syncing) { buffer.push(event); if (buffer.length > 10000) throw new Error('Depth buffer full'); return }
        consume(event)
      } catch (error) { restart(error instanceof Error ? error.message : 'Invalid Binance data') }
    })
    current.on('open', () => {
      timer = setInterval(() => {
        if (id !== generation) return
        if (Date.now() - lastMessage > 30000) { restart('Binance depth stream stale'); return }
        if (syncing || !initialized) return
        const rows = (side: Map<number, number>): Level[] => [...side].map(([price, quantity]) => [String(price), String(quantity)])
        renderer.loadSnapshot(rows(book.bids), rows(book.asks))
        const frame = renderer.frame(Date.now())
        if (!frame) return
        lastFrameAt = frame.time; attempts = 0
        update({ status: 'live', error: null, lastFrameAt }); publish(frame)
      }, 1000)
      void (async () => {
        try {
          const base = feed.market === 'spot' ? 'https://api.binance.com/api/v3/depth' : 'https://fapi.binance.com/fapi/v1/depth'
          const response = await fetch(`${base}?symbol=BTCUSDT&limit=1000`, { signal: AbortSignal.any([controller!.signal, AbortSignal.timeout(10000)]) })
          if (!response.ok) throw new Error(response.status === 451 ? 'Binance unavailable in this location (HTTP 451)' : `Binance snapshot HTTP ${response.status}`)
          const snapshot = await response.json() as Snapshot
          if (id !== generation || stopped) return
          if (!Number.isSafeInteger(snapshot.lastUpdateId) || !Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks)) throw new Error('Invalid Binance snapshot')
          book.load(snapshot)
          for (const event of buffer) consume(event)
          buffer.length = 0; syncing = false
        } catch (error) { if (id === generation && !stopped) restart(error instanceof Error ? error.message : 'Binance snapshot failed') }
      })()
    })
    current.on('error', (error) => { if (id === generation) restart(error.message.includes('451') ? 'Binance unavailable in this location (HTTP 451)' : error.message) })
    current.on('close', () => { if (id === generation) restart('Binance socket closed; reconnecting') })
  }
  connect()
  return () => { stopped = true; generation++; if (retry) clearTimeout(retry); clear() }
}
