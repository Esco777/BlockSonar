import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import type { HolderDirectory } from '../src/lib/holder-rankings.js'

type Chain = 'ethereum' | 'solana'
type Observation = { firstSeenAt: number; firstActivityAt: number | null; activityBasis: string; checkedAt: number }
type Rpc = Pick<AlchemyWalletRpc, 'call'>
const DAY = 86400000
export class HolderDiscovery {
  private records: Record<string, Observation> = {}
  private ready: Promise<void>
  private writes = Promise.resolve()
  private pending = new Map<Chain, Promise<void>>()
  private providers: Partial<Record<Chain, Rpc>>
  constructor(private filename = 'data/holder-observations.json', key?: string, providers?: Partial<Record<Chain, Rpc>>) {
    this.providers = providers ?? (key ? { ethereum: new AlchemyWalletRpc(key, 'eth-mainnet'), solana: new AlchemyWalletRpc(key, 'solana-mainnet') } : {})
    this.ready = readFile(filename, 'utf8').then(text => {
      const data = JSON.parse(text)
      if (data.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)
        || Object.values(data.records).some((row: any) => !Number.isFinite(row.firstSeenAt) || !Number.isFinite(row.checkedAt) || !(row.firstActivityAt === null || Number.isFinite(row.firstActivityAt)) || typeof row.activityBasis !== 'string')) throw new Error('Invalid holder observation history')
      this.records = data.records
    }).catch(error => { if (error.code !== 'ENOENT') throw new Error('Holder observation history could not be read; existing history preserved') })
    void this.ready.catch(() => {})
  }
  private save() {
    const text = JSON.stringify({ version: 1, records: this.records })
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true })
      await writeFile(`${this.filename}.tmp`, text, { mode: 0o600 })
      await rename(`${this.filename}.tmp`, this.filename)
    })
    return this.writes
  }
  async decorate(chain: Chain, directory: HolderDirectory): Promise<HolderDirectory> {
    await this.ready
    let changed = false
    for (const holder of directory.holders) {
      const id = `${chain}:${holder.address}`
      if (!this.records[id]) { this.records[id] = { firstSeenAt: Date.now(), firstActivityAt: null, activityBasis: 'Not checked yet', checkedAt: 0 }; changed = true }
    }
    if (changed) await this.save()
    if (!this.pending.has(chain) && this.providers[chain]) {
      const candidates = directory.holders.filter(h => !h.isContract && Date.now() - this.records[`${chain}:${h.address}`].checkedAt > DAY)
        .sort((a, b) => this.records[`${chain}:${a.address}`].checkedAt - this.records[`${chain}:${b.address}`].checkedAt).slice(0, 4)
      if (candidates.length) {
        const task = this.enrich(chain, candidates.map(h => h.address)).finally(() => this.pending.delete(chain))
        this.pending.set(chain, task)
        void task.catch(() => {})
      }
    }
    return { ...directory, holders: directory.holders.map(h => ({ ...h, ...this.records[`${chain}:${h.address}`] })) }
  }
  private async enrich(chain: Chain, addresses: string[]) {
    const rpc = this.providers[chain]!
    for (const address of addresses) {
      const record = this.records[`${chain}:${address}`]
      try {
        let timestamp: number | null = null, basis: string
        if (chain === 'ethereum') {
          const rows = await Promise.all(['toAddress', 'fromAddress'].map(direction => rpc.call<any>('alchemy_getAssetTransfers', [{ fromBlock: '0x0', toBlock: 'latest', [direction]: address, category: ['external', 'internal', 'erc20', 'erc721', 'erc1155'], order: 'asc', maxCount: '0x1', withMetadata: true, excludeZeroValue: false }], DAY)))
          if (rows.some(row => !Array.isArray(row.transfers))) throw new Error('Invalid transfer history')
          const times = rows.flatMap(row => row.transfers.map((t: any) => Date.parse(t.metadata?.blockTimestamp)))
          if (times.some(time => !Number.isFinite(time))) throw new Error('Incomplete transfer timestamps')
          timestamp = times.length ? Math.min(...times) : null
          basis = 'Earliest provider-indexed transfer; not a wallet creation date'
        } else {
          const rows = await rpc.call<any[]>('getSignaturesForAddress', [address, { limit: 1000, commitment: 'finalized' }], DAY)
          if (!Array.isArray(rows)) throw new Error('Invalid signature history')
          const times = rows.map(row => row.blockTime).filter(time => Number.isFinite(time) && time > 0).map(time => time * 1000)
          // A full page is truncated history and cannot establish first activity.
          timestamp = rows.length < 1000 && times.length === rows.length && times.length ? Math.min(...times) : null
          basis = rows.length >= 1000 ? 'History exceeds 1,000 transactions; first activity unknown' : 'Earliest RPC-returned activity; provider history may be incomplete; not a creation date'
        }
        if (timestamp !== null && (timestamp <= 0 || timestamp > Date.now())) timestamp = null
        record.firstActivityAt = timestamp
        record.activityBasis = basis
      } catch { record.activityBasis = 'History unavailable; retrying later' }
      record.checkedAt = Date.now()
    }
    await this.save()
  }
  async stop() { await Promise.allSettled(this.pending.values()); await this.writes.catch(() => {}) }
}
