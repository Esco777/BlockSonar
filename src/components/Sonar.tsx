import { useEffect, useMemo, useState } from 'react'
import { Radar, Activity, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react'
import {
  analyzeAssets,
  compareSonarSignals,
  DEFAULT_SIGNAL_RULES,
  createBaseline,
  median,
  researchDay,
  type DailyBaseline,
  type SonarAsset,
} from '../lib/sonar-research'
import { SONAR_ASSET_LIMIT } from '../lib/market-universe'
import { formatCompact, formatCurrency } from './market-data'
import SonarDefi from './SonarDefi'

type Props = {
  errorMessage?: string | null
  apiMode?: string
  cachedStale: boolean
  coins: SonarAsset[]
  dataSource: 'sample' | 'live'
  updatedAt: number | null
  error: boolean
  loading: boolean
  loadedCount: number
  onOpenAsset: (id: string) => void
}
const STORAGE_KEY = 'blocksonar-sonar-daily-v1'
function readBaselines(): DailyBaseline[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(data)) return []
    return data
      .filter(
        (item): item is DailyBaseline =>
          item &&
          typeof item.day === 'string' &&
          Number.isFinite(item.observedAt) &&
          typeof item.leaderId === 'string' &&
          item.ranks &&
          typeof item.ranks === 'object' &&
          Object.values(item.ranks).every((rank) => Number.isInteger(rank) && Number(rank) > 0)
      )
      .slice(-8)
  } catch {
    return []
  }
}
const percent = (value: number | null) =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

export default function Sonar({
  cachedStale,
  errorMessage,
  apiMode,
  coins,
  dataSource,
  updatedAt,
  error,
  loading,
  loadedCount,
  onOpenAsset,
}: Props) {
  const [momentum, setMomentum] = useState(DEFAULT_SIGNAL_RULES.momentum)
  const [zScore, setZScore] = useState(DEFAULT_SIGNAL_RULES.zScore)
  const [turnover, setTurnover] = useState(DEFAULT_SIGNAL_RULES.turnover)
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [filter, setFilter] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [baselines, setBaselines] = useState(readBaselines)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const rows = useMemo(
    () => analyzeAssets(coins, { momentum, zScore, turnover }),
    [coins, momentum, zScore, turnover]
  )
  const day = researchDay(now)
  const baseline = baselines.find((item) => item.day === day)
  useEffect(() => {
    if (
      dataSource !== 'live' ||
      error ||
      cachedStale ||
      loading ||
      !updatedAt ||
      researchDay(updatedAt) !== day ||
      !coins.length ||
      baseline
    )
      return
    const next = [
      ...baselines.filter((item) => item.day !== day),
      createBaseline(coins, updatedAt),
    ].slice(-8)
    setBaselines(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* Tracking remains available for this session. */
    }
  }, [coins, dataSource, updatedAt, day, baseline, baselines, error, cachedStale, loading])
  const stale = dataSource === 'live' && (cachedStale || !updatedAt || now - updatedAt > 240000)
  const sourceLabel =
    dataSource === 'sample'
      ? 'SAMPLE DATA'
      : error && rows.length < SONAR_ASSET_LIMIT
      ? 'PARTIAL DATA'
      : error || stale
      ? 'STALE DATA'
      : 'LIVE DATA'
  const leader = rows[0]
  const leaderChanged =
    dataSource === 'live' && baseline && leader && baseline.leaderId !== leader.id
  const breadth = rows.length
    ? (rows.filter((coin) => coin.change > 0).length / rows.length) * 100
    : 0
  const stack = [...rows]
    .filter(
      (coin) =>
        (!flaggedOnly || coin.score > 0) &&
        `${coin.name} ${coin.symbol}`.toLowerCase().includes(filter.toLowerCase())
    )
    .sort(compareSonarSignals)
  const totalPages = Math.max(1, Math.ceil(stack.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const offset = (currentPage - 1) * pageSize
  const visibleRows = stack.slice(offset, offset + pageSize)
  useEffect(() => {
    setPage(1)
  }, [filter, flaggedOnly, momentum, zScore, turnover])
  const flags =
    dataSource === 'live' && baseline
      ? rows
          .flatMap((coin) => {
            const previous = baseline.ranks[coin.id]
            const delta = previous ? previous - coin.rank : null
            return delta === null || delta !== 0 ? [{ coin, delta }] : []
          })
          .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
      : []

  return (
    <div className='sonar-page'>
      <div className='sonar-page-notice' role='note'>
        Please wait for the page to update. Thank you for your patience.
      </div>
      <header className='sonar-header'>
        <div>
          <div className='section-kicker'>
            <Radar size={15} /> SONAR RESEARCH DESK
          </div>
          <h1>Signals beneath the surface.</h1>
          <p>
            Automated observations across {rows.length.toLocaleString()} /{' '}
            {SONAR_ASSET_LIMIT.toLocaleString()} tracked assets.
          </p>
        </div>
        <div className='sonar-source'>
          <span className={dataSource === 'live' && !error && !stale ? 'positive' : ''}>
            ● {sourceLabel}
          </span>
          <small>
            {updatedAt
              ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
              : 'Waiting for live market data'}{' '}
            · CoinGecko{' '}
            {apiMode === 'demo'
              ? 'Demo key configured'
              : apiMode === 'pro'
              ? 'Pro key configured'
              : apiMode === 'public'
              ? 'public API'
              : ''}{' '}
            · checks every {error ? 120 : 60}s
          </small>
        </div>
      </header>
      {loading && (
        <p className='sonar-load-status' role='status'>
          Loading market universe: {loadedCount.toLocaleString()} /{' '}
          {SONAR_ASSET_LIMIT.toLocaleString()} eligible assets. CoinGecko requests are shared and
          paced by the server.
        </p>
      )}
      {error && (
        <p className='sonar-load-status' role='status'>
          {errorMessage || 'Market scan incomplete.'} Showing {rows.length.toLocaleString()}{' '}
          {dataSource === 'sample'
            ? 'sample assets'
            : rows.length === SONAR_ASSET_LIMIT
            ? 'assets from the last complete scan'
            : 'available assets'}
          . Automatic retry is scheduled. Daily baselines wait for a complete scan.
        </p>
      )}
      <SonarDefi />
      <section aria-label='Daily pulse' className='sonar-pulse'>
        <article>
          <span>DAILY PULSE · LOS ANGELES</span>
          <strong>{day}</strong>
          <small>Rolling 24-hour market observations</small>
        </article>
        <article>
          <span>ADVANCING ASSETS</span>
          <strong>{breadth.toFixed(0)}%</strong>
          <small>
            {rows.filter((coin) => coin.change > 0).length} of {rows.length} above zero
          </small>
        </article>
        <article>
          <span>MEDIAN 24H MOVE</span>
          <strong>{percent(median(rows.map((coin) => coin.change)))}</strong>
          <small>Equal-weight tracked universe</small>
        </article>
        <article>
          <span>24H PERFORMANCE LEADER</span>
          <strong>
            {leader?.symbol ?? '—'} {leaderChanged && <em>LEAD CHANGE</em>}
          </strong>
          <small>
            {leader ? percent(leader.change) : 'No data'}{' '}
            {baseline && dataSource === 'live'
              ? '· vs first daily observation'
              : '· baseline pending'}
          </small>
        </article>
      </section>
      <section className='sonar-section' aria-label='Automated signal stack'>
        <div className='sonar-section-title'>
          <div>
            <div className='section-kicker'>
              <Activity size={14} /> AUTOMATED SIGNAL STACK
            </div>
            <h2>Evidence to investigate</h2>
          </div>
          <span>{rows.filter((coin) => coin.score > 0).length} assets flagged</span>
        </div>
        <div className='sonar-controls'>
          <label>
            24h move ≥ %
            <input
              type='number'
              min='0.1'
              step='0.5'
              value={momentum}
              onChange={(e) => setMomentum(Math.max(0.1, Number(e.target.value) || 0.1))}
            />
          </label>
          <label>
            |Z-score| ≥
            <input
              type='number'
              min='0.1'
              step='0.1'
              value={zScore}
              onChange={(e) => setZScore(Math.max(0.1, Number(e.target.value) || 0.1))}
            />
          </label>
          <label>
            Turnover ≥ %
            <input
              type='number'
              min='0.1'
              step='1'
              value={turnover}
              onChange={(e) => setTurnover(Math.max(0.1, Number(e.target.value) || 0.1))}
            />
          </label>
          <label className='sonar-search'>
            <Search size={14} />
            <input
              aria-label='Filter Sonar assets'
              placeholder='Filter assets'
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <label>
            <input
              type='checkbox'
              checked={flaggedOnly}
              onChange={(e) => setFlaggedOnly(e.target.checked)}
            />{' '}
            Flagged only
          </label>
        </div>
        <div className='sonar-table-scroll'>
          <table className='sonar-table'>
            <thead>
              <tr>
                <th>ASSET / 24H RANK</th>
                <th>PRICE / 24H</th>
                <th>FLAGS / 4</th>
                <th>RELATIVE Z</th>
                <th>TURNOVER</th>
                <th>7D DRAWDOWN</th>
                <th>SAMPLE VOL.</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((coin) => (
                <tr key={coin.id}>
                  <td>
                    <button className='sonar-asset' onClick={() => onOpenAsset(coin.id)}>
                      <img src={coin.image} alt='' loading='lazy' />
                      <span>
                        <strong>
                          {coin.symbol} <small>#{coin.rank}</small>
                        </strong>
                        <small>{coin.name}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    {formatCurrency(coin.price)}
                    <small className={coin.change >= 0 ? 'positive' : 'negative'}>
                      {percent(coin.change)}
                    </small>
                  </td>
                  <td>
                    <div className='sonar-flags'>
                      <b>{coin.score}/4</b>
                      {coin.flags.length ? (
                        coin.flags.map((flag) => <span key={flag}>{flag}</span>)
                      ) : (
                        <small>No threshold crossed</small>
                      )}
                    </div>
                  </td>
                  <td>{coin.zScore === null ? '—' : coin.zScore.toFixed(2)}</td>
                  <td>{coin.turnover === null ? '—' : `${coin.turnover.toFixed(2)}%`}</td>
                  <td>{percent(coin.maxDrawdown)}</td>
                  <td>{coin.volatility === null ? '—' : `${coin.volatility.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!stack.length && <p className='sonar-empty'>No assets match these filters.</p>}
        </div>
        <nav className='sonar-pagination' aria-label='Sonar coin pages'>
          <span>
            {stack.length ? `${offset + 1}–${Math.min(offset + pageSize, stack.length)}` : '0'} of{' '}
            {stack.length.toLocaleString()} matching coins · {rows.length.toLocaleString()} /{' '}
            {SONAR_ASSET_LIMIT.toLocaleString()} coins loaded
          </span>
          <span>{pageSize} rows per page</span>
          <button
            type='button'
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span aria-live='polite'>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type='button'
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
      </section>
      <div className='sonar-research-grid'>
        <section className='sonar-section'>
          <div className='section-kicker'>DAILY LEAD CHANGE FLAGS</div>
          <h2>Rotation watch</h2>
          <p className='sonar-muted'>
            Ranks use rolling 24h returns. Compared with the first live observation saved today in
            this browser
            {baseline && dataSource === 'live'
              ? ` at ${new Date(baseline.observedAt).toLocaleTimeString()}`
              : ''}
            .
          </p>
          {dataSource !== 'live' ? (
            <p className='sonar-muted'>
              Daily tracking starts when live data arrives. Sample rankings are not saved.
            </p>
          ) : !flags.length ? (
            <p className='sonar-muted'>No rank changes since the daily baseline.</p>
          ) : (
            flags.slice(0, 8).map(({ coin, delta }) => (
              <button className='sonar-rotation' key={coin.id} onClick={() => onOpenAsset(coin.id)}>
                <strong>{coin.symbol}</strong>
                <span>
                  {delta === null ? (
                    'New to tracked universe'
                  ) : delta > 0 ? (
                    <>
                      <ArrowUpRight size={14} /> Up {delta}
                    </>
                  ) : (
                    <>
                      <ArrowDownRight size={14} /> Down {Math.abs(delta)}
                    </>
                  )}
                </span>
                <small>Rank #{coin.rank}</small>
              </button>
            ))
          )}
        </section>
        <section className='sonar-section'>
          <div className='section-kicker'>QUANTITATIVE RESEARCH TOOLS</div>
          <h2>Read the measurements</h2>
          <dl className='sonar-methods'>
            <dt>Cross-sectional z-score</dt>
            <dd>
              24h return minus the tracked-universe mean, divided by its sample standard deviation.
            </dd>
            <dt>Turnover</dt>
            <dd>
              24h USD trading volume ÷ current market cap. This is activity, not a volume-spike
              estimate.
            </dd>
            <dt>Drawdown & sample volatility</dt>
            <dd>
              Largest peak-to-trough fall in the supplied 7-day price samples; sample standard
              deviation of consecutive percentage returns. Volatility is per sample, not annualized.
            </dd>
            <dt>Signal count</dt>
            <dd>
              One flag each for the three configured thresholds and a sampled drawdown of at least
              10%. Flags describe observations; the count is not a probability or forecast.
            </dd>
          </dl>
          <p className='sonar-muted'>
            {formatCompact(
              rows.reduce((sum, coin) => sum + (Number.isFinite(coin.volume) ? coin.volume : 0), 0)
            )}{' '}
            reported 24h volume across the tracked universe. Missing research data appears as —.
          </p>
        </section>
      </div>
    </div>
  )
}
