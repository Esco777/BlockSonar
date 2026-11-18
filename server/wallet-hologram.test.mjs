import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walletCycleStep, walletAsset, walletAmount, nextWalletEntry, directoryBalanceEntries } from './dist/src/lib/wallet-hologram.js'
test('wallet animation cycles down the actual list and safely wraps or handles empty lists',()=>{
 assert.equal(nextWalletEntry(0,3),1);assert.equal(nextWalletEntry(1,3),2);assert.equal(nextWalletEntry(2,3),0)
 assert.equal(nextWalletEntry(0,0),0);assert.equal(nextWalletEntry(0,1),0)
})
test('wallet balances are already decimal quantities and never receive token decimals twice',()=>{
 assert.equal(walletAmount('1.23456789').exact,'1.23456789')
 assert.equal(walletAmount('1.23456789').display,'≈ 1.234567')
 assert.equal(walletAmount('9007199254740993').exact,'9007199254740993')
 assert.equal(walletAmount('0.00000001').display,'<0.000001')
 assert.equal(walletAmount('invalid').display,'Unavailable')
 assert.equal(walletAsset('ethereum','ETH').symbol,'ETH')
 assert.equal(walletAsset('solana','SOL').mark,'solana')
 assert.equal(walletAsset('ethereum','0xunknown','TEST').symbol,'TEST')
 assert.equal(walletAsset('ethereum','0xunknown','TEST').mark,'unknown')
})
test('directory animation keeps source order, real balances and wallet identities without generating observations',()=>{
 const directory={at:1000,source:'observed',scope:'watched only',holders:[{address:'one',label:'First',amount:'5',accountType:'Address',isContract:false},{address:'two',label:null,amount:'2',accountType:'Address',isContract:false}]}
 const entries=directoryBalanceEntries('ethereum',directory)
 assert.deepEqual(entries.map(e=>e.owner),['one','two']);assert.deepEqual(entries.map(e=>e.amount),['5','2']);assert.equal(entries[0].symbol,'ETH');assert.equal(entries[0].usd,null)
 assert.deepEqual(directoryBalanceEntries('solana',null),[])
})

test('wallet sequence shows each batch before advancing the wallet',()=>{
 assert.equal(walletCycleStep(0,7),3)
 assert.equal(walletCycleStep(3,7),6)
 assert.equal(walletCycleStep(6,7),null)
 for(const length of [0,1,2,3]) assert.equal(walletCycleStep(0,length),null)
 assert.equal(walletCycleStep(0,6),3)
 assert.equal(walletCycleStep(3,6),null)
})
