const hre = require('hardhat')
const fs = require('node:fs/promises')
const path = require('node:path')
const { main: deployMembership } = require('./deploy-membership.cjs')

async function main() {
  const chainId = (await hre.ethers.provider.getNetwork()).chainId
  if (chainId !== 31337n) throw new Error('This script is only for the local Hardhat chain (31337).')
  const [deployer] = await hre.ethers.getSigners()
  if (!deployer) throw new Error('Start your local Hardhat node first.')

  // Local-only defaults never use a public-network price feed.
  process.env.MEMBERSHIP_OWNER = await deployer.getAddress()
  process.env.MEMBERSHIP_MAX_PRICE_AGE_SECONDS = '7200'
  process.env.MEMBERSHIP_MAX_SUPPLY = '10000'
  // Metadata is optional for local login; this is a placeholder, not a hosted site.
  process.env.MEMBERSHIP_BASE_URI = process.env.LOCAL_MEMBERSHIP_BASE_URI || 'about:blank#'
  delete process.env.MEMBERSHIP_ETH_USD_FEED
  const { record } = await deployMembership({ openMinting: true })
  if (hre.network.name === 'localhost' && process.env.LOCAL_MEMBERSHIP_WRITE_ENV !== 'false') {
    const envPath = path.join(__dirname, '..', '.env.local')
    let existing = ''
    try { existing = await fs.readFile(envPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const retained = existing.split('\n').filter((line) => !/^\s*(?:export\s+)?VITE_MEMBERSHIP_(?:CONTRACT_ADDRESS|CHAIN_ID)\s*=/.test(line)).join('\n').trimEnd()
    await fs.writeFile(envPath, `${retained}${retained ? '\n' : ''}VITE_MEMBERSHIP_CONTRACT_ADDRESS=${record.address}\nVITE_MEMBERSHIP_CHAIN_ID=31337\n`)
    const serverEnvPath = path.join(__dirname, '..', '.env')
    let serverExisting = ''
    try { serverExisting = await fs.readFile(serverEnvPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const serverRetained = serverExisting.split('\n').filter(line => !/^\s*(?:export\s+)?MEMBERSHIP_(?:CONTRACT_ADDRESS|CHAIN_ID|RPC_URL)\s*=/.test(line)).join('\n').trimEnd()
    await fs.writeFile(serverEnvPath, `${serverRetained}${serverRetained ? '\n' : ''}MEMBERSHIP_CONTRACT_ADDRESS=${record.address}\nMEMBERSHIP_CHAIN_ID=31337\nMEMBERSHIP_RPC_URL=${JSON.stringify(hre.network.config.url)}\n`, { mode: 0o600 })
    
  }
  console.log('Deploying local membership access.')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
