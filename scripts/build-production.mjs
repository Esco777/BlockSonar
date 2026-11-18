import { loadEnv } from 'vite'
import { isAddress, ZeroAddress } from 'ethers'
import { spawnSync } from 'node:child_process'

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const address = env.VITE_MEMBERSHIP_CONTRACT_ADDRESS
const chain = Number(env.VITE_MEMBERSHIP_CHAIN_ID)
if (!address || !isAddress(address) || address.toLowerCase() === ZeroAddress || !Number.isSafeInteger(chain) || chain <= 0 || chain === 31337 || chain === 1337) {
  console.error('Set VITE_MEMBERSHIP_CONTRACT_ADDRESS to your deployed public-chain contract and VITE_MEMBERSHIP_CHAIN_ID to its chain. Production cannot use local Hardhat membership.')
  process.exit(1)
}
const serverAddress = env.MEMBERSHIP_CONTRACT_ADDRESS
const serverChain = Number(env.MEMBERSHIP_CHAIN_ID)
if (!serverAddress || serverAddress.toLowerCase() !== address.toLowerCase() || serverChain !== chain) {
  console.error('Set backend MEMBERSHIP_CONTRACT_ADDRESS and MEMBERSHIP_CHAIN_ID to match the frontend deployment before building production.')
  process.exit(1)
}
const origins = (env.MEMBERSHIP_APP_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
if (!origins.length || origins.some(value => { try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value } catch { return true } })) {
  console.error('Set MEMBERSHIP_APP_ORIGINS to the exact HTTPS website origin(s) before building production.')
  process.exit(1)
}
if (!env.MEMBERSHIP_RPC_URL && !(env.ALCHEMY_API_KEY && [1, 11155111].includes(chain))) {
  console.error('Set a server MEMBERSHIP_RPC_URL or an Alchemy key for the membership chain before building production.')
  process.exit(1)
}
for (const task of ['build', 'build:server']) {
  const result = spawnSync('npm', ['run', task], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
