import { Pool } from 'pg'
import { HolderDiscovery } from './holder-discovery.js'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { EthereumWalletService } from './ethereum-wallet-service.js'
import { solanaAccountKeys, walletSwapPools } from './alchemy-solana-wallet.js'
import { validSolanaKey } from './solana-dex.js'
import { decimalUnits } from '../src/lib/ethereum-wallet.js'
import { sortNativeHolders, type NativeHolder, type HolderDirectory } from '../src/lib/holder-rankings.js'

const SYSTEM = '11111111111111111111111111111111', STAKE = 'Stake11111111111111111111111111111111111111'
export function solanaHolder(address: string, account: any): NativeHolder | null {
  if (!validSolanaKey(address) || !account || !(typeof account.lamports === 'string' && /^\d+$/.test(account.lamports) || Number.isSafeInteger(account.lamports) && account.lamports >= 0)) return null
  const amount = decimalUnits(String(account.lamports), 9)
  if (amount === null) return null
  const isContract = account.owner !== SYSTEM || account.executable === true
  return { address, amount, label: null, isContract, accountType: account.owner === STAKE ? 'Stake account' : isContract ? 'Program-owned account' : 'Address' }
}
export class WalletHolderService {
  private discovery: HolderDiscovery
  private db?: Pool
  private rpc?: AlchemyWalletRpc
  private cache?: HolderDirectory
  private pending?: Promise<HolderDirectory>
  constructor(private ethereum: EthereumWalletService, private env = process.env) {
    this.discovery = new HolderDiscovery(env.HOLDER_OBSERVATIONS_PATH ?? 'data/holder-observations.json', env.ALCHEMY_API_KEY)
    if (env.ALCHEMY_API_KEY) this.rpc = new AlchemyWalletRpc(env.ALCHEMY_API_KEY, 'solana-mainnet')
    if (env.DEX_DATABASE_URL) { this.db = new Pool({ connectionString: env.DEX_DATABASE_URL, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 5000 }); this.db.on('error', () => {}) }
  }
  observe(chain: 'ethereum' | 'solana', directory: HolderDirectory) { return this.discovery.decorate(chain, directory) }
  async ethereumHolders() {
    const holders = sortNativeHolders((await this.ethereum.largeHolders()).map(h => ({ ...h, amount: h.eth, accountType: h.isContract ? 'Contract' : 'Address' })))
    return this.discovery.decorate('ethereum', { holders, at: Date.now(), source: 'Blockscout Ethereum directory', scope: 'Largest returned native ETH accounts; refreshed from the explorer once per minute. Staked ETH, token holdings and beneficial owners are not ranked.' })
  }
  async solanaHolders(): Promise<HolderDirectory> {
    if (this.cache && Date.now() - this.cache.at < 60000) return this.discovery.decorate('solana', this.cache)
    if (this.pending) return this.discovery.decorate('solana', await this.pending)
    this.pending = this.loadSolana().then(data => { this.cache = data; return data }).finally(() => { this.pending = undefined })
    return this.discovery.decorate('solana', await this.pending)
  }
  private async loadSolana(): Promise<HolderDirectory> {
    if (!this.rpc) throw new Error('Alchemy Solana provider is not configured')
    try {
      const largest = await this.rpc.call('getLargestAccounts', [{ commitment: 'finalized', sortResults: true }])
      if (!Array.isArray(largest.value) || !largest.value.length) throw new Error('Largest accounts unavailable')
      const addresses: string[] = largest.value.slice(0, 20).map((r: any) => r.address)
      const current = await this.rpc.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', dataSlice: { offset: 0, length: 0 } }])
      if (!Array.isArray(current.value) || current.value.length !== addresses.length) throw new Error('Holder balances unavailable')
      const holders = addresses.map((a, i) => solanaHolder(a, current.value[i]))
      if (holders.some(h => h === null)) throw new Error('Incomplete or unsafe largest-account balances')
      return { holders: sortNativeHolders(holders as NativeHolder[]), at: Date.now(), source: 'Alchemy Solana RPC', scope: 'Top 20 RPC-listed native SOL accounts, reordered with current finalized balances. RPC membership can be cached by the provider for up to two hours; staked/pooled holdings and beneficial owners are not aggregated.' }
    } catch { /* Preserve useful, honestly scoped observations when global discovery is unavailable. */ }
    const candidates = new Set<string>()
    if (this.db) {
      const rows = await this.db.query('SELECT raw FROM solana_transactions ORDER BY slot DESC LIMIT 250')
      for (const { raw: tx } of rows.rows) {
        if (tx.meta?.err !== null) continue
        const keys = solanaAccountKeys(tx), signers = keys.slice(0, Math.min(tx.transaction?.message?.header?.numRequiredSignatures ?? 1, 5))
        for (const key of signers) if (validSolanaKey(key) && walletSwapPools(tx, key).length) candidates.add(key)
      }
    }
    const addresses = [...candidates].slice(0, 100)
    if (!addresses.length) throw new Error('Global SOL rankings are unavailable and no observed wallet candidates exist yet')
    const current = await this.rpc.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', dataSlice: { offset: 0, length: 0 } }])
    if (!Array.isArray(current.value) || current.value.length !== addresses.length) throw new Error('Observed holder balances unavailable')
    const holders = addresses.map((a, i) => solanaHolder(a, current.value[i])).filter((h): h is NativeHolder => h !== null)
    return { holders: sortNativeHolders(holders).slice(0, 30), at: Date.now(), source: 'Alchemy balances · BlockSonar observed addresses', scope: `Largest current native SOL balances among ${addresses.length} recently indexed swap authorities. New observed addresses join at refresh. Global largest-account discovery is currently unavailable.`, delayed: true }
  }
  async stop() { await this.discovery.stop(); await this.db?.end() }
}
