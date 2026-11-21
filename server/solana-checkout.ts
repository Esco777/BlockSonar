import type {IncomingMessage,ServerResponse} from 'node:http'
import {MembershipAuth,MembershipAuthError} from './membership-auth.js'
import { ProviderCache } from './provider-cache.js'
import { SOLANA_MAINNET_GENESIS, validSolanaKey } from './solana-dex.js'
import { solanaDexRpcUrl } from './solana-dex-worker.js'
import type {SolanaMembership} from './solana-membership.js'

// Only these fixed purchase operations are public. This is never an RPC proxy.
export class SolanaCheckout {
 private balanceCache = new ProviderCache()
 constructor(private solana:SolanaMembership,private auth:MembershipAuth,private env = process.env){}
 private async mainnetBalance(address: string) {
  if (!validSolanaKey(address)) throw new MembershipAuthError(400, 'Invalid Solana address')
  const url = solanaDexRpcUrl(this.env) ||
    ((!this.env.MEMBERSHIP_SOLANA_CLUSTER || this.env.MEMBERSHIP_SOLANA_CLUSTER === 'mainnet-beta') ? this.env.MEMBERSHIP_SOLANA_RPC_URL : '')
  if (!url) throw new MembershipAuthError(503, 'Solana mainnet RPC unavailable')
  const rpc = async <T>(endpoint: string, method: string, params: unknown[], ttl: number) => {
   const data = await this.balanceCache.get<{ result?: T; error?: unknown }>(endpoint, 'solana-header-balance', 120, ttl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
   })
   if (data.error || data.result == null) throw new Error('Solana RPC unavailable')
   return data.result
  }
  const read = async (endpoint: string) => {
   if (await rpc<string>(endpoint, 'getGenesisHash', [], 600000) !== SOLANA_MAINNET_GENESIS) throw new Error('Solana mainnet required')
   const { value } = await rpc<{ value: number }>(endpoint, 'getBalance', [address, { commitment: 'finalized' }], 15000)
   if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Solana balance')
   return { lamports: value }
  }
  try { return await read(url) }
  catch (error) {
   const fallback = this.env.DEX_SOLANA_FALLBACK_RPC_URL?.trim()
   if (!fallback || fallback === url) throw error
   return read(fallback)
  }
 }
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){
  if(!url.pathname.startsWith('/api/membership/solana/'))return false
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
  try{
   if(req.method!=='POST')throw new MembershipAuthError(405,'Use POST for membership checkout')
   const{origin,body}=await this.auth.checkoutRequest(req)
   if(url.pathname==='/api/membership/solana/mainnet-balance'){
    res.end(JSON.stringify(await this.mainnetBalance(String(body.address??''))))
    return true
   }
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
