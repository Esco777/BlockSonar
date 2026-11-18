import WebSocket from 'ws'
import { startBinanceCollector } from './binance-collector.js'
import { ExchangeOrderBook } from './exchange-orderbook.js'
import { feedKey, type LiquidityFeed } from '../src/lib/liquidity-exchanges.js'
import type { LiquidityFrame } from '../src/lib/liquidity-types.js'

export type CollectorStatus = { status: 'connecting' | 'live' | 'reconnecting'; error: string | null; lastFrameAt: number | null }
export function startExchangeCollector(feed: LiquidityFeed, publish: (frame: LiquidityFrame) => void, updateStatus: (status: CollectorStatus) => void) {
  if (feed.exchange === 'binance') return startBinanceCollector(feed, publish, updateStatus)
  let stopped = false, generation = 0, attempts = 0
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let controller: AbortController | undefined
  const status: CollectorStatus = { status: 'connecting', error: null, lastFrameAt: null }
  const report = () => updateStatus({ ...status })
  function clear() { if (timer) clearInterval(timer); if (heartbeat) clearInterval(heartbeat); controller?.abort(); socket?.terminate() }
  function restart(message: string) {
    if (stopped) return
    generation++; clear()
    status.status = 'reconnecting'; status.error = message; report()
    attempts++
    console.error(`${feedKey(feed)}: ${message}`)
    retry = setTimeout(() => void connect(), Math.min(60000, 2000 * 2 ** Math.min(attempts - 1, 5)))
  }
  async function connect() {
    if (stopped) return
    const id = ++generation
    controller = new AbortController()
    status.status = attempts ? 'reconnecting' : 'connecting'; report()
    try {
      let multiplier = 1
      if (feed.exchange === 'okx' && feed.market === 'futures') {
        const response = await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${feed.symbol}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
        if (!response.ok) throw new Error(`Contract metadata HTTP ${response.status}`)
        const payload = await response.json() as { data?: Array<{ instId: string; ctValCcy: string; ctVal: string; ctMult: string }> }
        const instrument = payload.data?.find((item) => item.instId === feed.symbol)
        multiplier = Number(instrument?.ctVal) * Number(instrument?.ctMult || 1)
        if (instrument?.ctValCcy !== 'BTC' || !Number.isFinite(multiplier) || multiplier <= 0) throw new Error('Invalid BTC contract metadata')
      }
      if (stopped || id !== generation) return
      const book = new ExchangeOrderBook(feed, multiplier)
      const url = feed.exchange === 'bybit' ? `wss://stream.bybit.com/v5/public/${feed.market === 'spot' ? 'spot' : 'linear'}` : feed.exchange === 'coinbase' ? 'wss://ws-feed.exchange.coinbase.com' : feed.exchange === 'gemini' ? 'wss://ws.gemini.com' : 'wss://ws.okx.com:8443/ws/v5/public'
      const subscription = feed.exchange === 'bybit' ? { op: 'subscribe', args: [`orderbook.200.${feed.symbol}`] } : feed.exchange === 'coinbase' ? { type: 'subscribe', product_ids: [feed.symbol], channels: ['level2_batch', 'heartbeat'] } : feed.exchange === 'gemini' ? { id: '1', method: 'subscribe', params: ['btcusd@depth20@100ms'] } : { op: 'subscribe', args: [{ channel: 'books', instId: feed.symbol }] }
      socket = new WebSocket(url, { handshakeTimeout: 10000, maxPayload: 16 * 1024 * 1024 })
      const current = socket
      let lastMessage = Date.now(), lastBook = Date.now()
      current.on('open', () => {
        if (id !== generation) return
        current.send(JSON.stringify(subscription))
        heartbeat = setInterval(() => {
          if (current.readyState !== WebSocket.OPEN) return
          if (feed.exchange === 'bybit') current.send(JSON.stringify({ op: 'ping' }))
          else if (feed.exchange === 'okx') current.send('ping')
          else current.ping()
        }, 15000)
        timer = setInterval(() => {
          if (id !== generation) return
          if (Date.now() - lastMessage > 45000 || (!book.ready && Date.now() - lastBook > 20000)) { restart('Timed out waiting for order-book data'); return }
          const frame = book.frame(Date.now())
          if (!frame) return
          attempts = 0; status.status = 'live'; status.error = null; status.lastFrameAt = frame.time; report(); publish(frame)
        }, 1000)
      })
      current.on('pong', () => { lastMessage = Date.now() })
      current.on('message', (raw) => {
        if (id !== generation) return
        lastMessage = Date.now()
        if (raw.toString() === 'pong') return
        try {
          const message = JSON.parse(raw.toString())
          if (message.status && Number(message.status) >= 400) throw new Error(message.error?.msg ?? `Subscription HTTP ${message.status}`)
          // Some venues wrap stream messages in a data envelope.
          const payload = feed.exchange === 'gemini' && message.data ? message.data : message
          if (book.consume(payload)) lastBook = Date.now()
        } catch (error) { restart(error instanceof Error ? error.message : 'Invalid exchange payload') }
      })
      current.on('error', (error) => { if (id === generation) restart(error.message) })
      current.on('close', () => { if (id === generation) restart('Exchange socket closed') })
    } catch (error) { if (id === generation && !stopped) restart(error instanceof Error ? error.message : 'Connection failed') }
  }
  void connect()
  return () => { stopped = true; generation++; if (retry) clearTimeout(retry); clear() }
}
