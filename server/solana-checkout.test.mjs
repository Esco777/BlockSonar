import{test}from'node:test'
import assert from'node:assert/strict'
import{Readable}from'node:stream'
import{MembershipAuth}from'./dist/server/membership-auth.js'
import{SOLANA_MAINNET_GENESIS}from'./dist/server/solana-dex.js'
import{SolanaCheckout}from'./dist/server/solana-checkout.js'
const origin='https://blocksonar.test'
function fixture(env){
 const auth=new MembershipAuth({configured:false,chainId:1,contractAddress:'',hasAccess:async()=>false,validSignature:async()=>false},{NODE_ENV:'production',MEMBERSHIP_APP_ORIGINS:origin})
 let fail=false;const service={configured:true,quote:async()=>{if(fail)throw new Error('private RPC https://secret.test/key');return{lamports:'2000000000'}},prepare:async(address,cap,from)=>({address,cap,from})},checkout=new SolanaCheckout(service,auth,env)
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

test('selector balance verifies Solana mainnet independently of membership deployment', async (t) => {
 const primary = 'https://primary.test/key'
 const fallback = 'https://fallback.test/key'
 const calls = []
 t.mock.method(globalThis, 'fetch', async (endpoint, request) => {
  const { method } = JSON.parse(request.body)
  calls.push([endpoint, method])
  if (method === 'getGenesisHash') return Response.json({ result: endpoint === fallback ? SOLANA_MAINNET_GENESIS : 'devnet' })
  assert.equal(endpoint, fallback)
  assert.equal(method, 'getBalance')
  return Response.json({ result: { value: 1_500_000_000 } })
 })
 const f = fixture({ DEX_SOLANA_RPC_URL: primary, DEX_SOLANA_FALLBACK_RPC_URL: fallback, MEMBERSHIP_SOLANA_CLUSTER: 'devnet' })
 f.service.configured = false
 const address = '11111111111111111111111111111111'
 assert.equal((await f.call('mainnet-balance', { address: 'invalid' })).statusCode, 400)
 assert.deepEqual(calls, [])
 const result = await f.call('mainnet-balance', { address })
 assert.equal(result.statusCode, 200)
 assert.deepEqual(JSON.parse(result.body), { lamports: 1_500_000_000 })
 assert.deepEqual(calls, [[primary, 'getGenesisHash'], [fallback, 'getGenesisHash'], [fallback, 'getBalance']])
})
