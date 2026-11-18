import WhaleBuyCard from './WhaleBuyCard'
import type { WhaleSonarFeed } from '../lib/whale-sonar'
import { useWalletSonarPrices } from '../hooks/useWalletSonarPrices'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Pause, Play, ScanLine, ArrowUpRight } from 'lucide-react'
import TokenLogo from './TokenLogo'
import { walletCycleStep, walletAmount, type WalletHologramEntry } from '../lib/wallet-hologram'
import './SwapHologram.css'
import './WalletHologram.css'

export const WalletHologramTarget = createContext<HTMLElement | null>(null)

const short = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`
function AssetLogo({ entry }: { entry: WalletHologramEntry }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [entry.logo])
  return entry.logo?.startsWith('https://') && !failed ? <img className="wallet-holo-logo-image" src={entry.logo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <TokenLogo mark={entry.mark} />
}
export default function WalletHologram({ whaleFeed, entries, chain, selected, observedAt, loading, scope, wallets = [], onWalletChange, walletSource = 'Tracked wallets' }: { whaleFeed?: WhaleSonarFeed | null; walletSource?: string; wallets?: Array<{address:string; label:string}>; onWalletChange?: (address:string) => void; entries: WalletHologramEntry[]; chain: 'ethereum' | 'solana'; selected: string; observedAt?: number; loading?: boolean; scope?: string }) {
  const [currency, setCurrency] = useState<'usd' | 'native'>(() => { try { return localStorage.getItem('blocksonar-wallet-currency') === 'native' ? 'native' : 'usd' } catch { return 'usd' } })
  const chooseCurrency = (value: 'usd' | 'native') => { setCurrency(value); try { localStorage.setItem('blocksonar-wallet-currency', value) } catch { /* Preference still works for this visit. */ } }
  const usd = (value: number | null) => value !== null && Number.isFinite(value) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value) : 'USD unavailable'
  const target = useContext(WalletHologramTarget)
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false)
  const order = entries.map(e => e.id).join('|')
  useEffect(() => { setIndex(current => Math.min(current, Math.max(0, entries.length - 1))) }, [order, entries.length])
  const active = entries[index], amount = active ? walletAmount(active.amount) : null
  const upcoming = Array.from({ length: Math.min(3, Math.max(0, entries.length - index)) }, (_, n) => index + n)
  const sonarUsd = useWalletSonarPrices(chain, upcoming.map(position => entries[position]))
  const explorer = chain === 'ethereum' ? 'https://etherscan.io/address/' : 'https://solscan.io/account/'
  const marketAddress = (mint: string) => mint === 'ETH' ? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' : mint === 'SOL' ? 'So11111111111111111111111111111111111111112' : mint
  const move = (direction: number) => setIndex(current => entries.length ? (current + direction + entries.length) % entries.length : 0)
  const walletIndex = wallets.findIndex(wallet => wallet.address === selected)
  const changeWallet = (direction: number) => {
    if (!wallets.length || !onWalletChange) return
    const next = walletIndex < 0 ? (direction > 0 ? 0 : wallets.length - 1) : (walletIndex + direction + wallets.length) % wallets.length
    onWalletChange(wallets[next].address)
  }
  const changeWalletRef = useRef(changeWallet)
  useEffect(() => { changeWalletRef.current = changeWallet })
  const canAdvanceWallet = Boolean(selected && onWalletChange && wallets.length > 1)
  useEffect(() => {
    if (paused || loading || !entries.length || (entries.length <= 3 && !canAdvanceWallet)) return
    const timer = window.setTimeout(() => {
      const next = walletCycleStep(index, entries.length)
      if (next !== null) setIndex(next)
      else if (canAdvanceWallet) changeWalletRef.current(1)
      else setIndex(0)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [paused, loading, order, entries.length, index, canAdvanceWallet])
  const display = <section className={`swap-hologram wallet-hologram ${paused ? 'holo-paused' : ''} ${active ? 'holo-active' : 'holo-idle'}`} aria-label={`${chain === 'ethereum' ? 'Ethereum' : 'Solana'} wallet balance animation`}>
    <div className="holo-topline"><div><ScanLine size={13} /><span>WALLET SONAR</span><i /><span className="holo-network">{chain.toUpperCase()}</span></div><div className="holo-controls"><span>{selected ? 'Wallet assets' : 'Holder balances'} · 5s cycle</span><button type="button" aria-label={paused ? 'Resume balance animation' : 'Pause balance animation'} onClick={() => setPaused(p => !p)}>{paused ? <Play size={13} /> : <Pause size={13} />}</button></div></div>
    <div className="wallet-holo-scene">
      <div className="holo-grid" aria-hidden="true" /><div className="holo-horizon" aria-hidden="true" />
      <svg className="holo-circuits" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor"><path d="M0 250h140l55-55h85l60 60h150M0 220h120l55-55h130l60 60h125M0 190h100l55-55h170l60 60h105M1000 250H870l-55-55H700l-60 60H490m510-35H890l-55-55H680l-60 60H490m510-35H910l-55-55H660l-60 60H490" /></g></svg>
      <div className="wallet-holo-active">
        <div className="wallet-holo-coin-frame" aria-hidden="true"><div className="holo-center"><div className="wallet-holo-uplight" /><div className="wallet-holo-light-rain">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ left: `${9 + i * 10}%`, animationDelay: `${i * -.37}s` }} />)}</div><div className="holo-coin-space"><div className="holo-coin"><div className="holo-coin-face holo-face-front"><TokenLogo mark={chain === 'ethereum' ? 'ethereum' : 'solana'} /></div><div className="holo-coin-face holo-face-back"><TokenLogo mark={chain === 'ethereum' ? 'ethereum' : 'solana'} /></div>{Array.from({ length: 8 }, (_, i) => <div className="holo-coin-edge" key={i} style={{ transform: `translateZ(${i * 2 - 7}px)` }} />)}</div></div><div className="holo-platform"><i /><i /><i /></div><div className="holo-swap-label"><ScanLine size={13} /><span title={active ? `${amount?.exact} ${active.symbol}` : undefined}>{active ? currency === 'usd' ? usd(sonarUsd(active)) : `${amount?.display} ${active.symbol}` : '—'}</span></div></div></div>
        <svg className="wallet-holo-link" key={`circuit:${active?.id ?? 'empty'}`} viewBox="0 0 600 280" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor">{['M100 116H160L220 45H380', 'M100 130H195L220 140H380', 'M100 144H160L220 235H380'].slice(0, upcoming.length).map(path => <path key={path} pathLength="1" d={path} />)}</g></svg>
        <div className="wallet-holo-readout"><div className="wallet-holo-currency" role="group" aria-label="Balance currency"><button type="button" aria-pressed={currency === 'usd'} onClick={() => chooseCurrency('usd')}>USD</button><button type="button" aria-pressed={currency === 'native'} onClick={() => chooseCurrency('native')}>Native</button></div><div className="wallet-holo-boxes" key={`boxes:${active?.id ?? 'empty'}`}>{upcoming.map(position => { const entry = entries[position], quantity = walletAmount(entry.amount); return <div className="wallet-holo-asset-box" key={entry.id}><div className="wallet-holo-box-logo" aria-hidden="true"><AssetLogo entry={entry} /></div><div className="wallet-holo-kicker">{selected ? 'ASSET' : 'HOLDER'} {String(position + 1).padStart(2, '0')} / {String(entries.length).padStart(2, '0')}</div><h2 title={entry.name}>{entry.symbol}</h2><div className="wallet-holo-balance" title={quantity.exact}>{currency === 'usd' ? usd(sonarUsd(entry)) : quantity.display}</div><span className="wallet-holo-unit">{currency === 'usd' ? 'CURRENT VALUE · USD' : `${entry.symbol} HELD`}</span><div className="wallet-holo-value">{currency === 'usd' ? `${quantity.display} ${entry.symbol}` : usd(sonarUsd(entry))}</div><a className="wallet-holo-screener-link" href={`https://dexscreener.com/${chain}/${encodeURIComponent(marketAddress(entry.mint))}`} target="_blank" rel="noreferrer" title={`Open ${entry.mint === 'ETH' ? 'wrapped ETH' : entry.mint === 'SOL' ? 'wrapped SOL' : entry.symbol} on DEX Screener: ${marketAddress(entry.mint)}`}><span>{entry.mint === 'ETH' ? 'WETH market' : entry.mint === 'SOL' ? 'Wrapped SOL market' : short(entry.mint)}</span><ArrowUpRight size={10} /></a><a href={`${explorer}${entry.owner}`} target="_blank" rel="noreferrer" title={entry.owner}><span>{short(entry.owner)}</span><ArrowUpRight size={10} /></a></div> })}{!active && <div className="wallet-holo-asset-box"><h2>Waiting for balances</h2><p>{loading ? 'Reading wallet snapshot…' : 'Track a wallet or wait for the holder directory.'}</p></div>}</div></div>
      </div>
      <aside className="wallet-holo-queue" aria-label="Balance cycle list"><div className="wallet-holo-queue-heading"><span>{selected ? 'ASSET SEQUENCE' : 'HOLDER SEQUENCE'}</span><div><button type="button" aria-label="Previous balance" disabled={!entries.length} onClick={() => move(-1)}><ChevronLeft size={14} /></button><button type="button" aria-label="Next balance" disabled={!entries.length} onClick={() => move(1)}><ChevronRight size={14} /></button></div></div>{upcoming.map(position => { const entry = entries[position]; return <button type="button" className={`wallet-holo-queue-row ${position === index ? 'is-current' : ''}`} key={entry.id} onClick={() => setIndex(position)} aria-current={position === index ? 'true' : undefined}><span className="wallet-holo-position">{String(position + 1).padStart(2, '0')}</span><span className="wallet-holo-mini-logo"><AssetLogo entry={entry} /></span><span className="wallet-holo-row-name"><strong>{entry.symbol}</strong><small>{selected ? entry.name : short(entry.owner)}</small></span><span className="wallet-holo-row-amount" title={entry.amount}>{currency === 'usd' ? usd(sonarUsd(entry)) : walletAmount(entry.amount).display}</span></button> })}{!entries.length && <p className="wallet-holo-empty">Real balances will populate this sequence automatically.</p>}<div className="wallet-holo-progress" key={`${active?.id}:${paused}`}><i /></div><small className="wallet-holo-cycle-note">{paused ? 'Cycle paused' : canAdvanceWallet && index + 3 >= entries.length ? 'Next wallet after this sequence' : entries.length > 1 ? 'Next balances in 5 seconds' : 'Waiting for more balance entries'}</small></aside>
    </div>
    <WhaleBuyCard chain={chain} feed={whaleFeed} />
    <div className="holo-bottomline"><div><span className="holo-status-dot" /><strong>{selected ? 'Selected wallet holdings' : 'Native holder directory'}</strong><span>{observedAt ? `Observed ${new Date(observedAt).toLocaleString()}` : 'Awaiting source data'}</span></div><span className="wallet-holo-scope" title={scope}>{selected ? 'USD estimates by Alchemy · balances from the wallet provider · 5s display cycle.' : `USD estimates by Alchemy · ${scope || 'Directory scope appears when balances load.'}`}</span></div>
    <div className="wallet-holo-wallet-nav" role="group" aria-label="Change wallet"><div><span title={selected}>CHANGE WALLET - {walletIndex >= 0 ? wallets[walletIndex].label : selected ? short(selected) : 'Select a wallet'}</span><small title={selected}>{selected ? `${walletSource === 'Large ETH holders' ? 'Rank' : 'Wallet'} #${walletIndex >= 0 ? walletIndex + 1 : '—'} · ${short(selected)}` : wallets.length ? `Choose from ${walletSource.toLowerCase()}` : `Waiting for ${walletSource.toLowerCase()}`}</small></div><button type="button" aria-label="Previous wallet" disabled={!onWalletChange || !wallets.length || (wallets.length === 1 && walletIndex === 0)} onClick={() => changeWallet(-1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Next wallet" disabled={!onWalletChange || !wallets.length || (wallets.length === 1 && walletIndex === 0)} onClick={() => changeWallet(1)}><ChevronRight size={16} /></button></div>
  </section>
  return target ? createPortal(display, target) : display
}
