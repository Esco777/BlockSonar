import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExchangeLiquidations, groupLiquidationEvents } from './dist/src/lib/liquidation-feeds.js'
const time = 1700000001000
const binance = { e: 'forceOrder', o: { s: 'BTCUSDT', S: 'SELL', ap: '60000', z: '2', T: time } }
const bybit = { topic: 'allLiquidation.BTCUSDT', data: [{ s: 'BTCUSDT', S: 'Buy', p: '60000', v: '2', T: time }] }
const okx = { arg: { channel: 'liquidation-orders' }, data: [{ instId: 'BTC-USDT-SWAP', details: [{ posSide: 'long', side: 'sell', bkPx: '60000', sz: '200', ts: String(time) }] }] }

test('three exchange formats normalize to the same liquidated position and USD amount', () => {
  for (const [exchange, payload] of [['Binance', binance], ['Bybit', bybit], ['OKX', okx]]) {
    const [event] = parseExchangeLiquidations(exchange, payload, .01)
    assert.equal(event.exchange, exchange)
    assert.equal(event.side, 'Long')
    assert.equal(event.notional, 120000)
    assert.equal(event.receivedAt, time)
  }
})

test('OKX nested details include all BTC orders and exclude other instruments', () => {
  const payload = structuredClone(okx)
  payload.data[0].details.push({ posSide: 'short', side: 'buy', bkPx: '60010', sz: '100', ts: String(time + 1) })
  payload.data.push({ instId: 'ETH-USDT-SWAP', details: payload.data[0].details })
  const events = parseExchangeLiquidations('OKX', payload, .01)
  assert.equal(events.length, 2)
  assert.equal(events[1].side, 'Short')
  assert.equal(events[1].notional, 60010)
  assert.deepEqual(parseExchangeLiquidations('OKX', payload), [])
})

test('rejects other symbols, malformed messages, and non-finite quantities', () => {
  assert.deepEqual(parseExchangeLiquidations('Bybit', { ...bybit, data: [{ ...bybit.data[0], s: 'ETHUSDT' }] }), [])
  assert.deepEqual(parseExchangeLiquidations('Binance', { e: 'forceOrder', o: { ...binance.o, z: 'Infinity', q: 'Infinity' } }), [])
  for (const exchange of ['Binance', 'Bybit', 'OKX']) assert.deepEqual(parseExchangeLiquidations(exchange, null), [])
})

test('same candle, price and side retain separate exchange blocks', () => {
  const events = [...parseExchangeLiquidations('Binance', binance), ...parseExchangeLiquidations('Bybit', bybit), ...parseExchangeLiquidations('OKX', okx, .01)]
  const candles = [{ time: 1700000000, open: 60000, high: 60100, low: 59900, close: 60000 }]
  const groups = groupLiquidationEvents([...events, { ...events[0], id: 'second' }], candles, 60)
  assert.equal(groups.length, 3)
  assert.equal(groups.find((block) => block.exchange === 'Binance').count, 2)
  assert.equal(groups.find((block) => block.exchange === 'Bybit').notional, 120000)
})
