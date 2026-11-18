import 'dotenv/config'
import { readFileSync } from 'node:fs'

process.env.NODE_ENV = 'production'
const env = process.env
let deployment
try {
  deployment = JSON.parse(readFileSync(new URL('../dist/membership-build.json', import.meta.url), 'utf8'))
} catch {
  console.error('Production build missing. Run npm run build:production before npm start.')
  process.exit(1)
}
const { address, chain } = deployment
if (env.RENDER === 'true' && env.RENDER_EXTERNAL_URL) {
  env.MEMBERSHIP_CONTRACT_ADDRESS ||= address
  env.MEMBERSHIP_CHAIN_ID ||= String(chain)
  env.MEMBERSHIP_APP_ORIGINS ||= env.RENDER_EXTERNAL_URL
  if (chain === 11155111 && !env.ALCHEMY_API_KEY) {
    env.MEMBERSHIP_RPC_URL ||= 'https://ethereum-sepolia.publicnode.com'
  }
}
const serverAddress = env.MEMBERSHIP_CONTRACT_ADDRESS
const serverChain = Number(env.MEMBERSHIP_CHAIN_ID)
if (!serverAddress || serverAddress.toLowerCase() !== address.toLowerCase() || serverChain !== chain) {
  console.error('Set backend MEMBERSHIP_CONTRACT_ADDRESS and MEMBERSHIP_CHAIN_ID to match the frontend deployment before starting production.')
  process.exit(1)
}
const origins = (env.MEMBERSHIP_APP_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
if (!origins.length || origins.some(value => { try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value } catch { return true } })) {
  console.error('Set MEMBERSHIP_APP_ORIGINS to the exact HTTPS website origin(s) before starting production.')
  process.exit(1)
}
if (!env.MEMBERSHIP_RPC_URL && !(env.ALCHEMY_API_KEY && [1, 11155111].includes(chain))) {
  console.error('Set a server MEMBERSHIP_RPC_URL or an Alchemy key for the membership chain before starting production.')
  process.exit(1)
}
// Use the actual build configuration for the server's frontend consistency checks.
env.VITE_MEMBERSHIP_CONTRACT_ADDRESS = address
env.VITE_MEMBERSHIP_CHAIN_ID = String(chain)
await import('../server/dist/server/index.js')
