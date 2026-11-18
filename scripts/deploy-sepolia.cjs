const { ethers } = require('hardhat')
const { main: deployMembership } = require('./deploy-membership.cjs')

async function main() {
  const required = [
    'DEPLOYER_PRIVATE_KEY',
    'MEMBERSHIP_OWNER',
    'MEMBERSHIP_ETH_USD_FEED',
    'MEMBERSHIP_MAX_PRICE_AGE_SECONDS',
    'MEMBERSHIP_MAX_SUPPLY',
    'MEMBERSHIP_BASE_URI',
  ]
  const missing = required.filter(name => !process.env[name]?.trim())
  const { chainId } = await ethers.provider.getNetwork().catch(() => {
    throw new Error('Could not verify the Sepolia RPC. Check SEPOLIA_RPC_URL.')
  })
  if (chainId !== 11155111n) throw new Error('The deployment RPC must be on Sepolia (11155111).')
  console.log('Sepolia RPC verified.')
  if (missing.length) throw new Error(`Missing settings in .env: ${missing.join(', ')}`)

  const [deployer] = await ethers.getSigners()
  if (!deployer) throw new Error('No Sepolia deployer configured.')
  const address = await deployer.getAddress()
  if (await ethers.provider.getBalance(address) === 0n) {
    throw new Error(`Fund the deployer ${address} with Sepolia ETH for gas.`)
  }
  await deployMembership()
}

main().catch(error => {
  console.error(error.shortMessage || error.message)
  process.exitCode = 1
})
