import { encodeBase58 } from 'ethers'
import test from 'node:test'
import assert from 'node:assert/strict'
import { recentWhalePurchase } from './dist/src/lib/whale-sonar.js'
const address=`0x${'1'.repeat(40)}`,token=`0x${'2'.repeat(40)}`,signature=`0x${'a'.repeat(64)}`
const now=1800000000000
const purchase=(at=now-60000,extra={})=>({wallet:address,token,signature,symbol:'TOKEN',amount:'1.000000000000000001',balance:'2000',at,...extra})
const search=(purchases=[],holders=[{address,amount:'2500',isContract:false}])=>({holders,purchases,parameters:{whaleMinimum:'1000'}})
test('Wallet Sonar selects the newest verified purchase without mutating the purchase feed',()=>{
 const old=purchase(now-900000),recent=purchase(),feed=search([old,recent])
 const selected=recentWhalePurchase('ethereum',feed,null,now)
 assert.equal(selected.at,recent.at);assert.equal(selected.amount,recent.amount)
 assert.equal(selected.balance,'2500','the card displays the current search balance')
 assert.equal(feed.purchases[0].at,old.at)
})
test('a verified buy remains visible during the next scan while its whale still qualifies',()=>{
 const previous=purchase()
 assert.equal(recentWhalePurchase('ethereum',search(),previous,now).signature,previous.signature)
 assert.equal(recentWhalePurchase('ethereum',search([],[]),previous,now),null)
 assert.equal(recentWhalePurchase('ethereum',search([],[{address,amount:'999',isContract:false}]),previous,now),null)
 assert.equal(recentWhalePurchase('ethereum',search([],[{address,amount:'2000',isContract:true}]),previous,now),null)
 assert.equal(recentWhalePurchase('ethereum',null,previous,now),null)
})
test('stale, future, malformed and wrong-chain purchases never appear as recent buys',()=>{
 const invalid=[purchase(now-86400001),purchase(now+1),purchase(now-1,{signature:'not-a-transaction'}),purchase(now-1,{token:'https://invalid.test'}),purchase(now-1,{amount:'NaN'}),purchase(now-1,{amount:'0'})]
 assert.equal(recentWhalePurchase('ethereum',search(invalid),null,now),null)
 assert.equal(recentWhalePurchase('solana',search([purchase()]),null,now),null)
 assert.equal(recentWhalePurchase('ethereum',search(),purchase(now-86400001),now),null)
})

test('Solana purchases use the Solana wallet identity and cannot appear in the Ethereum card',()=>{
 const sol=n=>encodeBase58(Buffer.alloc(32,n)),wallet=sol(1)
 const buy=purchase(now-1000,{wallet,token:sol(2),signature:encodeBase58(Buffer.alloc(64,9))})
 const feed=search([buy],[{address:wallet,amount:'20000',isContract:false}]);feed.parameters.whaleMinimum='10000'
 assert.equal(recentWhalePurchase('solana',feed,null,now).token,sol(2))
 assert.equal(recentWhalePurchase('ethereum',feed,null,now),null)
})
