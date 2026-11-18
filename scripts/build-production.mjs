import { loadEnv } from 'vite'
import { isAddress, ZeroAddress } from 'ethers'
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const address = env.VITE_MEMBERSHIP_CONTRACT_ADDRESS
const chain = Number(env.VITE_MEMBERSHIP_CHAIN_ID)
if (!address || !isAddress(address) || address.toLowerCase() === ZeroAddress || !Number.isSafeInteger(chain) || chain <= 0 || chain === 31337 || chain === 1337) {
  console.error('Set VITE_MEMBERSHIP_CONTRACT_ADDRESS to your deployed public-chain contract and VITE_MEMBERSHIP_CHAIN_ID to its chain. Production cannot use local Hardhat membership.')
  process.exit(1)
}
for (const task of ['build', 'build:server']) {
  const result = spawnSync('npm', ['run', task], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
writeFileSync('dist/membership-build.json', JSON.stringify({ address, chain }) + '\n')
