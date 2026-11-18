import test from 'node:test'
import assert from 'node:assert/strict'
import { candleRequest, parseHeatmapCandles } from './dist/src/lib/heatmap-candles.js'

test('exchange candle formats preserve real OHLC and sort timestamps', () => {
  const time = 1800000000000
  const expected = [{ time, open: 100, high: 110, low: 90, close: 105, count: 1 }]
  assert.deepEqual(parseHeatmapCandles('coinbase', [[time / 1000, 90, 110, 100, 105]], 300), expected)
  for (const exchange of ['binance', 'gemini']) assert.deepEqual(parseHeatmapCandles(exchange, [[time, 100, 110, 90, 105]], 300), expected)
  assert.deepEqual(parseHeatmapCandles('bybit', { retCode: 0, result: { list: [[String(time), '100', '110', '90', '105']] } }, 300), expected)
  assert.deepEqual(parseHeatmapCandles('okx', { code: '0', data: [[String(time), '100', '110', '90', '105']] }, 300), expected)
})

test('ten-minute bars aggregate actual five-minute OHLC rather than inventing candles', () => {
  const time = 1800000000000
  const result = parseHeatmapCandles('binance', [[time + 300000, 105, 120, 95, 115], [time, 100, 110, 90, 105]], 600)
  assert.deepEqual(result, [{ time, open: 100, high: 120, low: 90, close: 115, count: 2 }])
  assert.deepEqual(parseHeatmapCandles('coinbase', [[time / 1000, 90, 80, 100, 105]], 300), [])
  assert.throws(() => parseHeatmapCandles('bybit', { retCode: 10001 }, 300))
})

test('candle requests preserve the selected exchange, symbol, and spot/futures market', () => {
  const feed = { exchange: 'binance', market: 'futures', symbol: 'BTCUSDT' }
  assert.match(candleRequest(feed, 300), /fapi.binance.com\/fapi\/v1\/klines.*interval=5m/)
  assert.match(candleRequest({ ...feed, market: 'spot' }, 300), /api.binance.com\/api\/v3/)
  assert.match(candleRequest({ ...feed, exchange: 'bybit' }, 300), /category=linear/)
  assert.match(candleRequest({ ...feed, exchange: 'okx', symbol: 'BTC-USDT-SWAP' }, 3600), /instId=BTC-USDT-SWAP&bar=1H/)
})


test('every minute-and-higher timeframe requests a supported interval for each feed', () => {
  for (const exchange of ['coinbase', 'gemini', 'bybit', 'okx', 'binance']) {
    for (const seconds of [60, 120, 300, 600, 900, 1800, 3600, 14400, 86400, 604800]) {
      assert.ok(candleRequest({ exchange, market: 'spot', symbol: 'BTCUSD' }, seconds))
    }
  }
  assert.match(candleRequest({ exchange: 'coinbase', market: 'spot', symbol: 'BTC-USD' }, 14400), /granularity=3600/)
  assert.match(candleRequest({ exchange: 'bybit', market: 'futures', symbol: 'BTCUSDT' }, 86400), /interval=D/)
  assert.match(candleRequest({ exchange: 'okx', market: 'spot', symbol: 'BTC-USDT' }, 604800), /bar=1Wutc/)
  assert.match(candleRequest({ exchange: 'gemini', market: 'spot', symbol: 'btcusd' }, 604800), /\/1d$/)
})

test('weekly candle aggregation aligns with UTC Monday', () => {
  const monday = Date.UTC(2026, 10, 2)
  const rows = [[monday, 100, 110, 90, 105], [monday + 86400000, 105, 120, 100, 115]]
  assert.deepEqual(parseHeatmapCandles('binance', rows, 604800), [{ time: monday, open: 100, high: 120, low: 90, close: 115, count: 2 }])
})
