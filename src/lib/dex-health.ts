export type WorkerHealth = { lastAttemptAt: number | null; lastSuccessAt: number | null; lastErrorAt: number | null }
export function dexHealth(configured: boolean, worker: string | undefined, health: WorkerHealth | undefined, jobs: Array<{ status: string }>, now = Date.now()) {
  if (!configured) return 'Database not configured'
  if (!worker || worker === 'not configured') return 'Indexer not configured'
  if (worker === 'invalid configuration') return 'Indexer configuration error'
  if (!health?.lastSuccessAt) return health?.lastErrorAt ? 'Collection unavailable · retrying' : 'Starting collection'
  if (health.lastErrorAt && health.lastErrorAt > health.lastSuccessAt) return 'Collection unavailable · retrying'
  if (now - health.lastSuccessAt > 90000) return 'Collection delayed'
  if (jobs.some(job => job.status === 'retrying')) return 'Collection partially unavailable · retrying'
  if (jobs.some(job => ['backfilling', 'replaying'].includes(job.status))) return 'Catching up on history'
  return 'Collection up to date'
}
