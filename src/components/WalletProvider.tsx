import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { formatEther, type Eip1193Provider } from 'ethers'
import { endMembershipSession } from '../lib/membership-session'
import { membershipNetworks, solanaCheckout, solanaWallet } from '../lib/membership-client'
import type { MembershipNetwork, MembershipNetworkInfo } from '../lib/membership-networks'
import { analyticsNetworks, analyticsNetworkIds, evmNetwork, switchEvmNetwork, walletErrorCode, type AnalyticsNetwork } from '../lib/analytics-networks'

type Listener = (value?: unknown) => void
type Injected = Eip1193Provider & { on?: (event: string, listener: Listener) => void; removeListener?: (event: string, listener: Listener) => void }
type EvmConnection = { account: string; chainId: number }
export type WalletState = { account: string; network: string; balance: string; currency: string }
type Operation = 'Connecting wallet' | 'Switching network'
const injected = () => (window as Window & { ethereum?: Injected }).ethereum

const WalletContext = createContext<{
  wallet: WalletState | null
  membershipAccount: string
  checkoutAccount: string
  activeNetwork: MembershipNetwork
  networks: MembershipNetworkInfo[]
  selectNetwork: (network: MembershipNetwork) => void
  analyticsNetwork: AnalyticsNetwork
  selectAnalyticsNetwork: (network: AnalyticsNetwork) => void
  connectWallet: () => Promise<void>
  walletMatchesAnalytics: boolean
  connectMembershipWallet: () => Promise<string>
  refreshWallet: () => Promise<void>
  signOut: () => void
  logoutVersion: number
  walletBusy: boolean
  walletStatus: string
  retryWallet: (() => void) | null
} | null>(null)

function readStored(storage: Storage, key: string) {
  try { return storage.getItem(key) } catch { return null }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [activeNetwork, setActiveNetwork] = useState<MembershipNetwork>(() => {
    const saved = readStored(sessionStorage, 'blocksonar-membership-network')
    return saved === 'bnb' || saved === 'solana' ? saved : 'ethereum'
  })
  const [analyticsNetwork, setAnalyticsNetwork] = useState<AnalyticsNetwork>(() =>
    analyticsNetworkIds.find(id => id === readStored(localStorage, 'blocksonar-analytics-network')) ?? 'ethereum')
  const [networks, setNetworks] = useState<MembershipNetworkInfo[]>([])
  const [evm, setEvm] = useState<EvmConnection | null>(null)
  const [solana, setSolana] = useState('')
  const [logoutVersion, setLogoutVersion] = useState(0)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [failure, setFailure] = useState('')
  const [retryWallet, setRetryWallet] = useState<(() => void) | null>(null)
  const [balanceRefresh, setBalanceRefresh] = useState(0)
  const [balance, setBalance] = useState<{ key: string; amount: string } | null>(null)
  const signedOut = useRef(readStored(sessionStorage, 'blocksonar-signed-out') === 'true')
  const running = useRef(false)
  const logoutCounter = useRef(0)
  const generation = useRef(0)
  const evmRef = useRef<EvmConnection | null>(null)
  const solanaRef = useRef('')
  const accountKind = useRef(activeNetwork)
  accountKind.current = activeNetwork

  const config = networks.find(network => network.id === activeNetwork)
  const membershipAccount = activeNetwork === 'solana' ? solana : evm?.account ?? ''
  const checkoutAccount = config && (activeNetwork === 'solana' || config.chainId === evm?.chainId) ? membershipAccount : ''
  const showSolana = Boolean(solana && (analyticsNetwork === 'solana' || !evm))
  const actualEvmNetwork = evm && (evmNetwork(evm.chainId) ?? networks.find(network => network.walletKind === 'evm' && network.chainId === evm.chainId))
  const walletAccount = showSolana ? solana : evm?.account ?? ''
  const balanceKey = walletAccount ? (showSolana ? `solana:${solana}` : `${evm?.chainId}:${walletAccount}`) : ''
  const wallet: WalletState | null = walletAccount ? {
    account: walletAccount,
    network: showSolana ? analyticsNetworks.solana.name : actualEvmNetwork?.name ?? `Unsupported network (${evm?.chainId ?? 'unknown'})`,
    currency: showSolana ? 'SOL' : actualEvmNetwork?.currency ?? '',
    balance: balance && balance.key === balanceKey ? balance.amount : '—',
  } : null
  const walletStatus = operation ?? (failure || (
    !wallet ? 'Wallet disconnected' :
      analyticsNetwork === 'solana' && !solana ? 'Connect a Solana wallet' :
        !showSolana && !actualEvmNetwork ? 'Unsupported network' :
          balance?.key === balanceKey && balance.amount === '—' ? 'RPC unavailable' :
            `Network connected · ${wallet.network}`
  ))

  function invalidateMembership() {
    void endMembershipSession()
    setLogoutVersion(version => version + 1)
  }

  function updateEvm(next: EvmConnection | null) {
    const previous = evmRef.current
    if (previous?.account && previous.account.toLowerCase() !== next?.account.toLowerCase() && accountKind.current !== 'solana') {
      invalidateMembership()
    }
    evmRef.current = next
    setEvm(next)
  }

  function updateSolana(next: string) {
    if (solanaRef.current && solanaRef.current !== next && accountKind.current === 'solana') invalidateMembership()
    solanaRef.current = next
    setSolana(next)
  }

  function signOut(broadcast = true) {
    if (broadcast) {
      try { localStorage.setItem('blocksonar-signout', `${Date.now()}:${Math.random()}`) } catch { /* Session checks still run. */ }
    }
    void endMembershipSession()
    logoutCounter.current++
    generation.current++
    signedOut.current = true
    setLogoutVersion(version => version + 1)
    evmRef.current = null
    solanaRef.current = ''
    setEvm(null)
    setSolana('')
    setBalance(null)
    setFailure('')
    setRetryWallet(null)
    try { sessionStorage.setItem('blocksonar-signed-out', 'true') } catch { /* In-memory logout remains active. */ }
  }

  function selectNetwork(network: MembershipNetwork) {
    if (network === activeNetwork || running.current) return
    signOut()
    setActiveNetwork(network)
    try { sessionStorage.setItem('blocksonar-membership-network', network) } catch { /* Keep selection in memory. */ }
  }

  async function readConnections() {
    const ethereum = injected()
    const provider = solanaWallet()
    const solanaAccount = provider?.isConnected === false ? '' : provider?.publicKey?.toString() ?? ''
    if (!ethereum) return { evm: null, solana: solanaAccount }
    try {
      const accounts = await ethereum.request({ method: 'eth_accounts' }) as string[]
      const account = accounts[0]
      if (!account) return { evm: null, solana: solanaAccount }
      const chainId = Number(await ethereum.request({ method: 'eth_chainId' })) || 0
      return { evm: { account, chainId }, solana: solanaAccount }
    } catch (error) {
      return { evm: null, solana: solanaAccount, error }
    }
  }

  async function refreshWallet() {
    if (signedOut.current) return
    const request = ++generation.current
    const connections = await readConnections()
    if (request !== generation.current) return
    if (!connections.error) updateEvm(connections.evm)
    else setFailure(current => current || 'RPC unavailable')
    updateSolana(connections.solana)
  }

  function selectAnalyticsNetwork(network: AnalyticsNetwork) {
    setAnalyticsNetwork(network)
    setFailure('')
    setRetryWallet(null)
    try { localStorage.setItem('blocksonar-analytics-network', network) } catch { /* Keep selection in memory. */ }
  }

  async function runWalletOperation(network: AnalyticsNetwork | MembershipNetwork, mode: 'connect' | 'membership') {
    if (running.current) throw new Error('A wallet request is already pending.')
    running.current = true
    const logoutAtStart = logoutCounter.current
    const runAgain = () => { void runWalletOperation(network, mode).catch(() => {}) }
    const switching = Boolean((mode === 'membership' ? activeNetwork : network) !== 'solana' && evmRef.current)
    setRetryWallet(null)
    setFailure('')
    setOperation(switching ? 'Switching network' : 'Connecting wallet')
    try {
      const before = signedOut.current ? { evm: null, solana: '' } : await readConnections()
      if (logoutAtStart !== logoutCounter.current) throw new Error('Wallet request cancelled after sign out.')
      if ('error' in before && before.error && network !== 'solana') throw before.error
      const membershipConfig = mode === 'membership' ? networks.find(item => item.id === network) : undefined
      if (mode === 'membership' && !membershipConfig) throw new Error('Membership network unavailable.')
      const ethereum = injected()
      const targetChain = network === 'solana' ? null :
        membershipConfig?.chainId ?? analyticsNetworks[network === 'bnb' ? 'bsc' : network].chainId
      if (targetChain === null) {
        if (!before.solana) {
          const provider = solanaWallet()
          if (!provider) throw new Error('Install a compatible Solana wallet such as Phantom to connect.')
          await provider.connect()
        }
      } else {
        if (!ethereum) throw new Error('Install a compatible Ethereum wallet to connect.')
        if (!before.evm) await ethereum.request({ method: 'eth_requestAccounts' })
        if (logoutAtStart !== logoutCounter.current) throw new Error('Wallet request cancelled after sign out.')
        await switchEvmNetwork(ethereum, targetChain)
      }
      const after = await readConnections()
      if (logoutAtStart !== logoutCounter.current) throw new Error('Wallet request cancelled after sign out.')
      if (after.error && network !== 'solana') throw after.error
      const account = network === 'solana' ? after.solana : after.evm?.account
      if (!account) throw new Error('Wallet disconnected. Connect and retry.')
      if (targetChain !== null && after.evm?.chainId !== targetChain) {
        throw new Error('Wallet did not confirm the requested network.')
      }
      generation.current++
      signedOut.current = false
      try { sessionStorage.removeItem('blocksonar-signed-out') } catch { /* Keep in-memory connection. */ }
      if (!after.error) updateEvm(after.evm)
      updateSolana(after.solana)
      setBalanceRefresh(value => value + 1)
      return account
    } catch (error) {
      if (logoutAtStart === logoutCounter.current) {
        const code = walletErrorCode(error)
        const message = code === 4001 ? (switching ? 'Switch rejected' : 'Wallet connection rejected') :
          [4200, 4901, 4902, -32601].includes(code) ? 'Unsupported network or wallet method' :
            [4900, 4100].includes(code) ? 'Wallet disconnected' :
              error instanceof Error ? error.message : 'RPC unavailable'
        setFailure(message)
        if (mode !== 'membership') setRetryWallet(() => runAgain)
        void refreshWallet()
        throw new Error(message)
      }
      throw error
    } finally {
      running.current = false
      setOperation(null)
    }
  }

  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === 'blocksonar-signout' && event.newValue) signOut(false) }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    let cancelled = false
    void membershipNetworks().then(items => { if (!cancelled) setNetworks(items) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const ethereum = injected(), provider = solanaWallet()
    const refresh = () => { if (!running.current) void refreshWallet() }
    const accountsChanged: Listener = value => {
      if (signedOut.current) return
      generation.current++
      const account = Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
      updateEvm(account ? { account, chainId: 0 } : null)
      refresh()
    }
    const solanaChanged = () => {
      if (signedOut.current) return
      generation.current++
      updateSolana(provider?.publicKey?.toString() ?? '')
      refresh()
    }
    const evmDisconnected = () => {
      generation.current++
      updateEvm(null)
    }
    const solanaDisconnected = () => {
      generation.current++
      updateSolana('')
    }
    const chainChanged = () => {
      if (signedOut.current || running.current) return
      const current = evmRef.current
      if (current) updateEvm({ ...current, chainId: 0 })
      refresh()
    }
    const providerError = () => { if (!signedOut.current) setFailure('RPC unavailable') }
    const evmListeners = { connect: refresh, accountsChanged, chainChanged, disconnect: evmDisconnected, error: providerError }
    const solanaListeners = { connect: refresh, accountChanged: solanaChanged, disconnect: solanaDisconnected, error: providerError }
    for (const [event, handler] of Object.entries(evmListeners)) ethereum?.on?.(event, handler)
    for (const [event, handler] of Object.entries(solanaListeners)) provider?.on?.(event, handler)
    window.addEventListener('focus', refresh)
    refresh()
    return () => {
      generation.current++
      for (const [event, handler] of Object.entries(evmListeners)) ethereum?.removeListener?.(event, handler)
      for (const [event, handler] of Object.entries(solanaListeners)) provider?.removeListener?.(event, handler)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  useEffect(() => {
    if (!balanceKey || (!showSolana && !actualEvmNetwork)) return
    const controller = new AbortController()
    async function readBalance() {
      if (showSolana) {
        const { lamports } = await solanaCheckout<{ lamports: number }>('mainnet-balance', { address: walletAccount }, controller.signal)
        if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('Invalid balance')
        return (lamports / 1e9).toFixed(4)
      }
      const provider = injected()
      if (!provider) throw new Error('Wallet disconnected')
      const raw = await provider.request({ method: 'eth_getBalance', params: [walletAccount, 'latest'] })
      if (Number(await provider.request({ method: 'eth_chainId' })) !== evm?.chainId) throw new Error('Wallet network changed')
      return Number(formatEther(BigInt(raw))).toFixed(4)
    }
    const update = (amount: string) => { if (!controller.signal.aborted) setBalance({ key: balanceKey, amount }) }
    void readBalance().then(update, () => update('—'))
    return () => controller.abort()
  }, [balanceKey, showSolana ? null : actualEvmNetwork, balanceRefresh])

  return <WalletContext.Provider value={{
    wallet, membershipAccount, checkoutAccount, activeNetwork, networks, selectNetwork, analyticsNetwork,
    selectAnalyticsNetwork,
    walletMatchesAnalytics: analyticsNetwork === 'solana' ? Boolean(solana) : evm?.chainId === analyticsNetworks[analyticsNetwork].chainId,
    connectWallet: async () => { await runWalletOperation(analyticsNetwork, 'connect') },
    connectMembershipWallet: () => runWalletOperation(activeNetwork, 'membership'),
    refreshWallet, signOut, logoutVersion, walletBusy: Boolean(operation), walletStatus, retryWallet: retryWallet ?? (walletStatus === 'RPC unavailable' ? () => { setFailure(''); setBalance(null); setBalanceRefresh(value => value + 1); void refreshWallet() } : null),
  }}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) throw new Error('useWallet requires WalletProvider')
  return context
}
