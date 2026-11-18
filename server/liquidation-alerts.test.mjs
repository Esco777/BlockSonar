import test from 'node:test'
import assert from 'node:assert/strict'
import { LiquidationBlockAlerts } from './dist/src/lib/liquidation-alerts.js'
import { groupLiquidationEvents } from './dist/src/lib/liquidation-feeds.js'
const block=(key,latestAt=1100)=>({key,latestAt,time:1,candleIndex:0,price:100,side:'Long',exchange:'Binance',notional:100,count:1})
test('liquidation alerts trigger after each three distinct new blocks, with remainder carried forward',()=>{
 const tracker=new LiquidationBlockAlerts(1000)
 assert.equal(tracker.update([block('a'),block('b')],300).length,0)
 const first=tracker.update([block('a'),block('b'),block('c')],300)
 assert.equal(first.length,1)
 assert.equal(first[0].message,'Look at these liquidation blocks!')
 assert.deepEqual(first[0].blockKeys,['a','b','c'])
 assert.equal(tracker.update(['a','b','c','d','e'].map(k=>block(k)),300).length,1)
 assert.equal(tracker.update(['a','b','c','d','e','f'].map(k=>block(k)),300).length,2)
})
test('restored history, duplicate fills, reconnection replays and old events never create alerts',()=>{
 const tracker=new LiquidationBlockAlerts(1000)
 const old=[block('old1',100),block('old2',200),block('old3',300)]
 assert.equal(tracker.update(old,300).length,0)
 assert.equal(tracker.update(old,300).length,0)
 assert.equal(tracker.update([...old,block('a')],300).length,0)
 assert.equal(tracker.update([...old,block('a',1200)],300).length,0)
 assert.equal(tracker.update([...old,block('a'),block('b'),block('c')],300).length,1)
})
test('timeframe regrouping resets partial counts without manufacturing block alerts',()=>{
 const tracker=new LiquidationBlockAlerts(1000)
 tracker.update([block('a'),block('b')],300)
 assert.equal(tracker.update([block('x'),block('y'),block('z')],60).length,0)
 assert.equal(tracker.update([block('x'),block('y'),block('z'),block('d'),block('e')],60).length,0)
 const next=tracker.update([block('x'),block('y'),block('z'),block('d'),block('e'),block('f')],60)
 assert.equal(next.length,1)
 assert.deepEqual(next[0].blockKeys,['d','e','f'])
})
test('six blocks in a batch produce two alerts and only the latest five records are retained',()=>{
 const tracker=new LiquidationBlockAlerts(1000)
 assert.equal(tracker.update(Array.from({length:6},(_,i)=>block(`b${i}`)),300).length,2)
 const alerts=tracker.update(Array.from({length:21},(_,i)=>block(`b${i}`)),300)
 assert.equal(alerts.length,5)
 assert.equal(new Set(alerts.map(a=>a.id)).size,5)
})
test('uses the map grouping so multiple liquidation prints in one rendered block count once',()=>{
 const start=1800000000000,tracker=new LiquidationBlockAlerts(start)
 const candles=[{time:start/1000,open:100,close:100,high:110,low:90}]
 const events=Array.from({length:3},(_,i)=>({id:`event${i}`,exchange:'Binance',side:'Long',price:100,notional:1000,receivedAt:start+1000+i}))
 const groups=groupLiquidationEvents(events,candles,300)
 assert.equal(groups.length,1)
 assert.equal(tracker.update(groups,300).length,0)
 const extra=[...events,{...events[0],id:'new2',price:110},{...events[0],id:'new3',exchange:'Bybit'}]
 const alerts=tracker.update(groupLiquidationEvents(extra,candles,300),300)
 assert.equal(alerts.length,1)
 assert.equal(alerts[0].blockKeys.length,3)
})
