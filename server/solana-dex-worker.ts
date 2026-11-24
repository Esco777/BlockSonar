import { SolanaDexRpc, SOLANA_MAINNET_GENESIS, validSolanaKey, decodeSolanaSwaps } from './solana-dex.js'
import { DexStore } from './dex-store.js'
import { dexRpcFailure } from './dex-rpc.js'

export type SolanaDexConfig = { rpc: string; fallbackRpc?: string; pools: string[]; start: number; pageSize: number; interval: number }
export function solanaDexRpcUrl(env: NodeJS.ProcessEnv) {
  const key = env.ALCHEMY_API_KEY?.trim()
  return env.DEX_SOLANA_RPC_URL?.trim() || (key ? `https://solana-mainnet.g.alchemy.com/v2/${encodeURIComponent(key)}` : env.DEX_SOLANA_FALLBACK_RPC_URL?.trim() || '')
}
export function solanaDexConfig(env: NodeJS.ProcessEnv): SolanaDexConfig | null {
  if (!env.DEX_SOLANA_POOLS?.trim() && !env.DEX_SOLANA_RPC_URL?.trim() && !env.DEX_SOLANA_START_SLOT?.trim() && !env.DEX_SOLANA_FALLBACK_RPC_URL?.trim()) return null
  const rpc = solanaDexRpcUrl(env)
  if (!rpc || !['https:', 'http:'].includes(new URL(rpc).protocol)) throw new Error('Set a valid Solana RPC URL or Alchemy key')
  const pools = [...new Set((env.DEX_SOLANA_POOLS ?? '').split(',').map(s => s.trim()).filter(Boolean))]
  if (!pools.length || pools.length > 10 || pools.some(p => !validSolanaKey(p))) throw new Error('Set 1–10 valid DEX_SOLANA_POOLS')
  const start = Number(env.DEX_SOLANA_START_SLOT), pageSize = Number(env.DEX_SOLANA_PAGE_SIZE ?? '10'), interval = Number(env.DEX_SOLANA_POLL_MS ?? '10000')
  if (!/^\d+$/.test(env.DEX_SOLANA_START_SLOT ?? '') || !Number.isSafeInteger(start) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isInteger(interval) || interval < 1000 || interval > 300000) throw new Error('Invalid Solana start slot, page size or polling interval')
  const fallbackRpc = env.DEX_SOLANA_FALLBACK_RPC_URL?.trim()
  return { rpc, ...(fallbackRpc && fallbackRpc !== rpc ? { fallbackRpc } : {}), pools, start, pageSize, interval }
}
type SignatureRow = { signature: string; slot: number; blockTime: number | null; err: unknown; confirmationStatus: string }
export class SolanaDexWorker {
  readonly health: { lastAttemptAt: number | null; lastSuccessAt: number | null; lastErrorAt: number | null } = { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null }
  get chainName() { return 'solana' }
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  constructor(private store: DexStore, private config: SolanaDexConfig, private rpc = new SolanaDexRpc(config.rpc, fetch, config.fallbackRpc ? {
    url: config.fallbackRpc, identityMethod: 'getGenesisHash', identity: SOLANA_MAINNET_GENESIS,
  } : undefined)) {}
  async batch(address: string) {
    if (await this.rpc.call('getGenesisHash', []) !== SOLANA_MAINNET_GENESIS) throw new Error('RPC must serve Solana mainnet')
    const pool = await this.rpc.solanaPool(address)
    return this.store.transaction(async client => {
      if (!(await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [`dex:solana:${address}`])).rows[0].acquired) return false
      await client.query(`INSERT INTO dex_pools(chain,address,protocol,token0,token1) VALUES('solana',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [address, pool.protocol, pool.token0, pool.token1])
      await client.query(`INSERT INTO backfill_jobs(chain,pool,start_block,status) VALUES('solana',$1,$2,'pending') ON CONFLICT DO NOTHING`, [address, this.config.start])
      const job = (await client.query(`SELECT * FROM backfill_jobs WHERE chain='solana' AND pool=$1`, [address])).rows[0]
      if (Number(job.start_block) !== this.config.start) throw new Error('Solana start slot differs from durable job')
      await client.query(`INSERT INTO solana_indexer_state(pool) VALUES($1) ON CONFLICT DO NOTHING`, [address])
      const state = (await client.query('SELECT * FROM solana_indexer_state WHERE pool=$1', [address])).rows[0]
      if (state.anchor_signature) {
        const status = (await this.rpc.call('getSignatureStatuses', [[state.anchor_signature], { searchTransactionHistory: true }])).value?.[0]
        if (!status || status.confirmationStatus !== 'finalized') throw new Error('Finalized Solana anchor unavailable; refusing to advance coverage')
      }
      const options: Record<string, unknown> = { commitment: 'finalized', limit: this.config.pageSize }
      if (state.next_before) options.before = state.next_before
      if (state.anchor_signature) options.until = state.anchor_signature
      const signatures = await this.rpc.call<SignatureRow[]>('getSignaturesForAddress', [address, options])
      if (!Array.isArray(signatures)) throw new Error('Invalid signature history')
      if (!signatures.length && !state.pending_head) return false
      let lastSlot = Number.MAX_SAFE_INTEGER
      for (const row of signatures) {
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature) || !Number.isSafeInteger(row.slot) || row.slot > lastSlot || row.confirmationStatus !== 'finalized') throw new Error('Invalid finalized signature row')
        lastSlot = row.slot
      }
      if (signatures.length && state.next_before && signatures.at(-1)!.signature === state.next_before) throw new Error('Solana pagination did not progress')
      const headSignature = state.pending_head ?? signatures[0]?.signature
      const headSlot = state.pending_slot ?? signatures[0]?.slot
      const headTime = state.pending_time ?? signatures[0]?.blockTime
      if (!headSignature || headTime == null) throw new Error('Solana collection timestamp unavailable')
      for (const row of signatures.filter(s => s.slot >= this.config.start)) {
        const tx = await this.rpc.call('getTransaction', [row.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 }])
        if (!tx || tx.slot !== row.slot || tx.transaction?.signatures?.[0] !== row.signature || !Number.isSafeInteger(tx.blockTime)) throw new Error('Incomplete finalized Solana transaction')
        const swaps = decodeSolanaSwaps(tx, pool)
        const at = new Date(tx.blockTime * 1000).toISOString()
        await client.query(`INSERT INTO solana_transactions(signature,slot,at,status,raw) VALUES($1,$2,$3,$4,$5) ON CONFLICT(signature) DO NOTHING`, [row.signature, row.slot, at, tx.meta.err ? 'failed' : 'finalized', JSON.stringify(tx)])
        for (const swap of swaps) {
          await client.query(`INSERT INTO dex_swaps(chain,tx_hash,log_index,block_number,block_hash,at,pool,protocol,token_in,token_out,amount_in,amount_out,finality,raw) VALUES('solana',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'finalized',$12) ON CONFLICT DO NOTHING`, [row.signature, swap.index, row.slot, row.signature, at, address, pool.protocol, swap.tokenIn, swap.tokenOut, swap.amountIn, swap.amountOut, JSON.stringify({ signature: row.signature, logIndex: swap.index, event: tx.meta.logMessages[swap.index] })])
        }
      }
      const complete = signatures.length < this.config.pageSize || signatures.some(s => s.slot < this.config.start)
      if (complete) {
        await client.query('UPDATE solana_indexer_state SET anchor_signature=$2,next_before=NULL,pending_head=NULL,pending_slot=NULL,pending_time=NULL WHERE pool=$1', [address, headSignature])
        if (Number(headSlot) >= this.config.start) {
          await client.query(`INSERT INTO indexer_checkpoints VALUES('solana',$1,$2,$3,now()) ON CONFLICT(chain,pool) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`, [address, headSlot, headSignature])
          await client.query(`INSERT INTO data_coverage(chain,pool,start_block,end_block,started_at,scope) VALUES('solana',$1,$2,$3,$4,'Pool-address finalized signature scans; slot bounds; supported events only. Start time is first completed scan observation, not a slot timestamp.') ON CONFLICT(chain,pool) DO UPDATE SET end_block=EXCLUDED.end_block,updated_at=now()`, [address, this.config.start, headSlot, new Date(Number(headTime) * 1000)])
        }
      } else {
        await client.query('UPDATE solana_indexer_state SET next_before=$2,pending_head=$3,pending_slot=$4,pending_time=$5 WHERE pool=$1', [address, signatures.at(-1)!.signature, headSignature, headSlot, headTime])
      }
      await client.query(`UPDATE backfill_jobs SET target_block=$2,status=$3,last_error=NULL,updated_at=now() WHERE chain='solana' AND pool=$1`, [address, headSlot, complete ? 'live' : 'backfilling'])
      return !complete
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
          console.error(JSON.stringify({ service: 'dex', event: 'solana_batch_failed', pool, ...dexRpcFailure(error) }))
          await this.store.db.query(`INSERT INTO backfill_jobs(chain,pool,start_block,status,attempts,last_error) VALUES('solana',$1,$2,'retrying',1,'Finalized Solana transaction/page unavailable, invalid logs, or database batch failed; cursor preserved') ON CONFLICT(chain,pool) DO UPDATE SET status='retrying',attempts=backfill_jobs.attempts+1,last_error=EXCLUDED.last_error,updated_at=now()`, [pool, this.config.start]).catch(() => {})
        }
      }
      if (!this.stopped) this.timer = setTimeout(() => { this.running = tick() }, catchingUp ? 1000 : this.config.interval)
    }
    this.running = tick()
  }
  async stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); await this.running }
}
