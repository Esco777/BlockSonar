import { createHash } from 'node:crypto'
import { encodeBase58, decodeBase58, getBytes, toBeHex } from 'ethers'
import { DexRpc } from './dex-rpc.js'

export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
export const ORCA_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'
export const RAYDIUM_CPMM_PROGRAM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'
export const discriminator = (name: string) => createHash('sha256').update(name).digest().subarray(0, 8)
export function validSolanaKey(value: string) {
  try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && encodeBase58(getBytes(toBeHex(decodeBase58(value), 32))) === value } catch { return false }
}
export type SolanaPool = { address: string; program: string; protocol: 'solana-orca-whirlpool' | 'solana-raydium-cpmm'; token0: string; token1: string }
export function decodeSolanaPool(address: string, account: { owner: string; executable: boolean; data: [string, string] }): SolanaPool {
  if (!validSolanaKey(address) || account.executable || account.data?.[1] !== 'base64') throw new Error('Invalid Solana pool account')
  const data = Buffer.from(account.data[0], 'base64')
  let protocol: SolanaPool['protocol'], a: number, b: number
  if (account.owner === ORCA_PROGRAM && data.subarray(0, 8).equals(discriminator('account:Whirlpool')) && data.length >= 653) {
    protocol = 'solana-orca-whirlpool'; a = 101; b = 181
  } else if (account.owner === RAYDIUM_CPMM_PROGRAM && data.subarray(0, 8).equals(discriminator('account:PoolState')) && data.length >= 637) {
    protocol = 'solana-raydium-cpmm'; a = 168; b = 200
  } else throw new Error('Unsupported Solana pool owner or account layout')
  const token0 = encodeBase58(data.subarray(a, a + 32)), token1 = encodeBase58(data.subarray(b, b + 32))
  if (token0 === token1 || /^1+$/.test(token0) || /^1+$/.test(token1)) throw new Error('Invalid pool mints')
  return { address, program: account.owner, protocol, token0, token1 }
}
export type SolanaSwap = { index: number; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; wallet: null }
function decodeEvent(data: Buffer, pool: SolanaPool, index: number): SolanaSwap | null {
  const expected = discriminator(pool.protocol === 'solana-orca-whirlpool' ? 'event:Traded' : 'event:SwapEvent')
  if (!data.subarray(0, 8).equals(expected)) return null
  if (data.length < 40) throw new Error('Incomplete swap event')
  if (encodeBase58(data.subarray(8, 40)) !== pool.address) return null
  let tokenIn: string, tokenOut: string, amountIn: bigint, amountOut: bigint
  if (pool.protocol === 'solana-orca-whirlpool') {
    if (data.length !== 121 || data[40] > 1) throw new Error('Unsupported Orca event layout')
    tokenIn = data[40] ? pool.token0 : pool.token1; tokenOut = data[40] ? pool.token1 : pool.token0
    amountIn = data.readBigUInt64LE(73); amountOut = data.readBigUInt64LE(81)
  } else {
    // Current CPMM event: pool, vault balances, amounts/fees, exact-input flag, mints, optional fee extensions.
    if (![153, 161, 170].includes(data.length) || data[88] > 1) throw new Error('Unsupported Raydium event layout')
    tokenIn = encodeBase58(data.subarray(89, 121)); tokenOut = encodeBase58(data.subarray(121, 153))
    if (!((tokenIn === pool.token0 && tokenOut === pool.token1) || (tokenIn === pool.token1 && tokenOut === pool.token0))) throw new Error('Swap mint mismatch')
    amountIn = data.readBigUInt64LE(56); amountOut = data.readBigUInt64LE(64)
  }
  if (amountIn === 0n || amountOut === 0n) throw new Error('Zero swap amount')
  // Event quantities are raw execution integers. Transfer-fee fields remain in the stored raw payload.
  return { index, tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString(), wallet: null }
}
export function decodeSolanaSwaps(tx: any, pool: SolanaPool): SolanaSwap[] {
  if (!tx?.meta || !('err' in tx.meta)) throw new Error('Transaction metadata missing')
  if (tx.meta.err !== null) return []
  const logs = tx.meta.logMessages
  if (!Array.isArray(logs) || logs.some((s: unknown) => typeof s !== 'string' || /log truncated/i.test(s as string))) throw new Error('Incomplete Solana transaction logs')
  const stack: Array<{ program: string; events: SolanaSwap[] }> = [], swaps: SolanaSwap[] = []
  logs.forEach((line: string, index: number) => {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line)
    if (invoke) {
      if (Number(invoke[2]) !== stack.length + 1) throw new Error('Incomplete invocation stack')
      stack.push({ program: invoke[1], events: [] }); return
    }
    const end = /^Program (\w+) (success|failed:.*)$/.exec(line)
    if (end) {
      const frame = stack.pop()
      if (!frame || frame.program !== end[1]) throw new Error('Invalid invocation stack')
      if (end[2] === 'success') (stack.at(-1)?.events ?? swaps).push(...frame.events)
      return
    }
    if (line.startsWith('Program data: ') && stack.at(-1)?.program === pool.program) {
      const event = decodeEvent(Buffer.from(line.slice(14), 'base64'), pool, index)
      if (event) stack.at(-1)!.events.push(event)
    }
  })
  if (stack.length) throw new Error('Unfinished invocation logs')
  return swaps
}
export class SolanaDexRpc extends DexRpc {
  async solanaPool(address: string): Promise<SolanaPool> {
    const result = await this.call('getAccountInfo', [address, { encoding: 'base64', commitment: 'finalized' }])
    if (!result.value) throw new Error('Solana pool account unavailable')
    return decodeSolanaPool(address, result.value)
  }
}
