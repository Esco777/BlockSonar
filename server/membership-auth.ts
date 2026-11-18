import {validAddress} from '../src/lib/token-identity.js'
import {MEMBERSHIP_NETWORK_LABELS} from '../src/lib/membership-networks.js'
import {randomBytes,createHash} from 'node:crypto'
import {getAddress,isAddress} from 'ethers'
import type {IncomingMessage,ServerResponse} from 'node:http'
import type {MembershipVerifier} from './membership-verifier.js'
export class MembershipAuthError extends Error{constructor(public status:number,message:string){super(message)}}
type Challenge={verifier:MembershipVerifier;address:string;origin:string;message:string;expiresAt:number;used:boolean;revoked:boolean}
type Session={verifier:MembershipVerifier;address:string;origin:string;expiresAt:number;streams:Set<ServerResponse>}
const MINUTE=60000,SESSION_MS=8*60*MINUTE
const digest=(token:string)=>createHash('sha256').update(token).digest('hex')
export class MembershipAuth{
 private challenges=new Map<string,Challenge>()
 private sessions=new Map<string,Session>()
 private checked=new Map<string,{at:number;member:boolean}>()
 private checking=new Map<string,Promise<boolean>>()
 private limits=new Map<string,{at:number;count:number}>()
 private origins:Set<string>
 private verifiers:MembershipVerifier[]
 private cookieName:string
 private challengeCookie:string
 constructor(private verifier:MembershipVerifier,private env:NodeJS.ProcessEnv=process.env,private now=Date.now,alternatives:MembershipVerifier[]=[]){
  this.verifiers=[verifier,...alternatives]
  const production=env.NODE_ENV==='production'
  this.cookieName=production?'__Host-blocksonar-session':'blocksonar-session'
  this.challengeCookie=production?'__Host-blocksonar-challenge':'blocksonar-challenge'
  const defaults=production?[]:['http://localhost:5173','http://127.0.0.1:5173','http://localhost:5174','http://127.0.0.1:5174','http://localhost:3000','http://127.0.0.1:3000','http://localhost:4001','http://127.0.0.1:4001']
  this.origins=new Set((env.MEMBERSHIP_APP_ORIGINS?.split(',')??defaults).map(origin=>origin.trim()).filter(origin=>{try{const url=new URL(origin);return url.origin===origin&&(production?url.protocol==='https:':['http:','https:'].includes(url.protocol))}catch{return false}}))
 }
 private cookie(req:IncomingMessage,name:string){const values=(req.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(`${name}=`));return values.length===1?values[0].slice(name.length+1):''}
 private setCookie(res:ServerResponse,name:string,value:string,seconds:number){
  const old=res.getHeader('Set-Cookie'),cookies=old?Array.isArray(old)?old:[String(old)]:[]
  res.setHeader('Set-Cookie',[...cookies,`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.env.NODE_ENV==='production'?'; Secure':''}`])
 }
 origin(req:IncomingMessage){const origin=req.headers.origin;if(!origin||!this.origins.has(origin))throw new MembershipAuthError(403,'Sign in from the configured BlockSonar website');return origin}
 private configured(verifier?:MembershipVerifier){if((verifier?!verifier.configured:!this.verifiers.some(item=>item.configured))||!this.origins.size)throw new MembershipAuthError(503,'Server membership verification is not configured')}
 private sweep(){const now=this.now();for(const[key,value]of this.challenges)if(value.expiresAt<=now){value.revoked=true;this.challenges.delete(key)}for(const[key,value]of this.sessions)if(value.expiresAt<=now)this.revoke(key);for(const[key,value]of this.checked)if(now-value.at>5000)this.checked.delete(key);for(const[key,value]of this.limits)if(now-value.at>MINUTE)this.limits.delete(key)}
 private rate(req:IncomingMessage){const key=req.socket.remoteAddress??'unknown',now=this.now();const value=this.limits.get(key)??{at:now,count:0};value.count++;this.limits.set(key,value);if(value.count>40||this.limits.size>10000)throw new MembershipAuthError(429,'Too many sign-in attempts; retry in a minute')}
 private async body(req:IncomingMessage):Promise<Record<string,unknown>>{
  if(!(req.headers['content-type']??'').startsWith('application/json'))throw new MembershipAuthError(415,'Send JSON')
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw new MembershipAuthError(413,'Sign-in request too large')}
  try{const value=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}catch{throw new MembershipAuthError(400,'Invalid JSON request')}
 }
 private async member(address:string,fresh=false,verifier=this.verifier){
  const identity=`${verifier.network??'ethereum'}:${verifier.chainId}:${verifier.contractAddress}:${address}`
  const cached=this.checked.get(identity);if(!fresh&&cached&&this.now()-cached.at<5000)return cached.member
  let task=this.checking.get(identity)
  if(!task){task=verifier.hasAccess(address).then(member=>{if(this.checked.size>=5000)this.checked.delete(this.checked.keys().next().value!);this.checked.set(identity,{at:this.now(),member});return member}).finally(()=>this.checking.delete(identity));this.checking.set(identity,task)}
  try{return await task}catch{throw new MembershipAuthError(503,'Membership network unavailable; access could not be verified')}
 }
 private revoke(key:string){const session=this.sessions.get(key);if(!session)return;this.sessions.delete(key);for(const stream of session.streams)stream.end();session.streams.clear()}
 private revokeAddress(address:string,verifier:MembershipVerifier){for(const[key,value]of this.sessions)if(value.address===address&&value.verifier===verifier)this.revoke(key)}
 private async session(req:IncomingMessage){
  this.configured();this.sweep();const token=this.cookie(req,this.cookieName),key=digest(token),session=token?this.sessions.get(key):undefined
  if(!session||session.expiresAt<=this.now())throw new MembershipAuthError(401,'Sign in with a membership wallet')
  if(req.headers.origin&&req.headers.origin!==session.origin)throw new MembershipAuthError(403,'Session origin mismatch')
  this.configured(session.verifier)
  if(!await this.member(session.address,false,session.verifier)){this.revokeAddress(session.address,session.verifier);throw new MembershipAuthError(403,'This wallet no longer holds a membership NFT')}
  if(!this.sessions.has(key))throw new MembershipAuthError(401,'Session has ended')
  return {key,session}
 }
 private details(session:Session){return {authenticated:true,address:session.address,network:session.verifier.network??'ethereum',chainId:session.verifier.chainId,contractAddress:session.verifier.contractAddress,cluster:session.verifier.cluster,expiresAt:session.expiresAt}}
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){
  if(!url.pathname.startsWith('/api/auth/'))return false
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie, Origin')
  try{
   this.sweep()
   if(url.pathname==='/api/auth/networks'&&req.method==='GET'){res.end(JSON.stringify({networks:this.verifiers.map(verifier=>{const id=verifier.network??'ethereum';return {id,...MEMBERSHIP_NETWORK_LABELS[id],walletKind:id==='solana'?'solana':'evm',chainId:verifier.chainId,contractAddress:verifier.contractAddress,configured:verifier.configured,cluster:verifier.cluster}})}));return true}
   if(url.pathname==='/api/auth/session'&&req.method==='GET'){const{session}=await this.session(req);res.end(JSON.stringify(this.details(session)));return true}
   if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end(JSON.stringify({error:'Method not allowed'}));return true}
   const origin=this.origin(req)
   if(url.pathname==='/api/auth/logout'){
    const challenge=this.cookie(req,this.challengeCookie),pending=this.challenges.get(challenge);if(pending)pending.revoked=true;this.challenges.delete(challenge)
    this.revoke(digest(this.cookie(req,this.cookieName)));this.setCookie(res,this.cookieName,'',0);this.setCookie(res,this.challengeCookie,'',0);res.end(JSON.stringify({authenticated:false}));return true
   }
   this.rate(req);this.configured();const body=await this.body(req)
   if(url.pathname==='/api/auth/challenge'){
    const verifier=this.verifiers.find(item=>(item.network??'ethereum')===(body.network??'ethereum'))
    if(!verifier)throw new MembershipAuthError(400,'Unsupported membership network')
    this.configured(verifier)
    if(typeof body.address!=='string'||!(verifier.network==='solana'?validAddress('solana',body.address):isAddress(body.address))||body.chainId!==verifier.chainId)throw new MembershipAuthError(400,'Wallet address or membership network does not match')
    if(this.challenges.size>=5000)throw new MembershipAuthError(503,'Sign-in is busy; retry shortly')
    const prior=this.cookie(req,this.challengeCookie),old=this.challenges.get(prior);if(old)old.revoked=true;this.challenges.delete(prior)
    const id=randomBytes(32).toString('hex'),address=verifier.network==='solana'?body.address:getAddress(body.address),issued=this.now(),expiresAt=issued+5*MINUTE
    const message=`${new URL(origin).host} wants you to sign in with your ${verifier.network==='solana'?'Solana':'Ethereum'} account:\n${address}\n\nSign in to BlockSonar with your membership NFT. This signature does not authorize a payment or transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${verifier.chainId}\nNonce: ${id}\nIssued At: ${new Date(issued).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}\nResources:\n- urn:blocksonar:membership:${verifier.chainId}:${verifier.contractAddress}`
    this.challenges.set(id,{verifier,address,origin,message,expiresAt,used:false,revoked:false});this.setCookie(res,this.challengeCookie,id,300);res.end(JSON.stringify({message,chainId:verifier.chainId,contractAddress:verifier.contractAddress,network:verifier.network??'ethereum',expiresAt}));return true
   }
   if(url.pathname==='/api/auth/verify'){
    const id=this.cookie(req,this.challengeCookie),challenge=this.challenges.get(id)
    if(!challenge||challenge.used||challenge.revoked||challenge.expiresAt<=this.now()||challenge.origin!==origin)throw new MembershipAuthError(401,'Sign-in challenge expired or already used; try again')
    challenge.used=true
    try{
     if(typeof body.signature!=='string'||!/^0x[0-9a-f]+$/i.test(body.signature)||body.signature.length>4098||body.signature.length%2!==0)throw new MembershipAuthError(400,'Invalid wallet signature')
     let valid=false;try{valid=await challenge.verifier.validSignature(challenge.address,challenge.message,body.signature)}catch{throw new MembershipAuthError(503,'Membership network unavailable; signature could not be verified')}
     if(!valid)throw new MembershipAuthError(401,'Wallet signature does not match the sign-in request')
     if(!await this.member(challenge.address,true,challenge.verifier))throw new MembershipAuthError(403,'This wallet does not hold a membership NFT')
     if(challenge.revoked||challenge.expiresAt<=this.now())throw new MembershipAuthError(401,'Sign-in was cancelled or expired')
     if(this.sessions.size>=5000)throw new MembershipAuthError(503,'Sign-in is busy; retry shortly')
     this.revoke(digest(this.cookie(req,this.cookieName)))
     const token=randomBytes(32).toString('hex'),session:Session={verifier:challenge.verifier,address:challenge.address,origin,expiresAt:this.now()+SESSION_MS,streams:new Set()}
     this.sessions.set(digest(token),session);this.setCookie(res,this.cookieName,token,SESSION_MS/1000);this.setCookie(res,this.challengeCookie,'',0);res.end(JSON.stringify(this.details(session)));return true
    }finally{this.challenges.delete(id)}
   }
   throw new MembershipAuthError(404,'Unknown authentication endpoint')
  }catch(error){this.reject(res,error);return true}
 }
 async checkoutRequest(req:IncomingMessage){this.sweep();const origin=this.origin(req);this.rate(req);return {origin,body:await this.body(req)}}
 async authorize(req:IncomingMessage,res:ServerResponse,url:URL){
  const{key,session}=await this.session(req)
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie, Origin')
  if(url.pathname==='/stream'||url.pathname.endsWith('/stream')){
   if(session.streams.size>=10)throw new MembershipAuthError(429,'Too many live streams for this session')
   session.streams.add(res)
   const timer=setInterval(()=>{void this.session(req).catch(()=>{this.revoke(key)})},10000);timer.unref()
   res.on('close',()=>{clearInterval(timer);session.streams.delete(res)})
  }
  return this.details(session)
 }
 reject(res:ServerResponse,error:unknown){if(res.headersSent){res.end();return}res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.writeHead(error instanceof MembershipAuthError?error.status:503);res.end(JSON.stringify({error:error instanceof MembershipAuthError?error.message:'Membership verification unavailable'}))}
 stop(){for(const key of this.sessions.keys())this.revoke(key);this.challenges.clear();for(const verifier of this.verifiers)verifier.close?.()}
}
