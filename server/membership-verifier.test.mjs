import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Wallet} from 'ethers'
import {createMembershipVerifier} from './dist/server/membership-verifier.js'
const contract='0x1111111111111111111111111111111111111111'
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
