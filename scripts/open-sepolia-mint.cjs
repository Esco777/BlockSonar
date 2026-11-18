const { ethers } = require('hardhat')

async function main() {
  const { chainId } = await ethers.provider.getNetwork()
  if (chainId !== 11155111n) throw new Error('Mint activation requires Sepolia (11155111).')

  const address = process.env.MEMBERSHIP_TESTNET_ADDRESS
  if (!ethers.isAddress(address || '') || await ethers.provider.getCode(address) === '0x') {
    throw new Error('Set MEMBERSHIP_TESTNET_ADDRESS to the deployed Sepolia membership contract.')
  }
  const nft = await ethers.getContractAt('BlockSonarMembership', address, ethers.provider)
  if (await nft.PRICE_USD() !== 200n || await nft.SALE_COMMISSION_PERCENT() !== 10n) {
    throw new Error('Unexpected membership contract configuration.')
  }
  if (await nft.mintingOpen()) {
    console.log(`Minting is already open on ${address}.`)
    return
  }

  const [signer] = await ethers.getSigners()
  if (!signer || await signer.getAddress() !== await nft.owner()) {
    throw new Error('Set DEPLOYER_PRIVATE_KEY to the Sepolia membership owner key for this command.')
  }
  await nft.mintPrice()
  const transaction = await nft.connect(signer).setMintingOpen(true)
  console.log(`Mint activation transaction submitted: ${transaction.hash}`)
  await transaction.wait(2)
  console.log(`Minting is open on ${address}.`)
}

main().catch(error => {
  console.error(error.shortMessage || error.message)
  process.exitCode = 1
})
