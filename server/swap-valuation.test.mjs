import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateSwapUsd, quoteKey } from './dist/src/lib/swap-valuation.js'
const input='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',output='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const swap={chain:'ethereum',token_in:input,token_out:output,amount_in:'2000000000000000000',amount_out:'4000000000'}
const now=10000000
const quote=(priceUsd,priceAt=now)=>({priceUsd,priceAt})
test('swap USD estimates use exact decimal input quantity and do not sum both sides',()=>{
 assert.deepEqual(estimateSwapUsd(swap,{[quoteKey('ethereum',input)]:quote(2000),[quoteKey('ethereum',output)]:quote(1)},now),{value:4000,priceAt:now})
 assert.deepEqual(estimateSwapUsd(swap,{[quoteKey('ethereum',output)]:quote(1)},now),{value:4000,priceAt:now})
})
test('swap USD estimates reject unknown decimals, stale and invalid prices',()=>{
 assert.equal(estimateSwapUsd(swap,{},now),null)
 for(const value of [quote(0),quote(Infinity),quote(-1),quote(2000,now-3600001),quote(2000,now+60001)])assert.equal(estimateSwapUsd(swap,{[quoteKey('ethereum',input)]:value},now),null)
 assert.equal(estimateSwapUsd({...swap,token_in:'unknown',token_out:'unknown'},{'ethereum:unknown':quote(1)},now),null)
 assert.notEqual(quoteKey('solana','Case'),quoteKey('solana','case'))
})

test('swap estimate attribution follows its quote provider without assuming DefiLlama',()=>{
 const quotes={[quoteKey('ethereum',input)]:{...quote(2000),source:'Alchemy'}}
 assert.equal(estimateSwapUsd(swap,quotes,now).source,'Alchemy')
 delete quotes[quoteKey('ethereum',input)].source
 assert.equal(estimateSwapUsd(swap,quotes,now).source,undefined)
})
