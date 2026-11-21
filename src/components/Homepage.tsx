import {authenticateMembership,authenticateSolanaMembership} from '../lib/membership-session'
import {useEffect,useRef,useState} from 'react'
import {BrowserProvider,Contract,formatEther,type Eip1193Provider} from 'ethers'
import {ArrowRight,Check,CheckCircle2,ChevronRight,Layers3,LoaderCircle,Radar,ShieldCheck,Wallet} from 'lucide-react'
import JoinCoinRain from './JoinCoinRain'
import NetworkSelector from './NetworkSelector'
import {useWallet} from './WalletProvider'
import {MEMBERSHIP_ABI} from '../lib/membership-config'
import {solanaCheckout,solanaWallet} from '../lib/membership-client'
import {walletErrorText as errorText} from '../lib/wallet-errors'
const short=(address:string)=>`${address.slice(0,6)}…${address.slice(-4)}`
const ethereum=()=>(window as Window & {ethereum?:Eip1193Provider}).ethereum
export default function Homepage({onEnter,sessionVerified}:{onEnter:()=>void;sessionVerified:boolean}){
 useEffect(()=>{const title=document.title;document.title='BlockSonar | Homepage';return()=>{document.title=title}},[])
 const{wallet,checkoutAccount,refreshWallet,connectWallet,connectMembershipWallet,walletBusy,logoutVersion,networks,activeNetwork,selectNetwork}=useWallet()
 const config=networks.find(item=>item.id===activeNetwork)
 const currency=activeNetwork==='solana'?'SOL':activeNetwork==='bnb'?'BNB':'ETH'
 const networkName=activeNetwork==='solana'?`Solana ${config?.cluster||''}`:config?.chainId===31337?'Local Ethereum test network':config?.chainId===11155111?'Ethereum Sepolia testnet':config?.chainId===97?'BNB testnet':config?.name||'Network unavailable'
 const[account,setAccount]=useState(''),[member,setMember]=useState(false),[saleOpen,setSaleOpen]=useState(false)
 const[quote,setQuote]=useState<bigint|null>(null),[busy,setBusy]=useState<'connecting'|'checking'|'minting'|null>(null)
 const[error,setError]=useState(''),[txHash,setTxHash]=useState('')
 const generation=useRef(0),connectingRef=useRef(false)
 useEffect(()=>{
  if(connectingRef.current&&checkoutAccount)return
  generation.current++;setAccount(checkoutAccount||'');setMember(false);setSaleOpen(false);setQuote(null);setError('');setTxHash('')
  if(!checkoutAccount||!config?.configured){if(!connectingRef.current)setBusy(null);return}
  if(connectingRef.current)return
  const request=++generation.current;setBusy('checking')
  void readMembership(checkoutAccount,request).catch(err=>{if(request===generation.current)setError(errorText(err))}).finally(()=>{if(request===generation.current)setBusy(null)})
  return()=>{generation.current++}
 },[checkoutAccount,logoutVersion,activeNetwork,config?.configured])
 async function readMembership(address:string,request:number){
  if(!config?.configured)throw new Error('Membership is not deployed on this network yet.')
  let hasAccess=false,open=false,required:bigint|null=null
  if(activeNetwork==='solana'){
   hasAccess=(await solanaCheckout<{member:boolean}>('access',{address})).member
   if(!hasAccess){const sale=await solanaCheckout<{mintingOpen:boolean;lamports:string;totalMinted:string;maxSupply:string}>('quote');open=sale.mintingOpen&&BigInt(sale.totalMinted)<BigInt(sale.maxSupply);required=open?BigInt(sale.lamports):null}
  }else{
   const injected=ethereum();if(!injected)throw new Error('Connect your browser wallet')
   const provider=new BrowserProvider(injected)
   if((await provider.getNetwork()).chainId!==BigInt(config.chainId))throw new Error(`Switch your wallet to ${config.name} and reconnect.`)
   if(await provider.getCode(config.contractAddress)==='0x')throw new Error('Membership contract not found on the configured network.')
   const contract=new Contract(config.contractAddress,MEMBERSHIP_ABI,provider)
   if(await contract.PRICE_USD()!==200n)throw new Error('The configured contract does not match the $200 membership.')
   hasAccess=await contract.hasAccess(address) as boolean
   if(!hasAccess){
    // Legacy deployments forward funds. Existing memberships work, but new purchases require the treasury revision.
    try{await contract.deployer()}catch{throw new Error('New purchases require the retained-funds membership deployment. Existing members can still sign in.')}
    open=await contract.mintingOpen() as boolean;required=open?await contract.mintPrice() as bigint:null
   }
  }
  if(request===generation.current){setMember(hasAccess);setSaleOpen(open);setQuote(required)}
  return {hasAccess,required}
 }
 async function authenticate(address:string){
  if(!config?.configured)throw new Error('Membership unavailable')
  if(activeNetwork==='solana')await authenticateSolanaMembership(address,config.chainId)
  else{const provider=ethereum();if(!provider)throw new Error('Reconnect your wallet');await authenticateMembership(new BrowserProvider(provider),address,activeNetwork)}
 }
 async function connect(signingIn=false){
  const request=++generation.current;connectingRef.current=true;setBusy('connecting');setError('');setQuote(null);setMember(false);setTxHash('')
  try{
   const address=await connectMembershipWallet()
   // Connecting changes the shared account. Let its effect settle before reading membership.
   if(request!==generation.current)return
   const current=request;setAccount(address)
   if(config?.configured){const result=await readMembership(address,current);if(signingIn&&current===generation.current){if(result.hasAccess){await authenticate(address);if(current===generation.current)onEnter()}else setError('No membership NFT found in this wallet. Mint below to join BlockSonar.')}}
  }catch(err){if(request===generation.current)setError(errorText(err))}
  finally{connectingRef.current=false;setBusy(null)}
 }
 async function signIn(){if(busy||walletBusy)return;if(sessionVerified){onEnter();return}if(!config?.configured){setError('Membership sign-in is not configured on this network yet.');return}if(account&&account===checkoutAccount)await enter();else await connect(true)}
 async function enter(){
  if(!account||account!==checkoutAccount||!config?.configured||busy||walletBusy)return
  const request=++generation.current;setBusy('checking');setError('')
  try{await authenticate(account);if(request===generation.current)onEnter()}catch(err){if(request===generation.current)setError(errorText(err))}finally{if(request===generation.current)setBusy(null)}
 }
 async function mint(){
  if(!account||account!==checkoutAccount||!config?.configured||busy||walletBusy)return
  const request=++generation.current;setBusy('minting');setError('');setTxHash('')
  try{
   const{hasAccess,required}=await readMembership(account,request)
   if(request!==generation.current||hasAccess)return
   if(!required)throw new Error('Minting is closed, or a fresh oracle quote is unavailable.')
   const cap=required+(required+99n)/100n
   if(activeNetwork==='solana'){
    const provider=solanaWallet();if(!provider||provider.publicKey?.toString()!==account)throw new Error('Reconnect your Solana wallet')
    const prepared=await solanaCheckout<{intentId:string;transaction:string}>('prepare',{address:account,maxLamports:cap.toString()})
    const{VersionedTransaction}=await import('@solana/web3.js')
    const transaction=VersionedTransaction.deserialize(Uint8Array.from(atob(prepared.transaction),char=>char.charCodeAt(0)))
    const signed=await provider.signTransaction(transaction)
    if(request!==generation.current)return
    const encoded=btoa(Array.from(signed.serialize(),byte=>String.fromCharCode(byte)).join(''))
    const submitted=await solanaCheckout<{signature:string}>('submit',{intentId:prepared.intentId,transaction:encoded});setTxHash(submitted.signature)
    let finalized=false
    for(let attempt=0;attempt<36;attempt++){
     await new Promise(resolve=>window.setTimeout(resolve,3000));if(request!==generation.current)return
     const status=await solanaCheckout<{finalized:boolean;expired:boolean}>('status',{intentId:prepared.intentId})
     if(status.finalized){finalized=true;break}if(status.expired)break
    }
    if(!finalized)throw new Error('Transaction submitted. Check its status before retrying; sign in once finalized.')
   }else{
    const injected=ethereum();if(!injected)throw new Error('Reconnect your wallet')
    const provider=new BrowserProvider(injected)
    const signer=await provider.getSigner()
    if(Number(await injected.request({method:'eth_chainId'}))!==config.chainId)throw new Error(`Switch your wallet to ${config.name} before minting.`)
    if((await signer.getAddress()).toLowerCase()!==account.toLowerCase())throw new Error('Wallet account changed. Reconnect before minting.')
    const transaction=await new Contract(config.contractAddress,MEMBERSHIP_ABI,signer).mint({value:cap});setTxHash(transaction.hash);await transaction.wait()
   }
   if(request!==generation.current)return
   await refreshWallet();await authenticate(account);if(request===generation.current)onEnter()
  }catch(err){if(request===generation.current)setError(errorText(err))}finally{if(request===generation.current)setBusy(null)}
 }
  const features = ['Sonar quantitative research', 'Multi-exchange liquidity heatmap', 'Sonar Walls & liquidation blocks', 'New-market discovery & watchlists']
  return <main className="join-page">
    <JoinCoinRain />
    <div className="join-sonar-background" aria-hidden="true"><div className="join-sonar-array"><div className="join-sonar-background-grid" /><div className="join-sonar-background-sweep" /><i className="join-sonar-background-ring ring-a" /><i className="join-sonar-background-ring ring-b" /><i className="join-sonar-background-ring ring-c" /><i className="join-sonar-background-echo echo-a" /><i className="join-sonar-background-echo echo-b" /><span className="join-sonar-background-core" /></div></div>
    <header className="join-header"><a href="#/home" aria-label="BlockSonar Homepage"><img className="join-brand-dark" src="/block-sonar-logo.svg" alt="BlockSonar" /><img className="join-brand-light" src="/block-sonar-logo-light.svg" alt="BlockSonar" /></a><span><i /> YOUR EDGE STARTS BELOW THE SURFACE</span><div className="join-header-actions"><a className="join-homepage-link" href="#/home">Homepage</a><NetworkSelector disabled={!!busy} /><button type="button" aria-label="Connect wallet" onClick={() => { void connectWallet().catch(() => {}) }} disabled={!!busy || walletBusy}><Wallet size={15} /><span className="join-wallet-label">{wallet ? short(wallet.account) : 'Connect wallet'}</span></button><button type="button" className="join-sign-in" onClick={signIn} disabled={!!busy || walletBusy}>Sign in <ArrowRight size={14} /></button></div></header>
    <div className="join-content">
      <section className="join-story"><div className="join-eyebrow"><Radar size={15} /> THE BLOCKSONAR MEMBERSHIP</div><h1>Go deeper.<br /><span>Stay for life.</span></h1><p>See liquidity, follow market shifts, and build your own research. One membership. A clearer view beneath the surface.</p><div className="join-feature-list">{features.map((feature) => <div key={feature}><Check size={15} /><span>{feature}</span></div>)}</div><div className="join-orbit" aria-hidden="true"><i /><i /><i /><span><Radar size={58} /></span></div><small className="join-story-note">Built for context. Designed for curiosity.</small></section>
      <section className="join-card" aria-label="Join BlockSonar"><div className="join-card-top"><span>LIFETIME ACCESS</span><Layers3 size={19} /></div><img className="join-card-logo" src="/block-sonar-lifetime-logo-transparent.png" alt="BlockSonar Bitcoin radar logo" /><h2>Your pass to BlockSonar.</h2><div className="join-price"><strong>$200</strong><span>USD · one time</span></div><div className="join-network-selector" role="group" aria-label="Purchase network">{(['ethereum','bnb','solana'] as const).map(id=><button key={id} type="button" aria-pressed={activeNetwork===id} disabled={!!busy || walletBusy} onClick={()=>selectNetwork(id)}>{id==='ethereum'?'Ethereum':id==='bnb'?'BNB Chain':'Solana'}</button>)}</div><p className="join-payment">Paid in {currency} at the current {currency}/USD oracle price.<br />Network gas is additional.</p><div className="join-card-divider" /><div className="join-benefits"><span><ShieldCheck size={15} /> Membership recorded onchain</span><span><Check size={15} /> No expiry or recurring subscription</span><span><Check size={15} /> Access follows the NFT holder</span></div>
        {!config?.configured ? <div className="join-status" role="status">Membership minting is not configured yet. Wallet connection is available; purchases remain disabled.</div> : <div className="join-network">{networkName}{config && ![1,56,101].includes(config.chainId) && <strong>TEST NETWORK</strong>}</div>}
        {account && config?.configured && !busy && member && <div className="join-status join-member" role="status"><CheckCircle2 size={17} /> Lifetime membership verified.</div>}
        {account && config?.configured && !busy && !member && !error && !saleOpen && <div className="join-status" role="status">Public minting is currently closed. Existing members can still enter.</div>}
        {quote !== null && !member && <div className="join-quote"><span>Current mint quote</span><strong>{activeNetwork==='solana'?(Number(quote)/1e9).toFixed(6):formatEther(quote)} {currency}</strong><small>{activeNetwork==='solana'?'The transaction caps price movement at 1%. Only the execution price is charged; NFT account rent and network fees are additional.':`A 1% transaction buffer covers price movement. Unused ${currency} is refunded by the contract.`}</small></div>}
        {error && <p className="join-error" role="alert">{error}</p>}
        {txHash && <p className="join-transaction">{busy === 'minting' ? 'Confirming transaction…' : 'Submitted transaction'}<code>{txHash}</code></p>}
        {!account ? <button type="button" className="join-primary" onClick={() => connect()} disabled={!!busy || walletBusy}>{busy ? <LoaderCircle className="spinning" size={17} /> : <Wallet size={17} />}Connect wallet to join <ArrowRight size={16} /></button> : member ? <button type="button" className="join-primary" onClick={enter} disabled={!!busy || walletBusy}>Enter the dapp <ArrowRight size={17} /></button> : <button type="button" className="join-primary" onClick={mint} disabled={!!busy || !config?.configured || !saleOpen || quote === null}>{busy ? <LoaderCircle className="spinning" size={17} /> : <Layers3 size={17} />}{busy === 'minting' ? 'Confirm in wallet / wait for receipt' : busy === 'checking' ? 'Checking membership…' : 'Mint lifetime membership'}</button>}
        <button type="button" className="join-secondary" onClick={signIn} disabled={!!busy || walletBusy}>Already a member? Sign in <ChevronRight size={13} /></button>
        <p className="join-card-note">Ethereum and BNB memberships can be transferred. Sales settled through the membership contract pay 90% to the seller and 10% to the current contract owner. Ordinary transfers and sales elsewhere do not automatically collect this commission. Membership access follows the NFT holder.</p><p className="join-card-note">Connecting your wallet is free. Sign-in asks for a message signature to verify membership; only minting requires a payment.</p>
      </section>
    </div>
    <footer className="join-footer"><span>© {new Date().getFullYear()} BlockSonar · Discover what’s moving beneath the surface.</span></footer>
  </main>
}
