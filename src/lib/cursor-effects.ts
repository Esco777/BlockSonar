import { useEffect, useState } from 'react'

const storageKey = 'blocksonar-cursor-effects'
const changeEvent = 'blocksonar-cursor-effects-change'
function savedCursorEffects() {
  try { return localStorage.getItem(storageKey) !== 'off' } catch { return true }
}
export function setCursorEffects(enabled: boolean) {
  try { localStorage.setItem(storageKey, enabled ? 'on' : 'off') } catch { /* Apply for this visit. */ }
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: enabled }))
}
export function useCursorEffects() {
  const [enabled, setEnabled] = useState(savedCursorEffects)
  useEffect(() => {
    const change = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail)
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) setEnabled(savedCursorEffects()) }
    window.addEventListener(changeEvent, change)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(changeEvent, change); window.removeEventListener('storage', sync) }
  }, [])
  return enabled
}
