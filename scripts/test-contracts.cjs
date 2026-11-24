require('dotenv').config()
const { spawnSync } = require('node:child_process')

function main() {
  const args = process.argv.slice(2)
  const forkOnly = args[0] === '--fork-only'
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
  const forkUrl = process.env.HARDHAT_FORK_RPC_URL?.trim()
    || (alchemyKey && `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`)

  if (forkOnly && !forkUrl) {
    throw new Error('Set HARDHAT_FORK_RPC_URL or ALCHEMY_API_KEY to run the Ethereum fork test')
  }

  if (forkUrl) {
    process.env.HARDHAT_FORK_RPC_URL = forkUrl
    process.env.HARDHAT_FORK_BLOCK_NUMBER = process.env.HARDHAT_FORK_BLOCK_NUMBER?.trim() || '21000000'
  }
  const testArgs = forkOnly
    ? ['contracts/test/network-fork.cjs', '--network', 'hardhat', ...args.slice(1)]
    : args
  const result = spawnSync(process.execPath, [
    require.resolve('hardhat/internal/cli/bootstrap'),
    'test',
    ...testArgs,
  ], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
