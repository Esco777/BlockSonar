import { Pool } from 'pg'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeWatchlists } from '../src/lib/watchlists.js'
import { validAddress } from '../src/lib/token-identity.js'
export type PreferenceIdentity = { network: string; chainId: number; address: string }
export const preferenceOwner = (user: PreferenceIdentity) => `${user.network}:${user.chainId}:${user.network === 'solana' ? user.address : user.address.toLowerCase()}`
export function validatePreference(kind: string, value: any) {
  if (kind === 'watchlists') {
    if (!value || !Array.isArray(value.lists) || value.lists.length > 50) throw new Error('Invalid watchlists')
    return normalizeWatchlists(value)
  }
  const chain = kind === 'wallets-ethereum' ? 'ethereum' : kind === 'wallets-solana' ? 'solana' : null
  if (!chain || !value || !Array.isArray(value.wallets) || value.wallets.length > 25) throw new Error('Invalid wallet preferences')
  if (value.wallets.some((w: any) => !w || !validAddress(chain, w.address) || typeof w.label !== 'string' || w.label.length > 64)) throw new Error('Invalid tracked wallet')
  return { wallets: value.wallets, ...(chain === 'solana' ? { settings: { swaps: value.settings?.swaps === true, transfers: value.settings?.transfers === true, patterns: value.settings?.patterns === true, minimumSwaps: Math.max(3, Math.min(100, Math.trunc(Number(value.settings?.minimumSwaps) || 3))) } } : {}) }
}
export class PrivatePreferences {
  readonly db?: Pool
  private ready?: Promise<unknown>
  constructor(connectionString?: string) {
    if (connectionString) { this.db = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); this.db.on('error', () => {}) }
  }
  private initialize() {
    if (!this.db) throw new Error('Private storage unavailable')
    if (!this.ready) this.ready = this.db.query('CREATE TABLE IF NOT EXISTS private_preferences (owner text NOT NULL, kind text NOT NULL, value jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,kind))').catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  async read(owner: string, kind: string) {
    await this.initialize()
    return (await this.db!.query('SELECT value, revision FROM private_preferences WHERE owner=$1 AND kind=$2', [owner, kind])).rows[0] ?? { value: null, revision: 0 }
  }
  async write(owner: string, kind: string, value: unknown, revision: number) {
    await this.initialize()
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision')
    const normalized = validatePreference(kind, value)
    const result = revision === 0
      ? await this.db!.query('INSERT INTO private_preferences(owner,kind,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING revision', [owner, kind, JSON.stringify(normalized)])
      : await this.db!.query('UPDATE private_preferences SET value=$3, revision=revision+1, updated_at=now() WHERE owner=$1 AND kind=$2 AND revision=$4 RETURNING revision', [owner, kind, JSON.stringify(normalized), revision])
    return result.rows[0]?.revision ?? null
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, user: PreferenceIdentity) {
    const kind = url.pathname.slice('/api/preferences/'.length)
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Cookie, Origin' }); res.end(JSON.stringify(data)) }
    if (!['watchlists', 'wallets-ethereum', 'wallets-solana'].includes(kind)) { send(404, { error: 'Unknown preference' }); return }
    const owner = preferenceOwner(user)
    try {
      if (req.method === 'GET') { send(200, { owner, ...await this.read(owner, kind) }); return }
      if (req.method !== 'PUT') { send(405, { error: 'Use GET or PUT' }); return }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { send(415, { error: 'Send JSON' }); return }
      let body = ''
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 512000) { send(413, { error: 'Preferences too large' }); return } }
      let value: any
      try { value = JSON.parse(body); validatePreference(kind, value.value); if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error() } catch { send(400, { error: 'Invalid preferences' }); return }
      if (value.owner !== owner) { send(409, { error: 'Your sign-in changed. Reload before saving.' }); return }
      const revision = await this.write(owner, kind, value.value, value.revision)
      send(revision === null ? 409 : 200, revision === null ? { error: 'This list changed in another tab. Reload before saving.' } : { revision })
    } catch { send(503, { error: 'Private storage unavailable. Your saved lists have been preserved; retry shortly.' }) }
  }
  async stop() { await this.db?.end() }
}
