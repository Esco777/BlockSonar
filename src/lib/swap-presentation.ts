import { decimalUnits } from './ethereum-wallet.js'
export type TokenMark = 'ethereum' | 'usdc' | 'tether' | 'solana' | 'bnb' | 'unknown'
export type SwapToken = { symbol: string; name: string; decimals: number | null; mark: TokenMark }
const known: Record<string, SwapToken> = {}
const add = (chain: string, address: string, symbol: string, name: string, decimals: number, mark: TokenMark) => {
  known[`${chain}:${chain === 'solana' ? address : address.toLowerCase()}`] = { symbol, name, decimals, mark }
}
add('ethereum', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'WETH', 'Wrapped Ether', 18, 'ethereum')
add('ethereum', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'USDC', 'USD Coin', 6, 'usdc')
add('base', '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, 'ethereum')
add('base', '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913', 'USDC', 'USD Coin', 6, 'usdc')
add('bsc', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', 'WBNB', 'Wrapped BNB', 18, 'bnb')
add('bsc', '0x55d398326f99059ff775485246999027b3197955', 'USDT', 'Tether USD', 18, 'tether')
add('solana', 'So11111111111111111111111111111111111111112', 'SOL', 'Wrapped SOL', 9, 'solana')
add('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 'USD Coin', 6, 'usdc')
export function swapToken(chain: string, address: string): SwapToken {
  return known[`${chain}:${chain === 'solana' ? address : address.toLowerCase()}`] ?? { symbol: `${address.slice(0, 5)}…${address.slice(-4)}`, name: 'Unidentified token', decimals: null, mark: 'unknown' }
}
export function swapQuantity(raw: string, decimals: number | null): { display: string; exact: string; raw: boolean } {
  if (decimals === null) return { display: raw, exact: raw, raw: true }
  const value = decimalUnits(raw, decimals)
  if (value === null) return { display: 'Unavailable', exact: raw, raw: true }
  const [whole, fraction = ''] = value.split('.')
  if (whole === '0' && fraction.length > 6 && /^0{6}/.test(fraction)) return { display: '<0.000001', exact: value, raw: false }
  const cut = fraction.slice(0, 6).replace(/0+$/, '')
  const approximate = /[1-9]/.test(fraction.slice(6))
  return { display: `${approximate ? '≈ ' : ''}${BigInt(whole).toLocaleString()}${cut ? `.${cut}` : ''}`, exact: value, raw: false }
}
