import { decodeBase58, getBytes, toBeHex } from 'ethers'
import { AlchemyWalletRpc } from './alchemy-wallet-rpc.js'
import { decodeSolanaPool, decodeSolanaSwaps, discriminator, ORCA_PROGRAM, RAYDIUM_CPMM_PROGRAM, validSolanaKey, SOLANA_MAINNET_GENESIS, type SolanaPool } from './solana-dex.js'
import { decimalUnits } from '../src/lib/ethereum-wallet.js'
import type { WalletActivity } from '../src/lib/wallet-intelligence.js'
const SPL_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']
const WSOL = 'So11111111111111111111111111111111111111112'
export const SOLANA_WALLET_COVERAGE = 'Alchemy · finalized wallet-address signatures only, 20 per page; token-account-only incoming transfers may be absent. Balances include up to 200 accounts per SPL program. Swap classification requires verified Orca/Raydium CPMM events, wallet swap authority and observed spend/receipt. Other swaps remain unverified; history is incomplete.'
export function solanaAccountKeys(tx: any): string[] {
  return [...(tx.transaction?.message?.accountKeys ?? []).map((k: any) => typeof k === 'string' ? k : k.pubkey), ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])]
}
export function walletSwapPools(tx: any, wallet: string): string[] {
  const keys = solanaAccountKeys(tx), pools = new Set<string>()
  const instructions = [...(tx.transaction?.message?.instructions ?? []), ...(tx.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions ?? [])]
  for (const ix of instructions) {
    const program = keys[ix.programIdIndex] ?? ix.programId
    if (![ORCA_PROGRAM, RAYDIUM_CPMM_PROGRAM].includes(program) || typeof ix.data !== 'string' || !Array.isArray(ix.accounts)) continue
    try {
      const data = Buffer.from(getBytes(toBeHex(decodeBase58(ix.data))))
      const accounts = ix.accounts.map((a: any) => typeof a === 'number' ? keys[a] : a)
      const matches = (name: string) => data.subarray(0, 8).equals(discriminator(`global:${name}`))
      let owner: string | undefined, pool: string | undefined
      if (program === ORCA_PROGRAM && matches('swap')) { owner = accounts[1]; pool = accounts[2] }
      else if (program === ORCA_PROGRAM && matches('swap_v2')) { owner = accounts[3]; pool = accounts[4] }
      else if (program === RAYDIUM_CPMM_PROGRAM && (matches('swap_base_input') || matches('swap_base_output'))) { owner = accounts[0]; pool = accounts[3] }
      if (owner === wallet && pool && validSolanaKey(pool)) pools.add(pool)
    } catch { /* Unknown instruction layouts do not establish a wallet trade. */ }
  }
  return [...pools].slice(0, 4)
}
export function classifyAlchemySolana(tx: any, wallet: string, pools: SolanaPool[]): WalletActivity {
  const at = Number(tx.blockTime) * 1000, signature = String(tx.transaction?.signatures?.[0] ?? '')
  const fee = Number.isSafeInteger(tx.meta?.fee) ? tx.meta.fee / 1e9 : null
  const base: WalletActivity = { signature, wallet, at, kind: 'unknown', tokens: [], feeSol: fee, nativeSolDelta: null }
  if (!tx.meta || !('err' in tx.meta)) return base
  if (tx.meta.err !== null) return { ...base, kind: 'failed' }
  const net = new Map<string, { raw: bigint; decimals: number }>()
  for (const [side, rows] of [[-1n, tx.meta.preTokenBalances], [1n, tx.meta.postTokenBalances]] as const) for (const row of rows ?? []) {
    const amount = row.uiTokenAmount
    if (row.owner !== wallet || !validSolanaKey(row.mint ?? '') || !/^\d+$/.test(amount?.amount ?? '') || !Number.isInteger(amount.decimals) || amount.decimals < 0 || amount.decimals > 36) continue
    const old = net.get(row.mint)
    if (old && old.decimals !== amount.decimals) throw new Error('Token decimals changed within transaction')
    net.set(row.mint, { decimals: amount.decimals, raw: (old?.raw ?? 0n) + side * BigInt(amount.amount) })
  }
  const rawTokens: NonNullable<WalletActivity['rawTokens']> = []
  for (const [mint, value] of net) {
    if (value.raw === 0n) continue
    const direction = value.raw > 0n ? 'in' as const : 'out' as const, rawAmount = (value.raw > 0n ? value.raw : -value.raw).toString()
    rawTokens.push({ mint, rawAmount, decimals: value.decimals, direction })
    const amount = Number(decimalUnits(rawAmount, value.decimals))
    if (Number.isFinite(amount) && amount > 0) base.tokens.push({ mint, amount, direction })
  }
  base.rawTokens = rawTokens
  const keys = solanaAccountKeys(tx), index = keys.indexOf(wallet)
  if (index >= 0 && Number.isSafeInteger(tx.meta.preBalances?.[index]) && Number.isSafeInteger(tx.meta.postBalances?.[index])) base.nativeSolDelta = (tx.meta.postBalances[index] - tx.meta.preBalances[index]) / 1e9
  const authorized = new Set(walletSwapPools(tx, wallet))
  const funded = (mint: string) => rawTokens.some(t => t.mint === mint && t.direction === 'out') || mint === WSOL && base.nativeSolDelta != null && base.nativeSolDelta < -(keys[0] === wallet ? fee ?? 0 : 0)
  const received = (mint: string) => rawTokens.some(t => t.mint === mint && t.direction === 'in') || mint === WSOL && base.nativeSolDelta != null && base.nativeSolDelta > 0
  const buyMints = new Set<string>()
  for (const pool of pools.filter(p => authorized.has(p.address))) {
    try { for (const swap of decodeSolanaSwaps(tx, pool)) if (funded(swap.tokenIn) && received(swap.tokenOut)) buyMints.add(swap.tokenOut) }
    catch { /* Truncated, malformed, or unsupported events cannot confirm a purchase. */ }
  }
  if (buyMints.size) return { ...base, kind: 'swap', buyMints: [...buyMints] }
  if (base.tokens.some(t => t.direction === 'in') && (base.tokens.some(t => t.direction === 'out') || (base.nativeSolDelta ?? 0) < -(fee ?? 0))) return base
  return { ...base, kind: base.tokens.length || (base.nativeSolDelta != null && Math.abs(base.nativeSolDelta) > (keys[0] === wallet ? fee ?? 0 : 0)) ? 'transfer' : 'unknown' }
}
export class AlchemySolanaWalletProvider {
  readonly chain = 'solana'
  readonly source = 'alchemy'
  readonly coverage = SOLANA_WALLET_COVERAGE
  constructor(private rpc: AlchemyWalletRpc) {}
  private async check(address: string) {
    if (!validSolanaKey(address)) throw new Error('Invalid Solana wallet')
    if (await this.rpc.call('getGenesisHash', [], 3600000) !== SOLANA_MAINNET_GENESIS) throw new Error('Solana Mainnet required')
  }
  async balances(address: string) {
    await this.check(address)
    const native = await this.rpc.call('getBalance', [address, { commitment: 'finalized' }])
    if (!Number.isSafeInteger(native.value) || native.value < 0) throw new Error('Native SOL balance unavailable')
    const balances = [{ mint: 'SOL', amount: decimalUnits(String(native.value), 9)! }], sums = new Map<string, { amount: bigint; decimals: number }>()
    for (const programId of SPL_PROGRAMS) {
      const result = await this.rpc.call('getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed', commitment: 'finalized' }])
      if (!Array.isArray(result.value)) throw new Error('SPL token balances unavailable')
      for (const row of result.value.slice(0, 200)) {
        const info = row.account?.data?.parsed?.info, amount = info?.tokenAmount
        if (info?.owner !== address || !validSolanaKey(info?.mint ?? '') || decimalUnits(amount?.amount, amount?.decimals) === null) continue
        const old = sums.get(info.mint)
        if (old && old.decimals !== amount.decimals) throw new Error('Inconsistent SPL token decimals')
        sums.set(info.mint, { amount: (old?.amount ?? 0n) + BigInt(amount.amount), decimals: amount.decimals })
      }
    }
    for (const [mint, value] of sums) if (value.amount > 0n) balances.push({ mint, amount: decimalUnits(value.amount.toString(), value.decimals)! })
    return balances
  }
  async history(address: string, before?: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid history limit')
    await this.check(address)
    if (before && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(before)) throw new Error('Invalid Solana history cursor')
    const rows = await this.rpc.call('getSignaturesForAddress', [address, { commitment: 'finalized', limit, ...(before ? { before } : {}) }])
    if (!Array.isArray(rows) || rows.length > limit) throw new Error('Solana history unavailable')
    const activities: WalletActivity[] = []
    // Do not advance a page cursor past a missing transaction.
    for (const row of rows) {
      if (row.confirmationStatus !== 'finalized' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)) throw new Error('Invalid finalized signature history')
      const tx = await this.rpc.call('getTransaction', [row.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }])
      if (tx.slot !== row.slot || tx.transaction?.signatures?.[0] !== row.signature || !Number.isSafeInteger(tx.blockTime)) throw new Error('Finalized Solana transaction unavailable')
      const pools: SolanaPool[] = []
      if (tx.meta?.err === null) for (const pool of walletSwapPools(tx, address)) {
        try {
          const account = await this.rpc.call('getAccountInfo', [pool, { encoding: 'base64', commitment: 'finalized' }], 300000)
          if (account.value) pools.push(decodeSolanaPool(pool, account.value))
        } catch { /* Keep movements visible without asserting an unverified swap. */ }
      }
      activities.push(classifyAlchemySolana(tx, address, pools))
    }
    return { activities, before: rows.length === limit ? rows.at(-1).signature as string : null, complete: false }
  }
  async concentration(mint: string) {
    if (!validSolanaKey(mint)) throw new Error('Invalid Solana mint')
    const [largest, supply] = await Promise.all([this.rpc.call('getTokenLargestAccounts', [mint, { commitment: 'finalized' }]), this.rpc.call('getTokenSupply', [mint, { commitment: 'finalized' }])])
    const accounts = largest.value
    if (!Array.isArray(accounts) || !accounts.length || !/^\d+$/.test(supply.value?.amount ?? '') || BigInt(supply.value.amount) === 0n) return { available: false, reason: 'Token supply or largest token accounts are unavailable' }
    const selected = accounts.slice(0, 20)
    const details = await this.rpc.call('getMultipleAccounts', [selected.map((a: any) => a.address), { encoding: 'jsonParsed', commitment: 'finalized' }])
    if (!Array.isArray(details.value) || details.value.length !== selected.length) throw new Error('Largest-account ownership unavailable')
    const owners = new Map<string, bigint>()
    for (let i = 0; i < selected.length; i++) {
      const info = details.value[i]?.data?.parsed?.info
      if (info?.mint !== mint || !validSolanaKey(info?.owner ?? '') || !/^\d+$/.test(selected[i].amount ?? '')) throw new Error('Invalid token owner observation')
      owners.set(info.owner, (owners.get(info.owner) ?? 0n) + BigInt(selected[i].amount))
    }
    const total = BigInt(supply.value.amount)
    return { available: true, at: Date.now(), scope: 'Alchemy · owners aggregated from the largest 20 token accounts; lower bound, not a complete holder snapshot. Pool vaults and exchanges may be included.', holders: [...owners].map(([owner, amount]) => ({ owner, rawAmount: amount.toString(), percentOfSupply: Number(amount * 1000000n / total) / 10000 })).sort((a, b) => b.percentOfSupply - a.percentOfSupply) }
  }
}
