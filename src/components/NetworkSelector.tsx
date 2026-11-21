import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  analyticsNetworkIds,
  analyticsNetworks,
  type AnalyticsNetwork,
} from '../lib/analytics-networks'
import { useWallet } from './WalletProvider'
import './NetworkSelector.css'

const symbols: Record<AnalyticsNetwork, string> = {
  ethereum: '♦',
  base: '━',
  bsc: '❖',
  solana: '≋',
}

function NetworkIcon({ network }: { network: AnalyticsNetwork }) {
  return (
    <span className={`network-symbol network-symbol-${network}`} aria-hidden='true'>
      {symbols[network]}
    </span>
  )
}

export default function NetworkSelector({ disabled = false }: { disabled?: boolean }) {
  const {
    analyticsNetwork,
    selectAnalyticsNetwork,
    walletBusy,
    walletStatus,
    retryWallet,
    wallet,
    walletMatchesAnalytics,
    connectWallet,
  } = useWallet()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return (
    <div
      className='network-selector'
      ref={menu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        className='network-trigger'
        type='button'
        ref={trigger}
        aria-label={`Analytics network: ${analyticsNetworks[analyticsNetwork].name}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <NetworkIcon network={analyticsNetwork} />
        <span className='network-label'>{analyticsNetworks[analyticsNetwork].label}</span>
        <ChevronDown size={13} aria-hidden='true' />
      </button>
      {(walletBusy || retryWallet) && !open && (
        <div className='network-feedback'>
          <span role='status'>{walletStatus}</span>
          {retryWallet && (
            <button type='button' onClick={retryWallet}>
              Retry
            </button>
          )}
        </div>
      )}
      {open && (
        <div id={id} className='network-options' role='group' aria-label='Analytics network'>
          {analyticsNetworkIds.map((network) => (
            <button
              key={network}
              type='button'
              aria-pressed={analyticsNetwork === network}
              disabled={walletBusy}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                selectAnalyticsNetwork(network)
              }}
            >
              <NetworkIcon network={network} />
              <span>{analyticsNetworks[network].name}</span>
              {analyticsNetwork === network && <Check size={14} aria-hidden='true' />}
            </button>
          ))}
          <p role='status'>{walletStatus}</p>
          {retryWallet && (
            <button type='button' onClick={retryWallet}>
              Retry wallet request
            </button>
          )}
          {wallet && !walletMatchesAnalytics && !retryWallet && (
            <button
              type='button'
              disabled={walletBusy}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                void connectWallet().catch(() => {})
              }}
            >
              {analyticsNetwork === 'solana'
                ? 'Connect Solana wallet'
                : `Switch wallet to ${analyticsNetworks[analyticsNetwork].label}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
