const { ethers } = require('hardhat')
async function main() {
  const { chainId } = await ethers.provider.getNetwork()
  if (![11155111n, 97n].includes(chainId)) throw new Error('This check only supports Sepolia or BNB Testnet')
  const address = process.env.MEMBERSHIP_TESTNET_ADDRESS
  if (!ethers.isAddress(address || '') || await ethers.provider.getCode(address) === '0x') throw new Error('Set MEMBERSHIP_TESTNET_ADDRESS to the deployed testnet contract')
  const nft = await ethers.getContractAt('BlockSonarMembership', address)
  if (await nft.SALE_COMMISSION_PERCENT() !== 10n || await nft.PRICE_USD() !== 200n) throw new Error('Unexpected membership contract configuration')
  const quote = await nft.mintPrice()
  console.log(JSON.stringify({ address, chainId: String(chainId), owner: await nft.owner(), deployer: await nft.deployer(), maxSupply: String(await nft.maxSupply()), totalMinted: String(await nft.totalMinted()), mintingOpen: await nft.mintingOpen(), mintPriceWei: String(quote), commissionPercent: 10, readOnly: true }, null, 2))
}
main().catch(() => { console.error('Testnet check failed. Verify RPC, contract address, and oracle freshness. No transactions were sent.'); process.exitCode = 1 })
