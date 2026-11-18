require('dotenv').config()
const { JsonRpcProvider, Contract, isAddress } = require('ethers')
async function main() {
  const [contractAddress, walletAddress] = process.argv.slice(2)
  if (!isAddress(contractAddress) || !isAddress(walletAddress)) throw new Error('Usage: npm run membership:check -- CONTRACT_ADDRESS WALLET_ADDRESS')
  const rpc = process.env.MEMBERSHIP_RPC_URL || 'http://127.0.0.1:8545'
  const provider = new JsonRpcProvider(rpc)
  try {
    if (await provider.getCode(contractAddress) === '0x') throw new Error('No membership contract at this address on the selected chain')
    const contract = new Contract(contractAddress, ['function hasAccess(address) view returns (bool)', 'function membershipTokenOf(address) view returns (uint256)'], provider)
    const hasAccess = await contract.hasAccess(walletAddress)
    console.log(JSON.stringify({ wallet: walletAddress, contract: contractAddress, chainId: (await provider.getNetwork()).chainId.toString(), hasAccess, tokenId: (await contract.membershipTokenOf(walletAddress)).toString() }, null, 2))
  } finally { provider.destroy() }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
