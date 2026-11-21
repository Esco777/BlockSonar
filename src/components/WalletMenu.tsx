import { useEffect,useRef,useState } from 'react'
import { ChevronDown,Eye,EyeOff,LogOut,Wallet } from 'lucide-react'
import './WalletMenu.css'
type Props={busy:boolean;balanceVisible:boolean;onToggleBalance:()=>void;wallet:{account:string;network:string;balance:string;currency?:string}|null;onConnect:()=>void;onSignOut:()=>void}
export default function WalletMenu({busy,wallet,balanceVisible,onToggleBalance,onConnect,onSignOut}:Props){
  const [open,setOpen]=useState(false)
  const container=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null)
  useEffect(()=>setOpen(false),[wallet?.account])
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)}
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus()}
      if((event.key==='ArrowDown'||event.key==='ArrowUp')&&container.current?.contains(event.target as Node)){
        event.preventDefault()
        const items=Array.from(container.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        const index=items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()
      }
    }
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard)
    const frame=window.requestAnimationFrame(()=>container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);window.cancelAnimationFrame(frame)}
  },[open])
  return <div className="wallet-menu" ref={container} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
    <button ref={trigger} type="button" className={`wallet-button${wallet?' wallet-connected':''}`} disabled={busy && !wallet} aria-label={wallet?'Wallet account menu':'Connect wallet'} aria-expanded={wallet?open:undefined} aria-haspopup={wallet?'menu':undefined} aria-controls={wallet?'wallet-account-menu':undefined} onClick={()=>wallet?setOpen(value=>!value):onConnect()}>
      {wallet?<><span className="wallet-status-dot"/>{wallet.account.slice(0,6)}…{wallet.account.slice(-4)}<ChevronDown size={14} className={open?'wallet-menu-caret-open':''}/></>:<><Wallet size={15}/>Connect wallet</>}
    </button>
    {wallet&&open&&<div className="wallet-menu-dropdown" id="wallet-account-menu" role="menu" aria-label="Wallet account">
      <div className="wallet-menu-account" role="presentation"><span>CONNECTED WALLET</span><strong>{wallet.account}</strong><small>{wallet.network} · {balanceVisible?wallet.balance:'••••'} {wallet.currency}</small></div>
      <button type="button" className="wallet-menu-balance-toggle" role="menuitem" onClick={onToggleBalance}>{balanceVisible?<EyeOff size={16}/>:<Eye size={16}/>}<span>{balanceVisible?'Hide balance':'Show balance'}</span></button>
      <button type="button" className="wallet-menu-sign-out" role="menuitem" onClick={()=>{setOpen(false);onSignOut()}}><LogOut size={16}/><span>Sign out</span></button>
    </div>}
  </div>
}
