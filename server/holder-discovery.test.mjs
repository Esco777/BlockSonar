import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { HolderDiscovery } from './dist/server/holder-discovery.js'
import { filterHolders } from './dist/src/lib/holder-rankings.js'
const holder = (address, amount, extra = {}) => ({ address, amount, label: null, isContract: false, accountType: 'Address', ...extra })
const directory = holders => ({ holders, at: Date.now(), source: 'test', scope: 'test candidates' })

test('discovery dates persist, slow age checks do not block lists, and Ethereum checks both transfer directions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'holder-discovery-'))
  const filename = path.join(dir, 'observations.json'), calls = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const earliest = Date.now() - 86400000
  const rpc = { call: async (method, [options]) => {
    calls.push(options)
    await gate
    return { transfers: [{ metadata: { blockTimestamp: new Date(options.toAddress ? earliest : earliest + 1000).toISOString() } }] }
  } }
  const service = new HolderDiscovery(filename, undefined, { ethereum: rpc })
  try {
    const first = await service.decorate('ethereum', directory([holder('a', '100')]))
    assert.equal(first.holders[0].firstActivityAt, null)
    assert.ok(first.holders[0].firstSeenAt)
    release(); await service.stop()
    const next = await service.decorate('ethereum', directory([holder('a', '200')]))
    assert.equal(next.holders[0].firstActivityAt, earliest)
    assert.equal(next.holders[0].firstSeenAt, first.holders[0].firstSeenAt)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].order, 'asc'); assert.equal(calls[0].fromBlock, '0x0')
    assert.equal(calls[0].toAddress, 'a'); assert.equal(calls[1].fromAddress, 'a')
    assert.match(next.holders[0].activityBasis, /not a wallet creation/)
    const restored = new HolderDiscovery(filename)
    const loaded = await restored.decorate('ethereum', directory([holder('a', '300')]))
    assert.equal(loaded.holders[0].firstSeenAt, first.holders[0].firstSeenAt)
    assert.equal(loaded.holders[0].firstActivityAt, earliest)
    await restored.stop()
  } finally { release(); await service.stop(); await rm(dir, { recursive: true, force: true }) }
})

test('full Solana history pages and unavailable history never become recently created wallets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'holder-age-'))
  const rpc = { call: async (_method, [address]) => {
    if (address === 'unavailable') throw new Error('Provider unavailable')
    return Array.from({ length: address === 'busy' ? 1000 : 2 }, () => ({ blockTime: Math.floor(Date.now() / 1000) - 60 }))
  } }
  const service = new HolderDiscovery(path.join(dir, 'history.json'), undefined, { solana: rpc })
  try {
    await service.decorate('solana', directory(['busy', 'new', 'unavailable'].map(a => holder(a, '1000'))))
    await service.stop()
    const result = await service.decorate('solana', directory(['busy', 'new', 'unavailable'].map(a => holder(a, '1000'))))
    assert.equal(result.holders[0].firstActivityAt, null)
    assert.equal(result.holders[2].firstActivityAt, null)
    assert.deepEqual(filterHolders(result.holders, 'recent-activity', '100', 7, Date.now(), false).map(h => h.address), ['new'])
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }) }
})

test('discovery filters separate observed age, balance, and contract ownership without mutating rows', () => {
  const now = Date.now(), day = 86400000
  const rows = [holder('old', '1000', { firstSeenAt: now - day, firstActivityAt: now - 30 * day }), holder('new', '200', { firstSeenAt: now, firstActivityAt: now - day }), holder('small', '1', { firstSeenAt: now + 1, firstActivityAt: now - day }), holder('contract', '999', { firstSeenAt: now, firstActivityAt: now - day, isContract: true }), holder('unknown', '100', { firstSeenAt: now })]
  assert.deepEqual(filterHolders(rows, 'discovered', '100', 7, now, true).map(h => h.address), ['new', 'unknown', 'old'])
  assert.deepEqual(filterHolders(rows, 'recent-activity', '100', 7, now, false).map(h => h.address), ['new'])
  assert.equal(filterHolders(rows, 'largest', '0', 7, now, false)[0].address, 'old')
  assert.equal(rows[0].address, 'old')
})

test('corrupt discovery history is preserved instead of overwritten', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'holder-corrupt-')), filename = path.join(dir, 'history.json')
  await writeFile(filename, 'bad data')
  const service = new HolderDiscovery(filename)
  try { await assert.rejects(service.decorate('ethereum', directory([holder('a', '100')])), /preserved/); assert.equal(await readFile(filename, 'utf8'), 'bad data') }
  finally { await service.stop(); await rm(dir, { recursive: true, force: true }) }
})
