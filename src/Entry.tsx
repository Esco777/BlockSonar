import {membershipSession} from './lib/membership-session'
import { useEffect, useState } from 'react'
import { BrowserProvider, type Eip1193Provider } from 'ethers'
import App from './App'
import Homepage from './components/Homepage'
import { useWallet } from './components/WalletProvider'

export default function Entry() {
  const { signOut, wallet, networks, activeNetwork } = useWallet()
  const [hash, setHash] = useState(window.location.hash)
  const identity = wallet ? `${activeNetwork}:${wallet.chainId}:${activeNetwork === 'solana' ? wallet.account : wallet.account.toLowerCase()}` : ''
  const [verified, setVerified] = useState('')
  const [sessionRefresh, refreshSession] = useState(0)
  useEffect(() => {
    if (!wallet?.account) { setVerified(''); return }
    let cancelled = false, checking = false
    const controller = new AbortController()
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const config=networks.find(item=>item.id===activeNetwork)
        if(!config?.configured)throw new Error('Membership unavailable')
        if(activeNetwork!=='solana'){
          const injected=(window as Window & {ethereum?:Eip1193Provider}).ethereum
          if(!injected||(await new BrowserProvider(injected).getNetwork()).chainId!==BigInt(config.chainId))throw new Error('Wallet network changed')
        }
        const session = await membershipSession(AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]))
        if ((activeNetwork==='solana'?session.address!==wallet.account:session.address.toLowerCase()!==wallet.account.toLowerCase()) || session.network!==activeNetwork || session.chainId !== config.chainId || (activeNetwork==='solana'?session.contractAddress!==config.contractAddress:session.contractAddress.toLowerCase()!==config.contractAddress.toLowerCase()) || session.expiresAt <= Date.now()) throw new Error('Membership session does not match this wallet')
        if (!cancelled) setVerified(identity)
      } catch { if (!cancelled) setVerified('') }
      finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 10000)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer) }
  }, [wallet?.account, wallet?.networkId, activeNetwork, networks, verified, sessionRefresh])
  useEffect(() => {
    if (!window.location.hash) { window.history.replaceState(null, '', '#/home'); setHash('#/home') }
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync) }
  }, [])
  return verified !== identity || !verified || !hash || hash === '#/home' || hash === '#/home/' || hash === '#/join' || hash === '#/join/' ? <Homepage onEnter={() => { refreshSession(n => n + 1); window.location.hash = '/' }} /> : <App key={identity} onSignOut={() => { signOut(); setVerified(''); window.location.hash = '/home' }} />
}
