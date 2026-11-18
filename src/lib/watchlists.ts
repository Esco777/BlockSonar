export type NamedWatchlist = { id: string; name: string; assetIds: string[] }
export type WatchlistState = { lists: NamedWatchlist[]; activeId: string | null }
export const WATCHLIST_STORAGE_KEY = 'blocksonar-watchlists-v1'
export const defaultWatchlists = (): WatchlistState => ({ lists: [{ id: 'core', name: 'Core watchlist', assetIds: ['bitcoin', 'ethereum', 'solana', 'chainlink'] }], activeId: 'core' })
export function normalizeWatchlists(value: unknown): WatchlistState {
  if (!value || typeof value !== 'object' || !('lists' in value) || !Array.isArray(value.lists)) return defaultWatchlists()
  const seen = new Set<string>()
  const lists: NamedWatchlist[] = []
  for (const item of value.lists.slice(0, 50)) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.assetIds)) continue
    seen.add(item.id)
    lists.push({ id: item.id, name: item.name.trim().slice(0, 64), assetIds: [...new Set<string>(item.assetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))].slice(0, 1500) })
  }
  const activeId = 'activeId' in value && lists.some((list) => list.id === value.activeId) ? String(value.activeId) : lists[0]?.id ?? null
  return { lists, activeId }
}
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
