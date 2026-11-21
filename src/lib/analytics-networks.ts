import type { Eip1193Provider } from 'ethers'

export const analyticsNetworks = {
  ethereum: { name: 'Ethereum Mainnet', label: 'Ethereum', chainId: 1, currency: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io', discovery: 'eth' },
  base: { name: 'Base Mainnet', label: 'Base', chainId: 8453, currency: 'ETH', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', discovery: 'base' },
  bsc: { name: 'BNB Smart Chain', label: 'BNB Chain', chainId: 56, currency: 'BNB', rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com', discovery: 'bsc' },
  solana: { name: 'Solana Mainnet', label: 'Solana', currency: 'SOL', discovery: 'solana' },
} as const

export type AnalyticsNetwork = keyof typeof analyticsNetworks
export const analyticsNetworkIds = Object.keys(analyticsNetworks) as AnalyticsNetwork[]
const evmNetworks = [analyticsNetworks.ethereum, analyticsNetworks.base, analyticsNetworks.bsc]

export const evmNetwork = (chainId: number) => evmNetworks.find(network => network.chainId === chainId)

export function walletErrorCode(error: unknown) {
  const value = error as { code?: unknown; data?: { originalError?: { code?: unknown } } } | null
  return Number(value?.data?.originalError?.code ?? value?.code)
}

export async function switchEvmNetwork(provider: Eip1193Provider, chainId: number) {
  const readChain = async () => Number(await provider.request({ method: 'eth_chainId' }))
  if (await readChain() === chainId) return
  const hex = `0x${chainId.toString(16)}`
  const switchChain = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  try {
    await switchChain()
  } catch (error) {
    const network = evmNetwork(chainId)
    if (walletErrorCode(error) !== 4902 || !network) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: hex, chainName: network.name, rpcUrls: [network.rpc], blockExplorerUrls: [network.explorer],
      nativeCurrency: { name: network.currency === 'ETH' ? 'Ether' : 'BNB', symbol: network.currency, decimals: 18 },
    }] })
    if (await readChain() !== chainId) await switchChain()
  }
  if (await readChain() !== chainId) throw new Error('Wallet did not confirm the requested network.')
}
