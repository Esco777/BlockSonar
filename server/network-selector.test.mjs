import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyticsNetworks, switchEvmNetwork } from './dist/src/lib/analytics-networks.js'
import { DexRpc } from './dist/server/dex-rpc.js'

test('switches Ethereum → Base → BNB → Ethereum and adds a missing chain once', async () => {
  let current = '0x1'
  const known = new Set([current, '0x38'])
  const added = []
  const wallet = { async request({ method, params }) {
    if (method === 'eth_chainId') return current
    if (method === 'wallet_addEthereumChain') {
      const [metadata] = params
      added.push(metadata)
      known.add(metadata.chainId)
      return null
    }
    assert.equal(method, 'wallet_switchEthereumChain')
    const target = params[0].chainId
    if (!known.has(target)) throw { code: 4902 }
    current = target
    return null
  } }
  for (const target of [8453, 56, 1, 8453, 1]) {
    await switchEvmNetwork(wallet, target)
    assert.equal(Number(current), target)
  }
  assert.equal(added.length, 1)
  assert.deepEqual(added[0].rpcUrls, [analyticsNetworks.base.rpc])
  assert.equal(added[0].nativeCurrency.symbol, 'ETH')
  assert.equal('chainId' in analyticsNetworks.solana, false)
})

test('a rejected or unconfirmed switch never adds a network or resolves successfully', async () => {
  for (const rejected of [true, false]) {
    const wallet = { async request({ method }) {
      if (method === 'eth_chainId') return '0x1'
      assert.equal(method, 'wallet_switchEthereumChain')
      if (rejected) throw { code: 4001 }
      return null
    } }
    await assert.rejects(switchEvmNetwork(wallet, 8453), rejected ? { code: 4001 } : /did not confirm/)
  }
})

test('DEX failover validates the fallback chain before reading data', async () => {
  const primary = 'https://primary.test', fallback = 'https://fallback.test'
  let fallbackIdentity = '0x1'
  const calls = []
  const fetcher = async (url, init) => {
    const { method } = JSON.parse(init.body)
    calls.push([url, method])
    if (url === primary) return new Response(null, { status: 503 })
    return Response.json({ result: method === 'eth_chainId' ? fallbackIdentity : '0xa' })
  }
  const rpc = new DexRpc(primary, fetcher, { url: fallback, identityMethod: 'eth_chainId', identity: '0x2105' })
  await assert.rejects(rpc.call('eth_blockNumber', []), /different chain/)
  assert.equal(calls.some(([, method]) => method === 'eth_blockNumber'), false)
  fallbackIdentity = '0x2105'
  assert.equal(await rpc.call('eth_blockNumber', []), '0xa')
})
