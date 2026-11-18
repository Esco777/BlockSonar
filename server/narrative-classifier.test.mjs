import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyNarratives, validateAiClusters } from './dist/server/narrative-classifier.js'
const news = (id, title, publisher = 'one') => ({ id, title, publisher, kind: 'news', url: `https://news.test/${id}`, publishedAt: 1, collectedAt: 1 })
test('topic rules use project context, not ambiguous ticker mentions', () => {
  assert.equal(classifyNarratives([news('1', 'LINK and AI prices rise')], []).length, 0)
  const result = classifyNarratives([news('2', 'Autonomous agents bring decentralized finance to new users')], [{ id: 'ai-agents', name: 'AI Agents', volume: 1 }])
  assert.ok(result.find(item => item.id === 'ai-agents' && item.categoryId === 'ai-agents'))
  assert.ok(result.find(item => item.id === 'defi'))
})
test('unknown topics require multiple independent headlines and remain unverified candidates', () => {
  const result = classifyNarratives([news('1', 'Programmable identity launches', 'one'), news('2', 'Programmable identity expands', 'two'), news('3', 'Programmable identity adoption grows', 'three')], [])
  const topic = result.find(item => item.name === 'Programmable Identity')
  assert.equal(topic.method, 'candidate'); assert.equal(topic.categoryId, null)
})
test('AI output cannot introduce unsupported evidence IDs or token associations', () => {
  const result = validateAiClusters({ clusters: [{ name: 'Quantum Computing', sourceIds: ['missing'] }, { name: 'AI Agents', sourceIds: ['real'], categoryId: 'invented', sentiment: 9 }] }, [news('real', 'AI agents launch')], [])
  assert.equal(result.length, 1); assert.equal(result[0].categoryId, null); assert.equal(result[0].sentiment, 1)
})


test('every source category appears without duplicating categories already represented by a topic', () => {
  const categories = [{ id: 'ai-agents', name: 'AI Agents', volume: 1 }, { id: 'new-theme', name: 'A New Category', volume: 1 }, { id: 'another', name: 'Another Category', volume: 1 }]
  const result = classifyNarratives([], categories)
  for (const category of categories) assert.equal(result.filter(topic => topic.categoryId === category.id).length, 1)
  const added = result.find(topic => topic.categoryId === 'new-theme')
  assert.equal(added.method, 'category'); assert.deepEqual(added.evidence, [])
})
