import type { Market } from './liquidity-types.js'

export type LiquidityExchange = 'bybit' | 'coinbase' | 'gemini' | 'okx' | 'binance'
export type LiquidityFeed = { exchange: LiquidityExchange; name: string; market: Market; symbol: string; quote: 'USD' | 'USDT'; depth: number; bucketSize?: number }
export const LIQUIDITY_FEEDS: LiquidityFeed[] = [
  { exchange: 'binance', name: 'Binance', market: 'spot', symbol: 'BTCUSDT', quote: 'USDT', depth: 200 },
  { exchange: 'binance', name: 'Binance', market: 'futures', symbol: 'BTCUSDT', quote: 'USDT', depth: 200 },
  { exchange: 'coinbase', name: 'Coinbase', market: 'spot', symbol: 'BTC-USD', quote: 'USD', depth: 200 },
  { exchange: 'coinbase', name: 'Coinbase', market: 'spot', symbol: 'ETH-USD', quote: 'USD', depth: 200, bucketSize: 1 },
  { exchange: 'coinbase', name: 'Coinbase', market: 'spot', symbol: 'SOL-USD', quote: 'USD', depth: 200, bucketSize: .1 },
  { exchange: 'bybit', name: 'Bybit', market: 'spot', symbol: 'BTCUSDT', quote: 'USDT', depth: 200 },
  { exchange: 'bybit', name: 'Bybit', market: 'futures', symbol: 'BTCUSDT', quote: 'USDT', depth: 200 },
  ...(['ETH', 'SOL'] as const).flatMap(asset => (['spot', 'futures'] as const).map(market => ({exchange:'bybit' as const,name:'Bybit',market,symbol:`${asset}USDT`,quote:'USDT' as const,depth:200,bucketSize:asset==='ETH'?1:.1}))),
  { exchange: 'gemini', name: 'Gemini', market: 'spot', symbol: 'BTCUSD', quote: 'USD', depth: 20 },
  { exchange: 'okx', name: 'OKX', market: 'spot', symbol: 'BTC-USDT', quote: 'USDT', depth: 200 },
  { exchange: 'okx', name: 'OKX', market: 'futures', symbol: 'BTC-USDT-SWAP', quote: 'USDT', depth: 200 },
]
export const feedKey = (feed: Pick<LiquidityFeed, 'exchange' | 'market'> & {symbol?:string}) => `${feed.exchange}:${feed.market}${feed.symbol && !feed.symbol.startsWith('BTC') ? `:${feed.symbol}` : ''}`
export const findLiquidityFeed = (exchange: string, market: string, symbol?:string) => LIQUIDITY_FEEDS.find(feed => feed.exchange === exchange && feed.market === market && (symbol ? feed.symbol === symbol : feed.symbol.startsWith('BTC')))

export function liquidityMarketFeed(asset:'BTC'|'ETH'|'SOL',market:Market,exchange:LiquidityExchange):LiquidityFeed {
 const available=LIQUIDITY_FEEDS.filter(feed=>feed.market===market&&feed.symbol.startsWith(asset))
 const feed=available.find(feed=>feed.exchange===exchange)??available.find(feed=>feed.exchange==='bybit')??available[0]
 if(!feed)throw new Error('Unsupported liquidity asset and market')
 return feed
}
