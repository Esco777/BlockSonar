import type { LiquidationEvent, StreamStatus, Candle } from './liquidity-types.js'

export const LIQUIDATION_EXCHANGES = ['Binance', 'Bybit', 'OKX'] as const
export type LiquidationExchange = typeof LIQUIDATION_EXCHANGES[number]
export type LiquidationFeedStatus = Record<LiquidationExchange, StreamStatus>
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0
export function parseLiquidationSide(value: unknown): LiquidationEvent['side'] | null {
  const side = String(value).toLowerCase()
  if (side === 'long' || side === 'sell') return 'Long'
  if (side === 'short' || side === 'buy') return 'Short'
  return null
}

export function parseExchangeLiquidations(exchange: LiquidationExchange, message: unknown, okxContractBtc?: number): LiquidationEvent[] {
  const payload = record(message)
  const events: LiquidationEvent[] = []
  const add = (side: LiquidationEvent['side'] | null, priceValue: unknown, qtyValue: unknown, timeValue: unknown) => {
    if (!side || !positive(priceValue) || !positive(qtyValue) || !positive(timeValue)) return
    const price = Number(priceValue), quantity = Number(qtyValue), receivedAt = Number(timeValue)
    const notional = price * quantity
    if (!Number.isFinite(notional)) return
    events.push({ id: `${exchange}-${receivedAt}-${side}-${price}-${quantity}`, exchange, side, price, notional, receivedAt })
  }
  if (exchange === 'Binance') {
    const data = payload.data ? record(payload.data) : payload
    const order = record(data.o)
    if (data.e === 'forceOrder' && order.s === 'BTCUSDT') add(parseLiquidationSide(order.S), positive(order.ap) ? order.ap : order.p, positive(order.z) ? order.z : order.q, order.T ?? data.E)
  } else if (exchange === 'Bybit') {
    if (payload.topic !== 'allLiquidation.BTCUSDT' || !Array.isArray(payload.data)) return []
    for (const item of payload.data) {
      const order = record(item)
      if (order.s !== 'BTCUSDT') continue
      // Bybit sends POSITION side; Binance sends the closing ORDER side.
      const side = order.S === 'Buy' ? 'Long' : order.S === 'Sell' ? 'Short' : null
      add(side, order.p, order.v, order.T)
    }
  } else {
    if (record(payload.arg).channel !== 'liquidation-orders' || !Array.isArray(payload.data) || !positive(okxContractBtc)) return []
    for (const item of payload.data) {
      const instrument = record(item)
      if (instrument.instId !== 'BTC-USDT-SWAP' || !Array.isArray(instrument.details)) continue
      for (const item of instrument.details) {
        const order = record(item)
        const side = order.posSide === 'long' ? 'Long' : order.posSide === 'short' ? 'Short' : parseLiquidationSide(order.side)
        add(side, order.bkPx, Number(order.sz) * okxContractBtc!, order.ts)
      }
    }
  }
  return events
}

export function groupLiquidationEvents(liquidations: LiquidationEvent[], candles: Candle[], timeframeSeconds: number) {
    const groups = new Map<string, { time: Candle['time']; candleIndex: number; side: LiquidationEvent['side']; exchange: string; weightedPrice: number; weight: number; notional: number; count: number; latestAt: number }>()
    liquidations.forEach((event) => {
      const eventTime = Math.floor(event.receivedAt / 1_000)
      const candleIndex = candles.findIndex((item) => eventTime >= item.time && eventTime < item.time + timeframeSeconds)
      if (candleIndex < 0) return
      const candle = candles[candleIndex]
      const priceBucket = Math.round(event.price / 5) * 5
      const key = `${candle.time}-${priceBucket}-${event.side}-${event.exchange}`
      const group = groups.get(key)
      if (group) {
        group.weightedPrice += event.price * event.notional
        group.weight += event.notional
        group.notional += event.notional
        group.count += 1
        group.latestAt = Math.max(group.latestAt, event.receivedAt)
      } else {
        groups.set(key, { time: candle.time, candleIndex, side: event.side, exchange: event.exchange, weightedPrice: event.price * event.notional, weight: event.notional, notional: event.notional, count: 1, latestAt: event.receivedAt })
      }
    })
    return [...groups.entries()].map(([key, group]) => ({
      key,
      time: group.time,
      candleIndex: group.candleIndex,
      side: group.side,
      exchange: group.exchange,
      price: group.weight ? group.weightedPrice / group.weight : 0,
      notional: group.notional,
      count: group.count,
      latestAt: group.latestAt,
    }))
}
