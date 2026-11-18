import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyEthereumTransaction,uniswapPool,transferAbi,v2Abi,v3Abi } from './dist/server/ethereum-classifier.js'
import { decimalUnits } from './dist/src/lib/ethereum-wallet.js'
import { llamaCoinId } from './dist/server/defillama.js'
const wallet='0x1111111111111111111111111111111111111111'
const router='0x2222222222222222222222222222222222222222'
const usdc='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', weth='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const metadata={[usdc]:{decimals:6,symbol:'USDC'},[weth]:{decimals:18,symbol:'WETH'}}
const tx={hash:'0x'+'ab'.repeat(32),timestamp:'2026-11-12T20:00:00Z',status:'ok',confirmations:5,from:{hash:wallet},to:{hash:router},value:'0',fee:{type:'actual',value:'1000000000000000'}}
const event=(address,abi,name,args)=>({address:{hash:address},...abi.encodeEventLog(abi.getEvent(name),args)})
const transfer=(mint,from,to,amount)=>event(mint,transferAbi,'Transfer',[from,to,amount])
function v2logs(pool=uniswapPool(usdc,weth),recipient=wallet) {return [transfer(weth,wallet,pool,10n**18n),transfer(usdc,pool,recipient,2000n*10n**6n),event(pool,v2Abi,'Swap',[router,0n,10n**18n,2000n*10n**6n,0n,recipient])]}
test('Ethereum decimals and native identity preserve base units and canonical chain mapping',()=>{
 assert.equal(decimalUnits('1234567',6),'1.234567')
 assert.equal(decimalUnits('0',18),'0')
 assert.equal(decimalUnits('1000',0),'1000')
 assert.equal(decimalUnits('bad',18),null)
 assert.equal(decimalUnits('100',null),null)
 assert.equal(llamaCoinId('ethereum','ETH'),`ethereum:${weth}`)
})
test('Uniswap emitter authentication matches known Ethereum v2 and v3 pool addresses',()=>{
 assert.equal(uniswapPool(usdc,weth),'0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc')
 assert.equal(uniswapPool(usdc,weth,3000),'0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8')
})
test('only a confirmed, wallet-funded, authenticated swap with token receipt is a buy',()=>{
 const activity=classifyEthereumTransaction(tx,v2logs(),wallet,metadata,true)
 assert.equal(activity.kind,'swap')
 assert.deepEqual(activity.buyMints,[usdc])
 assert.equal(activity.tokens.find(t=>t.mint===usdc).amount,2000)
 assert.equal(activity.feeEth,.001)
 assert.equal(classifyEthereumTransaction({...tx,from:{hash:router}},v2logs(),wallet,metadata,true).kind,'transfer')
 assert.equal(classifyEthereumTransaction(tx,v2logs(router),wallet,metadata,true).kind,'transfer','forged Swap emitter is not a Uniswap pool')
 assert.equal(classifyEthereumTransaction(tx,v2logs(undefined,router),wallet,metadata,true).kind,'transfer','a third-party recipient is not a wallet purchase')
})
test('v3 buys use authenticated pool amounts and support a final router transfer path',()=>{
 const pool=uniswapPool(usdc,weth,3000)
 const logs=[transfer(weth,wallet,pool,10n**18n),transfer(usdc,pool,router,2000n*10n**6n),transfer(usdc,router,wallet,2000n*10n**6n),event(pool,v3Abi,'Swap',[router,router,-2000n*10n**6n,10n**18n,1n,1n,0])]
 const activity=classifyEthereumTransaction(tx,logs,wallet,metadata,true)
 assert.equal(activity.kind,'swap');assert.deepEqual(activity.buyMints,[usdc])
})
test('failed, pending, incomplete and liquidity transactions do not fabricate purchases',()=>{
 assert.equal(classifyEthereumTransaction({...tx,status:'error'},v2logs(),wallet,metadata,true).kind,'failed')
 assert.equal(classifyEthereumTransaction({...tx,confirmations:0},v2logs(),wallet,metadata,true).kind,'unknown')
 assert.equal(classifyEthereumTransaction(tx,v2logs(),wallet,metadata,false).kind,'unknown')
 const logs=v2logs();logs.push(event(uniswapPool(usdc,weth),v2Abi,'Mint',[router,1n,1n]))
 const liquidity=classifyEthereumTransaction(tx,logs,wallet,metadata,true)
 assert.equal(liquidity.kind,'liquidity');assert.deepEqual(liquidity.buyMints,[])
 assert.equal(classifyEthereumTransaction({...tx,fee:{type:'actual'}},[],wallet,metadata,true).feeEth,null)
})
test('plain incoming transfers and self movements remain separate from buys',()=>{
 const plain=classifyEthereumTransaction({...tx,from:{hash:router}},[transfer(usdc,router,wallet,1000000n)],wallet,metadata,true)
 assert.equal(plain.kind,'transfer');assert.deepEqual(plain.buyMints,[])
 assert.equal(classifyEthereumTransaction({...tx,to:{hash:wallet},value:'1000000000000000000'},[],wallet,metadata,true).kind,'internal')
})
test('Ethereum service retains and deduplicates history without treating unknown quotes as zero',async()=>{
 const {EthereumWalletService}=await import('./dist/server/ethereum-wallet-service.js')
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path')
 const dir=await mkdtemp(path.join(tmpdir(),'blocksonar-eth-'))
 let calls=0
 const activity=classifyEthereumTransaction(tx,v2logs(),wallet,metadata,true)
 activity.tokenValues=activity.tokens.map(t=>({...t,symbol:metadata[t.mint].symbol,valueUsd:null,purchased:activity.buyMints.includes(t.mint)}))
 const provider={async snapshot(){calls++;return {holdings:[{mint:usdc,symbol:'USDC',amount:'2000'}],activities:[activity,activity],warnings:[]}}}
 const prices={async valueBalances(chain,balances){assert.equal(chain,'ethereum');return {balances:balances.map(b=>({...b,priceUsd:null,priceAt:null})),error:null}}}
 try {
  const filename=path.join(dir,'wallets.json'),service=new EthereumWalletService(filename,provider,prices)
  const [first,second]=await Promise.all([service.wallet(wallet),service.wallet(wallet.toUpperCase().replace('0X','0x'))])
  assert.equal(calls,1);assert.equal(first.activities.length,1);assert.equal(first.holdings[0].valueUsd,null);assert.equal(first.pricedSubtotalUsd,null);assert.equal(second.unpricedCount,1)
  const restored=await new EthereumWalletService(filename,provider,prices).wallet(wallet)
  assert.equal(calls,1);assert.equal(restored.activities[0].kind,'swap')
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('Ethereum provider retries a transient connection failure once but never retries a rate limit',async()=>{
 const {EthereumProvider}=await import('./dist/server/ethereum-provider.js')
 let attempts=0
 const cache={async get(){attempts++;if(attempts===1)throw new Error('Provider connection unavailable');return {items:[{hash:wallet,coin_balance:'1000000000000000000',is_contract:false}]}}}
 const holders=await new EthereumProvider(cache).largeHolders()
 assert.equal(attempts,2);assert.equal(holders[0].eth,'1')
 attempts=0
 const limited={async get(){attempts++;throw new Error('Provider unavailable (HTTP 429)')}}
 await assert.rejects(new EthereumProvider(limited).largeHolders(),/429/)
 assert.equal(attempts,1)
})

test('Ethereum provider keeps native holdings when token and history endpoints fail',async()=>{
 const {EthereumProvider}=await import('./dist/server/ethereum-provider.js')
 const cache={async get(url){if(url.endsWith(`/addresses/${wallet}`))return {coin_balance:'2000000000000000000'};throw new Error('Provider unavailable (HTTP 429)')}}
 const result=await new EthereumProvider(cache).snapshot(wallet)
 assert.equal(result.holdings[0].amount,'2')
 assert.equal(result.holdings[0].mint,'ETH')
 assert.deepEqual(result.activities,[])
 assert.ok(result.warnings.some(w=>w.includes('ERC-20 holdings are unavailable')))
 assert.ok(result.warnings.some(w=>w.includes('discovery is incomplete')))
})
