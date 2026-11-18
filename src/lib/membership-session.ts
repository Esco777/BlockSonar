import type {BrowserProvider} from 'ethers'
import type {MembershipNetwork} from './membership-networks.js'
import {solanaWallet} from './membership-client.js'
let sessionGeneration=0
let pendingLogout:Promise<void>=Promise.resolve()
export function endMembershipSession(){
 sessionGeneration++
 pendingLogout=pendingLogout.catch(()=>undefined).then(async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:'{}'})}catch{/* Local logout still removes the dashboard. */}})
 return pendingLogout
}
export type MembershipSession={authenticated:true;network:MembershipNetwork;address:string;chainId:number;contractAddress:string;expiresAt:number}
export async function membershipSession(signal?:AbortSignal):Promise<MembershipSession>{
 const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal})
 const data=await response.json()
 if(!response.ok)throw new Error(data.error||'Sign in with a membership wallet')
 return data
}
export async function authenticateMembership(provider:BrowserProvider,address:string,network:MembershipNetwork='ethereum'):Promise<MembershipSession>{
 await pendingLogout
 const generation=sessionGeneration
 const chainId=Number((await provider.getNetwork()).chainId)
 const post=async(path:string,body:unknown)=>{
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'Membership sign-in failed')
  return data
 }
 const challenge=await post('/api/auth/challenge',{address,chainId,network})
 if(generation!==sessionGeneration)throw new Error('Sign-in was cancelled')
 const signature=await(await provider.getSigner(address)).signMessage(challenge.message)
 if(generation!==sessionGeneration)throw new Error('Sign-in was cancelled')
 return post('/api/auth/verify',{signature})
}

export async function authenticateSolanaMembership(address:string,chainId:number):Promise<MembershipSession>{
 await pendingLogout
 const generation=sessionGeneration
 const post=async(path:string,body:unknown)=>{const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Membership sign-in failed');return data}
 const provider=solanaWallet();if(!provider||provider.publicKey?.toString()!==address)throw new Error('Reconnect your Solana wallet')
 const challenge=await post('/api/auth/challenge',{address,chainId,network:'solana'})
 if(generation!==sessionGeneration)throw new Error('Sign-in was cancelled')
 const signed=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8')
 if(generation!==sessionGeneration||provider.publicKey?.toString()!==address)throw new Error('Sign-in was cancelled')
 const signature='0x'+Array.from(signed.signature,byte=>byte.toString(16).padStart(2,'0')).join('')
 return post('/api/auth/verify',{signature})
}
