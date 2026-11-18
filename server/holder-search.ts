import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { AlchemySolanaWalletProvider } from './alchemy-solana-wallet.js'
import { WalletHolderService, solanaHolder } from './wallet-holders.js'
import { EthereumWalletService } from './ethereum-wallet-service.js'
import { validAddress } from '../src/lib/token-identity.js'
import { SOLANA_MAINNET_GENESIS } from './solana-dex.js'
import { decimalUnits, type EthereumActivity } from '../src/lib/ethereum-wallet.js'
import type { WalletActivity } from '../src/lib/wallet-intelligence.js'
import { filterHolders, holderTier, sortNativeHolders, type NativeHolder } from '../src/lib/holder-rankings.js'
import { parseHolderSearch, holderSearchQuery, type HolderSearchParams, type HolderSearchResult, type WhalePurchase } from '../src/lib/holder-search.js'
type Chain = 'ethereum' | 'solana'
type Rpc = Pick<AlchemyWalletRpc, 'call'>
type Scan = { holders: NativeHolder[]; recent: Set<string>; warnings: string[]; scope: string; checked: number }
const TTL = 10000
export function whalePurchases(chain: Chain, holder: NativeHolder, activities: WalletActivity[], now = Date.now()): WhalePurchase[] {
  return activities.flatMap(activity => {
    if (chain === 'ethereum' ? activity.wallet.toLowerCase() !== holder.address.toLowerCase() : activity.wallet !== holder.address) return []
    if (activity.kind !== 'swap' || !Number.isFinite(activity.at) || activity.at < now - 86400000 || activity.at > now) return []
    if (!(chain === 'ethereum' ? /^0x[0-9a-f]{64}$/i : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/).test(activity.signature)) return []
    const proven = new Set(activity.buyMints ?? [])
    return activity.tokens.filter(token => token.direction === 'in' && proven.has(token.mint) && validAddress(chain, token.mint) && Number.isFinite(token.amount) && token.amount > 0).map(token => {
      const raw = activity.rawTokens?.find(row => row.mint === token.mint && row.direction === 'in')
      const value = chain === 'ethereum' ? (activity as EthereumActivity).tokenValues?.find(row => row.mint === token.mint && row.purchased) : null
      return { wallet: holder.address, balance: holder.amount, token: token.mint, symbol: value?.symbol || `${token.mint.slice(0, 6)}…${token.mint.slice(-4)}`, amount: raw ? decimalUnits(raw.rawAmount, raw.decimals) ?? String(token.amount) : String(token.amount), signature: activity.signature, at: activity.at }
    })
  })
}
export class HolderSearch {
  private eth?: Rpc
  private sol?: Rpc
  private solana?: Pick<AlchemySolanaWalletProvider, 'history'>
  private scans = new Map<Chain, { at: number; pending: boolean; task: Promise<Scan> }>()
  private jobs = new Map<string, HolderSearchResult>()
  private keys = new Map<string, string>()
  private activePurchases = new Set<Promise<void>>()
  private stopped = false
  private windows = new Map<string, { until: number; reads: number; searches: number }>()
  constructor(private directory: WalletHolderService, private ethereum: Pick<EthereumWalletService, 'wallet'>, key?: string) {
    if (key) { this.eth = new AlchemyWalletRpc(key, 'eth-mainnet'); this.sol = new AlchemyWalletRpc(key, 'solana-mainnet'); this.solana = new AlchemySolanaWalletProvider(this.sol as AlchemyWalletRpc) }
  }
  get(chain: Chain, id: string) {
    const result = this.jobs.get(`${chain}:${id}`)
    if (!result || Date.now() - result.at > 600000) throw new Error('Search expired; run Search again')
    return result
  }
  async search(chain: Chain, parameters: HolderSearchParams) {
    if (this.stopped) throw new Error('Search service stopping')
    const key = `${chain}:${holderSearchQuery(parameters)}`, previous = this.keys.get(key), cached = previous ? this.jobs.get(previous) : undefined
    if (cached && Date.now() - cached.at < 15000) return cached
    let scan = this.scans.get(chain)
    if (!scan || !scan.pending && Date.now() - scan.at >= TTL) {
      const task = chain === 'ethereum' ? this.scanEthereum() : this.scanSolana()
      scan = { at: Date.now(), pending: true, task }; this.scans.set(chain, scan)
      void task.then(() => { const cached = this.scans.get(chain); if (cached?.task === task) { cached.pending = false; cached.at = Date.now() } }, () => { if (this.scans.get(chain)?.task === task) this.scans.delete(chain) })
    }
    const source = await scan.task
    const directory = await this.directory.observe(chain, { holders: source.holders, at: scan.at, source: 'Live finalized blockchain balances · Alchemy', scope: source.scope })
    const eligible = filterHolders(directory.holders, parameters.view, parameters.minimum, parameters.days, directory.at, parameters.hidePrograms)
    const holders = eligible.filter(holder => parameters.size === 'all' || holderTier(holder.amount, parameters.minimum, parameters.whaleMinimum) === (parameters.size === 'whales' ? 'Whale' : 'Large holder'))
    const whales = holders.filter(holder => !holder.isContract && holderTier(holder.amount, parameters.minimum, parameters.whaleMinimum) === 'Whale').sort((a, b) => Number(source.recent.has(b.address)) - Number(source.recent.has(a.address))).slice(0, 3)
    const job: HolderSearchResult = { ...directory, holders, id: randomUUID(), parameters, checked: source.checked, warnings: [...source.warnings], purchases: [], purchaseStatus: 'loading', whalesChecked: 0, whalesTargeted: whales.length }
    if (!whales.length) job.purchaseStatus = 'complete'
    else if (this.activePurchases.size >= 2) { job.purchaseStatus = 'unavailable'; job.warnings.push('Whale purchase checks are busy. Search again shortly.') }
    else {
      const task = this.collectPurchases(chain, job, whales).finally(() => this.activePurchases.delete(task))
      this.activePurchases.add(task)
    }
    const id = `${chain}:${job.id}`
    this.jobs.set(id, job); this.keys.set(key, id)
    while (this.jobs.size > 30) this.jobs.delete(this.jobs.keys().next().value!)
    for (const [key, value] of this.keys) if (!this.jobs.has(value)) this.keys.delete(key)
    return job
  }
  private async scanEthereum(): Promise<Scan> {
    if (!this.eth) throw new Error('Configure Alchemy for live blockchain searches')
    if (BigInt(await this.eth.call<string>('eth_chainId', [], TTL)) !== 1n) throw new Error('Ethereum mainnet required')
    const head = await this.eth.call<any>('eth_getBlockByNumber', ['finalized', true], TTL)
    if (!/^0x[0-9a-f]+$/i.test(head.number ?? '') || !Array.isArray(head.transactions)) throw new Error('Finalized Ethereum block unavailable')
    const recent = new Set<string>()
    for (const tx of head.transactions.slice().reverse()) {
      if (validAddress('ethereum', tx.from ?? '')) recent.add(tx.from.toLowerCase())
      if (recent.size >= 30) break
    }
    const warnings: string[] = []
    let listed: NativeHolder[] = []
    try { listed = (await this.directory.ethereumHolders()).holders.slice(0, 20) } catch { warnings.push('Largest-holder directory unavailable; recent finalized-block senders were still searched.') }
    const addresses = [...new Set([...recent, ...listed.map(h => h.address.toLowerCase())])].slice(0, 50), holders: NativeHolder[] = []
    for (let i = 0; i < addresses.length; i += 4) {
      const rows = await Promise.allSettled(addresses.slice(i, i + 4).map(async address => {
        const [raw, code] = await Promise.all([this.eth!.call<string>('eth_getBalance', [address, head.number], TTL), this.eth!.call<string>('eth_getCode', [address, head.number], TTL)])
        if (!/^0x[0-9a-f]+$/i.test(raw) || !/^0x[0-9a-f]*$/i.test(code)) throw new Error('Invalid balance response')
        const isContract = code !== '0x'
        return { address, amount: decimalUnits(BigInt(raw).toString(), 18)!, label: listed.find(h => h.address.toLowerCase() === address)?.label ?? null, isContract, accountType: isContract ? 'Contract' : 'Address' }
      }))
      holders.push(...rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []))
    }
    if (!holders.length) throw new Error('No live Ethereum balances could be checked')
    if (holders.length < addresses.length) warnings.push(`${addresses.length - holders.length} Ethereum balance checks were unavailable; results are partial.`)
    return { holders: sortNativeHolders(holders), recent, warnings, checked: holders.length, scope: `Finalized Ethereum block ${BigInt(head.number)}: up to 30 recent senders plus 20 explorer-listed large accounts, balances checked at this block. Bounded sample, not a scan of every Ethereum address.` }
  }
  private async scanSolana(): Promise<Scan> {
    if (!this.sol) throw new Error('Configure Alchemy for live blockchain searches')
    if (await this.sol.call('getGenesisHash', [], 3600000) !== SOLANA_MAINNET_GENESIS) throw new Error('Solana mainnet required')
    const warnings: string[] = [], recent = new Set<string>(), listed = new Set<string>()
    let slot = await this.sol.call<number>('getSlot', [{ commitment: 'finalized' }], TTL)
    if (!Number.isSafeInteger(slot) || slot < 1) throw new Error('Finalized Solana slot unavailable')
    const anchor = slot
    let block: any
    for (let attempt = 0; attempt < 3; attempt++, slot--) {
      try { block = await this.sol.call<any>('getBlock', [slot, { encoding: 'json', transactionDetails: 'accounts', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 }], TTL); break } catch { /* A finalized slot can be skipped. Try the preceding slot. */ }
    }
    if (Array.isArray(block?.transactions)) for (const tx of block.transactions.slice().reverse()) {
      if (tx.meta?.err !== null) continue
      for (const account of tx.transaction?.accountKeys ?? []) if (account.signer === true && validAddress('solana', account.pubkey ?? '')) recent.add(account.pubkey)
      if (recent.size >= 80) break
    }
    else warnings.push('Recent finalized-block signer discovery was unavailable.')
    try {
      const largest = await this.sol.call<any>('getLargestAccounts', [{ commitment: 'finalized', sortResults: true }], TTL)
      for (const row of largest.value?.slice(0, 20) ?? []) if (validAddress('solana', row.address ?? '')) listed.add(row.address)
    } catch { warnings.push('Largest-account directory unavailable; recent finalized-block signers were still searched.') }
    const addresses = [...new Set([...listed, ...recent])].slice(0, 100)
    if (!addresses.length) throw new Error('No live Solana candidate addresses available')
    const result = await this.sol.call<any>('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', minContextSlot: anchor, dataSlice: { offset: 0, length: 0 } }], TTL)
    if (!Number.isSafeInteger(result.context?.slot) || result.context.slot < anchor || !Array.isArray(result.value) || result.value.length !== addresses.length) throw new Error('Solana balances unavailable')
    const holders = addresses.flatMap((address, i) => { const holder = solanaHolder(address, result.value[i]); return holder ? [holder] : [] })
    if (!holders.length) throw new Error('No valid finalized Solana balances available')
    if (holders.length < addresses.length) warnings.push('Some Solana accounts had unavailable or unsafe balance quantities and were omitted.')
    return { holders: sortNativeHolders(holders), recent, checked: holders.length, warnings, scope: `Finalized Solana balance context ${result.context.slot}; recent signer sampling ${block ? `at slot ${slot}` : 'unavailable'}: up to 80 recent signers plus 20 RPC-listed large accounts; current finalized balances rechecked. Largest-account membership may be provider-cached up to two hours. Bounded sample, not every Solana address.` }
  }
  private async collectPurchases(chain: Chain, job: HolderSearchResult, whales: NativeHolder[]) {
    let failures = 0
    for (const whale of whales) {
      if (this.stopped) break
      try {
        const activities = chain === 'ethereum' ? (await this.ethereum.wallet(whale.address)).activities : (await this.solana!.history(whale.address, undefined, 5)).activities
        const rows = whalePurchases(chain, whale, activities)
        job.purchases = [...new Map([...job.purchases, ...rows].map(p => [`${p.wallet}:${p.signature}:${p.token}`, p])).values()].sort((a, b) => b.at - a.at).slice(0, 50)
      } catch { failures++; job.warnings.push(`Purchase history unavailable for ${whale.address.slice(0, 8)}…; no purchases inferred.`) }
      job.whalesChecked++
    }
    job.purchaseStatus = failures === whales.length ? 'unavailable' : failures || job.whalesChecked < whales.length ? 'partial' : 'complete'
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, account: string) {
    const match = /^\/api\/wallet-tracker\/(ethereum|solana)\/holder-search$/.exec(url.pathname)
    if (!match) return false
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(JSON.stringify(data)) }
    if (req.method !== 'GET') { send(405, { error: 'Use GET' }); return true }
    const now = Date.now()
    for (const [key, window] of this.windows) if (window.until <= now) this.windows.delete(key)
    const window = this.windows.get(account) ?? { until: now + 60000, reads: 0, searches: 0 }
    if (this.windows.size >= 10000 && !this.windows.has(account)) { send(503, { error: 'Search capacity reached; retry shortly' }); return true }
    this.windows.set(account, window)
    const id = url.searchParams.get('id'), chain = match[1] as Chain
    if (++window.reads > 60 || !id && ++window.searches > 6) { send(429, { error: 'Search limit reached; retry in one minute' }); return true }
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) { send(400, { error: 'Invalid search identifier' }); return true }
      try { send(200, this.get(chain, id)) } catch { send(404, { error: 'Search expired; click Search again' }) }
      return true
    }
    let parameters: HolderSearchParams
    try {
      const query = new URLSearchParams(url.searchParams)
      if (chain === 'solana') { if (!query.has('minimum')) query.set('minimum', '1000'); if (!query.has('whaleMinimum')) query.set('whaleMinimum', '10000') }
      parameters = parseHolderSearch(query)
    } catch (error) { send(400, { error: (error as Error).message }); return true }
    try { send(200, await this.search(chain, parameters)) }
    catch { send(503, { error: 'Live blockchain search unavailable. Check the configured Alchemy network and retry; previous results are preserved.' }) }
    return true
  }
  async stop() { this.stopped = true; await Promise.allSettled(this.activePurchases) }
}
