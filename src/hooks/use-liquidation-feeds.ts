import { useEffect, useRef, useState } from 'react'
import { parseExchangeLiquidations, type LiquidationFeedStatus } from '../lib/liquidation-feeds'
import type { LiquidationEvent } from '../lib/liquidity-types'

export function useLiquidationFeeds(onEvents: (events: LiquidationEvent[]) => void) {
  const callback = useRef(onEvents)
  callback.current = onEvents
  const [statuses, setStatuses] = useState<LiquidationFeedStatus>({ Binance: 'connecting', Bybit: 'connecting', OKX: 'connecting' })
  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const sockets = new Set<WebSocket>()
    const retries = new Set<number>()
    const update = (exchange: keyof LiquidationFeedStatus, status: LiquidationFeedStatus[keyof LiquidationFeedStatus]) => {
      if (!disposed) setStatuses((current) => ({ ...current, [exchange]: status }))
    }
    const connect = (exchange: keyof LiquidationFeedStatus, url: string, subscription?: object, contractBtc?: number) => {
      let attempts = 0
      const open = () => {
        if (disposed) return
        update(exchange, attempts ? 'reconnecting' : 'connecting')
        const socket = new WebSocket(url)
        sockets.add(socket)
        let lastMessage = Date.now()
        const heartbeat = window.setInterval(() => {
          if (exchange !== 'Binance' && Date.now() - lastMessage > 60000) { socket.close(); return }
          if (socket.readyState === WebSocket.OPEN && exchange !== 'Binance') socket.send(exchange === 'OKX' ? 'ping' : JSON.stringify({ op: 'ping' }))
        }, 20000)
        socket.onopen = () => {
          if (subscription) socket.send(JSON.stringify(subscription))
          else update(exchange, 'live')
        }
        socket.onmessage = (event) => {
          lastMessage = Date.now()
          if (event.data === 'pong') return
          try {
            const payload = JSON.parse(String(event.data))
            if (payload.event === 'error' || payload.success === false) { update(exchange, 'reconnecting'); socket.close(); return }
            if (payload.event === 'subscribe' || (payload.op === 'subscribe' && payload.success === true)) {
              attempts = 0
              update(exchange, 'live')
            }
            const events = parseExchangeLiquidations(exchange, payload, contractBtc)
            if (events.length) { attempts = 0; update(exchange, 'live'); callback.current(events) }
          } catch { /* Ignore non-data messages and malformed exchange payloads. */ }
        }
        socket.onerror = () => socket.close()
        socket.onclose = () => {
          sockets.delete(socket)
          window.clearInterval(heartbeat)
          if (disposed) return
          update(exchange, 'reconnecting')
          attempts++
          const timer = window.setTimeout(() => { retries.delete(timer); open() }, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)))
          retries.add(timer)
        }
      }
      open()
    }
    connect('Binance', 'wss://fstream.binance.com/market/ws/btcusdt@forceOrder')
    connect('Bybit', 'wss://stream.bybit.com/v5/public/linear', { op: 'subscribe', args: ['allLiquidation.BTCUSDT'] })
    // Read contract size from instrument metadata instead of guessing USD notional.
    const startOkx = async () => {
      try {
        const response = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error('OKX instrument metadata unavailable')
        const payload = await response.json()
        const instrument = payload.data?.find((item: { instId?: string }) => item.instId === 'BTC-USDT-SWAP')
        const value = Number(instrument?.ctVal) * Number(instrument?.ctMult || 1)
        if (instrument?.ctValCcy !== 'BTC' || !Number.isFinite(value) || value <= 0) throw new Error('Invalid OKX contract size')
        if (!disposed) connect('OKX', 'wss://ws.okx.com:8443/ws/v5/public', { op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] }, value)
      } catch {
        if (disposed) return
        update('OKX', 'reconnecting')
        const timer = window.setTimeout(() => { retries.delete(timer); void startOkx() }, 30000)
        retries.add(timer)
      }
    }
    void startOkx()
    return () => {
      disposed = true
      controller.abort()
      retries.forEach((timer) => window.clearTimeout(timer))
      sockets.forEach((socket) => socket.close())
    }
  }, [])
  return statuses
}
