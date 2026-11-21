import { useEffect, useRef, useState } from 'react'
import { LogOut, Monitor, Moon, Sun, X } from 'lucide-react'

import { setCursorEffects, useCursorEffects } from '../lib/cursor-effects'

type Theme = 'dark' | 'light' | 'default'
const storageKey = 'blocksonar-theme'
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === 'dark' || value === 'light') return value
  } catch {
    /* Use the original theme. */
  }
  return 'default'
}

export function ThemeAppearance() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = savedTheme()
    }
    apply()
    window.addEventListener('blocksonar-theme-change', apply)
    window.addEventListener('storage', apply)
    return () => {
      window.removeEventListener('blocksonar-theme-change', apply)
      window.removeEventListener('storage', apply)
    }
  }, [])
  return null
}

export default function AppearanceSettings({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  onSignOut: () => void
}) {
  const cursorEffects = useCursorEffects()
  const dialog = useRef<HTMLDialogElement>(null)
  const [theme, setTheme] = useState<Theme>(savedTheme)
  useEffect(() => {
    if (open) {
      setTheme(savedTheme())
      dialog.current?.showModal()
    } else dialog.current?.close()
  }, [open])
  function choose(value: Theme) {
    setTheme(value)
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      /* Apply for this visit if storage is unavailable. */
    }
    document.documentElement.dataset.theme = value
  }
  return (
    <dialog
      ref={dialog}
      className='appearance-dialog'
      aria-labelledby='appearance-title'
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) {
          const rect = dialog.current.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <div className='appearance-heading'>
        <h2 id='appearance-title'>Settings</h2>
        <button type='button' aria-label='Close settings' onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h3>Website appearance</h3>
      <p>
        Choose a theme. Default restores the original BlockSonar colors. Dark uses black
        backgrounds.
      </p>
      <div className='appearance-options'>
        {(
          [
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'default', label: 'Default', icon: Monitor },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            type='button'
            key={value}
            aria-pressed={theme === value}
            onClick={() => choose(value)}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </div>
      <div className='settings-cursor-row'>
        <div>
          <h3 id='cursor-effects-label'>Cursor effects</h3>
          <p>Sonar cursor and movement trail. Pixel click effects stay on.</p>
        </div>
        <button
          type='button'
          className='settings-cursor-toggle'
          role='switch'
          aria-checked={cursorEffects}
          aria-labelledby='cursor-effects-label'
          onClick={() => setCursorEffects(!cursorEffects)}
        >
          {cursorEffects ? 'On' : 'Off'}
        </button>
      </div>
      <button
        type='button'
        className='settings-sign-out'
        onClick={() => {
          dialog.current?.close()
          onSignOut()
        }}
      >
        <LogOut size={17} />
        Sign out
      </button>
    </dialog>
  )
}
