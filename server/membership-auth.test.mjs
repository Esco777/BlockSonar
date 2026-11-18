import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {EventEmitter} from 'node:events'
import {Wallet,verifyMessage} from 'ethers'
import {MembershipAuth} from './dist/server/membership-auth.js'
class Result extends EventEmitter{
 headers=new Map();statusCode=200;body='';ended=false
 setHeader(name,value){this.headers.set(name.toLowerCase(),value)}getHeader(name){return this.headers.get(name.toLowerCase())}
 writeHead(code){this.statusCode=code}end(body=''){this.body+=body;this.ended=true;this.emit('close')}
}
const origin='https://blocksonar.test',contract='0x1111111111111111111111111111111111111111'
function fixture(options={}){
 let now=Date.now(),member=true,fail=false,wait=null;const wallet=Wallet.createRandom()
 const verifier={configured:true,chainId:31337,contractAddress:contract,async hasAccess(){if(wait)await wait;if(fail)throw new Error('SECRET RPC URL');return member},async validSignature(address,message,signature){try{return verifyMessage(message,signature)===address}catch{return false}}}
 const auth=new MembershipAuth(verifier,{NODE_ENV:options.production?'production':'test',MEMBERSHIP_APP_ORIGINS:origin},()=>now)
 const jar=new Map(),req=(path,body,extra={})=>Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},socket:{remoteAddress:'test'}})
 const apply=res=>{for(const cookie of res.getHeader('Set-Cookie')??[]){const pair=cookie.split(';')[0],split=pair.indexOf('=');if(cookie.includes('Max-Age=0'))jar.delete(pair.slice(0,split));else jar.set(pair.slice(0,split),pair.slice(split+1))}return res}
 const call=async(path,body,extra)=>{const res=new Result();assert.equal(await auth.handle(req(path,body,extra),res,new URL(path,origin)),true);return apply(res)}
 const login=async()=>{const challenge=await call('/api/auth/challenge',{address:wallet.address,chainId:31337});assert.equal(challenge.statusCode,200);const message=JSON.parse(challenge.body).message;const response=await call('/api/auth/verify',{signature:await wallet.signMessage(message)});return {response,message}}
 return {auth,wallet,jar,req,call,login,verifier,advance(ms){now+=ms},setMember(value){member=value},setFail(value){fail=value},setWait(value){wait=value}}
}
test('signed member login grants an opaque HttpOnly session; a cookie or bearer claim alone grants nothing',async()=>{
 const f=fixture();const anonymous=new Result();await assert.rejects(()=>f.auth.authorize(f.req('/api/liquidity',undefined,{authorization:'Bearer anything'}),anonymous,new URL('/api/liquidity',origin)),error=>error.status===401)
 const {response,message}=await f.login();assert.equal(response.statusCode,200);assert.match(message,/blocksonar.test wants you to sign in/);assert.match(message,/Chain ID: 31337/);assert.match(message,/Nonce: [a-f0-9]{64}/)
 assert.ok(response.getHeader('Set-Cookie').some(cookie=>cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict')))
 assert.equal(JSON.parse(response.body).address,f.wallet.address);assert.equal('token'in JSON.parse(response.body),false)
 assert.equal((await f.call('/api/auth/session')).statusCode,200)
 const protectedResponse=new Result();await f.auth.authorize(f.req('/api/wallet-tracker'),protectedResponse,new URL('/api/wallet-tracker',origin));assert.equal(protectedResponse.getHeader('Cache-Control'),'private, no-store');f.auth.stop()
})
test('signatures are single-use and require the correct wallet, browser challenge cookie, origin and chain',async()=>{
 const f=fixture();const challenge=await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337});const message=JSON.parse(challenge.body).message,nonce=f.jar.get('blocksonar-challenge')
 assert.equal((await f.call('/api/auth/verify',{signature:await Wallet.createRandom().signMessage(message)})).statusCode,401)
 assert.equal((await f.call('/api/auth/verify',{signature:await f.wallet.signMessage(message)})).statusCode,401)
 assert.equal((await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:1})).statusCode,400)
 assert.equal((await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337},{origin:'https://evil.test'})).statusCode,403)
 assert.equal((await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337},{origin:undefined})).statusCode,403)
 const login=await f.login();f.jar.set('blocksonar-challenge',nonce);assert.equal((await f.call('/api/auth/verify',{signature:await f.wallet.signMessage(login.message)})).statusCode,401);f.auth.stop()
})
test('nonmembers cannot sign in; expired challenges and sessions cannot be reused',async()=>{
 const f=fixture();f.setMember(false);assert.equal((await f.login()).response.statusCode,403)
 f.setMember(true);const challenge=await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337});f.advance(300001)
 assert.equal((await f.call('/api/auth/verify',{signature:await f.wallet.signMessage(JSON.parse(challenge.body).message)})).statusCode,401)
 assert.equal((await f.login()).response.statusCode,200);f.advance(8*3600000+1);assert.equal((await f.call('/api/auth/session')).statusCode,401);f.auth.stop()
})
test('transferring the NFT revokes membership sessions and closes existing streams',async()=>{
 const f=fixture();await f.login();const stream=new Result();await f.auth.authorize(f.req('/api/liquidity/stream'),stream,new URL('/api/liquidity/stream',origin))
 f.setMember(false);f.advance(5001);assert.equal((await f.call('/api/auth/session')).statusCode,403);assert.equal(stream.ended,true);assert.equal((await f.call('/api/auth/session')).statusCode,401);f.auth.stop()
})
test('logout revokes the server session, expires cookies, and closes streams',async()=>{
 const f=fixture();await f.login();const oldCookie=[...f.jar].map(([k,v])=>`${k}=${v}`).join('; '),stream=new Result();await f.auth.authorize(f.req('/stream'),stream,new URL('/stream',origin))
 const logout=await f.call('/api/auth/logout',{});assert.equal(logout.statusCode,200);assert.equal(stream.ended,true);assert.equal(f.jar.size,0)
 assert.equal((await f.call('/api/auth/session',undefined,{cookie:oldCookie})).statusCode,401);f.auth.stop()
})
test('logout while membership verification is pending cannot create a new session afterward',async()=>{
 const f=fixture();const challenge=await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337});let release;f.setWait(new Promise(resolve=>release=resolve))
 const pending=f.call('/api/auth/verify',{signature:await f.wallet.signMessage(JSON.parse(challenge.body).message)})
 await new Promise(resolve=>setImmediate(resolve));await f.call('/api/auth/logout',{});release();assert.equal((await pending).statusCode,401);assert.equal((await f.call('/api/auth/session')).statusCode,401);f.auth.stop()
})
test('provider failures and missing server configuration fail closed without exposing secrets',async()=>{
 const f=fixture();await f.login();f.advance(5001);f.setFail(true);const response=await f.call('/api/auth/session');assert.equal(response.statusCode,503);assert.doesNotMatch(response.body,/SECRET/)
 f.verifier.configured=false;assert.equal((await f.call('/api/auth/session')).statusCode,503);f.auth.stop()
})
test('production cookies use Secure __Host prefixes and HTTPS origin-bound sessions',async()=>{
 const f=fixture({production:true});const{response}=await f.login();assert.equal(response.statusCode,200)
 assert.ok(response.getHeader('Set-Cookie').some(cookie=>cookie.startsWith('__Host-blocksonar-session=')&&cookie.includes('; Secure')&&!cookie.includes('Domain=')))
 assert.equal((await f.call('/api/auth/session',undefined,{origin:'https://evil.test'})).statusCode,403);f.auth.stop()
})
test('sign-in challenge budgets are bounded and logout remains available after rate limiting',async()=>{
 const f=fixture();let response
 for(let i=0;i<41;i++)response=await f.call('/api/auth/challenge',{address:f.wallet.address,chainId:31337})
 assert.equal(response.statusCode,429);assert.equal((await f.call('/api/auth/logout',{})).statusCode,200);f.auth.stop()
})

test('sessions and membership caches remain bound to the selected native network',async()=>{
 const f=fixture(),wallet=f.wallet;f.verifier.network='ethereum'
 let bnbMember=false,solMember=true
 const bnb={...f.verifier,network:'bnb',chainId:56,contractAddress:contract,hasAccess:async()=>bnbMember}
 const {Keypair}=await import('@solana/web3.js'),{SolanaMembership}=await import('./dist/server/solana-membership.js'),{createPrivateKey,sign}=await import('node:crypto')
 const solWallet=Keypair.generate(),solSignatures=new SolanaMembership({})
 const sol={network:'solana',configured:true,chainId:103,contractAddress:Keypair.generate().publicKey.toBase58(),hasAccess:async()=>solMember,validSignature:(...args)=>solSignatures.validSignature(...args)}
 const auth=new MembershipAuth(f.verifier,{NODE_ENV:'test',MEMBERSHIP_APP_ORIGINS:origin},Date.now,[bnb,sol])
 async function call(path,body){const res=new Result();await auth.handle(f.req(path,body),res,new URL(path,origin));for(const c of res.getHeader('Set-Cookie')??[]){const pair=c.split(';')[0],i=pair.indexOf('=');if(c.includes('Max-Age=0'))f.jar.delete(pair.slice(0,i));else f.jar.set(pair.slice(0,i),pair.slice(i+1))}return res}
 async function login(network,chainId,address,signer){const c=await call('/api/auth/challenge',{network,chainId,address});assert.equal(c.statusCode,200);return call('/api/auth/verify',{signature:await signer(JSON.parse(c.body).message)})}
 const publicNetworks=JSON.parse((await call('/api/auth/networks')).body).networks;assert.deepEqual(publicNetworks.map(n=>n.id),['ethereum','bnb','solana']);assert.doesNotMatch(JSON.stringify(publicNetworks),/RPC|private/)
 assert.equal((await login('ethereum',31337,wallet.address,m=>wallet.signMessage(m))).statusCode,200)
 assert.equal((await login('bnb',56,wallet.address,m=>wallet.signMessage(m))).statusCode,403,'Ethereum membership is never reused as BNB proof')
 bnbMember=true;const bnbSession=await login('bnb',56,wallet.address,m=>wallet.signMessage(m));assert.equal(JSON.parse(bnbSession.body).network,'bnb')
 assert.equal((await call('/api/auth/challenge',{network:'solana',chainId:56,address:solWallet.publicKey.toBase58()})).statusCode,400)
 const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(solWallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'})
 const solSession=await login('solana',103,solWallet.publicKey.toBase58(),m=>'0x'+sign(null,Buffer.from(m),key).toString('hex'))
 assert.equal(solSession.statusCode,200);assert.equal(JSON.parse(solSession.body).network,'solana');assert.equal((await call('/api/auth/session')).statusCode,200)
 await call('/api/auth/logout',{});assert.equal((await call('/api/auth/session')).statusCode,401);auth.stop();f.auth.stop()
})
