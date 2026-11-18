import {endMembershipSession} from '../lib/membership-session'
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {BrowserProvider,formatEther,type Eip1193Provider} from 'ethers'
import {membershipNetworks,solanaCheckout,solanaWallet} from '../lib/membership-client'
import type {MembershipNetwork,MembershipNetworkInfo} from '../lib/membership-networks'

type Injected=Eip1193Provider & {on?:(event:string,listener:()=>void)=>void;removeListener?:(event:string,listener:()=>void)=>void}
export type WalletState={account:string;network:string;networkId:MembershipNetwork;chainId:number;balance:string;currency:string}
const injected=()=>(window as Window & {ethereum?:Injected}).ethereum
const WalletContext=createContext<{wallet:WalletState|null;activeNetwork:MembershipNetwork;networks:MembershipNetworkInfo[];selectNetwork:(network:MembershipNetwork)=>void;connectWallet:()=>Promise<WalletState>;refreshWallet:()=>Promise<void>;signOut:()=>void;logoutVersion:number}|null>(null)
export function WalletProvider({children}:{children:ReactNode}){
 const[wallet,setWallet]=useState<WalletState|null>(null)
 const[activeNetwork,setActiveNetwork]=useState<MembershipNetwork>(()=>{try{const saved=sessionStorage.getItem('blocksonar-membership-network');return saved==='bnb'||saved==='solana'?saved:'ethereum'}catch{return 'ethereum'}})
 const[networks,setNetworks]=useState<MembershipNetworkInfo[]>([])
 const generation=useRef(0),logoutCounter=useRef(0),connecting=useRef(false)
 const[logoutVersion,setLogoutVersion]=useState(0)
 const signedOut=useRef((()=>{try{return sessionStorage.getItem('blocksonar-signed-out')==='true'}catch{return false}})())
 function signOut(broadcast=true){if(broadcast){try{localStorage.setItem('blocksonar-signout',`${Date.now()}:${Math.random()}`)}catch{/* Session polling remains the fallback across tabs. */}}void endMembershipSession();logoutCounter.current++;setLogoutVersion(logoutCounter.current);generation.current++;signedOut.current=true;setWallet(null);try{sessionStorage.setItem('blocksonar-signed-out','true')}catch{/* In-memory logout remains active. */}}
 function selectNetwork(network:MembershipNetwork){if(network===activeNetwork)return;signOut();setActiveNetwork(network);try{sessionStorage.setItem('blocksonar-membership-network',network)}catch{/* Keep selection in memory. */}}
 async function readWallet():Promise<WalletState|null>{
  const config=(await membershipNetworks()).find(item=>item.id===activeNetwork)
  if(!config)throw new Error('Membership network unavailable')
  if(activeNetwork==='solana'){
   const provider=solanaWallet(),account=provider?.publicKey?.toString();if(!account)return null
   let balance='—';if(config.configured){try{const result=await solanaCheckout<{lamports:string}>('balance',{address:account});balance=(Number(result.lamports)/1e9).toFixed(4)}catch{/* Balance unavailable; do not invent a value. */}}
   return {account,network:config.cluster==='mainnet-beta'?'Solana':`Solana ${config.cluster||''}`,networkId:activeNetwork,chainId:config.chainId,balance,currency:'SOL'}
  }
  const ethereum=injected();if(!ethereum)return null
  const provider=new BrowserProvider(ethereum),accounts=await provider.send('eth_accounts',[]) as string[]
  if(!accounts[0])return null
  const network=await provider.getNetwork();if(Number(network.chainId)!==config.chainId)return null
  return {account:accounts[0],network:config.name,networkId:activeNetwork,chainId:config.chainId,balance:Number(formatEther(await provider.getBalance(accounts[0]))).toFixed(4),currency:config.currency}
 }
 async function refreshWallet(){if(signedOut.current)return;const request=++generation.current;try{const state=await readWallet();if(request===generation.current)setWallet(state)}catch{if(request===generation.current)setWallet(null)}}
 async function connectWallet(){
  const logoutAtStart=logoutCounter.current;connecting.current=true
  try{
   const config=(await membershipNetworks()).find(item=>item.id===activeNetwork);if(!config)throw new Error('Membership network unavailable')
   if(activeNetwork==='solana'){const provider=solanaWallet();if(!provider)throw new Error('Install a Solana wallet such as Phantom to connect.');await provider.connect()}
   else{const ethereum=injected();if(!ethereum)throw new Error('Install an Ethereum / BNB wallet such as MetaMask to connect.');const chain=await ethereum.request({method:'eth_chainId'});if(Number(chain)!==config.chainId)await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${config.chainId.toString(16)}`} ]});await ethereum.request({method:'eth_requestAccounts'})}
   if(logoutAtStart!==logoutCounter.current)throw new Error('Wallet connection cancelled after sign out.')
   const state=await readWallet();if(!state)throw new Error('Select an account on the chosen network and reconnect.')
   if(logoutAtStart!==logoutCounter.current)throw new Error('Wallet connection cancelled after sign out.')
   signedOut.current=false;try{sessionStorage.removeItem('blocksonar-signed-out')}catch{/* Keep in-memory state. */}setWallet(state);return state
  }finally{connecting.current=false}
 }
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key==='blocksonar-signout'&&event.newValue)signOut(false)};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed)},[])
 useEffect(()=>{let cancelled=false;void membershipNetworks().then(items=>{if(!cancelled)setNetworks(items)}).catch(()=>{});return()=>{cancelled=true}},[])
 useEffect(()=>{
  const provider=activeNetwork==='solana'?solanaWallet():injected()
  const changed=()=>{if(!connecting.current)signOut()},refresh=()=>{void refreshWallet()}
  refresh();for(const event of ['accountsChanged','accountChanged','chainChanged','disconnect'])provider?.on?.(event,changed)
  window.addEventListener('focus',refresh)
  return()=>{generation.current++;for(const event of ['accountsChanged','accountChanged','chainChanged','disconnect'])provider?.removeListener?.(event,changed);window.removeEventListener('focus',refresh)}
 },[activeNetwork])
 return <WalletContext.Provider value={{wallet,activeNetwork,networks,selectNetwork,connectWallet,refreshWallet,signOut,logoutVersion}}>{children}</WalletContext.Provider>
}
export function useWallet(){const context=useContext(WalletContext);if(!context)throw new Error('useWallet requires WalletProvider');return context}
