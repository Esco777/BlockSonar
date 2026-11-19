const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('BlockSonarMembership user-to-user sales', function () {
  const price = ethers.parseEther('1')
  let owner, seller, buyer, other, membership

  beforeEach(async function () {
    ;[owner, seller, buyer, other] = await ethers.getSigners()
    const feed = await ethers.deployContract('MockEthUsdFeed', [8, 4000n * 10n ** 8n])
    membership = await ethers.deployContract('BlockSonarMembership', [owner.address, await feed.getAddress(), 7200, 10, 'ipfs://membership/'])
    await membership.mintFor(seller.address)
  })

  it('settles a sale with 90% to the seller and 10% to the owner and moves access', async function () {
    await expect(membership.connect(seller).listForSale(1, price))
      .to.emit(membership, 'MembershipListed').withArgs(1, seller.address, price)

    const purchase = membership.connect(buyer).buyMembership(1, { value: price })
    await expect(purchase).to.changeEtherBalances([seller, buyer, owner, membership], [price * 9n / 10n, -price, price / 10n, 0n])
    await expect(purchase).to.emit(membership, 'MembershipSold').withArgs(1, seller.address, buyer.address, price, owner.address, price / 10n)

    expect(await membership.ownerOf(1)).to.equal(buyer.address)
    expect(await membership.hasAccess(seller.address)).to.equal(false)
    expect(await membership.membershipTokenOf(seller.address)).to.equal(0n)
    expect(await membership.hasAccess(buyer.address)).to.equal(true)
    expect(await membership.membershipTokenOf(buyer.address)).to.equal(1n)
    expect(await membership.salePrice(1)).to.equal(0n)
    expect(await membership.totalMinted()).to.equal(1n)
    await expect(membership.connect(other).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'NotForSale')

  })

  it('restricts listing and cancellation to the holder, including when an operator is approved', async function () {
    await membership.connect(seller).approve(other.address, 1)
    await expect(membership.connect(other).listForSale(1, price)).to.be.revertedWithCustomError(membership, 'NotTokenOwner')

    await expect(membership.connect(seller).listForSale(1, 0)).to.be.revertedWithCustomError(membership, 'InvalidSalePrice')
    await expect(membership.connect(seller).listForSale(99, price)).to.be.revertedWithCustomError(membership, 'ERC721NonexistentToken')

    await membership.connect(seller).listForSale(1, price)
    await membership.connect(seller).listForSale(1, price + 1n)
    expect(await membership.salePrice(1)).to.equal(price + 1n)
    await expect(membership.connect(other).cancelSale(1)).to.be.revertedWithCustomError(membership, 'NotTokenOwner')
    await expect(membership.connect(seller).cancelSale(1)).to.emit(membership, 'MembershipListingCancelled').withArgs(1)

    await expect(membership.connect(seller).cancelSale(1)).to.be.revertedWithCustomError(membership, 'NotForSale')
    await expect(membership.connect(buyer).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'NotForSale')

  })

  it('requires exact payment and rejects self-purchases and existing members', async function () {
    await membership.connect(seller).listForSale(1, price)

    for (const value of [0n, price - 1n, price + 1n]) {
      await expect(membership.connect(buyer).buyMembership(1, { value })).to.be.revertedWithCustomError(membership, 'IncorrectPayment').withArgs(price, value)
    }
    await expect(membership.connect(seller).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'InvalidRecipient')

    await membership.mintFor(buyer.address)
    await expect(membership.connect(buyer).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'AlreadyMember').withArgs(buyer.address)

    expect(await membership.ownerOf(1)).to.equal(seller.address)
    expect(await membership.salePrice(1)).to.equal(price)

  })

  it('clears listings on ordinary transfers, even if the token later returns to the seller', async function () {
    await membership.connect(seller).listForSale(1, price)

    await membership.connect(seller).transferFrom(seller.address, buyer.address, 1)
    await membership.connect(buyer)['safeTransferFrom(address,address,uint256)'](buyer.address, seller.address, 1)
    expect(await membership.salePrice(1)).to.equal(0n)

    await expect(membership.connect(other).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'NotForSale')

  })

  it('pays the current owner after ownership handover, independently of mint withdrawals', async function () {
    await membership.setMintingOpen(true)
    const mintPrice = await membership.mintPrice()
    await membership.connect(other).mint({ value: mintPrice })

    await membership.connect(seller).listForSale(1, price)
    await membership.transferOwnership(other.address)
    await membership.connect(other).acceptOwnership()

    await expect(membership.connect(buyer).buyMembership(1, { value: price }))
      .to.changeEtherBalances([owner, other, seller, membership], [0n, price / 10n, price * 9n / 10n, 0n])

    await expect(membership.withdraw(owner.address)).to.changeEtherBalances([membership, owner], [-mintPrice, mintPrice])

  })

  it('rounds commissions down to whole wei and assigns the remainder to the seller', async function () {
    await membership.connect(seller).listForSale(1, 19n)
    await expect(membership.connect(buyer).buyMembership(1, { value: 19n }))
      .to.changeEtherBalances([seller, owner, membership], [18n, 1n, 0n])

    await membership.connect(buyer).listForSale(1, 1n)
    await expect(membership.connect(seller).buyMembership(1, { value: 1n }))
      .to.changeEtherBalances([buyer, owner, membership], [1n, 0n, 0n])

  })

  it('rolls back the entire sale when the owner rejects its commission', async function () {
    const reject = await ethers.deployContract('RejectEther')
    await membership.transferOwnership(await reject.getAddress())
    await reject.acceptOwnership(await membership.getAddress())
    await membership.connect(seller).listForSale(1, price)

    const before = await ethers.provider.getBalance(seller.address)
    await expect(membership.connect(buyer).buyMembership(1, { value: price })).to.be.revertedWithCustomError(membership, 'SalePaymentFailed')

    expect(await ethers.provider.getBalance(seller.address)).to.equal(before)
    expect(await membership.ownerOf(1)).to.equal(seller.address)
    expect(await membership.hasAccess(buyer.address)).to.equal(false)
    expect(await membership.salePrice(1)).to.equal(price)
    expect(await ethers.provider.getBalance(await membership.getAddress())).to.equal(0n)

  })

  for (const callback of [1, 2]) {
    it(`blocks reentrant purchases from the ${callback === 1 ? 'NFT receiver' : 'seller payment'} callback`, async function () {
      const attacker = await ethers.deployContract('CallbackAttacker')
      const address = await attacker.getAddress()
      const target = await membership.getAddress()
      await attacker.configure(target, ethers.ZeroAddress, membership.interface.encodeFunctionData('buyMembership', [1]), 0, callback)

      if (callback === 2) {
        await membership.connect(seller).transferFrom(seller.address, address, 1)
        await attacker.execute(membership.interface.encodeFunctionData('listForSale', [1, price]))
        await membership.connect(buyer).buyMembership(1, { value: price })
      } else {
        await membership.connect(seller).listForSale(1, price)
        await attacker.execute(membership.interface.encodeFunctionData('buyMembership', [1]), { value: price })
      }

      expect(await attacker.attempted()).to.equal(true)
      expect(await attacker.succeeded()).to.equal(false)
      expect(await attacker.result()).to.equal(membership.interface.getError('ReentrancyGuardReentrantCall').selector)
      expect(await membership.salePrice(1)).to.equal(0n)

    })
  }
})
