require('dotenv').config()
require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-chai-matchers')
const { subtask } = require('hardhat/config')
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names')

// Use the pinned npm compiler: tests do not download an unpinned compiler binary.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== '0.8.26') return runSuper()
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: solcVersion, longVersion: require('solc').version() }
})
const privateKey = process.env.DEPLOYER_PRIVATE_KEY
if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte key')
module.exports = {
  solidity: { version: '0.8.26', settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } },
  paths: { sources: './contracts', tests: './contracts/test', cache: './.hardhat-cache', artifacts: './artifacts' },
  networks: {
    ...(process.env.ETHEREUM_RPC_URL ? { ethereum: { url: process.env.ETHEREUM_RPC_URL, chainId: 1, accounts: privateKey ? [privateKey] : [] } } : {}),
    ...(process.env.BNB_RPC_URL ? { bnb: { url: process.env.BNB_RPC_URL, chainId: 56, accounts: privateKey ? [privateKey] : [] } } : {}),
    ...(process.env.BNB_TESTNET_RPC_URL ? { bnbTestnet: { url: process.env.BNB_TESTNET_RPC_URL, chainId: 97, accounts: privateKey ? [privateKey] : [] } } : {}),
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545', chainId: 31337 },
    ...(process.env.SEPOLIA_RPC_URL ? { sepolia: { url: process.env.SEPOLIA_RPC_URL, chainId: 11155111, accounts: privateKey ? [privateKey] : [] } } : {}),
  },
}
