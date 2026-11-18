export const dexChains = [
  { key: 'ethereum', name: 'Ethereum', chainId: 1, explorer: 'https://etherscan.io', status: 'available' },
  { key: 'base', name: 'Base', chainId: 8453, explorer: 'https://basescan.org', status: 'available' },
  { key: 'bsc', name: 'BNB Chain', chainId: 56, explorer: 'https://bscscan.com', status: 'available' },
  { key: 'solana', name: 'Solana', chainId: null, explorer: 'https://solscan.io', status: 'available' },
] as const
export type DexSwap = {
  chain: string; protocol: string; tx_hash: string; log_index: number; block_number: string;
  at: string; pool: string; token_in: string; token_out: string; amount_in: string; amount_out: string;
  wallet: string | null; usd_value: string | null; finality: string;
}
export type DexCoverage = { chain: string; pool: string; start_block: string; end_block: string; started_at: string; updated_at: string; scope: string }
export type DexSnapshot = { configured: boolean; swaps: DexSwap[]; coverage: DexCoverage[]; nextOffset: number | null; note: string }

export const dexProtocols = [
  { id: 'solana-orca-whirlpool', chain: 'solana', label: 'Orca Whirlpool · Solana' },
  { id: 'solana-raydium-cpmm', chain: 'solana', label: 'Raydium CPMM · Solana' },
  { id: 'bsc-pancakeswap-v2', chain: 'bsc', label: 'PancakeSwap V2 · BNB' },
  { id: 'bsc-pancakeswap-v3', chain: 'bsc', label: 'PancakeSwap V3 · BNB' },
  { id: 'base-uniswap-v3', chain: 'base', label: 'Uniswap V3 · Base' },
  { id: 'ethereum-uniswap-v2', chain: 'ethereum', label: 'Uniswap V2 · Ethereum' },
  { id: 'ethereum-uniswap-v3', chain: 'ethereum', label: 'Uniswap V3 · Ethereum' },
] as const
