import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  GripVertical,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { NamedWatchlist } from '../lib/watchlists'
import type { SonarAsset } from '../lib/sonar-research'
import { formatCurrency } from './market-data'

type Props = {
  ready: boolean
  coins: SonarAsset[]
  lists: NamedWatchlist[]
  activeId: string | null
  focusRequest: number
  storageError: boolean
  deletedName?: string
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onUndoDelete: () => void
  onMoveList: (from: number, to: number) => void
  onToggleAsset: (id: string) => void
  onMoveAsset: (from: number, to: number) => void
  onOpenAsset: (id: string) => void
}
export default function Watchlist(props: Props) {
  const { coins, lists, activeId } = props
  const active = lists.find((list) => list.id === activeId)
  const [name, setName] = useState('')
  const [rename, setRename] = useState(active?.name ?? '')
  const [search, setSearch] = useState('')
  const createInput = useRef<HTMLInputElement>(null)
  const coinMap = useMemo(() => new Map(coins.map((coin) => [coin.id, coin])), [coins])
  useEffect(() => {
    setRename(active?.name ?? '')
    setSearch('')
  }, [active?.id, active?.name])
  useEffect(() => {
    if (props.focusRequest) createInput.current?.focus()
  }, [props.focusRequest])
  const results = search.trim()
    ? coins
        .filter(
          (coin) =>
            `${coin.name} ${coin.symbol}`.toLowerCase().includes(search.trim().toLowerCase()) &&
            !active?.assetIds.includes(coin.id)
        )
        .slice(0, 15)
    : []

  return (
    <div className='watchlists-page'>
      <fieldset disabled={!props.ready} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <header className='watchlists-header'>
          <div>
            <div className='section-kicker'>
              <Bookmark size={14} /> YOUR RESEARCH LISTS
            </div>
            <h1>Watchlists</h1>
            <p>
              Create a list for every corner of the market. Names, order, and coins are saved
              privately for your signed-in wallet. Older unassigned browser lists are preserved on
              this device and are not imported automatically.
            </p>
          </div>
          <span>{lists.length} / 50 lists</span>
        </header>
        {props.storageError && (
          <p className='watchlists-notice' role='status'>
            Private storage is unavailable or a save needs attention. Keep this page open and retry
            before leaving.
          </p>
        )}
        {props.deletedName && (
          <div className='watchlists-notice' role='status'>
            <span>Deleted “{props.deletedName}”.</span>
            <button type='button' onClick={props.onUndoDelete}>
              <Undo2 size={14} /> Undo delete
            </button>
          </div>
        )}
        <div className='watchlists-grid'>
          <section className='watchlists-panel' aria-label='Manage named watchlists'>
            <h2>Your lists</h2>
            <form
              className='watchlists-create'
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim() && lists.length < 50) {
                  props.onCreate(name)
                  setName('')
                }
              }}
            >
              <input
                ref={createInput}
                aria-label='New watchlist name'
                maxLength={64}
                placeholder='Name a new watchlist'
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type='submit'
                aria-label='Create watchlist'
                disabled={!name.trim() || lists.length >= 50}
              >
                <Plus size={17} />
              </button>
            </form>
            <p className='watchlists-hint'>Drag lists or use the arrows to rearrange.</p>
            <div className='watchlists-list'>
              {lists.map((list, index) => (
                <div
                  key={list.id}
                  className={`watchlists-list-row ${activeId === list.id ? 'selected' : ''}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-blocksonar-watchlist', list.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('application/x-blocksonar-watchlist'))
                      event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const from = lists.findIndex(
                      (item) =>
                        item.id === event.dataTransfer.getData('application/x-blocksonar-watchlist')
                    )
                    if (from >= 0) props.onMoveList(from, index)
                  }}
                >
                  <GripVertical size={14} aria-hidden='true' />
                  <button
                    className='watchlists-select'
                    type='button'
                    aria-pressed={activeId === list.id}
                    onClick={() => props.onSelect(list.id)}
                  >
                    <strong>{list.name}</strong>
                    <small>{list.assetIds.length} coins</small>
                  </button>
                  <div className='watchlists-order'>
                    <button
                      type='button'
                      aria-label={`Move ${list.name} up`}
                      disabled={index === 0}
                      onClick={() => props.onMoveList(index, index - 1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type='button'
                      aria-label={`Move ${list.name} down`}
                      disabled={index === lists.length - 1}
                      onClick={() => props.onMoveList(index, index + 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!lists.length && (
              <p className='watchlists-empty'>Create your first watchlist above.</p>
            )}
          </section>
          <section className='watchlists-panel' aria-label='Selected watchlist'>
            {active ? (
              <>
                <form
                  className='watchlists-rename'
                  onSubmit={(event) => {
                    event.preventDefault()
                    props.onRename(active.id, rename)
                  }}
                >
                  <label>
                    Watchlist name
                    <input
                      aria-label='Rename selected watchlist'
                      maxLength={64}
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                    />
                  </label>
                  <button type='submit' disabled={!rename.trim() || rename.trim() === active.name}>
                    Save name
                  </button>
                  <button
                    type='button'
                    className='watchlists-delete'
                    onClick={() => props.onDelete(active.id)}
                  >
                    <Trash2 size={14} /> Delete list
                  </button>
                </form>
                <label className='watchlists-search'>
                  <Search size={15} />
                  <input
                    aria-label='Search coins to add'
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Add coins to ${active.name}…`}
                  />
                </label>
                {search.trim() && (
                  <div className='watchlists-results'>
                    {results.length ? (
                      results.map((coin) => (
                        <button
                          type='button'
                          key={coin.id}
                          disabled={active.assetIds.length >= 1500}
                          onClick={() => {
                            props.onToggleAsset(coin.id)
                            setSearch('')
                          }}
                        >
                          <span>
                            {coin.name} <small>{coin.symbol}</small>
                          </span>
                          <Plus size={14} />
                        </button>
                      ))
                    ) : (
                      <p className='watchlists-hint'>
                        No matching available coins. Market data may still be loading.
                      </p>
                    )}
                  </div>
                )}
                <p className='watchlists-hint'>
                  {active.assetIds.length} / 1,500 coins · Bookmarks elsewhere add to this selected
                  list.
                </p>
                <div className='watchlists-assets'>
                  {active.assetIds.map((id, index) => {
                    const coin = coinMap.get(id)
                    return (
                      <div key={id} className='watchlists-asset-row'>
                        <span className='watchlists-asset-rank'>{index + 1}</span>
                        <button
                          type='button'
                          className='watchlists-asset-name'
                          disabled={!coin}
                          onClick={() => props.onOpenAsset(id)}
                        >
                          {coin && <img src={coin.image} alt='' loading='lazy' />}
                          <span>
                            <strong>{coin?.symbol ?? id}</strong>
                            <small>{coin?.name ?? 'Waiting for market data'}</small>
                          </span>
                        </button>
                        <div className='watchlists-asset-price'>
                          <strong>{coin ? formatCurrency(coin.price) : '—'}</strong>
                          {coin && (
                            <small className={coin.change >= 0 ? 'positive' : 'negative'}>
                              {coin.change >= 0 ? '+' : ''}
                              {coin.change.toFixed(2)}%
                            </small>
                          )}
                        </div>
                        <div className='watchlists-order'>
                          <button
                            type='button'
                            disabled={index === 0}
                            aria-label={`Move ${coin?.name ?? id} up`}
                            onClick={() => props.onMoveAsset(index, index - 1)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type='button'
                            disabled={index === active.assetIds.length - 1}
                            aria-label={`Move ${coin?.name ?? id} down`}
                            onClick={() => props.onMoveAsset(index, index + 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                        <button
                          type='button'
                          aria-label={`Remove ${coin?.name ?? id} from watchlist`}
                          onClick={() => props.onToggleAsset(id)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                {!active.assetIds.length && (
                  <p className='watchlists-empty'>
                    This watchlist is empty. Search for a coin above to add it.
                  </p>
                )}
              </>
            ) : (
              <div className='watchlists-empty'>
                <Bookmark size={28} />
                <h2>Make it your own.</h2>
                <p>Create a named watchlist to start tracking coins.</p>
              </div>
            )}
          </section>
        </div>
      </fieldset>
    </div>
  )
}
