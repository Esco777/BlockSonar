import { LiquidationBlockAlerts, type LiquidationBlockAlert } from '../lib/liquidation-alerts'
import { groupLiquidationEvents } from '../lib/liquidation-feeds'
import type { Candle, LiquidationEvent } from '../lib/liquidity-types'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Bell, ArrowUpRight, Droplets, Radar, Activity, X } from 'lucide-react'
import {
  topSonarNotifications,
  notificationRevision,
  updateNotificationOrder,
  orderedNotificationSections,
  type NotificationOrderState,
  type NotificationSection,
  type NotificationFeed,
} from '../lib/notifications'
import type { SonarAsset } from '../lib/sonar-research'
import { DISCOVER_NETWORKS } from '../lib/discover-markets'
import { formatCurrency } from './market-data'
import './Notifications.css'
type Props = {
  liquidations: LiquidationEvent[]
  candles: Candle[]
  liquidationTimeframeSeconds: number
  onOpenLiquidations: () => void
  coins: SonarAsset[]
  dataSource: 'sample' | 'live'
  updatedAt: number | null
  marketError: boolean
  onNavigate: (page: string) => void
  onOpenAsset: (id: string) => void
}
const seenKey = 'blocksonar-notifications-seen-v1'
function readSeen() {
  try {
    return localStorage.getItem(seenKey) ?? ''
  } catch {
    return ''
  }
}
export default function Notifications({
  liquidations,
  candles,
  liquidationTimeframeSeconds,
  onOpenLiquidations,
  coins,
  dataSource,
  updatedAt,
  marketError,
  onNavigate,
  onOpenAsset,
}: Props) {
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState<NotificationFeed | null>(null),
    [error, setError] = useState('')
  const [seen, setSeen] = useState(readSeen)
  const [liquidationAlerts, setLiquidationAlerts] = useState<LiquidationBlockAlert[]>([])
  const liquidationCounter = useRef<LiquidationBlockAlerts | null>(null)
  if (liquidationCounter.current === null) liquidationCounter.current = new LiquidationBlockAlerts()
  const liquidationBlocks = useMemo(
    () => groupLiquidationEvents(liquidations, candles, liquidationTimeframeSeconds),
    [liquidations, candles, liquidationTimeframeSeconds]
  )
  useEffect(() => {
    if (!candles.length) return
    const next = liquidationCounter.current!.update(liquidationBlocks, liquidationTimeframeSeconds)
    setLiquidationAlerts((current) => (current[0]?.id === next[0]?.id ? current : next))
  }, [liquidationBlocks, liquidationTimeframeSeconds, candles.length])
  const [burst, setBurst] = useState(0)
  const burstSequence = useRef(0)
  const previousRevision = useRef(seen)
  const playAlertFeedback = useCallback(() => setBurst(++burstSequence.current), [])
  const wrapper = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null)
  const leaders = useMemo(
    () => topSonarNotifications(coins, dataSource === 'live'),
    [coins, dataSource]
  )
  const contentRevision = notificationRevision(leaders, feed)
  const revision = liquidationAlerts.length
    ? `${contentRevision}|${liquidationAlerts[0].id}`
    : contentRevision
  const unread = !!revision && revision !== seen
  const [sectionOrder, setSectionOrder] = useState<NotificationOrderState>({})
  const sectionSignals = useMemo(
    () => [
      {
        section: 'sonar' as const,
        revision: leaders.length
          ? JSON.stringify(leaders.map((coin) => [coin.id, coin.price, coin.change]))
          : null,
        sourceAt: updatedAt,
      },
      {
        section: 'pools' as const,
        revision: feed?.pools.length ? JSON.stringify(feed.pools.map((pool) => pool.id)) : null,
        sourceAt: feed?.pools.length ? Math.max(...feed.pools.map((pool) => pool.createdAt)) : null,
      },
      {
        section: 'narratives' as const,
        revision: feed?.narratives.revision ?? null,
        sourceAt: feed?.narratives.updatedAt ?? null,
      },
      {
        section: 'liquidations' as const,
        revision: liquidationAlerts[0]?.id ?? null,
        sourceAt: liquidationAlerts[0]?.createdAt ?? null,
      },
    ],
    [leaders, feed, updatedAt, liquidationAlerts]
  )
  useEffect(() => {
    setSectionOrder((previous) => updateNotificationOrder(previous, sectionSignals))
  }, [sectionSignals])
  useEffect(() => {
    if (!revision || revision === previousRevision.current) return
    previousRevision.current = revision
    playAlertFeedback()
  }, [revision, playAlertFeedback])
  useEffect(() => {
    if (!burst) return
    const timer = window.setTimeout(() => setBurst(0), 3000)
    return () => window.clearTimeout(timer)
  }, [burst])
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const response = await fetch('/api/notifications', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        })
        if (!response.ok) throw new Error('Pool and narrative updates are temporarily unavailable.')
        const data = (await response.json()) as NotificationFeed
        if (!Array.isArray(data.pools) || !data.narratives)
          throw new Error('Notification feed unavailable.')
        if (!controller.signal.aborted) {
          setFeed(data)
          setError('')
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Notification feed unavailable.')
      } finally {
        busy = false
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 60000)
    const visible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    const frame = window.requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    )
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.cancelAnimationFrame(frame)
    }
  }, [open])
  useEffect(() => {
    if (!open || !revision) return
    setSeen(revision)
    try {
      localStorage.setItem(seenKey, revision)
    } catch {
      /* Read state still works for this session. */
    }
  }, [open, revision])
  const navigate = (page: string) => {
    onNavigate(page)
    setOpen(false)
  }
  const marketDelayed = marketError || !updatedAt || Date.now() - updatedAt > 240000
  const sections: Record<NotificationSection, ReactNode> = {
    liquidations: !!liquidationAlerts.length && (
      <section
        className='notification-section notification-liquidations'
        aria-labelledby='notification-liquidations-title'
      >
        <div className='notification-section-title'>
          <h3 id='notification-liquidations-title'>
            <Activity size={14} />
            Liquidation blocks
          </h3>
        </div>
        {liquidationAlerts.map((alert) => (
          <a
            key={alert.id}
            className='notification-narrative-link'
            href='#/liquidity'
            onClick={() => {
              onOpenLiquidations()
              setOpen(false)
            }}
          >
            <span>
              <strong>{alert.message}</strong>
              <small>
                3 new BTC liquidation blocks · {new Date(alert.createdAt).toLocaleTimeString()}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </a>
        ))}
      </section>
    ),
    sonar: (
      <section className='notification-section' aria-labelledby='notification-sonar-title'>
        <div className='notification-section-title'>
          <h3 id='notification-sonar-title'>
            <Radar size={14} />
            Top Sonar coins
          </h3>
          <a href='#/sonar' onClick={() => navigate('Sonar')}>
            View Sonar <ArrowUpRight size={12} />
          </a>
        </div>
        {leaders.map((coin, index) => (
          <button
            type='button'
            className='notification-item'
            key={coin.id}
            onClick={() => {
              onOpenAsset(coin.id)
              setOpen(false)
            }}
          >
            <span className='notification-rank'>{index + 1}</span>
            {coin.image && (
              <img
                src={coin.image}
                alt=''
                loading='lazy'
                onError={(event) => {
                  event.currentTarget.style.display = 'none'
                }}
              />
            )}
            <span className='notification-item-copy'>
              <strong>{coin.symbol.toUpperCase()}</strong>
              <small>{coin.name}</small>
            </span>
            <span className='notification-item-value'>
              <strong>{formatCurrency(coin.price)}</strong>
              <small className={coin.change >= 0 ? 'positive' : 'negative'}>
                {coin.change >= 0 ? '+' : ''}
                {coin.change.toFixed(2)}% · 24h
              </small>
            </span>
          </button>
        ))}
        {!leaders.length && <p className='notification-empty'>Waiting for live Sonar coins…</p>}
        {!!leaders.length && (
          <p className='notification-feed-time'>
            {marketDelayed ? 'Last market data' : 'Market updated'}{' '}
            {updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'at an unknown time'}
          </p>
        )}
      </section>
    ),
    pools: (
      <section className='notification-section' aria-labelledby='notification-pools-title'>
        <div className='notification-section-title'>
          <h3 id='notification-pools-title'>
            <Droplets size={14} />
            Newest liquidity pools
          </h3>
          <a href='#/discover' onClick={() => navigate('Discover')}>
            View pools <ArrowUpRight size={12} />
          </a>
        </div>
        {!!feed?.pools.length && (
          <a
            className='notification-narrative-link notification-pool-alert'
            href='#/discover'
            onClick={() => navigate('Discover')}
          >
            <span>
              <strong>
                {feed.pools.length >= 2
                  ? 'Check out the 2 newest liquidity pools!'
                  : 'Check out this new liquidity pool!'}
              </strong>
              <small>
                {feed.pools
                  .slice(0, 2)
                  .map((pool) => pool.name)
                  .join(' · ')}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </a>
        )}
        {feed?.pools.map((pool, index) => (
          <a
            className='notification-item'
            key={pool.id}
            href={`https://www.geckoterminal.com/${pool.network}/pools/${encodeURIComponent(
              pool.address
            )}`}
            target='_blank'
            rel='noreferrer'
            onClick={() => setOpen(false)}
          >
            <span className='notification-rank'>{index + 1}</span>
            <span className='notification-pool-icon'>
              <Droplets size={15} />
            </span>
            <span className='notification-item-copy'>
              <strong>{pool.name}</strong>
              <small>
                {DISCOVER_NETWORKS.find((chain) => chain.id === pool.network)?.name ?? pool.network}{' '}
                · {new Date(pool.createdAt).toLocaleTimeString()}
              </small>
            </span>
            <ArrowUpRight size={14} />
          </a>
        ))}
        {!feed?.pools.length && (
          <p className='notification-empty'>
            {feed ? 'No pools returned by the discovery feeds.' : 'Checking new liquidity pools…'}
          </p>
        )}
        {feed?.poolsDelayed && (
          <p className='notification-feed-time'>
            Some pool feeds are delayed; showing available discoveries.
          </p>
        )}
      </section>
    ),
    narratives: (
      <section className='notification-section notification-narrative'>
        <div className='notification-section-title'>
          <h3>
            <Radar size={14} />
            Early Narrative Radar
          </h3>
        </div>
        {feed?.narratives.count && feed.narratives.updatedAt ? (
          <a
            className='notification-narrative-link'
            href='#/narratives'
            onClick={() => navigate('Early Narrative Radar')}
          >
            <span>
              <strong>Check out new narratives!</strong>
              <small>
                {feed.narratives.count} themes · updated{' '}
                {new Date(feed.narratives.updatedAt).toLocaleTimeString()}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </a>
        ) : (
          <p className='notification-empty'>Listening for narrative updates…</p>
        )}
      </section>
    ),
  }
  return (
    <div
      className={`blocksonar-notifications${burst ? ' notification-update-burst' : ''}`}
      ref={wrapper}
    >
      <button
        ref={trigger}
        type='button'
        className='icon-button notification-button'
        aria-label={unread ? 'Notifications, new updates' : 'Notifications'}
        aria-expanded={open}
        aria-controls='blocksonar-notification-panel'
        aria-haspopup='dialog'
        onClick={() => setOpen((value) => !value)}
      >
        <span
          key={burst}
          className={`notification-bell-motion${burst ? ' notification-bell-alert' : ''}`}
        >
          <Bell className='notification-bell-icon' size={18} />
        </span>
        {unread && <i aria-hidden='true' />}
      </button>
      {!!burst && (
        <span key={burst} className='notification-pixel-rain' aria-hidden='true'>
          {Array.from({ length: 14 }, (_, index) => (
            <span
              key={index}
              style={
                {
                  '--pixel-x': `${((index % 7) - 3) * 4}px`,
                  '--pixel-drift': `${((index * 17) % 53) - 26}px`,
                  '--pixel-delay': `${index * 25}ms`,
                  '--pixel-duration': `${760 + (index % 4) * 110}ms`,
                  '--pixel-drop': `${48 + (index % 5) * 11}px`,
                  '--pixel-size': `${index % 3 === 0 ? 5 : 3}px`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
      {open && (
        <div
          id='blocksonar-notification-panel'
          className='notification-dropdown'
          ref={panel}
          role='dialog'
          aria-labelledby='notification-heading'
        >
          <header className='notification-heading'>
            <div>
              <span>YOUR MARKET PULSE</span>
              <h2 id='notification-heading'>Notifications</h2>
            </div>
            <button
              type='button'
              aria-label='Close notifications'
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              <X size={16} />
            </button>
          </header>
          {orderedNotificationSections(sectionOrder).map((section) => (
            <Fragment key={section}>{sections[section]}</Fragment>
          ))}
          <footer className='notification-footer'>
            {error ? (
              <span role='status'>{error}</span>
            ) : (
              <span>
                <span className='notification-live-dot' /> Updates automatically while you’re here
              </span>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
