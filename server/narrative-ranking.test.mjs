import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCategoryRankings } from './dist/server/narrative-ranking.js'
import { rankNarratives, CATEGORY_SCORE_MODEL } from './dist/src/lib/narrative-ranking.js'
const now=1800000000000, HOUR=3600000
const narrative=(id)=>({id,name:id,categoryId:id,evidence:[],score:0,coverage:20,points:[{time:now,score:0,volume:null,coverage:20}]})
const category=(id,extra={})=>({id,name:id,volume:100,marketCap:1000,change24h:2,updatedAt:now,topCoinIds:[],...extra})
test('market activity immediately scores categories without news or an hourly baseline',()=>{
 const [result]=calculateCategoryRankings([narrative('a')],[category('a')],now,true)
 assert.ok(result.liveRanking.score>0)
 assert.equal(result.liveRanking.status,'current')
 assert.ok(result.liveRanking.inputs.some(i=>i.key==='turnover'))
 assert.ok(result.liveRanking.inputs.some(i=>i.key==='momentum'))
 assert.equal(result.liveRanking.inputs.some(i=>i.key==='volumeTrend'),false)
 assert.equal(result.score,0,'legacy evidence score remains intact for historical alerts')
})
test('a category moves above its peers when measured momentum and turnover improve',()=>{
 const items=[narrative('a'),narrative('b')]
 const first=calculateCategoryRankings(items,[category('a'),category('b',{change24h:8,volume:500})],now,true)
 assert.equal(first[0].id,'b')
 const next=calculateCategoryRankings(items,[category('a',{change24h:15,volume:800}),category('b')],now,true)
 assert.equal(next[0].id,'a')
 assert.deepEqual(rankNarratives([...next].reverse()).map(n=>n.id),['a','b'])
})
test('missing and stale data are unavailable, not fabricated zeros; delayed data is explicit',()=>{
 const a=narrative('a')
 assert.equal(calculateCategoryRankings([a],[],now,true)[0].liveRanking.score,null)
 assert.equal(calculateCategoryRankings([a],[category('a',{updatedAt:now-HOUR-1})],now,true)[0].liveRanking.score,null)
 assert.equal(calculateCategoryRankings([a],[category('a',{updatedAt:now+1})],now,true)[0].liveRanking.score,null)
 assert.equal(calculateCategoryRankings([a],[category('a',{updatedAt:now-20*60000})],now,true)[0].liveRanking.status,'delayed')
 assert.equal(calculateCategoryRankings([a],[category('a',{volume:NaN,marketCap:0,change24h:null})],now,true)[0].liveRanking.score,null)
 const zero=calculateCategoryRankings([a],[category('a',{volume:0,change24h:-100})],now,false)[0]
 assert.equal(zero.liveRanking.score,0,'a measured zero is still a valid result')
})
test('live deltas require recorded observations from the same activity model',()=>{
 const a=narrative('a')
 a.points.unshift({time:now-HOUR,score:95,volume:100,liveScore:30,scoreModel:CATEGORY_SCORE_MODEL})
 const [result]=calculateCategoryRankings([a],[category('a',{volume:200})],now,true)
 assert.equal(result.liveRanking.change1h,Math.round((result.liveRanking.score-30)*10)/10)
 assert.ok(result.liveRanking.inputs.some(i=>i.key==='volumeTrend'))
 const old=narrative('old');old.points.unshift({time:now-HOUR,score:95,volume:100})
 assert.equal(calculateCategoryRankings([old],[category('old')],now,true)[0].liveRanking.change1h,null)
})
test('news-only themes score real mentions but never imply market confirmation',()=>{
 const a=narrative('a');a.evidence=[{publisher:'One',publishedAt:now-1000,collectedAt:now-500}]
 const [result]=calculateCategoryRankings([a],[],now,true)
 assert.equal(result.liveRanking.status,'news-only')
 assert.ok(result.liveRanking.score>0)
 assert.ok(result.liveRanking.inputs.every(i=>['attention','publishers'].includes(i.key)))
 assert.equal(calculateCategoryRankings([a],[],now,false)[0].liveRanking.score,null)
})
