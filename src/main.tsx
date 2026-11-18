import React from 'react'
import ReactDOM from 'react-dom/client'
import Entry from './Entry'
import ClickPixels from './components/ClickPixels'
import { WalletProvider } from './components/WalletProvider'
import { ThemeAppearance } from './components/AppearanceSettings'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeAppearance />
    <WalletProvider><Entry /></WalletProvider>
    <ClickPixels />
  </React.StrictMode>,
)
