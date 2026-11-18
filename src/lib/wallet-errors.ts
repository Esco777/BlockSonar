import { Interface } from 'ethers'
import { MEMBERSHIP_ABI } from './membership-config.js'

const membershipInterface = new Interface(MEMBERSHIP_ABI)
const contractMessages: Record<string, string> = {
  StaleOraclePrice: 'The membership price feed has expired. Ask the operator to refresh it; for local testing, redeploy with npm run contracts:deploy:local and restart the frontend.',
  InvalidOraclePrice: 'The membership price feed returned invalid data. Contact the operator before minting.',
  MintingClosed: 'Public minting is currently closed.',
  IncorrectPayment: 'The mint price changed. Refresh the quote and try again.',
  AlreadyMember: 'This wallet already holds a membership NFT. Sign in to continue.',
  SoldOut: 'All memberships have been issued.',
  RefundFailed: 'Your wallet could not receive the excess native-currency refund. The purchase was reverted.',
  OnlyDeployer: 'Only the original contract deployer can withdraw membership funds.',
}

export function walletErrorText(error: unknown): string {
  // Wallets nest their RPC errors differently; ethers may wrap them again.
  const records: Record<string, unknown>[] = []
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()
  while (pending.length && records.length < 30) {
    const value = pending.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    records.push(record)
    for (const key of ['error', 'info', 'data', 'cause', 'originalError']) pending.push(record[key])
  }
  const codes = records.map((record) => record.code)
  if (codes.some((code) => code === 4001 || code === '4001' || code === 'ACTION_REJECTED')) return 'Wallet request cancelled. You can try again.'
  if (codes.some((code) => code === -32002 || code === '-32002')) return 'A wallet request is already pending. Open your wallet extension and approve or reject it, then try again.'
  if (codes.includes('INSUFFICIENT_FUNDS')) return 'Your wallet needs enough native currency for membership and network gas.'
  if (codes.includes('NETWORK_ERROR') || codes.includes(4900) || codes.includes(4901)) return 'Your wallet is disconnected or its network changed. Check the selected network and RPC connection, then reconnect.'

  for (const record of records) {
    if (typeof record.data !== 'string' || !/^0x[0-9a-f]+$/i.test(record.data)) continue
    try {
      const decoded = membershipInterface.parseError(record.data)
      if (decoded && contractMessages[decoded.name]) return contractMessages[decoded.name]
    } catch { /* Not membership revert data. */ }
  }
  // Prefer the underlying RPC message over ethers' generic wrapper. Never
  // render the serialized payload, which may contain transaction details.
  for (const record of [...records].reverse()) {
    for (const key of ['shortMessage', 'message']) {
      const message = record[key]
      if (typeof message !== 'string' || !message.trim() || /could not coalesce error|missing revert data|Internal JSON-RPC error/i.test(message)) continue
      return message
    }
  }
  return 'The wallet could not reach or complete a request on the selected network. Check its RPC connection; for local testing, keep npm run contracts:node running.'
}
