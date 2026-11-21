import { estimateSwapUsd, type SwapQuote } from '../lib/swap-valuation'
import TokenLogo from './TokenLogo'
import { useEffect, useRef, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, Pause, Play, Radio } from 'lucide-react'
import { dexChains, dexProtocols, type DexSwap } from '../lib/dex-intell'
import { swapQuantity, swapToken } from '../lib/swap-presentation'
import './SwapHologram.css'

type VisualEvent = { swap: DexSwap; kind: 'Recorded swap' | 'Newly indexed swap' }
const identity = (s: DexSwap) => `${s.chain}:${s.tx_hash}:${s.log_index}`
export default function SwapHologram({
  swaps,
  chain,
  historical,
  loading,
  error,
  quotes = {},
}: {
  quotes?: Record<string, SwapQuote>
  swaps: DexSwap[]
  chain: string
  historical: boolean
  loading: boolean
  error: boolean
}) {
  const [current, setCurrent] = useState<VisualEvent | null>(null),
    [paused, setPaused] = useState(false),
    [queued, setQueued] = useState(0)
  const queue = useRef<VisualEvent[]>([]),
    seen = useRef(new Set<string>()),
    started = useRef(false)
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const show = (event: VisualEvent) => {
    setCurrent(event)
  }
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'),
      update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!swaps.length) return
    const fresh = swaps.filter((s) => !seen.current.has(identity(s)))
    swaps.forEach((s) => seen.current.add(identity(s)))
    if (seen.current.size > 1500) seen.current = new Set([...seen.current].slice(-1000))
    if (!started.current) {
      started.current = true
      const events: VisualEvent[] = fresh
        .slice(0, 8)
        .map((swap) => ({ swap, kind: 'Recorded swap' }))
      if (events.length) {
        show(events[0])
        queue.current = events.slice(1)
      }
    } else if (fresh.length) {
      const events: VisualEvent[] = fresh
        .slice(0, 16)
        .reverse()
        .map((swap) => ({ swap, kind: historical ? 'Recorded swap' : 'Newly indexed swap' }))
      if (reduced) {
        show(events.at(-1)!)
        queue.current = []
      } else
        queue.current = [
          ...events,
          ...queue.current.filter((e) => e.kind === 'Newly indexed swap'),
        ].slice(0, 30)
    }
    setQueued(queue.current.length)
  }, [swaps, historical, reduced])
  useEffect(() => {
    if (paused || reduced) return
    const timer = window.setInterval(() => {
      const next = queue.current.shift()
      if (next) show(next)
      setQueued(queue.current.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [paused, reduced])
  const active = current?.swap,
    input = active ? swapToken(active.chain, active.token_in) : null,
    output = active ? swapToken(active.chain, active.token_out) : null
  const sent = active && input ? swapQuantity(active.amount_in, input.decimals) : null,
    received = active && output ? swapQuantity(active.amount_out, output.decimals) : null
  const currentValue = active ? estimateSwapUsd(active, quotes) : null
  const storedUsd =
    active?.usd_value != null &&
    /^\d+(\.\d+)?$/.test(active.usd_value) &&
    Number.isFinite(Number(active.usd_value))
      ? Number(active.usd_value)
      : null
  const dollars = storedUsd ?? currentValue?.value ?? null
  const chainName = dexChains.find((c) => c.key === chain)?.name ?? chain
  const dex = active
    ? dexProtocols.find((p) => p.id === active.protocol)?.label.split(' · ')[0] ?? active.protocol
    : 'Awaiting indexed activity'
  const replay = () => {
    if (swaps[0]) {
      show({ swap: swaps[0], kind: 'Recorded swap' })
      queue.current = swaps.slice(1, 8).map((swap) => ({ swap, kind: 'Recorded swap' }))
      setQueued(queue.current.length)
    }
  }
  return (
    <section
      className={`swap-hologram ${paused || reduced ? 'holo-paused' : ''} ${
        active ? 'holo-active' : 'holo-idle'
      }`}
      aria-label='Animated DEX swap visualization'
    >
      <div className='holo-topline'>
        <div>
          <Radio size={13} />
          <span>SWAP SONAR</span>
          <i />
          <span className='holo-network'>{chainName.toUpperCase()}</span>
        </div>
        <div className='holo-controls'>
          <span>
            {error
              ? 'Feed delayed · saved activity'
              : active
              ? current?.kind
              : loading
              ? 'Connecting to history'
              : error
              ? 'Feed unavailable'
              : 'Waiting for swaps'}
          </span>
          <button
            type='button'
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? 'Resume swap animation' : 'Pause swap animation'}
            title={reduced ? 'System reduced-motion preference is respected' : undefined}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </div>
      </div>
      <div className='holo-scene'>
        <div className='holo-grid' aria-hidden='true' />
        <div className='holo-horizon' aria-hidden='true' />
        <svg
          className='holo-circuits'
          viewBox='0 0 1000 300'
          preserveAspectRatio='none'
          aria-hidden='true'
        >
          <g fill='none' stroke='currentColor'>
            <path d='M0 210h90l48-48h140l55 55h106m561-7h-90l-48-48H722l-55 55H561' />
            <path d='M0 235h120l48-48h100l55 55h116m561-7H880l-48-48H732l-55 55H561' />
            <path d='M0 90h155l32 32h96l64 64h92M1000 90H845l-32 32h-96l-64 64h-92' />
          </g>
        </svg>
        <article className='holo-leg holo-leg-in' key={`in:${active ? identity(active) : 'empty'}`}>
          <div className='holo-leg-caption'>
            <span>01 / INPUT</span>
            <span>SENT</span>
          </div>
          <div className='holo-asset'>
            <div className='holo-logo-disc'>
              <TokenLogo mark={input?.mark ?? 'unknown'} />
            </div>
            <div>
              <strong>{input?.symbol ?? '—'}</strong>
              <small>{input?.name ?? 'Input token'}</small>
            </div>
          </div>
          <div
            className='holo-quantity'
            title={sent ? `${sent.exact} ${input?.symbol}` : undefined}
          >
            {sent?.display ?? '—'}
          </div>
          <span className='holo-quantity-unit'>
            {sent?.raw
              ? 'RAW TOKEN UNITS'
              : input
              ? `${input.symbol} SWAPPED`
              : 'AWAITING AN EXECUTED SWAP'}
          </span>
          <div className='holo-mini-bars' aria-hidden='true'>
            {Array.from({ length: 22 }, (_, i) => (
              <i
                key={i}
                style={{ height: `${18 + ((i * 17) % 39)}%`, animationDelay: `${i * -0.13}s` }}
              />
            ))}
          </div>
        </article>
        <div className='holo-center' aria-hidden='true'>
          <div className='holo-radar'>
            <div className='holo-radar-sweep' />
            <div className='holo-radar-inner' />
            <div className='holo-crosshair' />
          </div>
          <div className='holo-beam' />
          <div className='holo-coin-space'>
            <div className='holo-coin' key={active ? identity(active) : 'idle'}>
              <div className='holo-coin-face holo-face-front'>
                <TokenLogo mark={output?.mark ?? 'ethereum'} />
              </div>
              <div className='holo-coin-face holo-face-back'>
                <TokenLogo mark={input?.mark ?? 'ethereum'} />
              </div>
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  className='holo-coin-edge'
                  key={i}
                  style={{ transform: `translateZ(${i * 2 - 7}px)` }}
                />
              ))}
            </div>
          </div>
          <div className='holo-platform'>
            <i />
            <i />
            <i />
          </div>
          <div className='holo-swap-label'>
            <ArrowDownUp size={15} />
            <span>
              {dollars !== null
                ? new Intl.NumberFormat(undefined, {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 2,
                  }).format(dollars)
                : 'USD unavailable'}
            </span>
          </div>
          <span className='holo-particle holo-particle-one' />
          <span className='holo-particle holo-particle-two' />
        </div>
        <article
          className='holo-leg holo-leg-out'
          key={`out:${active ? identity(active) : 'empty'}`}
        >
          <div className='holo-leg-caption'>
            <span>02 / OUTPUT</span>
            <span>RECEIVED</span>
          </div>
          <div className='holo-asset'>
            <div className='holo-logo-disc'>
              <TokenLogo mark={output?.mark ?? 'unknown'} />
            </div>
            <div>
              <strong>{output?.symbol ?? '—'}</strong>
              <small>{output?.name ?? 'Output token'}</small>
            </div>
          </div>
          <div
            className='holo-quantity'
            title={received ? `${received.exact} ${output?.symbol}` : undefined}
          >
            {received?.display ?? '—'}
          </div>
          <span className='holo-quantity-unit'>
            {received?.raw
              ? 'RAW TOKEN UNITS'
              : output
              ? `${output.symbol} RECEIVED`
              : 'AMOUNTS APPEAR WITH REAL DATA'}
          </span>
          <div className='holo-settlement'>
            <span />
            <span>{active ? active.finality.toUpperCase() : 'AWAITING DATA'}</span>
            <span>{active ? `BLOCK / SLOT ${active.block_number}` : '—'}</span>
          </div>
        </article>
      </div>
      <div className='holo-usd-readout'>
        <span>{storedUsd !== null ? 'RECORDED USD VALUE' : 'CURRENT-VALUE ESTIMATE · USD'}</span>
        <strong>
          {dollars !== null
            ? new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 2,
              }).format(dollars)
            : active
            ? 'USD unavailable'
            : '—'}
        </strong>
        <small>
          {storedUsd !== null
            ? 'Recorded with this swap'
            : currentValue
            ? `${currentValue.source ? `${currentValue.source} · ` : ''}Quote ${new Date(
                currentValue.priceAt
              ).toLocaleString()} · not historical execution value`
            : 'Requires known token decimals and an available price quote'}
        </small>
      </div>
      <div className='holo-bottomline'>
        <div>
          <span className='holo-status-dot' />
          <strong>{dex}</strong>
          <span className='holo-event-time'>
            {active ? new Date(active.at).toLocaleString() : 'No matching indexed swaps yet'}
          </span>
        </div>
        <div>
          {active && (
            <a
              href={`${dexChains.find((c) => c.key === active.chain)?.explorer}/tx/${
                active.tx_hash
              }`}
              target='_blank'
              rel='noreferrer'
            >
              View transaction <ArrowUpRight size={12} />
            </a>
          )}
          <button type='button' onClick={replay} disabled={!swaps.length}>
            Replay latest{queued ? ` · ${queued} queued` : ''}
          </button>
        </div>
      </div>
    </section>
  )
}
