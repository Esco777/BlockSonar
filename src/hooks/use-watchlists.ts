import { useState } from 'react'
import { usePrivatePreference } from './use-private-preference'
import { defaultWatchlists, moveItem, type NamedWatchlist } from '../lib/watchlists'

export function useWatchlists() {
  const sync = usePrivatePreference('watchlists', defaultWatchlists)
  const { value: state, setValue: setState, error, ready } = sync
  const storageError = !!error
  const [deleted, setDeleted] = useState<{ list: NamedWatchlist; index: number } | null>(null)
  const select = (id: string) => setState((current) => current.lists.some((list) => list.id === id) ? { ...current, activeId: id } : current)
  const create = (name: string) => {
    const clean = name.trim().slice(0, 64)
    if (!clean) return
    const id = crypto.randomUUID()
    setState((current) => current.lists.length >= 50 ? current : { lists: [...current.lists, { id, name: clean, assetIds: [] }], activeId: id })
  }
  const rename = (id: string, name: string) => {
    const clean = name.trim().slice(0, 64)
    if (clean) setState((current) => ({ ...current, lists: current.lists.map((list) => list.id === id ? { ...list, name: clean } : list) }))
  }
  const remove = (id: string) => {
    const index = state.lists.findIndex((list) => list.id === id)
    if (index < 0) return
    setDeleted({ list: state.lists[index], index })
    setState((current) => {
      const lists = current.lists.filter((list) => list.id !== id)
      return { lists, activeId: current.activeId === id ? lists[Math.min(index, lists.length - 1)]?.id ?? null : current.activeId }
    })
  }
  const undoDelete = () => {
    if (!deleted) return
    setState((current) => {
      if (current.lists.some((list) => list.id === deleted.list.id) || current.lists.length >= 50) return current
      const lists = [...current.lists]
      lists.splice(Math.min(deleted.index, lists.length), 0, deleted.list)
      return { lists, activeId: deleted.list.id }
    })
    setDeleted(null)
  }
  const reorderLists = (from: number, to: number) => setState((current) => ({ ...current, lists: moveItem(current.lists, from, to) }))
  const toggleAsset = (assetId: string) => setState((current) => {
    if (!current.lists.length) return { lists: [{ id: 'core', name: 'Core watchlist', assetIds: [assetId] }], activeId: 'core' }
    return { ...current, lists: current.lists.map((list) => list.id !== current.activeId ? list : { ...list, assetIds: list.assetIds.includes(assetId) ? list.assetIds.filter((id) => id !== assetId) : list.assetIds.length < 1500 ? [...list.assetIds, assetId] : list.assetIds }) }
  })
  const reorderAssets = (from: number, to: number) => setState((current) => ({ ...current, lists: current.lists.map((list) => list.id === current.activeId ? { ...list, assetIds: moveItem(list.assetIds, from, to) } : list) }))
  return { ...state, ready, error, sync, activeList: state.lists.find((list) => list.id === state.activeId), storageError, deletedName: deleted?.list.name, select, create, rename, remove, undoDelete, reorderLists, toggleAsset, reorderAssets }
}
