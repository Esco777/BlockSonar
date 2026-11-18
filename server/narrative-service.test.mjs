import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NarrativeService } from './dist/server/narrative-service.js'

test('collector-to-dashboard flow persists evidence, verifies tokens, and keeps original alert prices immutable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'narrative-service-'))
  const originalFile = process.env.NARRATIVE_DATA_FILE, originalModel = process.env.NARRATIVE_OLLAMA_MODEL, originalNow = Date.now
  process.env.NARRATIVE_DATA_FILE = path.join(directory, 'history.json'); delete process.env.NARRATIVE_OLLAMA_MODEL
  const initial = Date.now(); let clock = initial
  Date.now = () => clock
  const fetcher = async url => {
    if (url.includes('rss')) return new Response(`<rss><item><title>AI agents expand decentralized finance</title><link>https://example.test/${url.includes('coindesk') ? 'one' : 'two'}</link><pubDate>${new Date(initial).toUTCString()}</pubDate></item></rss>`)
    if (url.endsWith('/coins/categories')) return Response.json([{ id: 'ai-agents', name: 'AI Agents', volume_24h: 100, updated_at: new Date(initial).toISOString(), top_3_coins_id: ['project-id'] }])
    if (url.includes('/coins/markets')) return Response.json([{ id: 'project-id', name: 'Project', symbol: 'ambiguous', current_price: 2, market_cap: 10000000, total_volume: 1000 }, ...(url.includes('category=') ? [{ id: 'second-id', name: 'Another project', symbol: 'other', current_price: 1 }] : [])])
    if (url.includes('/coins/project-id')) return Response.json({ id: 'project-id', platforms: { ethereum: '0x1234' } })
    throw new Error('Unexpected source')
  }
  const service = new NarrativeService(fetcher)
  try {
    await service.start(); await service.refresh()
    const snapshot = await service.snapshot()
    const narrative = snapshot.narratives.find(item => item.id === 'ai-agents')
    assert.ok(narrative); assert.equal(narrative.tokenPreview[0].id, 'project-id'); assert.ok(narrative.tokensUpdatedAt); assert.equal(narrative.method, 'rules'); assert.equal(narrative.evidence.length, 1)
    assert.equal(narrative.components.social, null); assert.equal(snapshot.sources.find(item => item.id === 'reddit').status, 'unconfigured')
    assert.equal(snapshot.alerts[0].coverage, 20); assert.deepEqual(snapshot.alerts[0].tokenPrices, {})
    clock += 14000
    const related = await service.tokens(narrative.id)
    assert.equal(related.tokens[0].id, 'project-id'); assert.equal(related.tokens[0].liquidity, null)
    clock += 14000
    assert.deepEqual((await service.identity('project-id')).chains, [{ chain: 'ethereum', address: '0x1234' }])
    await assert.rejects(service.identity('unverified-id'))
    clock += 14000
    await service.refresh()
    const refreshed = await service.snapshot()
    assert.ok(refreshed.narratives.find(item => item.id === narrative.id).tokenIds.includes('second-id'), 'score refresh retains verified token membership')
    const stored = JSON.parse(await readFile(process.env.NARRATIVE_DATA_FILE, 'utf8'))
    assert.deepEqual(stored.snapshot.alerts[0].tokenPrices, {})
    const restored = new NarrativeService(fetcher)
    const loaded = await restored.snapshot()
    assert.equal(loaded.narratives[0].firstSeen, snapshot.narratives[0].firstSeen)
    // A slow provider must not delay already verified coins after restart.
    clock += 120000
    let complete, requests = 0
    restored.client.get = () => { requests++; return new Promise(resolve => { complete = resolve }) }
    const lastVerified = await restored.tokens(narrative.id)
    assert.equal(lastVerified.tokens[0].id, 'project-id')
    assert.match(lastVerified.message, /refreshing in the background/)
    assert.ok(lastVerified.updatedAt < clock, 'cached observations retain their original timestamp')
    await restored.tokens(narrative.id)
    assert.equal(requests, 1, 'concurrent stale reads share one background request')
    const background = restored.tokenRequests.get(narrative.id)
    complete(JSON.stringify([{ id: 'fresh-id', name: 'Fresh project', symbol: 'fresh', current_price: 3 }]))
    await background
    assert.equal((await restored.tokens(narrative.id)).tokens[0].id, 'fresh-id')
    assert.equal(requests, 1, 'fresh cache avoids another provider request')
    restored.stop()
  } finally {
    service.stop(); Date.now = originalNow
    if (originalFile === undefined) delete process.env.NARRATIVE_DATA_FILE; else process.env.NARRATIVE_DATA_FILE = originalFile
    if (originalModel === undefined) delete process.env.NARRATIVE_OLLAMA_MODEL; else process.env.NARRATIVE_OLLAMA_MODEL = originalModel
    await rm(directory, { recursive: true, force: true })
  }
})

test('corrupt persistent history disables collection rather than overwriting evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'narrative-corrupt-')), previous = process.env.NARRATIVE_DATA_FILE
  const filename = path.join(directory, 'history.json')
  await writeFile(filename, 'invalid-history'); process.env.NARRATIVE_DATA_FILE = filename
  let calls = 0; const service = new NarrativeService(async () => { calls++; return Response.json([]) })
  try {
    await service.start(); assert.match((await service.snapshot()).error, /could not be read/)
    assert.equal(calls, 0); assert.equal(await readFile(filename, 'utf8'), 'invalid-history')
  } finally { service.stop(); if (previous === undefined) delete process.env.NARRATIVE_DATA_FILE; else process.env.NARRATIVE_DATA_FILE = previous; await rm(directory, { recursive: true, force: true }) }
})

test('minute refresh uses fresh headlines, retains market-cache provenance, and coalesces manual refreshes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'narrative-live-'))
  const originalFile = process.env.NARRATIVE_DATA_FILE, originalModel = process.env.NARRATIVE_OLLAMA_MODEL, originalNow = Date.now
  let clock = 1800000000000, phase = 0, categoryCalls = 0, newsCalls = 0
  Date.now = () => clock
  process.env.NARRATIVE_DATA_FILE = path.join(directory,'history.json'); delete process.env.NARRATIVE_OLLAMA_MODEL
  const fetcher = async url => {
    if (url.includes('rss')) {
      newsCalls++
      if (phase === 2) throw new Error('Feed offline')
      const second = url.includes('cointelegraph') && phase === 1
      return new Response(`<rss><item><title>${second ? 'AI agents gain another independent report' : 'AI agents launch new tools'}</title><link>https://example.test/${second ? 'second' : 'first'}</link><pubDate>${new Date(clock).toUTCString()}</pubDate></item></rss>`)
    }
    if (url.endsWith('/coins/categories')) { categoryCalls++; return Response.json([{ id:'ai-agents',name:'AI Agents',volume_24h:100,updated_at:new Date(clock).toISOString() }]) }
    throw new Error('Unexpected request')
  }
  const service = new NarrativeService(fetcher)
  try {
    await service.refresh()
    const first = await service.snapshot()
    const firstCategoryTime = first.sources.find(s=>s.id==='coingecko').updatedAt
    assert.equal(first.narratives.find(n=>n.id==='ai-agents').score,4)
    assert.equal(first.scoring.intervalMs,60000)
    clock += 60000; phase = 1
    await Promise.all([service.refresh(),service.refresh()])
    const next = await service.snapshot()
    const topic = next.narratives.find(n=>n.id==='ai-agents')
    assert.equal(topic.score,8)
    assert.equal(topic.changeSinceUpdate,4)
    assert.equal(categoryCalls,1)
    assert.equal(newsCalls,4)
    assert.equal(next.sources.find(s=>s.id==='coingecko').updatedAt,firstCategoryTime)
    await service.refresh()
    assert.equal(newsCalls,4, 'manual refresh inside the minute reuses the current computation')
    clock += 4*60000; phase = 2
    await service.refresh()
    const degraded = await service.snapshot()
    assert.equal(degraded.narratives.find(n=>n.id==='ai-agents').components.diversity,null)
    assert.equal(degraded.scoring.status,'partial')
    assert.equal(degraded.narratives.find(n=>n.id==='ai-agents').score,null)
    assert.equal(first.alerts[0].score,4,'original alert observations remain unchanged')
  } finally {
    service.stop(); Date.now = originalNow
    if (originalFile === undefined) delete process.env.NARRATIVE_DATA_FILE; else process.env.NARRATIVE_DATA_FILE = originalFile
    if (originalModel === undefined) delete process.env.NARRATIVE_OLLAMA_MODEL; else process.env.NARRATIVE_OLLAMA_MODEL = originalModel
    await rm(directory,{recursive:true,force:true})
  }
})
