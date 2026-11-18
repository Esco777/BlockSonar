import 'dotenv/config'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Keypair,PublicKey,Connection,Transaction,TransactionInstruction,SystemProgram,sendAndConfirmTransaction} from '@solana/web3.js'
const action=process.argv[2]
if(action==='keygen'){
 const path='solana/target/deploy/blocksonar_membership-keypair.json';await mkdir('solana/target/deploy',{recursive:true})
 const key=Keypair.generate();await writeFile(path,JSON.stringify([...key.secretKey]),{mode:0o600,flag:'wx'})
 const sourcePath='solana/programs/blocksonar-membership/src/lib.rs',source=await readFile(sourcePath,'utf8')
 await writeFile(sourcePath,source.replace(/declare_id!\("[^"]+"\)/,`declare_id!("${key.publicKey}")`))
 console.log(`Program ID: ${key.publicKey}\nKeypair: ${path}\nBuild after generating this key. Back it up securely.`)
}else{
 if(!['initialize','open','close','withdraw'].includes(action))throw new Error('Usage: node scripts/solana-membership.mjs keygen|initialize|open|close|withdraw [recipient]')
 const env=process.env,cluster=env.MEMBERSHIP_SOLANA_CLUSTER||'mainnet-beta',program=new PublicKey(env.MEMBERSHIP_SOLANA_PROGRAM_ID)
 const rpc=env.MEMBERSHIP_SOLANA_RPC_URL||(env.ALCHEMY_API_KEY&&cluster!=='localnet'?`https://${cluster==='devnet'?'solana-devnet':'solana-mainnet'}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`:'')
 if(!rpc||!env.MEMBERSHIP_SOLANA_DEPLOYER_KEYPAIR)throw new Error('Set the private Solana RPC and deployer keypair file path')
 const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(env.MEMBERSHIP_SOLANA_DEPLOYER_KEYPAIR,'utf8'))))
 const connection=new Connection(rpc,'finalized'),genesis=await connection.getGenesisHash()
 const expected=env.MEMBERSHIP_SOLANA_GENESIS_HASH||(cluster==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1':cluster==='mainnet-beta'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp':'')
 if(!expected||!genesis.startsWith(expected))throw new Error('Solana cluster mismatch; localnet requires MEMBERSHIP_SOLANA_GENESIS_HASH')
 const pda=seed=>PublicKey.findProgramAddressSync([Buffer.from(seed)],program)[0],config=pda('config'),treasury=pda('treasury')
 const account=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner})
 const integer=value=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(value));return data}
 let keys,data,name
 if(action==='initialize'){
  name='initialize';const deployed=await connection.getAccountInfo(program);if(!deployed?.executable||deployed.data.length!==36)throw new Error('Deploy the compiled upgradeable program first')
  const price=new PublicKey(env.MEMBERSHIP_SOLANA_PRICE_ACCOUNT),uri=Buffer.from(env.MEMBERSHIP_BASE_URI||'')
  if(!uri.length||uri.length>180)throw new Error('Set MEMBERSHIP_BASE_URI (1–180 bytes)')
  const length=Buffer.alloc(4);length.writeUInt32LE(uri.length)
  data=Buffer.concat([integer(env.MEMBERSHIP_MAX_SUPPLY||10000),integer(env.MEMBERSHIP_SOLANA_MAX_PRICE_AGE_SECONDS||120),length,uri])
  keys=[account(signer.publicKey,true,true),account(program),account(new PublicKey(deployed.data.subarray(4,36))),account(config,true),account(treasury,true),account(price),account(SystemProgram.programId)]
 }else{
  const existing=await connection.getAccountInfo(config)
  if(!existing||existing.owner.toBase58()!==program.toBase58()||!new PublicKey(existing.data.subarray(8,40)).equals(signer.publicKey))throw new Error('Only the original configured deployer may administer this membership')
  if(action==='withdraw'){name='withdraw';data=Buffer.alloc(0);if(!process.argv[3])throw new Error('Specify the withdrawal recipient');keys=[account(signer.publicKey,false,true),account(config),account(treasury,true),account(new PublicKey(process.argv[3]),true)]}
  else{name='set_minting_open';data=Buffer.from([action==='open'?1:0]);keys=[account(signer.publicKey,false,true),account(config,true)]}
 }
 const discriminator=createHash('sha256').update(`global:${name}`).digest().subarray(0,8)
 const transaction=new Transaction().add(new TransactionInstruction({programId:program,keys,data:Buffer.concat([discriminator,data])}))
 // Explicit CLI invocation is required for every administrative transaction.
 try{const signature=await sendAndConfirmTransaction(connection,transaction,[signer],{commitment:'finalized'});console.log(`${action} finalized on ${cluster}: ${signature}`)}catch{throw new Error('Solana administrative transaction failed; check the deployed program, oracle freshness and signer. Private RPC details omitted.')}
}
