import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useCursorEffects } from '../lib/cursor-effects'

export default function ClickPixels() {
  const enabled = useCursorEffects()
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([])
  const [trail, setTrail] = useState<Array<{ id: number; x: number; y: number }>>([])
  const [target, setTarget] = useState<Element | null>(null)
  const nextId = useRef(0)
  const ringRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    setBursts([])
    setTrail([])
    const timers = new Set<number>()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let ringFrame = 0
    let idleTimer: number | undefined
    let cursorX = 0, cursorY = 0
    const hideRing = () => {
      window.clearTimeout(idleTimer)
      cancelAnimationFrame(ringFrame)
      ringFrame = 0
      if (ringRef.current) { ringRef.current.style.opacity = '0'; ringRef.current.dataset.moving = 'false' }
    }
    const moveRing = (event: PointerEvent) => {
      cursorX = event.clientX; cursorY = event.clientY
      if (!ringFrame) ringFrame = requestAnimationFrame(() => {
        ringFrame = 0
        const ring = ringRef.current
        if (ring) { ring.style.transform = `translate3d(${cursorX - 22}px, ${cursorY - 22}px, 0)`; ring.style.opacity = '1'; ring.dataset.moving = 'true' }
      })
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => { if (ringRef.current) ringRef.current.dataset.moving = 'false' }, 140)
    }
    let lastHover = 0
    let lastX = -100, lastY = -100
    const syncTarget = () => setTarget(document.fullscreenElement ?? document.body)
    const drop = (event: PointerEvent) => {
      if (event.button !== 0 || reducedMotion.matches) return
      if (event.target instanceof Element && event.target.closest('.overview-sonar[data-paused="true"]')) return
      const id = ++nextId.current
      setBursts((current) => [...current.slice(-3), { id, x: event.clientX, y: event.clientY }])
      const timer = window.setTimeout(() => {
        setBursts((current) => current.filter((burst) => burst.id !== id))
        timers.delete(timer)
      }, 1300)
      timers.add(timer)
    }
    const hover = (event: PointerEvent) => {
      if (!enabled) return
      if (event.pointerType === 'touch' || reducedMotion.matches) { hideRing(); return }
      if (event.target instanceof Element && event.target.closest('.overview-sonar[data-paused="true"]')) { hideRing(); return }
      moveRing(event)
      const now = performance.now()
      if (now - lastHover < 45 || Math.hypot(event.clientX - lastX, event.clientY - lastY) < 5) return
      lastHover = now; lastX = event.clientX; lastY = event.clientY
      const pixels = Array.from({ length: 5 }, (_, index) => ({
        id: ++nextId.current,
        x: event.clientX + (index - 2) * 5,
        y: event.clientY + (index % 2 ? -5 : 5),
      }))
      const ids = new Set(pixels.map((pixel) => pixel.id))
      setTrail((current) => [...current.slice(-175), ...pixels])
      const timer = window.setTimeout(() => {
        setTrail((current) => current.filter((pixel) => !ids.has(pixel.id)))
        timers.delete(timer)
      }, 1650)
      timers.add(timer)
    }
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) { setTrail([]); hideRing() } }
    syncTarget()
    document.addEventListener('pointerdown', drop, { capture: true, passive: true })
    document.addEventListener('fullscreenchange', syncTarget)
    document.addEventListener('pointermove', hover, { capture: true, passive: true })
    document.addEventListener('pointerout', leave, { passive: true })
    window.addEventListener('blur', hideRing)
    return () => {
      document.removeEventListener('pointerdown', drop, true)
      document.removeEventListener('fullscreenchange', syncTarget)
      document.removeEventListener('pointermove', hover, true)
      document.removeEventListener('pointerout', leave)
      window.removeEventListener('blur', hideRing)
      hideRing()
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [enabled])

  return target ? createPortal(<div className="app-click-pixels" aria-hidden="true">{enabled && <span ref={ringRef} className="app-sonar-cursor" data-moving="false"><i className="app-sonar-cursor-sweep" /><i className="app-sonar-cursor-inner" /></span>}{enabled && trail.map((pixel) => <span key={pixel.id} className="app-hover-pixel" style={{ left: pixel.x, top: pixel.y, '--hover-drift': `${pixel.id % 2 ? 8 : -8}px`, '--hover-size': `${5 + pixel.id % 4 * 2}px` } as CSSProperties} />)}{bursts.map((burst) => <span key={burst.id} className="app-pixel-burst" style={{ left: burst.x, top: burst.y }}>{Array.from({ length: 20 }, (_, index) => <i key={index} style={{ '--fall-x': `${(index - 9.5) * 9}px`, '--fall-y': `${110 + index % 5 * 22}px`, '--fall-rotation': `${(index % 2 ? 1 : -1) * (45 + index * 13)}deg`, '--fall-delay': `${index % 4 * 30}ms`, '--fall-size': `${5 + index % 4 * 2}px` } as CSSProperties} />)}</span>)}</div>, target) : null
}
