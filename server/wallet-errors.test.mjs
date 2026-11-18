import test from 'node:test'
import assert from 'node:assert/strict'
import { Interface } from 'ethers'
import { walletErrorText } from './dist/src/lib/wallet-errors.js'

test('wallet errors reveal nested RPC causes instead of the ethers wrapper', () => {
  assert.equal(walletErrorText({ shortMessage: 'could not coalesce error', error: { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { message: 'RPC connection refused' } } } }), 'RPC connection refused')
  assert.match(walletErrorText({ info: { error: { code: -32002 } } }), /already pending/)
  assert.match(walletErrorText({ error: { code: 4001 } }), /cancelled/)
  assert.match(walletErrorText({ code: 'INSUFFICIENT_FUNDS' }), /enough native currency/)
  assert.match(walletErrorText({ code: 4900 }), /disconnected/)
})

test('wallet errors decode contract failures nested by the RPC', () => {
  const abi = new Interface(['error StaleOraclePrice()', 'error OnlyDeployer(address caller)'])
  assert.match(walletErrorText({ shortMessage: 'could not coalesce error', error: { data: { data: abi.encodeErrorResult('StaleOraclePrice') } } }), /price feed has expired/)
  assert.match(walletErrorText({ data: abi.encodeErrorResult('OnlyDeployer',['0x1111111111111111111111111111111111111111']) }), /original contract deployer/)
})

test('wallet error fallback handles absent, circular, and unrecognized data', () => {
  const circular = { shortMessage: 'could not coalesce error' }
  circular.error = circular
  for (const error of [undefined, null, circular, { message: 'Internal JSON-RPC error.' }, { data: '0x1234' }]) {
    assert.match(walletErrorText(error), /RPC connection/)
  }
  assert.equal(walletErrorText(new Error('Switch your wallet to the local network.')), 'Switch your wallet to the local network.')
})
