import test from 'node:test'
import assert from 'node:assert/strict'
import { ExchangeOrderBook } from './dist/server/exchange-orderbook.js'
import { findLiquidityFeed } from './dist/src/lib/liquidity-exchanges.js'
const book = (exchange, market = 'spot', multiplier = 1) => new ExchangeOrderBook(findLiquidityFeed(exchange, market), multiplier)

test('Coinbase ordered snapshot/delta state replaces quantities and removes zero levels', () => {
  const state = book('coinbase')
  assert.throws(() => state.consume({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '100', '1']] }), /before snapshot/)
  state.consume({ type: 'snapshot', product_id: 'BTC-USD', bids: [['100', '2'], ['99', '3']], asks: [['101', '4']] })
  state.consume({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '100', '0'], ['sell', '101', '6']] })
  assert.equal(state.bids.has(100), false)
  assert.equal(state.asks.get(101), 6)
  const frame = state.frame(1000)
  assert.equal(frame.exchange, 'coinbase')
  assert.equal(frame.quote, 'USD')
  assert.equal(frame.price, 100)
})

test('Bybit deltas need snapshot; repeated snapshots and service restarts replace old state', () => {
  const state = book('bybit')
  const message = (type, u, bids) => ({ topic: 'orderbook.200.BTCUSDT', type, data: { s: 'BTCUSDT', u, b: bids, a: [['101', '2']] } })
  assert.throws(() => state.consume(message('delta', 2, [['100', '1']])), /before snapshot/)
  state.consume(message('snapshot', 10, [['100', '1']]))
  state.consume(message('delta', 11, [['100', '3']]))
  state.consume(message('delta', 10, [['100', '9']]))
  assert.equal(state.bids.get(100), 3)
  state.consume(message('snapshot', 1, [['99', '4']]))
  assert.equal(state.bids.has(100), false)
})

test('Gemini partial depth is a fresh snapshot, not a delta merged with old levels', () => {
  const state = book('gemini')
  state.consume({ lastUpdateId: 1, bids: [['100', '2']], asks: [['101', '3']] })
  state.consume({ lastUpdateId: 2, bids: [['99', '4']], asks: [['102', '5']] })
  assert.equal(state.bids.has(100), false)
  assert.equal(state.frame(1000).symbol, 'BTCUSD')
})

test('OKX ignores deprecated zero checksum and detects sequence gaps before mutation', () => {
  const state = book('okx')
  const message = (action, seqId, prevSeqId, bids) => ({ arg: { channel: 'books', instId: 'BTC-USDT' }, action, data: [{ seqId, prevSeqId, checksum: 0, bids, asks: [['101', '3', '0', '1']] }] })
  state.consume(message('snapshot', 10, -1, [['100', '2', '0', '1']]))
  state.consume(message('update', 11, 10, [['100', '4', '0', '1']]))
  assert.throws(() => state.consume(message('update', 13, 12, [['100', '0']])), /sequence gap/)
  assert.equal(state.bids.get(100), 4)
  state.consume(message('update', 1, 11, [])) // documented maintenance sequence reset
  assert.equal(state.lastId, 1)
})

test('OKX perpetual contracts normalize to BTC before aggregation and wall sizing', () => {
  const state = book('okx', 'futures', .01)
  state.consume({ arg: { channel: 'books', instId: 'BTC-USDT-SWAP' }, action: 'snapshot', data: [{ seqId: 10, prevSeqId: -1, checksum: 0, bids: [['60000', '2000']], asks: [['60025', '100']] }] })
  const frame = state.frame(1000)
  assert.equal(frame.depth.bids[0].quantity, 20)
  assert.equal(frame.walls[0].notional, 1200000)
  assert.equal(frame.levels.find((level) => level.price === 60000).bidUsd, 1200000)
  assert.equal(frame.quote, 'USDT')
})

test('rejects invalid levels and avoids emitting empty or crossed books', () => {
  const state = book('coinbase')
  assert.equal(state.frame(1000), null)
  assert.throws(() => state.consume({ type: 'snapshot', product_id: 'BTC-USD', bids: [['NaN', '1']], asks: [] }), /Invalid/)
  state.consume({ type: 'snapshot', product_id: 'BTC-USD', bids: [['102', '1']], asks: [['101', '1']] })
  assert.equal(state.frame(1000), null)
})
