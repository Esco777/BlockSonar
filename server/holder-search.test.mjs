import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeBase58 } from 'ethers'
import { HolderSearch, whalePurchases } from './dist/server/holder-search.js'
import { parseHolderSearch, holderSearchQuery } from './dist/src/lib/holder-search.js'
import { SOLANA_MAINNET_GENESIS } from './dist/server/solana-dex.js'
const eth = n => `0x${String(n).repeat(40)}`, sol = n => encodeBase58(Buffer.alloc(32,n))
const token=eth(3), signature=`0x${'a'.repeat(64)}`
const holder=(address,amount)=>({address,amount,label:null,isContract:false,accountType:'Address'})
const params={minimum:'100',whaleMinimum:'1000',size:'all',view:'largest',days:7,hidePrograms:false}
const directory={observe:async(_chain,result)=>result,ethereumHolders:async()=>({holders:[holder(eth(2),'900000')]})}
const activity=(wallet,extra={})=>({wallet,kind:'swap',at:Date.now(),signature,tokens:[{mint:token,amount:1,direction:'in'},{mint:eth(4),amount:99,direction:'in'}],buyMints:[token],tokenValues:[{mint:token,symbol:'TOKEN',purchased:true}],feeSol:null,...extra})
test('search rejects invalid parameters before blockchain work',()=>{
 for(const query of ['minimum=-1','minimum=1e6','whaleMinimum=1&minimum=100','whaleMinimum=0&minimum=0','size=anything','view=unknown','days=2','hidePrograms=yes'])assert.throws(()=>parseHolderSearch(new URLSearchParams(query)))
 assert.deepEqual(parseHolderSearch(new URLSearchParams()),params)
 assert.equal(holderSearchQuery(params),holderSearchQuery(Object.fromEntries(Object.entries(params).reverse())),'equivalent parameters serialize identically regardless of draft field order')
})
test('Ethereum search rechecks balances, applies submitted filters, and streams proven whale purchases',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),calls=[]
 const service=new HolderSearch(directory,{wallet:async wallet=>{await gate;return {activities:[activity(wallet)],warnings:[]}}})
 service.eth={call:async(method,args)=>{
  calls.push([method,args])
  if(method==='eth_chainId')return '0x1'
  if(method==='eth_getBlockByNumber')return {number:'0x123',transactions:[{from:eth(1)}]}
  if(method==='eth_getBalance')return `0x${((args[0]===eth(1)?2000n:500n)*10n**18n).toString(16)}`
  if(method==='eth_getCode')return '0x'
  throw new Error('Unexpected method')
 }}
 try{
  const result=await service.search('ethereum',{...params,size:'whales'})
  assert.deepEqual(result.holders.map(h=>h.address),[eth(1)],'old explorer balance cannot qualify a non-whale')
  assert.equal(result.checked,2);assert.equal(result.purchaseStatus,'loading')
  assert.ok(calls.some(([method,args])=>method==='eth_getBalance'&&args[1]==='0x123'))
  assert.equal((await service.search('ethereum',{...params,size:'whales'})).id,result.id,'duplicate requests share work')
  release();await service.stop()
  const completed=service.get('ethereum',result.id)
  assert.equal(completed.purchaseStatus,'complete');assert.equal(completed.purchases.length,1)
  assert.equal(completed.purchases[0].token,token,'unrelated incoming transfers are not purchases')
  assert.equal(completed.whalesChecked,1)
  assert.throws(()=>service.get('solana',result.id),/expired/)
 }finally{release();await service.stop()}
})
test('Solana search reads finalized signer balances when largest-account discovery is unavailable',async()=>{
 const service=new HolderSearch({observe:directory.observe},{wallet:async()=>{throw new Error('Wrong chain')}})
 let requested
 service.sol={call:async(method,args)=>{
  if(method==='getGenesisHash')return SOLANA_MAINNET_GENESIS
  if(method==='getSlot')return 100
  if(method==='getBlock')return {transactions:[{meta:{err:null},transaction:{accountKeys:[{pubkey:sol(1),signer:true},{pubkey:sol(2),signer:true},{pubkey:sol(3),signer:false}]}}]}
  if(method==='getLargestAccounts')throw new Error('Not supported')
  if(method==='getMultipleAccounts'){requested=args;return {context:{slot:101},value:[{lamports:'20000000000000',owner:'11111111111111111111111111111111'},{lamports:'1000000000',owner:'11111111111111111111111111111111'}]}}
  throw new Error('Unexpected method')
 }}
 service.solana={history:async(address,_cursor,limit)=>{assert.equal(address,sol(1));assert.equal(limit,5);return {activities:[]}}}
 try{
  const result=await service.search('solana',{...params,minimum:'1000',whaleMinimum:'10000'})
  assert.deepEqual(requested[0],[sol(1),sol(2)],'non-signers never become wallet candidates')
  assert.equal(requested[1].commitment,'finalized');assert.equal(requested[1].minContextSlot,100)
  assert.deepEqual(result.holders.map(h=>h.address),[sol(1)])
  assert.equal(result.holders[0].amount,'20000')
  assert.match(result.warnings.join(' '),/Largest-account directory unavailable/)
 }finally{await service.stop()}
})
test('purchase extraction excludes transfers, failed transactions, unrelated wallets and unproven outputs',()=>{
 const h=holder(eth(1),'2000'),base=activity(h.address)
 assert.equal(whalePurchases('ethereum',h,[{...base,kind:'transfer'},{...base,kind:'failed'},{...base,wallet:eth(2)},{...base,buyMints:[]},{...base,at:Date.now()-90000000},{...base,signature:'bad'}]).length,0)
 const exact=whalePurchases('ethereum',h,[{...base,rawTokens:[{mint:token,rawAmount:'1000000000000000001',decimals:18,direction:'in'}]}])
 assert.equal(exact.length,1);assert.equal(exact[0].amount,'1.000000000000000001')
 const s=holder(sol(1),'10000'),solTx={...activity(s.address),signature:encodeBase58(Buffer.alloc(64,8)),buyMints:[sol(2)],tokens:[{mint:sol(2),amount:2,direction:'in'},{mint:sol(3),amount:9,direction:'in'}]}
 assert.deepEqual(whalePurchases('solana',s,[solTx]).map(row=>row.token),[sol(2)])
})
test('authenticated search work is rate limited per account and malformed searches never reach RPC',async()=>{
 const service=new HolderSearch(directory,{wallet:async()=>({activities:[]})});let searches=0
 service.search=async()=>{searches++;return {holders:[]}}
 const call=async(query,account='alice')=>{const res={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};await service.handle({method:'GET'},res,new URL('http://localhost/api/wallet-tracker/ethereum/holder-search'+query),account);return res}
 assert.equal((await call('?minimum=-5')).status,400);assert.equal(searches,0)
 for(let i=0;i<5;i++)assert.equal((await call('')).status,200)
 assert.equal((await call('')).status,429)
 assert.equal((await call('','bob')).status,200)
 await service.stop()
})

test('unavailable purchase history never turns into a fabricated purchase',async()=>{
 const service=new HolderSearch(directory,{wallet:async()=>{throw new Error('Provider unavailable')}})
 service.scanEthereum=async()=>({holders:[holder(eth(1),'2000')],recent:new Set([eth(1)]),warnings:[],scope:'test',checked:1})
 try{
  const result=await service.search('ethereum',params)
  await service.stop()
  assert.equal(result.purchaseStatus,'unavailable')
  assert.equal(result.purchases.length,0)
  assert.match(result.warnings.join(' '),/no purchases inferred/)
 }finally{await service.stop()}
})
test('search rejects a provider serving the wrong Ethereum chain',async()=>{
 const service=new HolderSearch(directory,{wallet:async()=>({activities:[]})})
 service.eth={call:async()=> '0x38'}
 await assert.rejects(service.search('ethereum',params),/Ethereum mainnet required/)
 await service.stop()
})

test('other-large-holder searches do not inspect whales excluded by the submitted size filter',async()=>{
 let historyCalls=0
 const service=new HolderSearch(directory,{wallet:async()=>{historyCalls++;return {activities:[]}}})
 service.scanEthereum=async()=>({holders:[holder(eth(1),'2000'),holder(eth(2),'200')],recent:new Set(),warnings:[],scope:'test',checked:2})
 try{
  const result=await service.search('ethereum',{...params,size:'large'})
  assert.deepEqual(result.holders.map(h=>h.address),[eth(2)])
  assert.equal(result.whalesTargeted,0);assert.equal(historyCalls,0)
 }finally{await service.stop()}
})
