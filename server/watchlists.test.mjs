import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWatchlists, moveItem, defaultWatchlists } from './dist/src/lib/watchlists.js'
test('watchlist persistence preserves names, selection, coin order, and intentionally empty lists', () => {
  const state = { lists: [{ id: 'a', name: 'Research', assetIds: ['solana', 'bitcoin'] }, { id: 'b', name: 'New', assetIds: [] }], activeId: 'b' }
  assert.deepEqual(normalizeWatchlists(JSON.parse(JSON.stringify(state))), state)
  assert.deepEqual(normalizeWatchlists({ lists: [], activeId: null }), { lists: [], activeId: null })
})
test('corrupt storage recovers safely and deduplicates asset IDs and list IDs', () => {
  assert.deepEqual(normalizeWatchlists(null), defaultWatchlists())
  const state = normalizeWatchlists({ lists: [{ id: 'a', name: ' Valid ', assetIds: ['bitcoin', 'bitcoin', null] }, { id: 'a', name: 'Duplicate', assetIds: [] }], activeId: 'missing' })
  assert.equal(state.lists.length, 1)
  assert.equal(state.activeId, 'a')
  assert.deepEqual(state.lists[0].assetIds, ['bitcoin'])
})
test('reordering lists and assets is immutable and bounds checked', () => {
  const values = ['a', 'b', 'c']
  assert.deepEqual(moveItem(values, 0, 2), ['b', 'c', 'a'])
  assert.deepEqual(values, ['a', 'b', 'c'])
  assert.equal(moveItem(values, -1, 2), values)
  assert.equal(moveItem(values, 0, 3), values)
})
