import type { DepthSnapshot, LiquidityMarket, Market, Level, DepthEvent, Snapshot } from '../src/lib/liquidity-types.js'

/** Bounded snapshot storage; exchange synchronization will feed this store. */
export class OrderBookStore {
  private readonly snapshots = new Map<string, DepthSnapshot[]>()

  constructor(private readonly historyLimit = 300) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new Error('Invalid history limit')
  }

  record(market: LiquidityMarket, symbol: string, snapshot: DepthSnapshot): void {
    const key = `${market}:${symbol.toUpperCase()}`
    const history = this.snapshots.get(key) ?? []
    history.push(structuredClone(snapshot))
    if (history.length > this.historyLimit) history.splice(0, history.length - this.historyLimit)
    this.snapshots.set(key, history)
  }

  latest(market: LiquidityMarket, symbol: string): DepthSnapshot | null {
    const history = this.snapshots.get(`${market}:${symbol.toUpperCase()}`)
    return history?.length ? structuredClone(history[history.length - 1]) : null
  }

  clear(market: LiquidityMarket, symbol: string): void {
    this.snapshots.delete(`${market}:${symbol.toUpperCase()}`)
  }
}

export type { Market, Level, DepthEvent, Snapshot } from '../src/lib/liquidity-types.js'

export class OrderBook {
  bids = new Map<number, number>()
  asks = new Map<number, number>()
  lastId = 0
  ready = false

  constructor(public market: Market) {}

  load(snapshot: Snapshot) {
    this.bids.clear()
    this.asks.clear()

    for (const [p, q] of snapshot.bids) {
      if (+q > 0) this.bids.set(+p, +q)
    }
    for (const [p, q] of snapshot.asks) {
      if (+q > 0) this.asks.set(+p, +q)
    }

    this.lastId = snapshot.lastUpdateId
    this.ready = true
  }

  /** Bridge the REST snapshot to the first buffered stream event. */
  synchronize(event: DepthEvent): boolean {
    if (!this.ready) return false
    const target = this.market === 'spot' ? this.lastId + 1 : this.lastId
    if (event.U > target || event.u < target) return false
    this.updateSide(this.bids, event.b)
    this.updateSide(this.asks, event.a)
    this.lastId = event.u
    return true
  }

  apply(event: DepthEvent): boolean {
    if (!this.ready) return false
    // Ignore updates already included in the snapshot.
    if (event.u <= this.lastId) return true

    if (this.market === 'spot') {
      // The next update must cover lastId + 1.
      if (event.U > this.lastId + 1 || event.u < this.lastId + 1) return false
    } else {
      // Futures uses pu to validate continuity after initial synchronization.
      if (event.pu !== this.lastId) return false
    }

    this.updateSide(this.bids, event.b)
    this.updateSide(this.asks, event.a)
    this.lastId = event.u
    return true
  }

  private updateSide(side: Map<number, number>, levels: Level[]) {
    for (const [priceText, qtyText] of levels) {
      const price = Number(priceText)
      const qty = Number(qtyText)
      if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty < 0) continue
      if (qty === 0) side.delete(price)
      else side.set(price, qty)
    }
  }

  bestBid() {
    return Math.max(...this.bids.keys())
  }

  bestAsk() {
    return Math.min(...this.asks.keys())
  }

  walls(minUsd = 1_000_000) {
    const extract = (side: Map<number, number>, type: 'bid' | 'ask') =>
      [...side.entries()]
        .map(([price, quantity]) => ({ price, quantity, notional: price * quantity, side: type }))
        .filter((x) => x.notional >= minUsd)
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 10)

    return [...extract(this.bids, 'bid'), ...extract(this.asks, 'ask')]
  }
}
