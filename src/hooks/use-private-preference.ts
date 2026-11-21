import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useWallet } from '../components/WalletProvider'
import { PreferenceWriter, type SaveStatus } from '../lib/preference-writer'

export function usePrivatePreference<T>(kind: string, initial: () => T) {
  const { membershipAccount, activeNetwork, networks } = useWallet()
  const config = networks.find(network => network.id === activeNetwork)
  const owner = membershipAccount && config ? `${activeNetwork}:${config.chainId}:${activeNetwork === 'solana' ? membershipAccount : membershipAccount.toLowerCase()}` : ''
  const [value, update] = useState(initial), [ready, setReady] = useState(false), [status, setStatus] = useState<SaveStatus>({ error: '', unsaved: false })
  const [reload, setReload] = useState(0)
  const writer = useRef<PreferenceWriter<T> | null>(null), currentValue = useRef(value)
  useEffect(() => {
    const controller = new AbortController()
    setReady(false); currentValue.current = initial(); update(currentValue.current); setStatus({ error: '', unsaved: false })
    if (owner) void fetch(`/api/preferences/${kind}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Private lists unavailable')
      if (data.owner !== owner) throw new Error('Sign-in changed. Reload your lists.')
      if (!controller.signal.aborted) {
        currentValue.current = data.value ?? initial(); update(currentValue.current)
        writer.current = new PreferenceWriter(kind, owner, data.revision, currentValue.current, setStatus)
        setReady(true)
      }
    }).catch(error => { if (!controller.signal.aborted) setStatus({ error: error.message, unsaved: false }) })
    return () => { controller.abort(); writer.current?.dispose(); writer.current = null }
  }, [owner, kind, reload])
  const setValue: Dispatch<SetStateAction<T>> = next => {
    if (!writer.current) return
    const result = typeof next === 'function' ? (next as (current: T) => T)(currentValue.current) : next
    currentValue.current = result; update(result); writer.current.update(result)
  }
  return { value, setValue, ready, ...status, retry: () => { if (writer.current) writer.current.retry(); else setReload(n => n + 1) }, reload: () => setReload(n => n + 1) }
}
