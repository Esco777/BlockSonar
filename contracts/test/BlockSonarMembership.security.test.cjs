const { expect } = require('chai')
const { ethers, network } = require('hardhat')

describe('BlockSonarMembership callback security', function () {
  const price = ethers.parseEther('0.05')
  let owner, buyer, sink, other, membership, attacker

  beforeEach(async function () {
    ;[owner, buyer, sink, other] = await ethers.getSigners()
    const feed = await ethers.deployContract('MockEthUsdFeed', [8, 4000n * 10n ** 8n])
    membership = await ethers.deployContract('BlockSonarMembership', [
      owner.address, await feed.getAddress(), 7200, 10, 'ipfs://membership/',
    ])
    attacker = await ethers.deployContract('CallbackAttacker')
    await membership.setMintingOpen(true)
    await network.provider.send('hardhat_setBalance', [await attacker.getAddress(), ethers.toQuantity(price * 3n)])
  })

  async function configure(method, args = [], value = 0n, callback = 2, forwardTo = ethers.ZeroAddress) {
    await attacker.configure(
      await membership.getAddress(), forwardTo,
      membership.interface.encodeFunctionData(method, args), value, callback,
    )
  }

  async function execute(method, args = [], value = 0n) {
    return attacker.execute(membership.interface.encodeFunctionData(method, args), { value })
  }

  async function expectGuard() {
    expect(await attacker.attempted()).to.equal(true)
    expect(await attacker.succeeded()).to.equal(false)
    expect(await attacker.result()).to.equal(membership.interface.getError('ReentrancyGuardReentrantCall').selector)
  }

  async function makeAttackerOwner() {
    await configure('mint')
    await membership.transferOwnership(await attacker.getAddress())
    await execute('acceptOwnership')
  }

  for (const [name, callback, excess] of [['NFT', 1, 0n], ['refund', 2, 1n]]) {
    it(`blocks a funded mint from the ${name} callback after the first NFT is transferred away`, async function () {
      await configure('mint', [], price, callback, sink.address)
      await execute('mint', [], price + excess)
      await expectGuard()
      expect(await membership.totalMinted()).to.equal(1n)
      expect(await membership.ownerOf(1)).to.equal(sink.address)
      expect(await membership.hasAccess(await attacker.getAddress())).to.equal(false)
      expect(await membership.membershipTokenOf(sink.address)).to.equal(1n)
      expect(await ethers.provider.getBalance(await membership.getAddress())).to.equal(price)
      // The guard must unlock after settlement for the next legitimate buyer.
      await membership.connect(buyer).mint({ value: price })
      expect(await membership.totalMinted()).to.equal(2n)
    })
  }

  const ownerAttacks = [
    ['mint', [], price],
    ['mintFor', 'recipient', 0n],
    ['withdraw', 'recipient', 0n],
    ['setMintingOpen', [false], 0n],
    ['transferOwnership', 'recipient', 0n],
  ]
  for (const [method, configuredArgs, value] of ownerAttacks) {
    it(`blocks ${method} from an owner contract's refund callback`, async function () {
      await makeAttackerOwner()
      const args = configuredArgs === 'recipient' ? [other.address] : configuredArgs
      await configure(method, args, value)
      const balanceBefore = await ethers.provider.getBalance(await attacker.getAddress())
      await execute('mint', [], price + 1n)
      await expectGuard()
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(balanceBefore + 1n)
      expect(await membership.totalMinted()).to.equal(1n)
      expect(await membership.ownerOf(1)).to.equal(await attacker.getAddress())
      expect(await membership.owner()).to.equal(await attacker.getAddress())
      expect(await membership.pendingOwner()).to.equal(ethers.ZeroAddress)
      expect(await membership.mintingOpen()).to.equal(true)
      expect(await ethers.provider.getBalance(await membership.getAddress())).to.equal(price)
    })
  }

  it('defers pending ownership acceptance until after the NFT callback', async function () {
    await membership.transferOwnership(await attacker.getAddress())
    await configure('acceptOwnership', [], 0n, 1)
    const ownerBalance = await ethers.provider.getBalance(owner.address)
    await attacker.connect(buyer).execute(membership.interface.encodeFunctionData('mint'), { value: price })
    await expectGuard()
    expect(await membership.owner()).to.equal(owner.address)
    expect(await ethers.provider.getBalance(owner.address)).to.equal(ownerBalance)
    await execute('acceptOwnership')
    expect(await membership.owner()).to.equal(await attacker.getAddress())
  })

  it('blocks recursive withdrawals by a recipient contract', async function () {
    await makeAttackerOwner()
    await configure('withdraw', [await attacker.getAddress()])
    await network.provider.send('hardhat_setBalance', [await membership.getAddress(), ethers.toQuantity(price)])
    const balanceBefore = await ethers.provider.getBalance(await attacker.getAddress())
    await membership.withdraw(await attacker.getAddress())
    await expectGuard()
    expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(balanceBefore + price)
    expect(await ethers.provider.getBalance(await membership.getAddress())).to.equal(0n)
  })

  it('allows cancelling a pending ownership handover outside callbacks', async function () {
    await membership.transferOwnership(other.address)
    await membership.transferOwnership(ethers.ZeroAddress)
    await expect(membership.connect(other).acceptOwnership())
      .to.be.revertedWithCustomError(membership, 'OwnableUnauthorizedAccount').withArgs(other.address)
    expect(await membership.owner()).to.equal(owner.address)
  })
})
