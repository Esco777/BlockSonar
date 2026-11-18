import test from 'node:test'
import assert from 'node:assert/strict'
import { topSonarNotifications,newestPoolNotifications,notificationRevision } from './dist/src/lib/notifications.js'
import { analyzeAssets,compareSonarSignals,DEFAULT_SIGNAL_RULES } from './dist/src/lib/sonar-research.js'
import { NotificationService } from './dist/server/notification-service.js'
const coin=(id,change,volume=100)=>({id,name:id,symbol:id,image:'',price:1,change,marketCap:100,volume,sparkline:[]})
const pool=(network,address,createdAt)=>({id:`${network}:${address}`,network,address,createdAt,name:address,symbol:address,image:null})
test('notification leaders match Sonar signal order, update from new inputs, and exclude sample data',()=>{
 const coins=[coin('a',1,0),coin('b',15),coin('c',-20)]
 assert.deepEqual(topSonarNotifications(coins,true).map(c=>c.id),analyzeAssets(coins,DEFAULT_SIGNAL_RULES).sort(compareSonarSignals).slice(0,2).map(c=>c.id))
 assert.deepEqual(topSonarNotifications(coins,false),[])
 assert.equal(topSonarNotifications([coin('a',1,0),coin('b',15)],true)[0].id,'b')
 assert.equal(topSonarNotifications([coin('a',25),coin('b',1,0)],true)[0].id,'a')
})
test('pool notifications pick two newest canonical pools, preserving different chains',()=>{
 const rows=newestPoolNotifications([pool('eth','0xAb',1),pool('ethereum','0xab',2),pool('solana','Sol',4),pool('bsc','0xAb',3)])
 assert.equal(rows.length,2)
 assert.deepEqual(rows.map(r=>r.network),['solana','bsc'])
})
test('notification revision changes with actual content but not collection timestamps',()=>{
 const feed={pools:[pool('solana','A',1)],narratives:{updatedAt:1,revision:'a',count:1},poolsCheckedAt:1,poolsDelayed:false}
 const initial=notificationRevision([coin('a',1)],feed)
 assert.equal(initial,notificationRevision([coin('a',1)],{...feed,poolsCheckedAt:2,narratives:{...feed.narratives,updatedAt:2}}))
 assert.notEqual(initial,notificationRevision([coin('a',2)],feed))
 assert.notEqual(initial,notificationRevision([coin('a',1)],{...feed,pools:[pool('solana','new-pool',3),pool('solana','A',1)]}))
 assert.notEqual(initial,notificationRevision([coin('a',1)],{...feed,narratives:{...feed.narratives,revision:'b'}}))
 assert.equal(notificationRevision([],null),'')
})
test('notification aggregation coalesces callers and remains useful when pool discovery fails',async()=>{
 let calls=0
 const radar={async snapshot(){return {updatedAt:100,narratives:[{id:'ai',score:20,evidence:[{id:'news'}]}]}}}
 const service=new NotificationService({async notificationPools(){calls++;throw new Error('Rate limited')}},radar)
 const [first,second]=await Promise.all([service.snapshot(),service.snapshot()])
 assert.equal(calls,1)
 assert.equal(first.poolsDelayed,true)
 assert.equal(first.narratives.count,1)
 assert.ok(first.narratives.revision)
 assert.equal(first.narratives.revision,second.narratives.revision)
})

test('new alert arrivals move their category above older categories across all feeds',async()=>{
 const {updateNotificationOrder,orderedNotificationSections}=await import('./dist/src/lib/notifications.js')
 let state={}
 for(const [section,revision] of [['sonar','s1'],['pools','p1'],['narratives','n1'],['liquidations','l1'],['pools','p2'],['sonar','s2']]){
   state=updateNotificationOrder(state,[{section,revision,sourceAt:100}])
   assert.equal(orderedNotificationSections(state)[0],section)
 }
 assert.deepEqual(orderedNotificationSections(state),['sonar','pools','liquidations','narratives'])
})
test('unchanged polling does not reorder alerts; simultaneous arrivals use their source times',async()=>{
 const {updateNotificationOrder,orderedNotificationSections}=await import('./dist/src/lib/notifications.js')
 const first=updateNotificationOrder({},[{section:'pools',revision:'p1',sourceAt:200},{section:'narratives',revision:'n1',sourceAt:100}])
 assert.equal(orderedNotificationSections(first)[0],'pools')
 const next=updateNotificationOrder(first,[{section:'narratives',revision:'n1',sourceAt:999}])
 assert.equal(next,first)
 assert.equal(orderedNotificationSections(next)[0],'pools')
 assert.equal(updateNotificationOrder(first,[{section:'sonar',revision:null,sourceAt:1000}]),first)
})
