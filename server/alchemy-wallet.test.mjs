import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeBase58 } from 'ethers'
import { AlchemyEthereumWalletProvider } from './dist/server/alchemy-ethereum-wallet.js'
import { AlchemySolanaWalletProvider, classifyAlchemySolana, walletSwapPools } from './dist/server/alchemy-solana-wallet.js'
import { uniswapPool, transferAbi, v2Abi } from './dist/server/ethereum-classifier.js'
import { ORCA_PROGRAM, discriminator, SOLANA_MAINNET_GENESIS } from './dist/server/solana-dex.js'
import { AlchemyWalletRpc } from './dist/server/alchemy-wallet-rpc.js'
const wallet='0x1111111111111111111111111111111111111111', router='0x2222222222222222222222222222222222222222'
const usdc='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', weth='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const hash='0x'+'ab'.repeat(32), blockHash='0x'+'cd'.repeat(32), pool=uniswapPool(usdc,weth)
const event=(address,abi,name,args)=>({address,...abi.encodeEventLog(abi.getEvent(name),args)})
function ethRpc(options={}) {
 const logs=[event(weth,transferAbi,'Transfer',[wallet,pool,10n**18n]),event(usdc,transferAbi,'Transfer',[pool,wallet,2000n*10n**6n]),event(options.forged?router:pool,v2Abi,'Swap',[router,0,10n**18n,2000n*10n**6n,0,wallet])]
 return {call:async(method,params)=>{
  if(method==='eth_chainId')return '0x1'
  if(method==='eth_getBlockByNumber')return {number:'0x20',hash:blockHash,timestamp:'0x6553f100'}
  if(method==='eth_getBalance')return '0xde0b6b3a7640000'
  if(method==='alchemy_getTokenBalances'){if(options.tokenFailure)throw new Error('Unavailable');return {tokenBalances:[{contractAddress:usdc,tokenBalance:'0x77359400'}],pageKey:'more'}}
  if(method==='alchemy_getTokenMetadata')return {decimals:params[0]===usdc?6:18,symbol:params[0]===usdc?'USDC':'WETH'}
  if(method==='alchemy_getAssetTransfers')return {transfers:[{hash,blockNum:'0x20'}]}
  if(method==='eth_getTransactionByHash')return {hash,from:wallet,to:router,value:'0x0'}
  if(method==='eth_getTransactionReceipt')return {transactionHash:hash,blockNumber:'0x20',blockHash,status:options.failed?'0x0':'0x1',gasUsed:'0x5208',effectiveGasPrice:'0x3b9aca00',logs}
  throw new Error('Unexpected '+method)
 }}
}
test('Alchemy Ethereum snapshots retain exact balances, authenticate buys and deduplicate discovered hashes',async()=>{
 const p=new AlchemyEthereumWalletProvider(ethRpc(),{largeHolders:async()=>[]})
 const data=await p.snapshot(wallet)
 assert.equal(data.source,'alchemy');assert.equal(data.holdings[0].amount,'1');assert.equal(data.holdings[1].amount,'2000')
 assert.equal(data.activities.length,1);assert.equal(data.activities[0].kind,'swap');assert.deepEqual(data.activities[0].buyMints,[usdc])
 assert.ok(data.warnings.some(w=>w.includes('bounded')))
 assert.equal((await new AlchemyEthereumWalletProvider(ethRpc({forged:true})).snapshot(wallet)).activities[0].kind,'transfer')
 assert.equal((await new AlchemyEthereumWalletProvider(ethRpc({failed:true})).snapshot(wallet)).activities[0].kind,'failed')
})
test('Ethereum preserves native holdings when enhanced token API is unavailable',async()=>{
 const result=await new AlchemyEthereumWalletProvider(ethRpc({tokenFailure:true})).snapshot(wallet)
 assert.equal(result.holdings[0].amount,'1');assert.ok(result.warnings.some(w=>w.includes('ERC-20 balances unavailable')))
})
const bytes=n=>Buffer.alloc(32,n),key=n=>encodeBase58(bytes(n)),owner=key(1),mintA=key(2),mintB=key(3),solPool=key(4),sig=encodeBase58(Buffer.alloc(64,5))
const descriptor={address:solPool,program:ORCA_PROGRAM,protocol:'solana-orca-whirlpool',token0:mintA,token1:mintB}
function solTx(){
 const data=Buffer.alloc(121);discriminator('event:Traded').copy(data);bytes(4).copy(data,8);data[40]=1;data.writeBigUInt64LE(900n,73);data.writeBigUInt64LE(200n,81)
 const balance=(mint,amount)=>({owner,mint,uiTokenAmount:{amount:String(amount),decimals:6}})
 return {slot:10,blockTime:1700000000,transaction:{signatures:[sig],message:{accountKeys:[owner,key(9),solPool,ORCA_PROGRAM],instructions:[{programIdIndex:3,accounts:[1,0,2],data:encodeBase58(discriminator('global:swap'))}]}},meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[999995000],preTokenBalances:[balance(mintA,1000),balance(mintB,0)],postTokenBalances:[balance(mintA,100),balance(mintB,200)],logMessages:[`Program ${ORCA_PROGRAM} invoke [1]`,`Program data: ${data.toString('base64')}`,`Program ${ORCA_PROGRAM} success`]}}
}
test('Solana buys require wallet swap authority, verified pool events, spend and receipt',()=>{
 const tx=solTx();assert.deepEqual(walletSwapPools(tx,owner),[solPool])
 const activity=classifyAlchemySolana(tx,owner,[descriptor]);assert.equal(activity.kind,'swap');assert.equal(activity.rawTokens[0].rawAmount,'900');assert.equal(activity.rawTokens[1].rawAmount,'200');assert.deepEqual(activity.buyMints,[mintB])
 tx.meta.preTokenBalances.push({owner,mint:key(6),uiTokenAmount:{amount:'0',decimals:6}})
 tx.meta.postTokenBalances.push({owner,mint:key(6),uiTokenAmount:{amount:'1234',decimals:6}})
 assert.deepEqual(classifyAlchemySolana(tx,owner,[descriptor]).buyMints,[mintB],'an unrelated incoming token is not a verified swap output')
 assert.equal(classifyAlchemySolana(tx,owner,[]).kind,'unknown')
 tx.transaction.message.instructions[0].accounts[1]=1
 assert.notEqual(classifyAlchemySolana(tx,owner,[descriptor]).kind,'swap','a different authority cannot establish a wallet purchase')
 tx.meta.err={InstructionError:[0,'failed']}
 const failed=classifyAlchemySolana(tx,owner,[descriptor]);assert.equal(failed.kind,'failed');assert.deepEqual(failed.tokens,[])
})
test('Solana balances aggregate SPL accounts safely and history verifies finalized transaction identity',async()=>{
 const account=Buffer.alloc(653);discriminator('account:Whirlpool').copy(account);bytes(2).copy(account,101);bytes(3).copy(account,181)
 let missing=false
 const rpc={call:async(method,params)=>{
  if(method==='getGenesisHash')return SOLANA_MAINNET_GENESIS
  if(method==='getBalance')return {value:1234567890}
  if(method==='getTokenAccountsByOwner')return {value:[{account:{data:{parsed:{info:{owner,mint:mintA,tokenAmount:{amount:'18446744073709551610',decimals:6}}}}}}]}
  if(method==='getSignaturesForAddress')return [{signature:sig,slot:10,confirmationStatus:'finalized'}]
  if(method==='getTransaction'){assert.equal(params[1].maxSupportedTransactionVersion,1);if(missing)throw new Error('Missing transaction');return solTx()}
  if(method==='getAccountInfo')return {value:{owner:ORCA_PROGRAM,executable:false,data:[account.toString('base64'),'base64']}}
  throw new Error('Unexpected '+method)
 }}
 const p=new AlchemySolanaWalletProvider(rpc),balances=await p.balances(owner)
 assert.equal(balances[0].amount,'1.23456789');assert.equal(balances[1].amount,'36893488147419.10322')
 const history=await p.history(owner);assert.equal(history.activities[0].kind,'swap');assert.equal(history.complete,false);assert.equal(history.before,null)
 missing=true;await assert.rejects(p.history(owner),'missing transactions must not advance history cursor')
})
test('Alchemy JSON-RPC errors remain sanitized and keys are not part of error messages',async()=>{
 const rpc=new AlchemyWalletRpc('secret-key','eth-mainnet',{get:async()=>({error:{message:'secret-key'}})})
 await assert.rejects(rpc.call('eth_getBalance',[]),/^Error: Alchemy wallet eth_getBalance unavailable$/)
})

test('Solana concentration aggregates owners and never treats the largest accounts as all holders',async()=>{
 const p=new AlchemySolanaWalletProvider({call:async(method)=>{
  if(method==='getTokenLargestAccounts')return {value:[{address:key(6),amount:'20'},{address:key(7),amount:'30'}]}
  if(method==='getTokenSupply')return {value:{amount:'100'}}
  if(method==='getMultipleAccounts')return {value:[0,1].map(()=>({data:{parsed:{info:{owner,mint:mintA}}}}))}
 }})
 const d=await p.concentration(mintA);assert.equal(d.holders.length,1);assert.equal(d.holders[0].percentOfSupply,50);assert.match(d.scope,/not a complete holder snapshot/)
})
