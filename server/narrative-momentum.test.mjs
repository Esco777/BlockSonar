import {test} from 'node:test'
import assert from 'node:assert/strict'
import {narrativeMomentumChart} from './dist/src/lib/narrative-momentum.js'
const point=(time,liveScore,scoreModel='category-activity-v1')=>({time,liveScore,scoreModel,attention:0})
test('momentum chart uses recorded activity scores instead of zero headline counts',()=>{
 const rows=narrativeMomentumChart([{id:'category:example.v1',points:[point(2000,75),point(3000,80)]}],['category:example.v1'],3000,1)
 assert.deepEqual(rows,[{time:2000,'category:example.v1':75},{time:3000,'category:example.v1':80}])
})
test('momentum chart limits range and selected narratives, preserves missing observations, and rejects legacy/future/invalid data',()=>{
 const rows=narrativeMomentumChart([{id:'one',points:[point(0,50),point(4000000,null),point(4001000,0),point(4002000,101),point(4003000,60,'legacy'),point(9000000,80)]},{id:'two',points:[point(4000000,45)]},{id:'excluded',points:[point(4000000,99)]}],['one','two'],5000000,1)
 assert.deepEqual(rows,[{time:4000000,one:null,two:45},{time:4001000,one:0,two:null},{time:4002000,one:null,two:null}])
 assert.deepEqual(narrativeMomentumChart([],[],5000000,1),[])
})

test('momentum chart breaks lines over collection outages instead of implying continuous observations',()=>{
 const rows=narrativeMomentumChart([{id:'one',points:[point(60000,60),point(1200000,80)]}],['one'],1200000,1)
 assert.equal(rows.length,3);assert.equal(rows[1].one,null)
})
