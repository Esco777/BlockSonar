import {test}from'node:test'
import assert from'node:assert/strict'
import{createPrivateKey,sign}from'node:crypto'
import{Keypair,PublicKey}from'@solana/web3.js'
import{TOKEN_PROGRAM_ID}from'@solana/spl-token'
import{SolanaMembership,solLamports,decodeSolPrice,discriminator,SOL_USD_FEED,PYTH_RECEIVER,u64}from'./dist/server/solana-membership.js'
const program=Keypair.generate().publicKey.toBase58(),owner=Keypair.generate(),buyer=Keypair.generate(),oracle=Keypair.generate().publicKey,now=Math.floor(Date.now()/1000)
const account=(data,owner,executable=false)=>({owner,executable,data:[data.toString('base64'),'base64'],lamports:10000000})
function price(){const data=Buffer.alloc(134);discriminator('account','PriceUpdateV2').copy(data);data[40]=1;Buffer.from(SOL_USD_FEED,'hex').copy(data,41);data.writeBigInt64LE(10000000000n,73);data.writeBigUInt64LE(1000000n,81);data.writeInt32LE(-8,89);data.writeBigInt64LE(BigInt(now),93);return data}
function fixture(options={}){
 let service;const state={counterfeit:false,registry:true,genesis:'local-test-genesis',...options},loader='BPFLoaderUpgradeab1e11111111111111111111111',programData=Keypair.generate().publicKey
 const fetcher=async(_url,init)=>{
  const{method,params}=JSON.parse(init.body)
  const get=address=>{
   if(address===program){const data=Buffer.alloc(36);data.writeUInt32LE(2);programData.toBuffer().copy(data,4);return account(data,loader,true)}
   if(address===programData.toBase58()){const data=Buffer.alloc(45);data.writeUInt32LE(3);data[12]=state.immutable?0:1;owner.publicKey.toBuffer().copy(data,13);return account(data,loader)}
   if(address==='SysvarC1ock11111111111111111111111111111111'){const data=Buffer.alloc(40);data.writeBigInt64LE(BigInt(now),32);return account(data,'Sysvar1111111111111111111111111111111111111')}
   if(address===service.pda('config').toBase58()){const data=Buffer.alloc(283);discriminator('account','MembershipConfig').copy(data);owner.publicKey.toBuffer().copy(data,8);oracle.toBuffer().copy(data,40);data.writeBigUInt64LE(10000n,72);data.writeBigUInt64LE(1n,80);data.writeBigUInt64LE(120n,88);data[96]=1;return account(data,program)}
   if(address===oracle.toBase58())return account(price(),PYTH_RECEIVER)
   const mint=service.pda('mint',u64(1n));if(address===mint.toBase58()){const data=Buffer.alloc(82);data.writeBigUInt64LE(1n,36);data[45]=1;return account(data,TOKEN_PROGRAM_ID.toBase58())}
   if(address===service.pda('member-mint',mint.toBuffer()).toBase58()&&state.registry){const data=Buffer.alloc(81);discriminator('account','MembershipMint').copy(data);service.pda('config').toBuffer().copy(data,8);mint.toBuffer().copy(data,40);data.writeBigUInt64LE(state.counterfeit?2n:1n,72);return account(data,program)}
   return null
  }
  let result
  if(method==='getGenesisHash')result=state.genesis
  else if(method==='getMultipleAccounts')result={value:params[0].map(get)}
  else if(method==='getAccountInfo')result={value:get(params[0])}
  else if(method==='getTokenAccountsByOwner')result={value:[{account:{owner:TOKEN_PROGRAM_ID.toBase58(),data:{parsed:{info:{owner:buyer.publicKey.toBase58(),mint:service.pda('mint',u64(1n)).toBase58(),tokenAmount:{amount:'1',decimals:0}}}}}}]}
  else throw new Error('Unexpected test RPC method')
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200})
 }
 service=new SolanaMembership({NODE_ENV:state.production?'production':'test',MEMBERSHIP_SOLANA_CLUSTER:state.production?'devnet':'localnet',MEMBERSHIP_SOLANA_GENESIS_HASH:'local-test-genesis',MEMBERSHIP_SOLANA_PROGRAM_ID:program,MEMBERSHIP_SOLANA_RPC_URL:'http://private-rpc.test'},fetcher)
 return{service,state}
}
test('SOL quote uses exact ceiling arithmetic and rejects unsafe prices',()=>{assert.equal(solLamports(10000000000n,-8),2000000000n);assert.equal(solLamports(300000000n,-8),66666666667n);assert.throws(()=>solLamports(0n,-8));assert.throws(()=>solLamports(1n,-19));assert.throws(()=>solLamports(1n,-18))})
test('SOL oracle rejects stale, partial, incorrect-feed, wrong-owner and wide-confidence prices',()=>{
 const data=price();assert.equal(decodeSolPrice(account(data,PYTH_RECEIVER),now,120).lamports,2000000000n)
 assert.throws(()=>decodeSolPrice(account(data,program),now,120));assert.throws(()=>decodeSolPrice(account(data,PYTH_RECEIVER),now+121,120))
 for(const change of[b=>{b[40]=0},b=>{b[41]^=1},b=>b.writeBigUInt64LE(10000000000n,81),b=>b.writeBigInt64LE(BigInt(now+6),93)]){const bad=Buffer.from(data);change(bad);assert.throws(()=>decodeSolPrice(account(bad,PYTH_RECEIVER),now,120))}
})
test('only a genuine registered program-derived NFT grants Solana access',async()=>{
 assert.equal(await fixture().service.hasAccess(buyer.publicKey.toBase58()),true)
 assert.equal(await fixture({registry:false}).service.hasAccess(buyer.publicKey.toBase58()),false)
 assert.equal(await fixture({counterfeit:true}).service.hasAccess(buyer.publicKey.toBase58()),false)
 const f=fixture();f.state.genesis='wrong-cluster';await assert.rejects(()=>f.service.hasAccess(buyer.publicKey.toBase58()),/cluster/)
})
test('production Solana verification requires immutable deployment authority',async()=>{
 await assert.rejects(()=>fixture({production:true}).service.hasAccess(buyer.publicKey.toBase58()),/Finalize/)
 assert.equal(await fixture({production:true,immutable:true}).service.hasAccess(buyer.publicKey.toBase58()),true)
})
test('Solana sign-in verifies real Ed25519 signatures and case-sensitive wallet identity',async()=>{
 const{service}=fixture(),message='BlockSonar unique sign-in challenge',key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(buyer.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'}),signature='0x'+sign(null,Buffer.from(message),key).toString('hex')
 assert.equal(await service.validSignature(buyer.publicKey.toBase58(),message,signature),true);assert.equal(await service.validSignature(owner.publicKey.toBase58(),message,signature),false);assert.equal(await service.validSignature(buyer.publicKey.toBase58(),message+'altered',signature),false)
})
