import test from 'node:test'
import assert from 'node:assert/strict'
import { OrderBook } from './dist/server/orderbook.js'

const snapshot = { lastUpdateId: 100, bids: [['100', '2']], asks: [['101', '3']] }

test('requires a snapshot, loads best prices, and ignores stale updates', () => {
  const book = new OrderBook('spot')
  assert.equal(book.apply({ U: 101, u: 101, b: [], a: [] }), false)
  book.load(snapshot)
  assert.equal(book.bestBid(), 100)
  assert.equal(book.bestAsk(), 101)
  assert.equal(book.apply({ U: 99, u: 100, b: [['100', '0']], a: [] }), true)
  assert.equal(book.bids.get(100), 2)
})

test('spot accepts an overlapping update and removes zero-quantity levels', () => {
  const book = new OrderBook('spot')
  book.load(snapshot)
  assert.equal(book.apply({ U: 100, u: 102, b: [['100', '0'], ['99', '4']], a: [] }), true)
  assert.equal(book.bids.has(100), false)
  assert.equal(book.bestBid(), 99)
  assert.equal(book.lastId, 102)
})

test('spot rejects missing or out-of-order updates without mutating the book', () => {
  const book = new OrderBook('spot')
  book.load(snapshot)
  assert.equal(book.apply({ U: 103, u: 104, b: [['100', '0']], a: [] }), false)
  assert.equal(book.lastId, 100)
  assert.equal(book.bids.get(100), 2)
  assert.equal(book.apply({ U: 101, u: 102, b: [], a: [] }), true)
  assert.equal(book.apply({ U: 101, u: 101, b: [['100', '0']], a: [] }), true)
  assert.equal(book.bids.get(100), 2)
})

test('futures validates previous update IDs', () => {
  const book = new OrderBook('futures')
  book.load(snapshot)
  assert.equal(book.apply({ U: 101, u: 102, pu: 100, b: [], a: [] }), true)
  assert.equal(book.apply({ U: 103, u: 104, pu: 101, b: [['100', '0']], a: [] }), false)
  assert.equal(book.lastId, 102)
  assert.equal(book.bids.get(100), 2)
})

test('invalid quantities are ignored and wall thresholds use USD notional', () => {
  const book = new OrderBook('spot')
  book.load(snapshot)
  book.apply({ U: 101, u: 101, b: [['100', '-1'], ['NaN', '5'], ['99', '20000']], a: [['101', 'Infinity']] })
  assert.equal(book.bids.get(100), 2)
  assert.equal(book.asks.get(101), 3)
  assert.deepEqual(book.walls(), [{ price: 99, quantity: 20000, notional: 1980000, side: 'bid' }])
})

test('futures first event bridges the snapshot even with an older pu', () => {
  const book = new OrderBook('futures')
  book.load(snapshot)
  assert.equal(book.synchronize({ U: 98, u: 100, pu: 95, b: [['100', '4']], a: [] }), true)
  assert.equal(book.bids.get(100), 4)
  assert.equal(book.apply({ U: 101, u: 103, pu: 100, b: [], a: [] }), true)
})

test('initial synchronization rejects a missing bridge for either market', () => {
  for (const market of ['spot', 'futures']) {
    const book = new OrderBook(market)
    book.load(snapshot)
    assert.equal(book.synchronize({ U: 102, u: 105, pu: 99, b: [['100', '0']], a: [] }), false)
    assert.equal(book.bids.get(100), 2)
    assert.equal(book.lastId, 100)
  }
})

test('futures requires pu after the initial bridge', () => {
  const book = new OrderBook('futures')
  book.load(snapshot)
  book.synchronize({ U: 99, u: 101, pu: 95, b: [], a: [] })
  assert.equal(book.apply({ U: 102, u: 103, b: [], a: [] }), false)
})
