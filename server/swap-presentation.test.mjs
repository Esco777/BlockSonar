import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swapToken, swapQuantity } from './dist/src/lib/swap-presentation.js'
test('token identities are chain-specific and Solana mints stay case-sensitive',()=>{
 assert.equal(swapToken('ethereum','0xC02aAA39b223FE8D0A0e5C4F27eAD9083C756Cc2').symbol,'WETH')
 assert.equal(swapToken('bsc','0x55d398326f99059ff775485246999027b3197955').decimals,18)
 assert.equal(swapToken('ethereum','0x55d398326f99059ff775485246999027b3197955').decimals,null)
 assert.equal(swapToken('solana','So11111111111111111111111111111111111111112').decimals,9)
 assert.equal(swapToken('solana','so11111111111111111111111111111111111111112').mark,'unknown')
})
test('animated amounts preserve raw precision and explicitly indicate truncation',()=>{
 assert.equal(swapQuantity('1234567890000000000',18).exact,'1.23456789')
 assert.equal(swapQuantity('1234567890000000000',18).display,'≈ 1.234567')
 assert.equal(swapQuantity('1000000',6).display,'1')
 assert.equal(swapQuantity('1',18).display,'<0.000001')
 assert.equal(swapQuantity('9007199254740993000000000',18).exact,'9007199.254740993')
 assert.equal(swapQuantity('12345',null).raw,true)
 assert.equal(swapQuantity('12345',null).display,'12345')
 assert.equal(swapQuantity('invalid',6).display,'Unavailable')
})
