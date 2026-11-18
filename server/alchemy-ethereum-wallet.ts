import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { EthereumProvider } from './ethereum-provider.js'
import { classifyEthereumTransaction, transferAbi, type TokenMetadata } from './ethereum-classifier.js'
import { decimalUnits, type EthereumActivity } from '../src/lib/ethereum-wallet.js'
import { validAddress } from '../src/lib/token-identity.js'

export class AlchemyEthereumWalletProvider {
  readonly source = 'alchemy'
  constructor(private rpc: AlchemyWalletRpc, private directory = new EthereumProvider()) {}
  // Alchemy RPC has no global richest-wallet directory; preserve the existing discovery source.
  largeHolders() { return this.directory.largeHolders() }
  async snapshot(address: string) {
    if (!validAddress('ethereum', address)) throw new Error('Invalid Ethereum wallet')
    address = address.toLowerCase()
    if (BigInt(await this.rpc.call('eth_chainId', [])) !== 1n) throw new Error('Ethereum Mainnet required')
    const head = await this.rpc.call('eth_getBlockByNumber', ['finalized', false])
    const rawEth = await this.rpc.call('eth_getBalance', [address, head.number])
    const holdings: Array<{ mint: string; symbol: string; amount: string; logo?: string }> = [{ mint: 'ETH', symbol: 'ETH', amount: decimalUnits(BigInt(rawEth).toString(), 18)! }]
    const warnings = ['Alchemy wallet balances and history. Global large-holder discovery remains sourced from Blockscout.', 'ERC-20 balances are a current snapshot; transaction classification uses finalized receipts.']
    const metadata: TokenMetadata = {}
    const remember = async (mint: string) => {
      mint = mint.toLowerCase()
      if (metadata[mint] || !validAddress('ethereum', mint)) return
      const value = await this.rpc.call('alchemy_getTokenMetadata', [mint], 3600000)
      if (!Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 36) throw new Error('Token decimals unavailable')
      metadata[mint] = { decimals: value.decimals, symbol: typeof value.symbol === 'string' ? value.symbol.slice(0, 30) : mint.slice(0, 8), ...(typeof value.logo === 'string' && value.logo.startsWith('https://') && value.logo.length <= 2048 ? { logo: value.logo } : {}) }
    }
    try {
      const balances = await this.rpc.call('alchemy_getTokenBalances', [address, 'erc20', { maxCount: 100 }])
      if (!Array.isArray(balances.tokenBalances)) throw new Error('Token balances unavailable')
      const rows = balances.tokenBalances.filter((b: any) => validAddress('ethereum', b.contractAddress ?? '') && !b.error && /^0x[0-9a-f]+$/i.test(b.tokenBalance ?? '') && BigInt(b.tokenBalance) > 0n)
      for (let i = 0; i < Math.min(rows.length, 30); i += 3) await Promise.all(rows.slice(i, Math.min(i + 3, 30)).map(async (row: any) => {
        try {
          const mint = row.contractAddress.toLowerCase(); await remember(mint)
          holdings.push({ mint, symbol: metadata[mint].symbol, logo: metadata[mint].logo, amount: decimalUnits(BigInt(row.tokenBalance).toString(), metadata[mint].decimals)! })
        } catch { warnings.push('Some token metadata is unavailable; those token quantities are omitted.') }
      }))
      if (balances.pageKey || rows.length > 30) warnings.push('Token holdings are bounded to 30 nonzero ERC-20 positions from the first balance page; additional tokens may exist.')
    } catch { warnings.push('ERC-20 balances unavailable; showing the observed native balance.') }
    const activities: EthereumActivity[] = []
    const discovery = await Promise.allSettled(['fromAddress', 'toAddress'].map(key => this.rpc.call('alchemy_getAssetTransfers', [{ [key]: address, fromBlock: '0x0', toBlock: head.number, category: ['external', 'erc20'], order: 'desc', withMetadata: true, maxCount: '0x14', excludeZeroValue: true }])))
    if (discovery.some(r => r.status === 'rejected')) warnings.push('Recent transaction discovery is incomplete; retry on the next refresh.')
    const rows = discovery.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value.transfers) ? r.value.transfers : [])
      .filter((r: any) => /^0x[0-9a-f]{64}$/i.test(r.hash ?? '')).sort((a: any, b: any) => Number(BigInt(b.blockNum)) - Number(BigInt(a.blockNum)))
    const hashes = [...new Set<string>(rows.map((r: any) => r.hash.toLowerCase()))].slice(0, 8)
    for (let i = 0; i < hashes.length; i += 2) {
      const results = await Promise.allSettled(hashes.slice(i, i + 2).map(async hash => {
        const [tx, receipt] = await Promise.all([this.rpc.call('eth_getTransactionByHash', [hash]), this.rpc.call('eth_getTransactionReceipt', [hash])])
        if (tx.hash?.toLowerCase() !== hash || receipt.transactionHash?.toLowerCase() !== hash || BigInt(receipt.blockNumber) > BigInt(head.number) || !Array.isArray(receipt.logs)) throw new Error('Finalized receipt unavailable')
        const block = await this.rpc.call('eth_getBlockByNumber', [receipt.blockNumber, false])
        if (block.hash !== receipt.blockHash) throw new Error('Receipt block changed')
        const mints = [...new Set<string>(receipt.logs.filter((l: any) => l.topics?.[0] === transferAbi.getEvent('Transfer')!.topicHash).map((l: any) => String(l.address).toLowerCase()))].filter(m => validAddress('ethereum', m)).slice(0, 20)
        await Promise.allSettled(mints.map(remember))
        const normalized = { hash, timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), status: receipt.status === '0x1' ? 'ok' : 'error', confirmations: Number(BigInt(head.number) - BigInt(receipt.blockNumber) + 1n), from: { hash: tx.from }, to: { hash: tx.to }, value: BigInt(tx.value).toString(), fee: receipt.effectiveGasPrice ? { type: 'actual', value: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString() } : undefined }
        const activity = classifyEthereumTransaction(normalized, receipt.logs, address, metadata, receipt.logs.every((l: any) => !l.removed))
        activity.tokenValues = activity.tokens.map(t => ({ ...t, symbol: metadata[t.mint]?.symbol ?? t.mint, valueUsd: null, purchased: activity.buyMints.includes(t.mint) }))
        return activity
      }))
      for (const r of results) if (r.status === 'fulfilled') activities.push(r.value); else warnings.push('Some finalized transaction details could not be confirmed; purchases are not inferred.')
    }
    return { source: this.source, holdings, activities, metadata, warnings: [...new Set(warnings)] }
  }
}
