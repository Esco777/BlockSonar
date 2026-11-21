import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {Wallet,id,toBeHex} from 'ethers'
import {createMembershipVerifier} from './dist/server/membership-verifier.js'
const contract='0x1111111111111111111111111111111111111111'
test('membership access retries a temporary RPC failure',async()=>{
 const accessSelector=id('hasAccess(address)').slice(0,10)
 let accessReads=0
 const rpc=createServer(async(req,res)=>{
  let body=''
  for await(const chunk of req)body+=chunk
  const payload=JSON.parse(body)
  const calls=Array.isArray(payload)?payload:[payload]
  if(calls.some(call=>call.method==='eth_call'&&call.params[0].data.startsWith(accessSelector))&&++accessReads===1){
   res.writeHead(503).end()
   return
  }
  const results=calls.map(call=>{
   const result=call.method==='eth_chainId'?'0x7a69':call.method==='eth_getCode'?'0x01':toBeHex(call.params[0].data.startsWith(accessSelector)?1:200,32)
   return {jsonrpc:'2.0',id:call.id,result}
  })
  res.setHeader('Content-Type','application/json')
  res.end(JSON.stringify(Array.isArray(payload)?results:results[0]))
 })
 rpc.listen(0,'127.0.0.1')
 await once(rpc,'listening')
 const verifier=createMembershipVerifier({MEMBERSHIP_CONTRACT_ADDRESS:contract,MEMBERSHIP_CHAIN_ID:'31337',MEMBERSHIP_RPC_URL:`http://127.0.0.1:${rpc.address().port}`})
 try{
  assert.equal(await verifier.hasAccess(contract),true)
  assert.equal(accessReads,2)
 }finally{
  verifier.close?.()
  rpc.close()
 }
})
test('server membership config rejects missing, mismatched and production-local deployments',()=>{
 for(const env of [{},{MEMBERSHIP_CONTRACT_ADDRESS:contract,MEMBERSHIP_CHAIN_ID:'31337',NODE_ENV:'production'},{MEMBERSHIP_CONTRACT_ADDRESS:contract,MEMBERSHIP_CHAIN_ID:'31337',VITE_MEMBERSHIP_CHAIN_ID:'1'},{MEMBERSHIP_CONTRACT_ADDRESS:contract,MEMBERSHIP_CHAIN_ID:'31337',VITE_MEMBERSHIP_CONTRACT_ADDRESS:'0x2222222222222222222222222222222222222222'}]){
  const verifier=createMembershipVerifier(env);assert.equal(verifier.configured,false);verifier.close?.()
 }
})
test('server signature verification recovers the signing wallet without needing a private key',async()=>{
 const verifier=createMembershipVerifier({MEMBERSHIP_CONTRACT_ADDRESS:contract,MEMBERSHIP_CHAIN_ID:'31337',MEMBERSHIP_RPC_URL:'http://127.0.0.1:1'})
 const wallet=Wallet.createRandom(),message='BlockSonar membership authentication test'
 try{assert.equal(verifier.configured,true);assert.equal(await verifier.validSignature(wallet.address,message,await wallet.signMessage(message)),true)}finally{verifier.close?.()}
})
