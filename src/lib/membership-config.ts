import { isAddress } from 'ethers'

export const MEMBERSHIP_ABI = [
  'error InvalidOraclePrice()',
  'error StaleOraclePrice()',
  'error MintingClosed()',
  'error IncorrectPayment(uint256 expected, uint256 received)',
  'error AlreadyMember(address account)',
  'error SoldOut()',
  'error RefundFailed()',
  'error OnlyDeployer(address caller)',
  'function deployer() view returns (address)',
  'function hasAccess(address) view returns (bool)',
  'function mintPrice() view returns (uint256)',
  'function PRICE_USD() view returns (uint256)',
  'function mintingOpen() view returns (bool)',
  'function mint() payable returns (uint256)',
]
export function membershipConfig(address: string | undefined, chain: string | undefined) {
  const chainId = Number(chain || '11155111')
  const valid = !!address && isAddress(address) && !/^0x0{40}$/i.test(address) && Number.isSafeInteger(chainId) && chainId > 0
  return { address: address || '', chainId, configured: valid, networkName: chainId === 1 ? 'Ethereum' : chainId === 11155111 ? 'Sepolia testnet' : chainId === 31337 ? 'Local test network' : `Chain ${chainId}` }
}
