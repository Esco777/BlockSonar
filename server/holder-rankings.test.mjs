import { ORCA_PROGRAM, discriminator } from './dist/server/solana-dex.js'
import { HolderDiscovery } from './dist/server/holder-discovery.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeBase58 } from 'ethers'
import { sortNativeHolders, compareNativeBalances, holderTier } from './dist/src/lib/holder-rankings.js'
import { WalletHolderService, solanaHolder } from './dist/server/wallet-holders.js'
const key=n=>encodeBase58(Buffer.alloc(32,n)),system='11111111111111111111111111111111'
const holder=(address,amount)=>({address,amount,label:null,isContract:false,accountType:'Address'})
test('holder ranking compares exact decimal balances beyond floating-point precision',()=>{
 const rows=[holder('b','2'),holder('c','10'),holder('d','9007199254740992.0001'),holder('a','9007199254740992.0002')]
 assert.deepEqual(sortNativeHolders(rows).map(r=>r.address),['a','d','c','b'])
 assert.equal(rows[0].address,'b','ranking does not mutate a shared prior snapshot')
 assert.equal(compareNativeBalances('1','1.000'),0)
 assert.throws(()=>compareNativeBalances('NaN','1'))
})
test('holder ranks reorder when balances change and when a new address enters the returned set',()=>{
 const first=sortNativeHolders([holder('a','1'),holder('b','2')]);assert.equal(first[0].address,'b')
 const updated=sortNativeHolders([holder('a','3'),holder('b','2'),holder('c','4')]);assert.deepEqual(updated.map(r=>r.address),['c','a','b'])
})
test('native SOL accounts distinguish wallet, stake and program ownership and reject unsafe quantities',()=>{
 assert.equal(solanaHolder(key(1),{lamports:1234567890,owner:system}).amount,'1.23456789')
 assert.equal(solanaHolder(key(1),{lamports:'99999999999999999',owner:system}).amount,'99999999.999999999')
 assert.equal(solanaHolder(key(1),{lamports:100,owner:'Stake11111111111111111111111111111111111111'}).accountType,'Stake account')
 assert.equal(solanaHolder(key(1),{lamports:Number.MAX_SAFE_INTEGER+1,owner:system}),null)
})
test('Ethereum directory preserves original fields and sorts largest native holdings first',async()=>{
 const service=new WalletHolderService({largeHolders:async()=>[{address:'b',eth:'2',label:null,isContract:false},{address:'a',eth:'10',label:'Exchange',isContract:true}]},{})
 const data=await service.ethereumHolders();assert.equal(data.holders[0].address,'a');assert.equal(data.holders[0].eth,'10');assert.equal(data.holders[0].amount,'10')
})
test('Solana native ranking rechecks current balances rather than trusting stale membership order',async()=>{
 const service=new WalletHolderService({},{});let calls=0
 service.rpc={call:async method=>{calls++;return method==='getLargestAccounts'?{value:[{address:key(1)},{address:key(2)}]}:{value:[{lamports:100,owner:system},{lamports:300,owner:system}]}}}
 const result=await service.solanaHolders();assert.equal(result.holders[0].address,key(2));assert.match(result.scope,/up to two hours/)
 await service.solanaHolders();assert.equal(calls,2,'rankings are shared and cached for one minute')
})
test('unavailable global Solana rankings are never represented as a complete richest-wallet list',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path')
 const dir=await mkdtemp(path.join(tmpdir(),'holder-directory-'))
 try{
  const filename=path.join(dir,'wallets.json');await writeFile(filename,JSON.stringify({wallets:{[key(1)]:{}}}))
  const service=new WalletHolderService({},{INTELLIGENCE_STORE_PATH:filename})
  service.db={query:async()=>({rows:[{raw:{meta:{err:null},transaction:{message:{header:{numRequiredSignatures:1},accountKeys:[key(1)],instructions:[{programId:ORCA_PROGRAM,accounts:[key(2),key(1),key(3)],data:encodeBase58(discriminator('global:swap'))}]}}}}]})}
  service.rpc={call:async method=>{if(method==='getLargestAccounts')throw new Error('Unavailable');return {value:[{lamports:2000000000,owner:system}]}}}
  const data=await service.solanaHolders();assert.equal(data.delayed,true);assert.match(data.scope,/observed|watched/);assert.match(data.scope,/unavailable/);assert.equal(data.holders[0].amount,'2')
 }finally{await rm(dir,{recursive:true,force:true})}
})

// Directory ranking tests do not write production discovery metadata.
test.beforeEach(t => { t.mock.method(HolderDiscovery.prototype, 'decorate', async (_chain, directory) => directory) })

test('whale and other large-holder cutoffs are exact, inclusive, and configurable',()=>{
 assert.equal(holderTier('1000','100','1000'),'Whale')
 assert.equal(holderTier('999.999999999999999999','100','1000'),'Large holder')
 assert.equal(holderTier('100','100','1000'),'Large holder')
 assert.equal(holderTier('99.9999','100','1000'),'Below threshold')
 assert.equal(holderTier('10000','1000','10000'),'Whale')
 assert.throws(()=>holderTier('100','1000','100'),/Whale minimum/)
})
