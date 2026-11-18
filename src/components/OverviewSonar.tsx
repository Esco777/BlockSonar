import DexIntellIcon from './DexIntellIcon'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, Droplets, Activity, Layers3, Pause, Play, Radar } from 'lucide-react'
import type { SonarAsset } from '../lib/sonar-research'

type Props = {
  coins: SonarAsset[]
  dataSource: 'sample' | 'live'
  updatedAt: number | null
  onOpenAsset: (id: string) => void
  onNavigate: (destination: string) => void
}
const positions = [[28, 30], [66, 25], [77, 59], [42, 76], [19, 60], [52, 18], [73, 78]]

export default function OverviewSonar({ coins, dataSource, updatedAt, onOpenAsset, onNavigate }: Props) {
  const [paused, setPaused] = useState(false)
  const [exploreOpen, setExploreOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const exploreButton = useRef<HTMLButtonElement>(null)
  const exploreMenu = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setExploreOpen(true) }
  const closeSoon = () => { closeTimer.current = setTimeout(() => setExploreOpen(false), 180) }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (!exploreOpen) return
    const position = () => {
      const bounds = exploreButton.current?.getBoundingClientRect()
      if (!bounds) return
      const height = exploreMenu.current?.offsetHeight ?? 190
      setMenuPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 238)), top: bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 8 : Math.max(8, bounds.top - height - 8) })
    }
    const outside = (event: PointerEvent) => { if (!exploreButton.current?.contains(event.target as Node) && !exploreMenu.current?.contains(event.target as Node)) setExploreOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExploreOpen(false); exploreButton.current?.focus() } }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [exploreOpen])
  const radarRef = useRef<HTMLDivElement>(null)
  const sweepRef = useRef<HTMLDivElement>(null)
  const sweepAngle = useRef(0)
  const xrp = coins.find((coin) => coin.id === 'ripple') ?? coins.find((coin) => coin.symbol.toUpperCase() === 'XRP')
  const contacts = coins.filter((coin) => coin.symbol.toUpperCase() !== 'XRP' && coin.id !== 'ripple').slice(0, positions.length - 1)
  if (xrp) {
    const usdtIndex = contacts.findIndex((coin) => coin.symbol.toUpperCase() === 'USDT')
    contacts.splice(usdtIndex >= 0 ? usdtIndex + 1 : contacts.length, 0, xrp)
  }
  const advancing = coins.filter((coin) => coin.change > 0).length
  const contactIds = contacts.map((coin) => coin.id).join(',')
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation = 0
    let previous = 0
    const draw = () => {
      if (sweepRef.current) sweepRef.current.style.transform = `rotate(${reducedMotion.matches ? 32 : sweepAngle.current}deg)`
      radarRef.current?.querySelectorAll<HTMLButtonElement>('[data-scan-angle]').forEach((contact) => {
        const age = (sweepAngle.current - Number(contact.dataset.scanAngle) + 360) % 360
        const opacity = reducedMotion.matches ? 1 : age < 12 ? 1 : age < 100 ? (1 - (age - 12) / 88) : 0
        contact.style.opacity = String(opacity)
        contact.style.pointerEvents = opacity > .08 ? 'auto' : 'none'
      })
    }
    const tick = (time: number) => {
      if (!previous) previous = time
      const elapsed = time - previous
      if (elapsed >= 32) {
        sweepAngle.current = (sweepAngle.current + Math.min(elapsed, 100) * 360 / 9000) % 360
        previous = time
        draw()
      }
      animation = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(animation)
      previous = 0
      draw()
      if (!paused && !reducedMotion.matches) animation = requestAnimationFrame(tick)
    }
    start()
    reducedMotion.addEventListener('change', start)
    return () => { cancelAnimationFrame(animation); reducedMotion.removeEventListener('change', start) }
  }, [paused, contactIds])

  return <section className="overview-sonar" data-paused={paused} aria-label="Market overview with animated three-dimensional sonar">

    <div className="overview-sonar-pixels" aria-hidden="true">{Array.from({ length: 160 }, (_, index) => {
      const column = index % 20, row = Math.floor(index / 20)
      return <i key={index} style={{ '--wave-delay': `${-(column * .16 + Math.abs(row - 3.5) * .2)}s`, '--pixel-size': `${3 + index % 3}px` } as CSSProperties} />
    })}</div>
    <div className="overview-sonar-copy">
      <div className="overview-sonar-kicker"><Radar size={15} /> BLOCKSONAR / MARKET RADAR</div>
      <h1>See beneath<br />the <span>surface.</span></h1>
      <p>A wider view of what’s moving. Explore the market, follow changing momentum, and investigate the signals.</p>
      <button ref={exploreButton} type="button" className="overview-sonar-action" aria-expanded={exploreOpen} aria-controls="sonar-explore-options" onMouseEnter={keepOpen} onMouseLeave={closeSoon} onClick={keepOpen} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); keepOpen(); requestAnimationFrame(() => exploreMenu.current?.querySelector('button')?.focus()) } }}>Explore Sonar <ChevronDown size={16} /></button>
      {exploreOpen && createPortal(<nav ref={exploreMenu} id="sonar-explore-options" className="overview-explore-options sonar-explore-options" aria-label="Explore Sonar destinations" style={{ position: 'fixed', left: menuPosition.left, top: menuPosition.top, right: 'auto', zIndex: 1000 }} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== exploreButton.current) setExploreOpen(false) }}>
        {[{ label: 'Sonar', destination: 'Sonar', icon: Radar }, { label: 'Liquidity Pools', destination: 'Discover', icon: Droplets }, { label: 'DEX Intell', destination: 'DEX Intell', icon: DexIntellIcon }, { label: 'Early Narrative Radar', destination: 'Early Narrative Radar', icon: Activity }, { label: 'Liquidation Heatmap', destination: 'Liquidation / Heatmap', icon: Layers3 }].map(({ label, destination, icon: Icon }) => <button key={destination} type="button" onClick={() => { setExploreOpen(false); onNavigate(destination) }}><Icon size={16} /><span>{label}</span></button>)}
      </nav>, document.body)}
      <div className="overview-sonar-readout"><span><i /> {dataSource === 'live' ? 'MARKET SNAPSHOT' : 'SAMPLE DATA'}</span><small>{updatedAt ? `Received ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for live market data'}</small></div>
    </div>
    <div className="overview-sonar-visual">
      <div className="overview-sonar-stage-label"><span>SONAR ARRAY / 01</span><button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Play sonar animation' : 'Pause sonar animation'} aria-pressed={paused}>{paused ? <Play size={13} /> : <Pause size={13} />}</button></div>
      <div className="overview-sonar-scene">
        <div className="overview-sonar-halo" aria-hidden="true" />
        <div ref={radarRef} className="overview-sonar-plane">
          <div className="overview-sonar-disc" aria-hidden="true"><div className="overview-sonar-grid" /><div ref={sweepRef} className="overview-sonar-sweep" /><i className="overview-sonar-ring ring-one" /><i className="overview-sonar-ring ring-two" /><i className="overview-sonar-ring ring-three" /><i className="overview-sonar-axis axis-x" /><i className="overview-sonar-axis axis-y" /></div>
          <div className="overview-sonar-depth depth-one" aria-hidden="true" /><div className="overview-sonar-depth depth-two" aria-hidden="true" />
          <div className="overview-sonar-core" aria-hidden="true"><i /><i /></div>
          {contacts.map((coin, index) => <button type="button" key={coin.id} className="overview-sonar-contact" data-scan-angle={(Math.atan2(positions[index][0] - 50, 50 - positions[index][1]) * 180 / Math.PI + 360) % 360} style={{ left: `${positions[index][0]}%`, top: `${positions[index][1]}%` }} onClick={() => onOpenAsset(coin.id)} title={`${coin.name} · ${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}% in 24h`} aria-label={`Open ${coin.name}, ${coin.change >= 0 ? 'up' : 'down'} ${Math.abs(coin.change).toFixed(2)} percent in 24 hours`}><span className="overview-sonar-coin-face"><span className="overview-sonar-coin-fallback" aria-hidden="true"><Radar size={18} /></span><img src={coin.image} alt="" draggable={false} onError={(event) => { event.currentTarget.style.display = 'none' }} /></span></button>)}
        </div>
      </div>
      <div className="overview-sonar-visual-caption"><span>3D MARKET VISUALIZATION</span><small>Illustrative positions · 24h price changes</small></div>
    </div>
    <div className="overview-sonar-bottom"><div><span>TRACKED ASSETS</span><strong>{coins.length.toLocaleString()}</strong></div><div><span>ADVANCING / 24H</span><strong>{advancing.toLocaleString()} <small>/ {coins.length.toLocaleString()}</small></strong></div><div><span>SCAN UNIVERSE</span><strong>Crypto markets</strong></div><span className="overview-sonar-bottom-note">Depth of perspective.<br />Clarity of context.</span></div>
  </section>
}
