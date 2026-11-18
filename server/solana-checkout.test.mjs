import{test}from'node:test'
import assert from'node:assert/strict'
import{Readable}from'node:stream'
import{MembershipAuth}from'./dist/server/membership-auth.js'
import{SolanaCheckout}from'./dist/server/solana-checkout.js'
const origin='https://blocksonar.test'
function fixture(){
 const auth=new MembershipAuth({configured:false,chainId:1,contractAddress:'',hasAccess:async()=>false,validSignature:async()=>false},{NODE_ENV:'production',MEMBERSHIP_APP_ORIGINS:origin})
 let fail=false;const service={configured:true,quote:async()=>{if(fail)throw new Error('private RPC https://secret.test/key');return{lamports:'2000000000'}},prepare:async(address,cap,from)=>({address,cap,from})},checkout=new SolanaCheckout(service,auth)
 async function call(path='quote',body={},headers={},method='POST'){
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{headers:{origin,'content-type':'application/json',...headers},method,socket:{remoteAddress:'test'}})
  const res={statusCode:200,headersSent:false,headers:{},setHeader(name,value){this.headers[name]=value},writeHead(status){this.statusCode=status},end(body){this.body=body}}
  assert.equal(await checkout.handle(req,res,new URL(`/api/membership/solana/${path}`,origin)),true);return res
 }
 return{call,service,fail(){fail=true}}
}
test('public Solana checkout accepts only fixed same-origin JSON POST operations',async()=>{
 const f=fixture();assert.equal((await f.call()).statusCode,200)
 assert.equal((await f.call('quote',{}, {origin:'https://evil.test'})).statusCode,403)
 assert.equal((await f.call('quote',{}, {origin:undefined})).statusCode,403)
 assert.equal((await f.call('quote',{}, {},'GET')).statusCode,405)
 assert.equal((await f.call('quote',{}, {'content-type':'text/plain'})).statusCode,415)
 assert.equal((await f.call('sendTransaction')).statusCode,404)
 assert.equal((await f.call('quote',{padding:'x'.repeat(8192)})).statusCode,413)
 const prepared=await f.call('prepare',{address:'buyer',maxLamports:'2020000000'});assert.deepEqual(JSON.parse(prepared.body),{address:'buyer',cap:'2020000000',from:origin})
})
test('unconfigured or failing Solana purchase providers fail closed without exposing RPC secrets',async()=>{
 const f=fixture();f.service.configured=false;assert.equal((await f.call()).statusCode,503)
 f.service.configured=true;f.fail();const result=await f.call();assert.equal(result.statusCode,503);assert.doesNotMatch(result.body,/secret.test|private RPC/)
})
