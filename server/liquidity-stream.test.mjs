import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLiquidityFrame, appendLiquidityFrame, MAX_FRAMES } from './dist/src/lib/liquidity-stream.js'
const frame = { exchange: 'bybit', quote: 'USDT', bucketSize: 25, depth: { bids: [], asks: [], updatedAt: 1000, midPrice: 100 }, time: 1000, market: 'spot', symbol: 'BTCUSDT', price: 100, levels: [{ price: 100, bidUsd: 200, askUsd: 0 }], walls: [] }

test('frame parser accepts exchange data and rejects malformed inputs', () => {
  assert.deepEqual(parseLiquidityFrame(JSON.stringify(frame)), frame)
  for (const input of ['null', '{}', 'bad', JSON.stringify({ ...frame, market: 'other' }), JSON.stringify({ ...frame, levels: [null] }), JSON.stringify({ ...frame, price: -10 })]) assert.equal(parseLiquidityFrame(input), null)
})

test('market histories stay separate, bounded, ordered and deduplicated on replay', () => {
  let history = { 'bybit:spot': [], 'bybit:futures': [] }
  for (let time = 0; time < MAX_FRAMES + 20; time++) history = appendLiquidityFrame(history, { ...frame, time })
  assert.equal(history['bybit:spot'].length, MAX_FRAMES)
  assert.equal(history['bybit:futures'].length, 0)
  history = appendLiquidityFrame(history, { ...frame, time: 100 })
  assert.equal(history['bybit:spot'].length, MAX_FRAMES)
  assert.equal(history['bybit:spot'].filter((item) => item.time === 100).length, 1)
  assert.equal(history['bybit:spot'].at(-1).time, MAX_FRAMES + 19)
  history = appendLiquidityFrame(history, { ...frame, market: 'futures' })
  assert.equal(history['bybit:futures'].length, 1)
})


test('rejects mismatched quotes and unsupported markets; keeps exchanges separate', () => {
  assert.equal(parseLiquidityFrame(JSON.stringify({ ...frame, exchange: 'coinbase' })), null)
  assert.equal(parseLiquidityFrame(JSON.stringify({ ...frame, exchange: 'coinbase', symbol: 'BTC-USD', quote: 'USD', market: 'futures' })), null)
  let history = appendLiquidityFrame({}, frame)
  history = appendLiquidityFrame(history, { ...frame, exchange: 'coinbase', symbol: 'BTC-USD', quote: 'USD' })
  assert.equal(history['bybit:spot'].length, 1)
  assert.equal(history['coinbase:spot'].length, 1)
})
