import type {MembershipNetworkInfo} from './membership-networks.js'
export async function membershipNetworks():Promise<MembershipNetworkInfo[]>{
 const response=await fetch('/api/auth/networks',{cache:'no-store',signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new Error('Membership configuration is unavailable')
 const data=await response.json()
 if(!Array.isArray(data.networks))throw new Error('Invalid membership configuration')
 return data.networks
}
export async function solanaCheckout<T=Record<string,unknown>>(action:string,body:unknown={},signal?:AbortSignal):Promise<T>{
 const response=await fetch(`/api/membership/solana/${action}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)})
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Solana checkout unavailable');return data
}
export type SolanaWallet={publicKey?:{toString():string};isConnected?:boolean;connect():Promise<{publicKey:{toString():string}}>;signMessage(message:Uint8Array,encoding?:string):Promise<{signature:Uint8Array}>;signTransaction(transaction:import('@solana/web3.js').VersionedTransaction):Promise<import('@solana/web3.js').VersionedTransaction>;on?:(event:string,callback:()=>void)=>void;removeListener?:(event:string,callback:()=>void)=>void}
export const solanaWallet=()=>{const wallet=window as Window & {phantom?:{solana?:SolanaWallet};solana?:SolanaWallet};return wallet.phantom?.solana??wallet.solana}
