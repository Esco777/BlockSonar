const { expect } = require('chai')
const { ethers, network } = require('hardhat')

describe('Ethereum mainnet fork', function () {
  it('reads deployed WETH and changes its state only on the local chain', async function () {
    if (network.name !== 'hardhat' || !network.config.forking?.enabled) this.skip()
    this.timeout(60000)
    const metadata = await network.provider.send('hardhat_metadata')
    expect(metadata.chainId).to.equal(31337)
    expect(metadata.forkedNetwork.chainId).to.equal(1)
    if (network.config.forking.blockNumber !== undefined) {
      expect(metadata.forkedNetwork.forkBlockNumber).to.equal(network.config.forking.blockNumber)
    }

    const [signer] = await ethers.getSigners()
    const weth = new ethers.Contract('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', [
      'function symbol() view returns (string)',
      'function balanceOf(address) view returns (uint256)',
      'function deposit() payable',
    ], signer)
    expect(await weth.symbol()).to.equal('WETH')
    const before = await weth.balanceOf(signer.address)
    await (await weth.deposit({ value: 1n })).wait()
    expect(await weth.balanceOf(signer.address)).to.equal(before + 1n)
  })
})
