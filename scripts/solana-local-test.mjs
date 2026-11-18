// No public transactions: a new disposable ledger, mock price and test keys per run.
import{mkdtemp,readFile,writeFile,access}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{spawn}from'node:child_process'
import{Keypair}from'@solana/web3.js'
import{discriminator,SOL_USD_FEED,PYTH_RECEIVER}from'../server/dist/server/solana-membership.js'
const rpc='http://127.0.0.1:8899'
try{await fetch(rpc,{signal:AbortSignal.timeout(500)});throw new Error('Port 8899 is already in use; stop your disposable test validator first')}catch(error){if(error.message.includes('already in use'))throw error}
const metadata=process.env.SOLANA_TEST_METADATA_SO||'/tmp/blocksonar-metaplex.so',programSo='solana/target/deploy/blocksonar_membership.so'
await access(metadata);await access(programSo)
const dir=await mkdtemp(join(tmpdir(),'blocksonar-solana-qa-')),source=await readFile('solana/programs/blocksonar-membership/src/lib.rs','utf8'),programId=source.match(/declare_id!\("([^"]+)"\)/)[1]
const deployer=Keypair.generate(),oracle=Keypair.generate(),keyPath=join(dir,'blocksonar-solana-test-deployer.json'),oraclePath=join(dir,'oracle.json')
await writeFile(keyPath,JSON.stringify([...deployer.secretKey]),{mode:0o600})
await writeFile(join(dir,'blocksonar-solana-test-public.json'),JSON.stringify({programId,deployer:deployer.publicKey.toBase58(),oracle:oracle.publicKey.toBase58()}))
const data=Buffer.alloc(134);discriminator('account','PriceUpdateV2').copy(data);data[40]=1;Buffer.from(SOL_USD_FEED,'hex').copy(data,41);data.writeBigInt64LE(10000000000n,73);data.writeBigUInt64LE(1000000n,81);data.writeInt32LE(-8,89);data.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)),93)
await writeFile(oraclePath,JSON.stringify({pubkey:oracle.publicKey.toBase58(),account:{lamports:10000000,data:[data.toString('base64'),'base64'],owner:PYTH_RECEIVER,executable:false,rentEpoch:0}}))
const tools=process.env.SOLANA_TOOLS_BIN,command=tools?join(tools,'solana-test-validator'):'solana-test-validator'
const validator=spawn(command,['--ledger',join(dir,'ledger'),'--rpc-port','8899','--bind-address','127.0.0.1','--ticks-per-slot','32','--faucet-port','9900','--upgradeable-program',programId,programSo,keyPath,'--bpf-program','metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',metadata,'--account','-',oraclePath,'--quiet'],{stdio:['ignore','ignore','pipe']})
let failed=false,log='';validator.stderr.on('data',chunk=>{log+=chunk.toString()});validator.on('exit',()=>{failed=true});validator.on('error',error=>{failed=true;log+=error.message})
try{
 let ready=false
 for(let i=0;i<120;i++){if(failed)throw new Error(log);try{const response=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})});if((await response.json()).result==='ok'){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,500))}
 if(!ready)throw new Error('Local Solana validator did not start')
 const test=spawn(process.execPath,['scripts/test-solana-local.mjs'],{stdio:'inherit',env:{...process.env,SOLANA_TEST_FIXTURE_DIR:dir,SOLANA_TEST_RPC:rpc}})
 const result=await new Promise((resolve,reject)=>{test.on('exit',resolve);test.on('error',reject)})
 if(result!==0)throw new Error('Local Solana membership integration failed')
}finally{validator.kill('SIGTERM');console.log(`Disposable Solana test files: ${dir}`)}
