import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Bitcoin } from 'lucide-react'

type CoinKind = 'btc' | 'eth' | 'sol' | 'xrp' | 'bnb'
type Pixel = { x: number; y: number; dx: number; dy: number; rotation: number; delay: number }
type Coin = { id: number; kind: CoinKind; x: number; y: number; size: number; tilt: number; pixels: Pixel[] }
const kinds: CoinKind[] = ['btc', 'eth', 'sol', 'xrp', 'bnb']

function CoinMark({ kind }: { kind: CoinKind }) {
  if (kind === 'btc') return <Bitcoin className="join-bitcoin-logo" strokeWidth={2.6} shapeRendering="geometricPrecision" />
  if (kind === 'eth') return <svg shapeRendering="geometricPrecision" viewBox="0 0 32 32" fill="currentColor"><path d="m16 2 9 14-9 5-9-5z" opacity=".9" /><path d="m16 23 9-5-9 12-9-12z" /><path d="M16 2v19l9-5z" fill="#d6ffc0" opacity=".3" /></svg>
  if (kind === 'sol') return <svg shapeRendering="geometricPrecision" viewBox="0 0 32 32" fill="currentColor"><path d="m9 6-5 5h19l5-5zM4 14l5 5h19l-5-5zm5 8-5 5h19l5-5z" /></svg>
  if (kind === 'xrp') return <svg shapeRendering="geometricPrecision" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="m5 5 7 7a5.7 5.7 0 0 0 8 0l7-7M5 27l7-7a5.7 5.7 0 0 1 8 0l7 7" /></svg>
  return <svg shapeRendering="geometricPrecision" viewBox="0 0 32 32" fill="currentColor"><path d="m16 3 7 7-3 3-4-4-4 4-3-3zm-9 9 4 4-4 4-4-4zm18 0 4 4-4 4-4-4zm-9 0 4 4-4 4-4-4zm-7 10 3-3 4 4 4-4 3 3-7 7z" /></svg>
}

export default function JoinCoinRain() {
  const [coins, setCoins] = useState<Coin[]>([])
  const nextId = useRef(0)
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timers = new Set<number>()
    const occupiedAreas = new Map<number, { left: number; top: number; right: number; bottom: number }>()
    let spawnTimer: number | undefined
    let stopped = false
    const later = (action: () => void, delay: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); action() }, delay)
      timers.add(timer)
      return timer
    }
    const spawn = () => {
      if (stopped || reduced.matches) return
      if (!document.hidden) {
        const id = nextId.current + 1
        const size = (34 + Math.random() * 36) * (id % 3 === 0 ? 2 : 1)
        const layer = layerRef.current
        const bounds = layer?.getBoundingClientRect()
        const protectedAreas = Array.from(layer?.parentElement?.querySelectorAll('.join-header, .join-card') ?? []).map((element) => element.getBoundingClientRect())
        let position: { x: number; y: number } | undefined
        if (bounds && bounds.width > size && bounds.height > size) {
          // Reserve the full pop-up/dissolve area until the coin is removed.
          // Store coordinates relative to the layer so scrolling cannot invalidate them.
          const reservedAreas = [...occupiedAreas.values()].map(area => ({ left: bounds.left + area.left, top: bounds.top + area.top, right: bounds.left + area.right, bottom: bounds.top + area.bottom }))
          const blockedAreas = [...protectedAreas, ...reservedAreas]
          for (let attempt = 0; attempt < 80; attempt++) {
            const x = Math.random() * (bounds.width - size)
            const y = Math.random() * (bounds.height - size)
            // Reserve space for the spinning coin and its falling fragments.
            const left = bounds.left + x - 80
            const top = bounds.top + y - 32
            const right = bounds.left + x + size + 80
            const bottom = bounds.top + y + size + 250
            if (blockedAreas.every((area) => right < area.left || left > area.right || bottom < area.top || top > area.bottom)) {
              position = { x: x / bounds.width * 100, y: y / bounds.height * 100 }
              occupiedAreas.set(id, { left: x - 80, top: y - 32, right: x + size + 80, bottom: y + size + 250 })
              break
            }
          }
        }
        if (!position) {
          spawnTimer = later(spawn, 900 + Math.random() * 500)
          return
        }
        nextId.current = id
        const pixels: Pixel[] = []
        for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
          if (Math.hypot(col - 3.5, row - 3.5) > 3.9) continue
          pixels.push({ x: col * 12.5, y: row * 12.5, dx: (Math.random() - .5) * 135, dy: 90 + Math.random() * 150, rotation: (Math.random() - .5) * 300, delay: Math.random() * 140 })
        }
        const coin: Coin = { id, kind: id === 1 ? 'btc' : kinds[Math.floor(Math.random() * kinds.length)], ...position, size, tilt: -22 + Math.random() * 44, pixels }
        setCoins((current) => [...current.slice(-7), coin])
        later(() => {
          occupiedAreas.delete(id)
          setCoins((current) => current.filter((item) => item.id !== id))
        }, 5200)
      }
      spawnTimer = later(spawn, 900 + Math.random() * 500)
    }
    const motionChanged = () => {
      if (spawnTimer) { window.clearTimeout(spawnTimer); timers.delete(spawnTimer) }
      if (reduced.matches) { occupiedAreas.clear(); setCoins([]) }
      else spawnTimer = later(spawn, 500)
    }
    if (!reduced.matches) spawnTimer = later(spawn, 500)
    const clearCoins = () => { occupiedAreas.clear(); setCoins([]) }
    window.addEventListener('resize', clearCoins)
    reduced.addEventListener('change', motionChanged)
    return () => { window.removeEventListener('resize', clearCoins); stopped = true; occupiedAreas.clear(); timers.forEach((timer) => window.clearTimeout(timer)); reduced.removeEventListener('change', motionChanged) }
  }, [])
  return <div ref={layerRef} className="join-coin-rain" aria-hidden="true">{coins.map((coin) => <div key={coin.id} className="join-floating-coin" style={{ left: `${coin.x}%`, top: `${coin.y}%`, '--coin-size': `${coin.size}px`, '--coin-tilt': `${coin.tilt}deg` } as CSSProperties}>
    <div className="join-floating-coin-body"><span className="join-floating-coin-edge" /><span className="join-floating-coin-face"><CoinMark kind={coin.kind} /><span className="join-coin-specular" /></span></div>
    <div className="join-coin-fragments">{coin.pixels.map((pixel, index) => <i key={index} style={{ left: `${pixel.x}%`, top: `${pixel.y}%`, '--fragment-x': `${pixel.dx}px`, '--fragment-y': `${pixel.dy}px`, '--fragment-rotation': `${pixel.rotation}deg`, '--fragment-delay': `${pixel.delay}ms` } as CSSProperties} />)}</div>
  </div>)}</div>
}
