import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'

function config(settings) {
  const env = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', ...settings }
  return spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("hardhat").userConfig.networks))'], { env, encoding: 'utf8' })
}

test('Hardhat isolates local accounts and configures Sepolia, Base and a pinned fork', () => {
  const result = config({
    SEPOLIA_RPC_URL: 'https://sepolia.invalid',
    BASE_RPC_URL: 'https://base.invalid',
    HARDHAT_FORK_RPC_URL: 'https://mainnet.invalid',
    HARDHAT_FORK_BLOCK_NUMBER: '21000000',
    DEPLOYER_PRIVATE_KEY: '',
  })
  assert.equal(result.status, 0, result.stderr)
  const networks = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(networks.localhost.chainId, 31337)
  assert.deepEqual(networks.sepolia.accounts, [])
  assert.equal(networks.sepolia.chainId, 11155111)
  assert.equal(networks.base.chainId, 8453)
  assert.equal(networks.hardhat.forking.blockNumber, 21000000)
  assert.equal(networks.hardhat.accounts, undefined)
})

test('invalid URLs and fork block settings fail without logging credentials', () => {
  const invalidUrl = config({ SEPOLIA_RPC_URL: 'invalid+secret' })
  assert.notEqual(invalidUrl.status, 0)
  assert.match(invalidUrl.stderr, /SEPOLIA_RPC_URL must be an HTTP/)
  assert.doesNotMatch(invalidUrl.stderr, /invalid\+secret/)
  const invalidBlock = config({ HARDHAT_FORK_RPC_URL: '', HARDHAT_FORK_BLOCK_NUMBER: '21000000' })
  assert.notEqual(invalidBlock.status, 0)
  assert.match(invalidBlock.stderr, /HARDHAT_FORK_BLOCK_NUMBER requires/)
})

test('remote deployments require credentials and chain-specific mainnet confirmation before RPC access', () => {
  const env = {
    ...process.env, DOTENV_CONFIG_PATH: '/dev/null', HARDHAT_FORK_RPC_URL: '', HARDHAT_FORK_BLOCK_NUMBER: '',
    DEPLOYER_PRIVATE_KEY: '', CONFIRM_MEMBERSHIP_MAINNET: '',
    BASE_RPC_URL: 'https://base.invalid', SEPOLIA_RPC_URL: 'https://sepolia.invalid',
    MEMBERSHIP_OWNER: '0x0000000000000000000000000000000000000042',
    MEMBERSHIP_MAX_PRICE_AGE_SECONDS: '3600', MEMBERSHIP_MAX_SUPPLY: '100', MEMBERSHIP_BASE_URI: 'https://metadata.invalid/',
  }
  for (const [network, expected] of [['base', /CONFIRM_MEMBERSHIP_MAINNET=base:8453/], ['sepolia', /DEPLOYER_PRIVATE_KEY/]]) {
    const result = spawnSync(process.execPath, ['node_modules/hardhat/internal/cli/cli.js', 'run', '--no-compile',
      'scripts/deploy-membership.cjs', '--network', network], { env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expected)
  }
})

test('deployment preflight refuses an RPC serving the wrong chain before sending transactions', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const hre = require('hardhat')
    let calls = 0
    hre.ethers.provider.send = async method => {
      if (method !== 'eth_chainId' || ++calls > 1) throw new Error('Unexpected RPC method')
      return '0x1'
    }
    require('./scripts/deploy-membership.cjs').main().then(() => {
      process.exitCode = 1
    }, error => {
      console.log(error.message)
    })
  `], {
    env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', HARDHAT_NETWORK: 'hardhat',
      HARDHAT_FORK_RPC_URL: '', HARDHAT_FORK_BLOCK_NUMBER: '', DEPLOYER_PRIVATE_KEY: '',
      MEMBERSHIP_OWNER: '0x0000000000000000000000000000000000000042',
      MEMBERSHIP_MAX_PRICE_AGE_SECONDS: '3600', MEMBERSHIP_MAX_SUPPLY: '100', MEMBERSHIP_BASE_URI: 'https://metadata.invalid/',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Deployment RPC chain does not match/)
})
