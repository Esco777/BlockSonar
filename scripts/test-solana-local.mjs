// Requires the isolated validator described in docs/multichain-membership.md.
import assert from 'node:assert/strict'
import {readFile}from'node:fs/promises'
import {createPrivateKey,sign}from'node:crypto'
import {Keypair,Connection,PublicKey,Transaction,TransactionInstruction,SystemProgram,VersionedTransaction,sendAndConfirmTransaction}from'@solana/web3.js'
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountInstruction,createTransferInstruction}from'@solana/spl-token'
import {SolanaMembership,discriminator,u64}from'../server/dist/server/solana-membership.js'
const rpc=process.env.SOLANA_TEST_RPC||'http://127.0.0.1:8899',connection=new Connection(rpc,'confirmed')
if(new URL(rpc).hostname!=='127.0.0.1')throw new Error('This test only supports a disposable localhost validator')
const fixtureDir=process.env.SOLANA_TEST_FIXTURE_DIR||'/tmp'
const fixture=JSON.parse(await readFile(`${fixtureDir}/blocksonar-solana-test-public.json`,'utf8'))
const deployer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(`${fixtureDir}/blocksonar-solana-test-deployer.json`,'utf8')))),buyer=Keypair.generate(),outsider=Keypair.generate()
const service=new SolanaMembership({MEMBERSHIP_SOLANA_CLUSTER:'localnet',MEMBERSHIP_SOLANA_PROGRAM_ID:fixture.programId||'6hv79zuF9vjoiiYE6KTCXXbKLJfdiEKDndNjBsGRCU97',MEMBERSHIP_SOLANA_RPC_URL:rpc,MEMBERSHIP_SOLANA_GENESIS_HASH:await connection.getGenesisHash(),NODE_ENV:'test'})
const program=new PublicKey(service.contractAddress),config=service.pda('config'),treasury=service.pda('treasury'),key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner})
async function send(name,keys,data,signer=deployer){return sendAndConfirmTransaction(connection,new Transaction().add(new TransactionInstruction({programId:program,keys,data:Buffer.concat([discriminator('global',name),data])})),[signer],{commitment:'finalized',preflightCommitment:'confirmed',maxRetries:8})}
await Promise.all([deployer,buyer,outsider].map(async person=>{const signature=await connection.requestAirdrop(person.publicKey,100_000_000_000);await connection.confirmTransaction(signature,'finalized')}))
const deployed=await connection.getAccountInfo(program),uri=Buffer.from('ipfs://local-test/'),len=Buffer.alloc(4);len.writeUInt32LE(uri.length)
const initKeys=[key(deployer.publicKey,true,true),key(program),key(new PublicKey(deployed.data.subarray(4,36))),key(config,true),key(treasury,true),key(new PublicKey(fixture.oracle)),key(SystemProgram.programId)]
await assert.rejects(()=>send('initialize',[key(outsider.publicKey,true,true),...initKeys.slice(1)],Buffer.concat([u64(10000n),u64(300n),len,uri]),outsider),'only actual program deployer can initialize')
await send('initialize',initKeys,Buffer.concat([u64(10000n),u64(300n),len,uri]))
await send('set_minting_open',[key(deployer.publicKey,false,true),key(config,true)],Buffer.from([1]))
console.log('Local program initialized and sale opened');
const quote=await service.quote();assert.equal(quote.lamports,'2000000000');assert.equal(await service.hasAccess(buyer.publicKey.toBase58()),false)
const origin='http://localhost:5173',prepared=await service.prepare(buyer.publicKey.toBase58(),'2020000000',origin)
const transaction=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));transaction.sign([buyer])
const tampered=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));tampered.message.recentBlockhash=PublicKey.default.toBase58();tampered.sign([buyer])
await assert.rejects(()=>service.submit(prepared.intentId,Buffer.from(tampered.serialize()).toString('base64'),origin),/does not match/)
await assert.rejects(()=>service.submit(prepared.intentId,Buffer.from(transaction.serialize()).toString('base64'),'https://evil.test'),/expired/)
const balanceBefore=await connection.getBalance(deployer.publicKey,'finalized'),rentBefore=await connection.getBalance(treasury,'finalized')
console.log('Testing signed native NFT mint');
const submitted=await service.submit(prepared.intentId,Buffer.from(transaction.serialize()).toString('base64'),origin)
await connection.confirmTransaction(submitted.signature,'finalized')
assert.equal((await service.status(prepared.intentId,origin)).finalized,true)
assert.equal(await connection.getBalance(deployer.publicKey,'finalized'),balanceBefore,'purchase never pays deployer directly')
assert.equal(await connection.getBalance(treasury,'finalized'),rentBefore+2_000_000_000,'purchase stays in treasury')
assert.equal(await service.hasAccess(buyer.publicKey.toBase58()),true,'genuine native NFT grants access')
const message='BlockSonar native Solana login',privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(buyer.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'}),signature='0x'+sign(null,Buffer.from(message),privateKey).toString('hex')
assert.equal(await service.validSignature(buyer.publicKey.toBase58(),message,signature),true);assert.equal(await service.validSignature(outsider.publicKey.toBase58(),message,signature),false)
await assert.rejects(()=>send('withdraw',[key(outsider.publicKey,false,true),key(config),key(treasury,true),key(outsider.publicKey,true)],Buffer.alloc(0),outsider),'non-deployer cannot withdraw')
await send('withdraw',[key(deployer.publicKey,false,true),key(config),key(treasury,true),key(outsider.publicKey,true)],Buffer.alloc(0))
assert.equal(await connection.getBalance(treasury,'finalized'),rentBefore,'withdraw preserves treasury rent')
console.log('Retained funds and withdrawal permissions passed; checking NFT transfer');
const mint=new PublicKey(prepared.mint),from=getAssociatedTokenAddressSync(mint,buyer.publicKey),to=getAssociatedTokenAddressSync(mint,outsider.publicKey)
await sendAndConfirmTransaction(connection,new Transaction().add(createAssociatedTokenAccountInstruction(buyer.publicKey,to,outsider.publicKey,mint),createTransferInstruction(from,to,buyer.publicKey,1)),[buyer],{commitment:'finalized',preflightCommitment:'confirmed',maxRetries:8})
assert.equal(await service.hasAccess(buyer.publicKey.toBase58()),false);assert.equal(await service.hasAccess(outsider.publicKey.toBase58()),true)
console.log('PASS: Solana initialization authority, real NFT mint/transfer, signatures, transaction tamper/origin checks, retained proceeds and deployer-only withdrawals')

if(process.env.SOLANA_TEST_BROWSER==='1'){const{testSolanaBrowser}=await import('./test-solana-browser.mjs');await testSolanaBrowser(service,buyer)}
