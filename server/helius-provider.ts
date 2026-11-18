import { ProviderCache } from './provider-cache.js'
import { classifyTransaction, type WalletActivity } from '../src/lib/wallet-intelligence.js'
export interface WalletProvider {
  chain: string
  source?: string
  coverage?: string
  history(address: string, before?: string): Promise<{ activities: WalletActivity[]; before: string | null; complete: boolean }>
  concentration?(mint: string): Promise<unknown>
  balances(address: string): Promise<Array<{ mint: string; amount: string }>>
}
export class HeliusProvider implements WalletProvider {
  chain = 'solana'
  constructor(private key: string, private cache = new ProviderCache()) {}
  private async rpc(method: string, params: unknown[]) {
    const data = await this.cache.get<any>(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.key)}`, 'helius', 60, 60000, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    if (data.error) throw new Error('Helius RPC unavailable')
    return data.result
  }
  async history(address: string, before?: string) {
    const query = new URLSearchParams({ 'api-key': this.key, limit: '100', 'token-accounts': 'balanceChanged', commitment: 'finalized' })
    if (before) query.set('before-signature', before)
    const rows = await this.cache.get<any[]>(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${query}`, 'helius', 60)
    if (!Array.isArray(rows)) throw new Error('Invalid wallet history response')
    return { activities: rows.map(tx => classifyTransaction(tx, address)).filter(tx => tx.signature && Number.isFinite(tx.at)), before: rows.length === 100 ? String(rows.at(-1)?.signature) : null, complete: rows.length < 100 }
  }
  async concentration(mint: string) {
    const largest = await this.rpc('getTokenLargestAccounts', [mint, { commitment: 'finalized' }])
    const supply = await this.rpc('getTokenSupply', [mint, { commitment: 'finalized' }])
    const accounts = largest.value ?? []
    if (!accounts.length || !supply.value?.amount || BigInt(supply.value.amount) === 0n) return { available: false, reason: 'Missing token supply or holder accounts' }
    const detail = await this.rpc('getMultipleAccounts', [accounts.map((a: any) => a.address), { encoding: 'jsonParsed', commitment: 'finalized' }])
    const owners = new Map<string, bigint>()
    for (let i = 0; i < accounts.length; i++) {
      const owner = detail.value?.[i]?.data?.parsed?.info?.owner
      if (typeof owner === 'string') owners.set(owner, (owners.get(owner) ?? 0n) + BigInt(accounts[i].amount))
    }
    const total = BigInt(supply.value.amount)
    return { available: true, at: Date.now(), scope: 'Owners aggregated from the largest 20 token accounts; lower bound, excludes unsampled accounts. Pool vaults, exchanges, and program custody may be included.', holders: [...owners].map(([owner, amount]) => ({ owner, percentOfSupply: Number(amount * 1000000n / total) / 10000 })).sort((a,b) => b.percentOfSupply-a.percentOfSupply) }
  }
  async balances(address: string) {
    const sol = await this.rpc('getBalance', [address, { commitment: 'finalized' }])
    const balances = [{ mint: 'SOL', amount: String(sol.value / 1e9) }]
    for (const programId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
      const result = await this.rpc('getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed', commitment: 'finalized' }])
      for (const row of result.value ?? []) { const info = row.account?.data?.parsed?.info; if (info?.mint) balances.push({ mint: info.mint, amount: info.tokenAmount.uiAmountString }) }
    }
    return balances
  }
}
