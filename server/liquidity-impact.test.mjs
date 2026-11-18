import {test} from 'node:test'
import assert from 'node:assert/strict'
import {liquidityPixelDirection,liquidityPixelOffset} from './dist/src/lib/liquidity-impact.js'
test('pixels fly opposite the candle movement and stationary prices do not emit directional pixels',()=>{
 assert.equal(liquidityPixelDirection(110,105),'up');assert.equal(liquidityPixelDirection(99,105),'down');assert.equal(liquidityPixelDirection(105,105),null);assert.equal(liquidityPixelDirection(NaN,105),null)
 for(const direction of ['up','down'])for(let index=0;index<88;index++){
  const start=liquidityPixelOffset(direction,index,4,0),middle=liquidityPixelOffset(direction,index,4,.5),end=liquidityPixelOffset(direction,index,4,1)
  assert.equal(Math.abs(start.y),0);assert.ok(direction==='up'?middle.y<0&&end.y<middle.y:middle.y>0&&end.y>middle.y);assert.ok([9,12].includes(start.size));assert.ok(middle.size>0&&middle.size<start.size);assert.equal(end.size,0);assert.equal(start.alpha,1);assert.ok(middle.alpha>0&&middle.alpha<1);assert.equal(end.alpha,0)
 }
})
