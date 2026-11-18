import type { DepthSnapshot, Level, LiquidityFrame } from '../src/lib/liquidity-types.js'
import type { LiquidityFeed } from '../src/lib/liquidity-exchanges.js'

type Update = { snapshot: boolean; bids: Level[]; asks: Level[]; sequence?: number; previous?: number }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
function levels(value: unknown): Level[] {
  if (!Array.isArray(value)) throw new Error('Missing order-book levels')
  return value.map((row) => {
    if (!Array.isArray(row) || row.length < 2 || !Number.isFinite(Number(row[0])) || Number(row[0]) <= 0 || !Number.isFinite(Number(row[1])) || Number(row[1]) < 0) throw new Error('Invalid order-book level')
    return [String(row[0]), String(row[1])]
  })
}
function sided(changes: unknown): { bids: Level[]; asks: Level[] } {
  const bids: Level[] = [], asks: Level[] = []
  if (!Array.isArray(changes)) throw new Error('Missing order-book changes')
  for (const row of changes) {
    if (!Array.isArray(row) || !['buy', 'sell'].includes(row[0])) throw new Error('Invalid book side')
    ;(row[0] === 'buy' ? bids : asks).push(...levels([[row[1], row[2]]]))
  }
  return { bids, asks }
}
export class ExchangeOrderBook {
  bids = new Map<number, number>()
  asks = new Map<number, number>()
  ready = false
  lastId: number | null = null
  constructor(public readonly feed: LiquidityFeed, private readonly multiplier = 1) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error('Invalid contract multiplier')
  }
  private apply(update: Update) {
    if (!update.snapshot && !this.ready) throw new Error('Delta received before snapshot')
    if (update.snapshot) { this.bids.clear(); this.asks.clear(); this.lastId = null }
    else if (this.feed.exchange === 'okx') {
      if (update.previous !== this.lastId) throw new Error('OKX sequence gap')
    } else if (update.sequence !== undefined && this.lastId !== null && update.sequence <= this.lastId) return
    const write = (side: Map<number, number>, rows: Level[]) => {
      for (const [p, q] of rows) {
        const price = Number(p), quantity = Number(q) * this.multiplier
        if (!Number.isFinite(quantity)) throw new Error('Invalid normalized size')
        if (!quantity) side.delete(price); else side.set(price, quantity)
      }
    }
    write(this.bids, update.bids); write(this.asks, update.asks)
    if (this.bids.size > 100000 || this.asks.size > 100000) throw new Error('Book capacity exceeded; resnapshot required')
    this.lastId = update.sequence ?? this.lastId
    this.ready = true
  }
  loadSnapshot(bids: Level[], asks: Level[]) {
    this.apply({ snapshot: true, bids: levels(bids), asks: levels(asks) })
  }
  consume(message: unknown): boolean {
    const data = record(message)
    if (data.event === 'error' || data.type === 'error' || data.success === false) throw new Error(String(data.msg ?? data.message ?? data.ret_msg ?? 'Exchange subscription rejected'))
    if (this.feed.exchange === 'bybit') {
      if (data.topic !== `orderbook.200.${this.feed.symbol}`) return false
      const book = record(data.data)
      if (book.s !== this.feed.symbol || !Number.isSafeInteger(book.u)) throw new Error('Invalid Bybit update')
      this.apply({ snapshot: data.type === 'snapshot' || book.u === 1, bids: levels(book.b), asks: levels(book.a), sequence: Number(book.u) })
    } else if (this.feed.exchange === 'coinbase') {
      if (data.product_id !== this.feed.symbol || !['snapshot', 'l2update'].includes(String(data.type))) return false
      this.apply(data.type === 'snapshot' ? { snapshot: true, bids: levels(data.bids), asks: levels(data.asks) } : { snapshot: false, ...sided(data.changes) })
    } else if (this.feed.exchange === 'gemini') {
      // Gemini's public partial-depth stream sends complete top-20 snapshots.
      if (!Array.isArray(data.bids) || !Array.isArray(data.asks)) return false
      this.apply({ snapshot: true, bids: levels(data.bids), asks: levels(data.asks), sequence: Number(data.lastUpdateId) })
    } else {
      const arg = record(data.arg)
      if (arg.channel !== 'books' || arg.instId !== this.feed.symbol || !Array.isArray(data.data)) return false
      for (const value of data.data) {
        const book = record(value)
        if (!Number.isSafeInteger(book.seqId) || !Number.isSafeInteger(book.prevSeqId)) throw new Error('Invalid OKX sequence')
        this.apply({ snapshot: data.action === 'snapshot', bids: levels(book.bids), asks: levels(book.asks), sequence: Number(book.seqId), previous: Number(book.prevSeqId) })
      }
    }
    return true
  }
  frame(time: number, bucketSize = this.feed.bucketSize ?? 25, minWall = 1000000): LiquidityFrame | null {
    if (!this.ready) return null
    const bids = [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, this.feed.depth)
    const asks = [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, this.feed.depth)
    if (!bids.length || !asks.length || bids[0][0] >= asks[0][0]) return null
    const buckets = new Map<number, { price: number; bidUsd: number; askUsd: number }>()
    const walls: LiquidityFrame['walls'] = []
    for (const [rows, side] of [[bids, 'bid'], [asks, 'ask']] as const) for (const [price, quantity] of rows) {
      const key = Math.floor(price / bucketSize) * bucketSize
      const row = buckets.get(key) ?? { price: key, bidUsd: 0, askUsd: 0 }
      const notional = price * quantity
      row[side === 'bid' ? 'bidUsd' : 'askUsd'] += notional
      buckets.set(key, row)
      if (notional >= minWall) walls.push({ price, quantity, notional, side })
    }
    const price = (bids[0][0] + asks[0][0]) / 2
    const toLevels = (rows: number[][]) => rows.slice(0, 20).map(([price, quantity]) => ({ price, quantity, notional: price * quantity }))
    const depth: DepthSnapshot = { bids: toLevels(bids), asks: toLevels(asks), midPrice: price, updatedAt: time }
    return { exchange: this.feed.exchange, market: this.feed.market, symbol: this.feed.symbol, quote: this.feed.quote, bucketSize, time, price, levels: [...buckets.values()].sort((a, b) => a.price - b.price), walls: walls.sort((a, b) => b.notional - a.notional).slice(0, 20), depth }
  }
}
