const { ethers } = require('hardhat')
async function main() {
  const address = process.env.MEMBERSHIP_TESTNET_ADDRESS?.trim()
  if (!ethers.isAddress(address || '')) throw new Error('Set MEMBERSHIP_TESTNET_ADDRESS to the deployed testnet contract address.')
  const { chainId } = await ethers.provider.getNetwork().catch(error => {
    const code = error.code === 'EPERM' || error.code === 'EACCES' ? ' Outbound network access was denied.' : ''
    throw new Error(`Could not connect to the configured testnet RPC.${code}`)
  })
  if (![11155111n, 97n].includes(chainId)) throw new Error(`Expected Sepolia or BNB Testnet, got chain ${chainId}.`)
  const code = await ethers.provider.getCode(address).catch(() => { throw new Error('The RPC failed to return contract bytecode.') })
  if (code === '0x') throw new Error(`No contract at ${address} on chain ${chainId}.`)
  const nft = await ethers.getContractAt('BlockSonarMembership', address)
  const [commission, price, owner, deployer, maxSupply, totalMinted, mintingOpen] = await Promise.all([
    nft.SALE_COMMISSION_PERCENT(), nft.PRICE_USD(), nft.owner(), nft.deployer(), nft.maxSupply(), nft.totalMinted(), nft.mintingOpen(),
  ]).catch(() => { throw new Error('Could not read membership settings. Verify the contract address and RPC.') })
  if (commission !== 10n || price !== 200n) throw new Error('Unexpected membership contract configuration.')
  const quote = await nft.mintPrice().catch(error => {
    const reason = error.revert?.name
    if (reason === 'StaleOraclePrice') throw new Error('The oracle price is older than the contract’s maximum price age.')
    if (reason === 'InvalidOraclePrice') throw new Error('The oracle returned invalid price data.')
    throw new Error('Could not read the mint price. Check the configured oracle and RPC.')
  })
  console.log(JSON.stringify({ address, chainId: String(chainId), owner, deployer, maxSupply: String(maxSupply), totalMinted: String(totalMinted), mintingOpen, mintPriceWei: String(quote), commissionPercent: Number(commission), readOnly: true }, null, 2))
}
main().catch(error => { console.error(`Testnet check failed. ${error.message} No transactions were sent.`); process.exitCode = 1 })
