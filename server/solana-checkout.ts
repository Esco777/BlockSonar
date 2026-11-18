import type {IncomingMessage,ServerResponse} from 'node:http'
import {MembershipAuth,MembershipAuthError} from './membership-auth.js'
import type {SolanaMembership} from './solana-membership.js'

// Only these fixed purchase operations are public. This is never an RPC proxy.
export class SolanaCheckout {
 constructor(private solana:SolanaMembership,private auth:MembershipAuth){}
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){
  if(!url.pathname.startsWith('/api/membership/solana/'))return false
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
  try{
   if(req.method!=='POST')throw new MembershipAuthError(405,'Use POST for membership checkout')
   const{origin,body}=await this.auth.checkoutRequest(req)
   if(!this.solana.configured)throw new MembershipAuthError(503,'Solana membership is not deployed or configured yet')
   let result:unknown
   switch(url.pathname){
    case '/api/membership/solana/access':result={member:await this.solana.hasAccess(String(body.address??''))};break
    case '/api/membership/solana/quote':result=await this.solana.quote();break
    case '/api/membership/solana/balance':result=await this.solana.balance(String(body.address??''));break
    case '/api/membership/solana/prepare':result=await this.solana.prepare(String(body.address??''),String(body.maxLamports??''),origin);break
    case '/api/membership/solana/submit':result=await this.solana.submit(String(body.intentId??''),String(body.transaction??''),origin);break
    case '/api/membership/solana/status':result=await this.solana.status(String(body.intentId??''),origin);break
    default:throw new MembershipAuthError(404,'Unknown checkout endpoint')
   }
   res.end(JSON.stringify(result))
  }catch(error){
   // Provider errors may include a private RPC URL. Return a fixed message.
   this.auth.reject(res,error instanceof MembershipAuthError?error:new MembershipAuthError(503,'Solana checkout unavailable. Check the transaction and fresh oracle price before retrying.'))
  }
  return true
 }
}
