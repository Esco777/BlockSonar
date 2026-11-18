import {createHash,createPublicKey,randomBytes,verify as verifyEd25519} from 'node:crypto'
import {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,SYSVAR_RENT_PUBKEY,ComputeBudgetProgram} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token'
import {ProviderCache} from './provider-cache.js'
import type {MembershipVerifier} from './membership-verifier.js'
import {validAddress} from '../src/lib/token-identity.js'
export const SOL_USD_FEED='ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
export const PYTH_RECEIVER='rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'
export const METADATA_PROGRAM=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const LOADER='BPFLoaderUpgradeab1e11111111111111111111111',CLOCK='SysvarC1ock11111111111111111111111111111111'
export const discriminator=(kind:string,name:string)=>createHash('sha256').update(`${kind}:${name}`).digest().subarray(0,8)
export const u64=(value:bigint)=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(value);return data}
export function solLamports(price:bigint,exponent:number){
 if(price<=0n||!Number.isInteger(exponent)||exponent < -18||exponent>18)throw new Error('Invalid SOL/USD price')
 const scale=10n**BigInt(Math.abs(exponent)),numerator=200n*1_000_000_000n*(exponent<0?scale:1n),denominator=price*(exponent>=0?scale:1n)
 const value=(numerator+denominator-1n)/denominator
 if(value<=0n||value>0xffffffffffffffffn)throw new Error('SOL amount outside supported range')
 return value
}
type RpcAccount={owner:string;executable?:boolean;data:[string,string];lamports:number}
export function decodeSolConfig(account:RpcAccount|null,program:string){
 if(!account||account.owner!==program)throw new Error('Solana membership deployment is unavailable')
 const data=Buffer.from(account.data[0],'base64')
 if(data.length<103||!data.subarray(0,8).equals(discriminator('account','MembershipConfig')))throw new Error('Invalid Solana membership configuration')
 const maxSupply=data.readBigUInt64LE(72),totalMinted=data.readBigUInt64LE(80),maxPriceAge=data.readBigUInt64LE(88),uriLength=data.readUInt32LE(99)
 if(maxSupply===0n||totalMinted>maxSupply||maxPriceAge===0n||maxPriceAge>300n||uriLength>180||data.length<103+uriLength||data[96]>1)throw new Error('Invalid Solana sale configuration')
 return {deployer:new PublicKey(data.subarray(8,40)),priceAccount:new PublicKey(data.subarray(40,72)),maxSupply,totalMinted,maxPriceAge,mintingOpen:data[96]===1,bump:data[97],treasuryBump:data[98],baseUri:data.subarray(103,103+uriLength).toString('utf8')}
}
export function decodeSolPrice(account:RpcAccount|null,nowSeconds:number,maxAge:number){
 if(!account||account.owner!==PYTH_RECEIVER)throw new Error('SOL price must come from the configured Pyth oracle')
 const data=Buffer.from(account.data[0],'base64')
 if(data.length<133||!data.subarray(0,8).equals(discriminator('account','PriceUpdateV2'))||data[40]!==1||data.subarray(41,73).toString('hex')!==SOL_USD_FEED)throw new Error('Invalid or partially verified SOL/USD price')
 const price=data.readBigInt64LE(73),confidence=data.readBigUInt64LE(81),exponent=data.readInt32LE(89),published=Number(data.readBigInt64LE(93))
 if(price<=0n||confidence*100n>price||published<=0||published>nowSeconds+5||nowSeconds-published>maxAge)throw new Error('SOL/USD oracle is stale or unavailable; the operator must update its Pyth feed')
 return {lamports:solLamports(price,exponent),published,price,exponent}
}
const keyBytes=(address:string)=>new PublicKey(address).toBuffer()
const messageSignature=(address:string,message:Uint8Array,signature:Uint8Array)=>verifyEd25519(null,message,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),keyBytes(address)]),format:'der',type:'spki'}),signature)
type Intent={address:string;origin:string;hash:string;expiresAt:number;blockhash:string;lastValidBlockHeight:number;signature?:string}
export class SolanaMembership implements MembershipVerifier{
 readonly network='solana' as const;readonly chainId:number;readonly cluster:string;readonly contractAddress:string;readonly configured:boolean
 private rpcUrl:string;private cache:ProviderCache;private intents=new Map<string,Intent>()
 constructor(private env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
  this.cluster=env.MEMBERSHIP_SOLANA_CLUSTER||'mainnet-beta';this.chainId=this.cluster==='devnet'?103:this.cluster==='localnet'?102:101;this.contractAddress=env.MEMBERSHIP_SOLANA_PROGRAM_ID||''
  this.rpcUrl=env.MEMBERSHIP_SOLANA_RPC_URL||(env.ALCHEMY_API_KEY&&this.cluster!=='localnet'?`https://${this.cluster==='devnet'?'solana-devnet':'solana-mainnet'}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`:'')
  this.configured=validAddress('solana',this.contractAddress)&&!!this.rpcUrl&&['mainnet-beta','devnet','localnet'].includes(this.cluster)&&!(env.NODE_ENV==='production'&&this.cluster==='localnet')
  this.cache=new ProviderCache(fetcher)
 }
 private async rpc(method:string,params:unknown[],ttl=1000):Promise<any>{
  if(!this.configured)throw new Error('Solana membership is not deployed or configured')
  const data=await this.cache.get<any>(this.rpcUrl,'solana-membership',300,ttl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  if(data.error||data.result==null)throw new Error('Solana membership RPC is unavailable')
  return data.result
 }
 pda(seed:string,...keys:Buffer[]){return PublicKey.findProgramAddressSync([Buffer.from(seed),...keys],new PublicKey(this.contractAddress))[0]}
 private async state(){
  const genesis=await this.rpc('getGenesisHash',[],300000),expected=this.env.MEMBERSHIP_SOLANA_GENESIS_HASH||(this.cluster==='mainnet-beta'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp':this.cluster==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1':'')
  if(!expected||typeof genesis!=='string'||!genesis.startsWith(expected))throw new Error('Solana RPC cluster does not match membership configuration')
  const result=await this.rpc('getMultipleAccounts',[[this.pda('config').toBase58(),this.contractAddress,CLOCK],{encoding:'base64',commitment:'finalized'}],0)
  if(!Array.isArray(result.value)||result.value.length!==3)throw new Error('Invalid Solana account response')
  const [configAccount,program,clock]=result.value as [RpcAccount|null,RpcAccount|null,RpcAccount|null]
  const config=decodeSolConfig(configAccount,this.contractAddress)
  if(!program?.executable||program.owner!==LOADER||!clock)throw new Error('Solana membership program is unavailable')
  const programData=Buffer.from(program.data[0],'base64');if(programData.length!==36||programData.readUInt32LE(0)!==2)throw new Error('Invalid membership program')
  const authorityAccount=(await this.rpc('getAccountInfo',[new PublicKey(programData.subarray(4,36)).toBase58(),{encoding:'base64',commitment:'finalized'}],60000)).value as RpcAccount|null
  if(!authorityAccount||authorityAccount.owner!==LOADER)throw new Error('Invalid membership program data')
  const authority=Buffer.from(authorityAccount.data[0],'base64')
  if(authority.length<13||authority.readUInt32LE(0)!==3)throw new Error('Invalid program authority')
  if(authority[12]===1){if(authority.length<45||!new PublicKey(authority.subarray(13,45)).equals(config.deployer)||this.env.NODE_ENV==='production')throw new Error('Finalize the Solana program before enabling production purchases')}else if(authority[12]!==0)throw new Error('Invalid program authority')
  const clockData=Buffer.from(clock.data[0],'base64');if(clockData.length!==40)throw new Error('Invalid Solana clock')
  return {config,nowSeconds:Number(clockData.readBigInt64LE(32))}
 }
 async hasAccess(address:string){
  if(!validAddress('solana',address))return false
  const{config}=await this.state()
  const response=await this.rpc('getTokenAccountsByOwner',[address,{programId:TOKEN_PROGRAM_ID.toBase58()},{encoding:'jsonParsed',commitment:'finalized'}],0)
  if(!Array.isArray(response.value)||response.value.length>5000)throw new Error('Wallet NFT coverage exceeds supported bounds')
  const candidates:string[]=response.value.flatMap((row:any)=>{const info=row?.account?.data?.parsed?.info;return row.account?.owner===TOKEN_PROGRAM_ID.toBase58()&&info?.owner===address&&info.tokenAmount?.amount==='1'&&info.tokenAmount.decimals===0&&validAddress('solana',info.mint)?[info.mint as string]:[]})
  if(candidates.length>512)throw new Error('Wallet NFT coverage exceeds supported bounds')
  for(let start=0;start<candidates.length;start+=32){
   const mints=candidates.slice(start,start+32),keys=mints.flatMap(mint=>[mint,this.pda('member-mint',keyBytes(mint)).toBase58()])
   const accounts=(await this.rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}],0)).value as Array<RpcAccount|null>
   if(!Array.isArray(accounts)||accounts.length!==keys.length)throw new Error('Invalid NFT ownership response')
   for(let index=0;index<mints.length;index++){
    const mint=accounts[index*2],record=accounts[index*2+1];if(!mint||!record||mint.owner!==TOKEN_PROGRAM_ID.toBase58()||record.owner!==this.contractAddress)continue
    const data=Buffer.from(mint.data[0],'base64'),registry=Buffer.from(record.data[0],'base64')
    if(data.length!==82||data[44]!==0||data[45]!==1||data.readBigUInt64LE(36)!==1n||registry.length!==81||!registry.subarray(0,8).equals(discriminator('account','MembershipMint'))||!registry.subarray(8,40).equals(this.pda('config').toBuffer())||!registry.subarray(40,72).equals(keyBytes(mints[index])))continue
    const serial=registry.readBigUInt64LE(72);if(serial>0n&&serial<=config.totalMinted&&this.pda('mint',u64(serial)).toBase58()===mints[index])return true
   }
  }
  return false
 }
 async validSignature(address:string,message:string,signature:string){try{return messageSignature(address,Buffer.from(message),Buffer.from(signature.slice(2),'hex'))}catch{return false}}
 async quote(){
  const{config,nowSeconds}=await this.state()
  const account=(await this.rpc('getAccountInfo',[config.priceAccount.toBase58(),{encoding:'base64',commitment:'finalized'}],0)).value as RpcAccount|null
  const price=decodeSolPrice(account,nowSeconds,Number(config.maxPriceAge))
  return {configured:true,network:'solana',cluster:this.cluster,currency:'SOL',priceUsd:200,lamports:price.lamports.toString(),priceAt:price.published*1000,source:'Pyth',mintingOpen:config.mintingOpen,totalMinted:config.totalMinted.toString(),maxSupply:config.maxSupply.toString(),programId:this.contractAddress,deployer:config.deployer.toBase58()}
 }
 async balance(address:string){if(!validAddress('solana',address))throw new Error('Invalid Solana wallet');return {lamports:String((await this.rpc('getBalance',[address,{commitment:'finalized'}])).value)}}
 async prepare(address:string,cap:string,origin:string){
  if(!validAddress('solana',address)||!/^\d{1,20}$/.test(cap)||BigInt(cap)>0xffffffffffffffffn)throw new Error('Invalid SOL purchase request')
  if(await this.hasAccess(address))throw new Error('This wallet already holds a membership NFT')
  const quote=await this.quote();if(!quote.mintingOpen||BigInt(quote.totalMinted)>=BigInt(quote.maxSupply))throw new Error('Solana membership minting is closed or sold out')
  if(BigInt(quote.lamports)>BigInt(cap))throw new Error('The SOL quote changed; refresh and try again')
  const config=this.pda('config'),treasury=this.pda('treasury'),serial=BigInt(quote.totalMinted)+1n,mint=this.pda('mint',u64(serial)),buyer=new PublicKey(address),registry=this.pda('member-mint',mint.toBuffer())
  const metadata=PublicKey.findProgramAddressSync([Buffer.from('metadata'),METADATA_PROGRAM.toBuffer(),mint.toBuffer()],METADATA_PROGRAM)[0],edition=PublicKey.findProgramAddressSync([Buffer.from('metadata'),METADATA_PROGRAM.toBuffer(),mint.toBuffer(),Buffer.from('edition')],METADATA_PROGRAM)[0]
  const state=await this.state()
  const keys=[{pubkey:buyer,isSigner:true,isWritable:true},... [config,treasury].map(pubkey=>({pubkey,isSigner:false,isWritable:true})),{pubkey:state.config.priceAccount,isSigner:false,isWritable:false},...[mint,getAssociatedTokenAddressSync(mint,buyer),registry,metadata,edition].map(pubkey=>({pubkey,isSigner:false,isWritable:true})),...[METADATA_PROGRAM,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,SystemProgram.programId,SYSVAR_RENT_PUBKEY].map(pubkey=>({pubkey,isSigner:false,isWritable:false}))]
  const instruction=new TransactionInstruction({programId:new PublicKey(this.contractAddress),keys,data:Buffer.concat([discriminator('global','mint'),u64(serial),u64(BigInt(cap))])})
  const latest=(await this.rpc('getLatestBlockhash',[{commitment:'confirmed'}],0)).value
  const transaction=new VersionedTransaction(new TransactionMessage({payerKey:buyer,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000}),instruction]}).compileToV0Message())
  for(const[id,intent]of this.intents)if(intent.expiresAt<Date.now())this.intents.delete(id)
  if(this.intents.size>=1000)throw new Error('Checkout is busy; retry shortly')
  const intentId=randomBytes(32).toString('hex');this.intents.set(intentId,{address,origin,hash:createHash('sha256').update(transaction.message.serialize()).digest('hex'),expiresAt:Date.now()+120000,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight})
  return {...quote,intentId,mint:mint.toBase58(),transaction:Buffer.from(transaction.serialize()).toString('base64')}
 }
 async submit(id:string,encoded:string,origin:string){
  const intent=this.intents.get(id);if(!intent||intent.origin!==origin||intent.expiresAt<Date.now())throw new Error('Checkout expired; refresh and check membership before retrying')
  if(encoded.length>2000)throw new Error('Invalid signed transaction')
  const bytes=Buffer.from(encoded,'base64'),transaction=VersionedTransaction.deserialize(bytes),message=transaction.message.serialize()
  if(bytes.length>1232||transaction.signatures.length!==1||transaction.message.header.numRequiredSignatures!==1||transaction.message.staticAccountKeys[0].toBase58()!==intent.address||createHash('sha256').update(message).digest('hex')!==intent.hash||!messageSignature(intent.address,message,transaction.signatures[0]))throw new Error('Signed transaction does not match this membership purchase')
  if(!intent.signature)intent.signature=await this.rpc('sendTransaction',[encoded,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:3}],0)
  return {signature:intent.signature,intentId:id,cluster:this.cluster}
 }
 async status(id:string,origin:string){const intent=this.intents.get(id);if(!intent?.signature||intent.origin!==origin)throw new Error('No submitted membership transaction');const result=await this.rpc('getSignatureStatuses',[[intent.signature],{searchTransactionHistory:true}],0),status=result.value?.[0];if(status?.err)throw new Error('Membership purchase failed on-chain; check the transaction before retrying');return {signature:intent.signature,finalized:status?.confirmationStatus==='finalized',expired:Date.now()>intent.expiresAt+60000}}
}
