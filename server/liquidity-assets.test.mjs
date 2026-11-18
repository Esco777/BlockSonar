import {test} from 'node:test'
import assert from 'node:assert/strict'
import {LIQUIDITY_FEEDS,feedKey,findLiquidityFeed} from './dist/src/lib/liquidity-exchanges.js'
import {parseLiquidityFrame,appendLiquidityFrame} from './dist/src/lib/liquidity-stream.js'
import {ExchangeOrderBook} from './dist/server/exchange-orderbook.js'
import {candleRequest} from './dist/src/lib/heatmap-candles.js'
test('BTC, ETH and SOL use separate books, history, symbols and asset-sized buckets',()=>{
 let history={}
 for(const [symbol,price,bucket] of [['BTC-USD',60000,25],['ETH-USD',2000,1],['SOL-USD',80,.1]]){
  const feed=findLiquidityFeed('coinbase','spot',symbol);assert.ok(feed)
  const book=new ExchangeOrderBook(feed)
  assert.equal(book.consume({type:'snapshot',product_id:'wrong',bids:[],asks:[]}),false)
  book.consume({type:'snapshot',product_id:symbol,bids:[[String(price),'10']],asks:[[String(price+.1),'20']]})
  const frame=book.frame(1000);assert.equal(frame.symbol,symbol);assert.equal(frame.bucketSize,bucket);assert.ok(parseLiquidityFrame(JSON.stringify(frame)))
  history=appendLiquidityFrame(history,frame)
  assert.match(candleRequest(frame,60),new RegExp(symbol))
 }
 assert.equal(Object.keys(history).length,3)
 assert.equal(history['coinbase:spot:ETH-USD'][0].symbol,'ETH-USD');assert.equal(history['coinbase:spot:SOL-USD'][0].symbol,'SOL-USD')
 assert.equal(findLiquidityFeed('coinbase','spot').symbol,'BTC-USD');assert.equal(findLiquidityFeed('coinbase','futures','ETH-USD'),undefined)
 assert.equal(new Set(LIQUIDITY_FEEDS.map(feedKey)).size,LIQUIDITY_FEEDS.length)
})

test('ETH/SOL futures route from Coinbase spot to Bybit and keep native sizes and distinct histories',async()=>{
 const {liquidityMarketFeed}=await import('./dist/src/lib/liquidity-exchanges.js')
 let history={}
 for(const [asset,price,bucket] of [['ETH',2000,1],['SOL',80,.1]]){
  const feed=liquidityMarketFeed(asset,'futures','coinbase');assert.equal(feed.exchange,'bybit');assert.equal(feed.symbol,`${asset}USDT`);assert.equal(feed.market,'futures')
  const book=new ExchangeOrderBook(feed)
  book.consume({topic:`orderbook.200.${asset}USDT`,type:'snapshot',data:{s:`${asset}USDT`,u:1,b:[[String(price),'2']],a:[[String(price+1),'3']]}})
  const frame=book.frame(2000);assert.equal(frame.bucketSize,bucket);assert.equal(frame.depth.bids[0].quantity,2);assert.equal(frame.depth.bids[0].notional,price*2);assert.ok(parseLiquidityFrame(JSON.stringify(frame)))
  history=appendLiquidityFrame(history,frame)
  assert.match(candleRequest(frame,60),/category=linear/)
  const spot=liquidityMarketFeed(asset,'spot','bybit');assert.equal(spot.market,'spot');assert.notEqual(feedKey(spot),feedKey(feed))
 }
 assert.equal(Object.keys(history).length,2)
 assert.equal(liquidityMarketFeed('BTC','futures','coinbase').exchange,'bybit')
})
