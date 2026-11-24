import { adapterForProtocol, decodeProtocolSwap, swapAbi, type DexChain } from './dex-adapters.js'
import { DexRpc, DexRpcError, hexBlock, type RawDexLog } from './dex-rpc.js'
import { DexStore } from './dex-store.js'

export type DexConfig = { chain?: DexChain; rpc: string; fallbackRpc?: string; pools: string[]; start: bigint; batch: bigint; interval: number }
export function dexConfig(env: NodeJS.ProcessEnv, chain: DexChain = 'base'): DexConfig | null {
  const prefix = chain === 'base' ? 'DEX_BASE' : chain === 'ethereum' ? 'DEX_ETHEREUM' : 'DEX_BSC'
  const fallbackRpc = env[`${prefix}_FALLBACK_RPC_URL`]?.trim()
  if (chain !== 'base' && !env[`${prefix}_POOLS`]?.trim() && !env[`${prefix}_START_BLOCK`]?.trim() && !env[`${prefix}_RPC_URL`]?.trim() && !fallbackRpc) return null
  const network = chain === 'base' ? 'base-mainnet' : chain === 'ethereum' ? 'eth-mainnet' : 'bnb-mainnet'
  const apiKey = env.ALCHEMY_API_KEY?.trim()
  const rpc = env[`${prefix}_RPC_URL`]?.trim() || (apiKey ? `https://${network}.g.alchemy.com/v2/${encodeURIComponent(apiKey)}` : fallbackRpc ?? '')
  if (!rpc) return null
  const pools = [...new Set((env[`${prefix}_POOLS`] ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]
  if (!pools.length || pools.length > 50 || pools.some(p => !/^0x[0-9a-f]{40}$/.test(p))) throw new Error(`Set 1–50 valid ${prefix}_POOLS`)
  if (!/^\d+$/.test(env[`${prefix}_START_BLOCK`] ?? '')) throw new Error(`Set ${prefix}_START_BLOCK explicitly; coverage cannot be assumed`)
  const alchemy = new URL(rpc).hostname === `${network}.g.alchemy.com`
  const batch = BigInt(env[`${prefix}_BATCH_BLOCKS`] ?? env.DEX_BATCH_BLOCKS ?? (alchemy ? '10' : '100')), interval = Number(env[`${prefix}_POLL_MS`] ?? env.DEX_POLL_MS ?? '10000')
  if (batch < 1n || batch > 2000n || !Number.isInteger(interval) || interval < 1000 || interval > 300000) throw new Error('Invalid DEX batch or polling interval')
  return { chain, rpc, ...(fallbackRpc && fallbackRpc !== rpc ? { fallbackRpc } : {}), pools, start: BigInt(env[`${prefix}_START_BLOCK`]!), batch, interval }
}
const chainIds = { base: '0x2105', ethereum: '0x1', bsc: '0x38' } as const
class DexBatchValidationError extends Error {
  constructor(readonly reason: 'wrong_rpc_chain' | 'start_block_mismatch', message: string) {
    super(message)
  }
}

function batchFailure(error: unknown) {
  if (error instanceof DexRpcError) {
    return { reason: `rpc_${error.reason}`, method: error.method, httpStatus: error.status, rpcCode: error.rpcCode }
  }
  if (error instanceof DexBatchValidationError) return { reason: error.reason }
  if (error instanceof Error && 'severity' in error && 'code' in error &&
      typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return { reason: 'database_error', sqlState: error.code }
  }
  return { reason: 'pool_or_batch_validation_failed' }
}
export class DexWorker {
  readonly health: { lastAttemptAt: number | null; lastSuccessAt: number | null; lastErrorAt: number | null } = { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null }
  get chainName() { return this.chain }
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  constructor(private store: DexStore, private config: DexConfig, private rpc = new DexRpc(config.rpc, fetch, config.fallbackRpc ? {
    url: config.fallbackRpc, identityMethod: 'eth_chainId', identity: chainIds[config.chain ?? 'base'],
  } : undefined)) {}
  private get chain(): DexChain {
    const chain = this.config.chain ?? 'base'
    if (chain !== 'base' && chain !== 'ethereum' && chain !== 'bsc') throw new Error('Unsupported indexing chain')
    return chain
  }
  async batch(pool: string) {
    const chainId = await this.rpc.call<string>('eth_chainId', [])
    if (BigInt(chainId) !== BigInt(chainIds[this.chain])) throw new DexBatchValidationError('wrong_rpc_chain', `DEX RPC must serve ${this.chain} Mainnet`)
    const tokens = await this.rpc.verifyPool(pool, this.chain)
    const adapter = adapterForProtocol(tokens.protocol ?? `${this.chain}-uniswap-v3`)
    if (adapter.chain !== this.chain) throw new Error('Pool protocol belongs to another chain')
    const protocol = adapter.id
    const head = await this.rpc.block('finalized')
    return this.store.transaction(async client => {
      const locked = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [`dex:${this.chain}:${pool}`])
      if (!locked.rows[0].acquired) return
      await client.query(`INSERT INTO dex_pools(chain,address,protocol,token0,token1) VALUES('${this.chain}',$1,'${protocol}',$2,$3) ON CONFLICT DO NOTHING`, [pool, tokens.token0, tokens.token1])
      await client.query(`INSERT INTO backfill_jobs(chain,pool,start_block,status) VALUES('${this.chain}',$1,$2,'pending') ON CONFLICT DO NOTHING`, [pool, this.config.start.toString()])
      const job = (await client.query(`SELECT * FROM backfill_jobs WHERE chain='${this.chain}' AND pool=$1`, [pool])).rows[0]
      if (BigInt(job.start_block) !== this.config.start) throw new DexBatchValidationError('start_block_mismatch', 'Start block differs from durable job; use a separate database or a reviewed reset')
      const checkpoint = (await client.query(`SELECT * FROM indexer_checkpoints WHERE chain='${this.chain}' AND pool=$1`, [pool])).rows[0]
      if (checkpoint) {
        const canonical = await this.rpc.block(hexBlock(BigInt(checkpoint.block_number)))
        if (canonical.hash.toLowerCase() !== checkpoint.block_hash.toLowerCase()) {
          // Finalized reorg: invalidate this pool's entire claimed range before replay.
          await client.query(`DELETE FROM dex_swaps WHERE chain='${this.chain}' AND pool=$1`, [pool])
          await client.query(`DELETE FROM dex_unclassified_swaps WHERE chain='${this.chain}' AND pool=$1`, [pool])
          await client.query(`DELETE FROM indexer_checkpoints WHERE chain='${this.chain}' AND pool=$1`, [pool])
          await client.query(`DELETE FROM data_coverage WHERE chain='${this.chain}' AND pool=$1`, [pool])
          await client.query(`UPDATE backfill_jobs SET status='replaying',last_error='Finalized block changed; pool history invalidated for replay',updated_at=now() WHERE chain='${this.chain}' AND pool=$1`, [pool])
          console.warn(JSON.stringify({ service: 'dex', event: 'finalized_reorg_replay', chain: this.chain, pool }))
          return
        }
      }
      const from = checkpoint ? BigInt(checkpoint.block_number) + 1n : this.config.start
      const end = BigInt(head.number)
      if (from > end) return
      const to = from + this.config.batch - 1n < end ? from + this.config.batch - 1n : end
      const logs = await this.rpc.call<RawDexLog[]>('eth_getLogs', [{ address: pool, fromBlock: hexBlock(from), toBlock: hexBlock(to), topics: [swapAbi(adapter).getEvent('Swap')!.topicHash] }])
      if (!Array.isArray(logs)) throw new Error('Invalid log response')
      const blocks = new Map<string, Awaited<ReturnType<DexRpc['block']>>>()
      for (const log of logs) {
        if (log.address.toLowerCase() !== pool || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash) || !/^0x[0-9a-f]+$/i.test(log.logIndex) || BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to) throw new Error('Log outside requested pool/range')
        const swap = decodeProtocolSwap(adapter, log, tokens.token0, tokens.token1)
        let block = blocks.get(log.blockNumber)
        if (!block) { block = await this.rpc.block(log.blockNumber); blocks.set(log.blockNumber, block) }
        if (block.hash.toLowerCase() !== log.blockHash.toLowerCase()) throw new Error('Block changed during batch; retrying')
        const at = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()
        if (!swap) {
          await client.query(`INSERT INTO dex_unclassified_swaps(chain,tx_hash,log_index,block_number,block_hash,at,pool,protocol,reason,raw) VALUES('${this.chain}',$1,$2,$3,$4,$5,$6,'${protocol}','Swap amounts do not establish a two-token direction',$7) ON CONFLICT DO NOTHING`, [log.transactionHash.toLowerCase(), Number(BigInt(log.logIndex)), BigInt(log.blockNumber).toString(), log.blockHash.toLowerCase(), at, pool, JSON.stringify(log)])
          continue
        }
        await client.query(`INSERT INTO dex_swaps(chain,tx_hash,log_index,block_number,block_hash,at,pool,protocol,token_in,token_out,amount_in,amount_out,finality,raw) VALUES('${this.chain}',$1,$2,$3,$4,$5,$6,'${protocol}',$7,$8,$9,$10,'finalized',$11) ON CONFLICT DO NOTHING`,
          [log.transactionHash.toLowerCase(), Number(BigInt(log.logIndex)), BigInt(log.blockNumber).toString(), log.blockHash.toLowerCase(), at, pool, swap.tokenIn, swap.tokenOut, swap.amountIn, swap.amountOut, JSON.stringify(log)])
      }
      const last = await this.rpc.block(hexBlock(to))
      // Recheck the finalized anchor before committing all records and progress together.
      if ((await this.rpc.block(head.number)).hash !== head.hash) throw new Error('Finalized anchor changed during batch')
      await client.query(`INSERT INTO indexer_checkpoints VALUES('${this.chain}',$1,$2,$3,now()) ON CONFLICT(chain,pool) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`, [pool, to.toString(), last.hash])
      const first = await this.rpc.block(hexBlock(from))
      await client.query(`INSERT INTO data_coverage(chain,pool,start_block,end_block,started_at) VALUES('${this.chain}',$1,$2,$3,$4) ON CONFLICT(chain,pool) DO UPDATE SET end_block=EXCLUDED.end_block,updated_at=now()`, [pool, from.toString(), to.toString(), new Date(Number(BigInt(first.timestamp)) * 1000)])
      await client.query(`UPDATE backfill_jobs SET target_block=$2,status=$3,last_error=NULL,updated_at=now() WHERE chain='${this.chain}' AND pool=$1`, [pool, end.toString(), to === end ? 'live' : 'backfilling'])
      return to < end
    })
  }
  start() {
    const tick = async () => {
      let catchingUp = false
      for (const pool of this.config.pools) {
        if (this.stopped) break
        try { this.health.lastAttemptAt = Date.now(); if (await this.batch(pool)) catchingUp = true; this.health.lastSuccessAt = Date.now() }
        catch (error) {
          this.health.lastErrorAt = Date.now()
          // Preserve checkpoint; failed range is retried on the next tick.
          console.error(JSON.stringify({ service: 'dex', event: 'batch_failed', chain: this.chain, pool, ...batchFailure(error) }))
          await this.store.db.query(`INSERT INTO backfill_jobs(chain,pool,start_block,status,attempts,last_error) VALUES('${this.chain}',$1,$2,'retrying',1,'RPC or database batch failed; checkpoint preserved') ON CONFLICT(chain,pool) DO UPDATE SET status='retrying',attempts=backfill_jobs.attempts+1,last_error=EXCLUDED.last_error,updated_at=now()`, [pool, this.config.start.toString()]).catch(() => {})
        }
      }
      if (!this.stopped) this.timer = setTimeout(() => { this.running = tick() }, catchingUp ? 1000 : this.config.interval)
    }
    this.running = tick()
  }
  async stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); await this.running }
}
