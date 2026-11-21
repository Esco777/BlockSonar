import { membershipSession } from './lib/membership-session'
import { useEffect, useState } from 'react'
import App from './App'
import Homepage from './components/Homepage'
import { useWallet } from './components/WalletProvider'

export default function Entry() {
  const { signOut, membershipAccount, networks, activeNetwork, logoutVersion } = useWallet()
  const [hash, setHash] = useState(window.location.hash)
  const config = networks.find((item) => item.id === activeNetwork)
  const identity =
    membershipAccount && config?.configured
      ? `${activeNetwork}:${config.chainId}:${
          activeNetwork === 'solana' ? membershipAccount : membershipAccount.toLowerCase()
        }`
      : ''
  const [verified, setVerified] = useState('')
  const membershipKey = identity ? `${identity}:${logoutVersion}` : ''
  const sessionVerified = Boolean(verified && verified === membershipKey)
  const [sessionRefresh, refreshSession] = useState(0)
  useEffect(() => {
    if (!membershipKey) {
      setVerified('')
      return
    }
    let cancelled = false,
      checking = false
    const controller = new AbortController()
    const check = async () => {
      if (checking) return
      checking = true
      try {
        if (!config?.configured) throw new Error('Membership unavailable')
        const session = await membershipSession(
          AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
        )
        if (
          (activeNetwork === 'solana'
            ? session.address !== membershipAccount
            : session.address.toLowerCase() !== membershipAccount.toLowerCase()) ||
          session.network !== activeNetwork ||
          session.chainId !== config.chainId ||
          (activeNetwork === 'solana'
            ? session.contractAddress !== config.contractAddress
            : session.contractAddress.toLowerCase() !== config.contractAddress.toLowerCase()) ||
          session.expiresAt <= Date.now()
        )
          throw new Error('Membership session does not match this wallet')
        if (!cancelled) setVerified(membershipKey)
      } catch {
        if (!cancelled) setVerified('')
      } finally {
        checking = false
      }
    }
    void check()
    const timer = window.setInterval(() => {
      void check()
    }, 10000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [membershipKey, membershipAccount, activeNetwork, config, sessionRefresh])
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/home')
      setHash('#/home')
    }
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])
  return !sessionVerified ||
    !hash ||
    hash === '#/home' ||
    hash === '#/home/' ||
    hash === '#/join' ||
    hash === '#/join/' ? (
    <Homepage
      sessionVerified={sessionVerified}
      onEnter={() => {
        refreshSession((n) => n + 1)
        window.location.hash = '/'
      }}
    />
  ) : (
    <App
      key={identity}
      onSignOut={() => {
        signOut()
        setVerified('')
        window.location.hash = '/home'
      }}
    />
  )
}
