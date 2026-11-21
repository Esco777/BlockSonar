const hre = require('hardhat')
const fs = require('node:fs/promises')
const path = require('node:path')

async function main({ openMinting = false } = {}) {
  const { ethers, network } = hre
  for (const name of ['MEMBERSHIP_OWNER', 'MEMBERSHIP_MAX_PRICE_AGE_SECONDS', 'MEMBERSHIP_MAX_SUPPLY', 'MEMBERSHIP_BASE_URI']) {
    if (!process.env[name]?.trim()) throw new Error(`Set ${name} before deploying; see .env.membership.example`)
  }
  if (!ethers.isAddress(process.env.MEMBERSHIP_OWNER) || process.env.MEMBERSHIP_OWNER === ethers.ZeroAddress) throw new Error('Invalid MEMBERSHIP_OWNER')
  const maxPriceAge = BigInt(process.env.MEMBERSHIP_MAX_PRICE_AGE_SECONDS)
  const supply = BigInt(process.env.MEMBERSHIP_MAX_SUPPLY)
  if (maxPriceAge <= 0n || supply <= 0n) throw new Error('Oracle maximum age and supply must be positive')
  const expectedChain = BigInt(network.config.chainId ?? 0)
  if ([1n, 56n, 8453n].includes(expectedChain) && process.env.CONFIRM_MEMBERSHIP_MAINNET !== `${network.name}:${expectedChain}`) {
    throw new Error(`Set CONFIRM_MEMBERSHIP_MAINNET=${network.name}:${expectedChain} to confirm this deployment`)
  }
  if (expectedChain !== 31337n && !process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('Set DEPLOYER_PRIVATE_KEY to configure a dedicated deployer for this network')
  }
  const networkId = await ethers.provider.send('eth_chainId', []).then(BigInt).catch(() => {
    throw new Error('Could not verify the deployment RPC chain. Check the selected network RPC setting.')
  })
  if (networkId !== expectedChain) throw new Error('Deployment RPC chain does not match the selected Hardhat network')
  if (openMinting && networkId !== 31337n) throw new Error('Automatic mint activation is only allowed on the local Hardhat chain.')
  if (![1n,11155111n,56n,97n,8453n,31337n].includes(networkId)) throw new Error('Unsupported membership deployment chain')
  const [deployer] = await ethers.getSigners()
  if (!deployer) throw new Error('Set DEPLOYER_PRIVATE_KEY to configure a dedicated deployer for this network')
  async function checkBalance(factory, args) {
    const transaction = await factory.getDeployTransaction(...args)
    const [gas, fees, balance] = await Promise.all([
      deployer.estimateGas(transaction), ethers.provider.getFeeData(), ethers.provider.getBalance(await deployer.getAddress()),
    ])
    const fee = fees.maxFeePerGas ?? fees.gasPrice
    if (fee == null || balance < gas * fee) throw new Error('Deployer balance is insufficient for the estimated deployment gas')
  }
  const nativeCurrency = [56n,97n].includes(networkId) ? 'BNB' : 'ETH'
  const expectedFeed = `${nativeCurrency}/USD`
  let feedAddress = nativeCurrency === 'BNB' ? process.env.MEMBERSHIP_BNB_USD_FEED : process.env.MEMBERSHIP_ETH_USD_FEED
  let mockFeed = false
  if (!feedAddress && networkId === 31337n) {
    const factory = await ethers.getContractFactory('MockEthUsdFeed', deployer)
    const args = [8, 4000n * 10n ** 8n]
    await checkBalance(factory, args)
    const mock = await factory.deploy(...args)
    await mock.waitForDeployment()
    feedAddress = await mock.getAddress()
    mockFeed = true
    console.log('LOCAL TEST ONLY: mock ETH/USD feed at $4,000 per ETH')
  }
  if (!feedAddress || !ethers.isAddress(feedAddress) || await ethers.provider.getCode(feedAddress) === '0x') throw new Error('Set the matching MEMBERSHIP_ETH_USD_FEED or MEMBERSHIP_BNB_USD_FEED Chainlink proxy for this chain')
  const feed = new ethers.Contract(feedAddress, ['function description() view returns (string)', 'function decimals() view returns (uint8)'], ethers.provider)
  if ((await feed.description()).replace(/\s/g, '') !== expectedFeed || await feed.decimals() > 18n) throw new Error('The configured feed must match the network native currency / USD with at most 18 decimals')
  const factory = await ethers.getContractFactory('BlockSonarMembership', deployer)
  const args = [process.env.MEMBERSHIP_OWNER, feedAddress, maxPriceAge, supply, process.env.MEMBERSHIP_BASE_URI]
  await checkBalance(factory, args)
  const contract = await factory.deploy(...args)
  await contract.waitForDeployment()
  const receipt = await contract.deploymentTransaction().wait(network.name === 'sepolia' ? 2 : 1)
  if (openMinting) await (await contract.setMintingOpen(true)).wait()
  const chainId = networkId.toString()
  const address = await contract.getAddress()
  const artifact = await hre.artifacts.readArtifact('BlockSonarMembership')
  const directory = process.env.MEMBERSHIP_DEPLOYMENTS_DIR || path.join(__dirname, '..', 'deployments')
  await fs.mkdir(directory, { recursive: true })
  const record = { address, chainId, network: network.name, nativeCurrency, deployer: await deployer.getAddress(), fundsPolicy: 'Held in contract; only the original deployer can withdraw', owner: process.env.MEMBERSHIP_OWNER, mintPriceUsd: '200', priceFeed: feedAddress, mockFeed, maxPriceAgeSeconds: maxPriceAge.toString(), quotedPriceWeiAtDeployment: await contract.mintPrice().then(String).catch(() => null), maxSupply: supply.toString(), baseURI: process.env.MEMBERSHIP_BASE_URI, transactionHash: receipt.hash, mintingOpen: await contract.mintingOpen(), abi: artifact.abi }
  const filename = path.join(directory, `membership-${chainId}-${address}.json`)
  await fs.writeFile(filename, JSON.stringify(record, null, 2) + '\n')
  console.log(`Membership deployed: ${address}\nChain: ${chainId}\nDeployment record: ${filename}\nPrice: $200 USD, paid in ${nativeCurrency} using the oracle quote. Gas is separate.\nPublic minting is ${record.mintingOpen ? 'OPEN for local testing' : 'CLOSED'}.`)
  return { contract, filename, record }
}
module.exports = { main }
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
