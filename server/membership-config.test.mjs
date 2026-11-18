import test from 'node:test'
import assert from 'node:assert/strict'
import { membershipConfig } from './dist/src/lib/membership-config.js'
const address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
test('membership entry disables purchases without a valid deployed address and chain', () => {
  for (const [contract, chain] of [[undefined, undefined], ['', '1'], ['0xYourAddress', '1'], ['0x0000000000000000000000000000000000000000', '1'], [address, 'NaN'], [address, '-1'], [address, '1.5']]) assert.equal(membershipConfig(contract, chain).configured, false)
})
test('membership entry identifies Ethereum, Sepolia, and local configurations', () => {
  assert.equal(membershipConfig(address, '1').networkName, 'Ethereum')
  assert.equal(membershipConfig(address, undefined).chainId, 11155111)
  assert.equal(membershipConfig(address, '11155111').networkName, 'Sepolia testnet')
  assert.equal(membershipConfig(address, '31337').networkName, 'Local test network')
  assert.equal(membershipConfig(address, '31337').configured, true)
})
