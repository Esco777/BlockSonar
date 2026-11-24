const { expect } = require('chai')
const { ethers, network } = require('hardhat')

describe('BlockSonarMembership', function () {
  const price = ethers.parseEther('0.05')
  const baseURI = 'ipfs://membership/'
  let owner, alice, bob, outsider, contract, feed
  beforeEach(async function () {
    ;[owner, alice, bob, outsider] = await ethers.getSigners()
    feed = await ethers.deployContract('MockEthUsdFeed', [8, 4000n * 10n ** 8n])
    contract = await ethers.deployContract('BlockSonarMembership', [owner.address, await feed.getAddress(), 7200, 3, baseURI])
    await contract.waitForDeployment()
  })

  const open = async () => contract.setMintingOpen(true)
  const mintAlice = async () => { await open(); await contract.connect(alice).mint({ value: price }) }

  it('supports native BNB-sized USD quotes with the same retained-funds rules', async function () {
    await feed.setRound(2, 600n * 10n ** 8n, (await ethers.provider.getBlock('latest')).timestamp, 2)
    const bnbQuote = 333333333333333334n
    expect(await contract.mintPrice()).to.equal(bnbQuote)

    await open()
    await contract.connect(alice).mint({ value: bnbQuote + 1000n })

    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(bnbQuote)
    expect(await contract.hasAccess(alice.address)).to.equal(true)

    await expect(contract.connect(alice).withdraw(bob.address)).to.be.revertedWithCustomError(contract, 'OnlyDeployer')
    await contract.withdraw(bob.address)

    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n)
  })

  it('initializes ownership, metadata, immutable sale settings, and closed minting', async function () {
    expect(await contract.owner()).to.equal(owner.address)
    expect(await contract.name()).to.equal('BlockSonar Lifetime Membership')
    expect(await contract.symbol()).to.equal('SONAR')
    expect(await contract.mintPrice()).to.equal(price)
    expect(await contract.maxSupply()).to.equal(3n)
    expect(await contract.mintingOpen()).to.equal(false)
    expect(await contract.hasAccess(ethers.ZeroAddress)).to.equal(false)
    expect(await contract.hasAccess(alice.address)).to.equal(false)

  })

  it('rejects zero owner, zero supply and empty metadata', async function () {
    const Factory = await ethers.getContractFactory('BlockSonarMembership')

    await expect(Factory.deploy(ethers.ZeroAddress, await feed.getAddress(), 7200, 3, baseURI)).to.be.revertedWithCustomError(contract, 'OwnableInvalidOwner')
    await expect(Factory.deploy(owner.address, await feed.getAddress(), 7200, 0, baseURI)).to.be.revertedWithCustomError(contract, 'InvalidSupply')
    await expect(Factory.deploy(owner.address, await feed.getAddress(), 7200, 3, '')).to.be.revertedWithCustomError(contract, 'EmptyBaseURI')

  })

  it('restricts sale activation to the owner', async function () {
    await expect(contract.connect(alice).setMintingOpen(true)).to.be.revertedWithCustomError(contract, 'OwnableUnauthorizedAccount')
    await expect(contract.connect(alice).mint({ value: price })).to.be.revertedWithCustomError(contract, 'MintingClosed')
    await expect(open()).to.emit(contract, 'MintingStatusChanged').withArgs(true)

  })

  it('accepts the exact price, emits membership issuance and grants access', async function () {
    await open()
    await expect(contract.connect(alice).mint({ value: price })).to.emit(contract, 'MembershipIssued').withArgs(alice.address, 1n)

    expect(await contract.ownerOf(1)).to.equal(alice.address)
    expect(await contract.hasAccess(alice.address)).to.equal(true)
    expect(await contract.membershipTokenOf(alice.address)).to.equal(1n)
    expect(await contract.tokenURI(1)).to.equal(`${baseURI}1`)

  })

  it('retains purchase proceeds in the contract until the original deployer withdraws', async function () {
    await open()
    expect(await contract.deployer()).to.equal(owner.address)

    await expect(contract.connect(alice).mint({ value: price })).to.changeEtherBalances([owner, contract], [0n, price])
    await contract.connect(bob).mint({ value: price })

    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(price * 2n)
    await expect(contract.withdraw(owner.address)).to.changeEtherBalances([contract, owner], [-price * 2n, price * 2n])
  })

  it('keeps withdrawal authority with the deployer after ownership transfer', async function () {

    await open()
    await contract.transferOwnership(bob.address)
    await contract.connect(bob).acceptOwnership()
    await expect(contract.connect(alice).mint({ value: price })).to.changeEtherBalances([owner,bob,contract],[0n,0n,price])
    await expect(contract.connect(bob).withdraw(bob.address)).to.be.revertedWithCustomError(contract,'OnlyDeployer').withArgs(bob.address)
    await expect(contract.withdraw(owner.address)).to.changeEtherBalances([contract,owner],[-price,price])

  })

  it('keeps deployer withdrawal authority separate from a different initial admin', async function () {
    const different=await ethers.deployContract('BlockSonarMembership',[bob.address,await feed.getAddress(),7200,3,baseURI])

    await different.connect(bob).setMintingOpen(true)
    await different.connect(alice).mint({value:price})
    await expect(different.connect(bob).withdraw(bob.address)).to.be.revertedWithCustomError(different,'OnlyDeployer')
    await expect(different.withdraw(owner.address)).to.changeEtherBalances([different,owner],[-price,price])

  })

  it('does not call the owner during a purchase, even when the owner rejects ETH', async function () {
    await open()
    const reject=await ethers.deployContract('RejectEther')
    await contract.transferOwnership(await reject.getAddress())
    await reject.acceptOwnership(await contract.getAddress())
    await contract.connect(alice).mint({value:price+1n})

    expect(await contract.totalMinted()).to.equal(1n)
    expect(await contract.hasAccess(alice.address)).to.equal(true)
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(price)
  })

  it('preserves an administrative owner', async function () {

    await expect(contract.renounceOwnership()).to.be.revertedWithCustomError(contract, 'InvalidRecipient')
    expect(await contract.owner()).to.equal(owner.address)

  })

  it('rejects underpayment without issuing tokens', async function () {
    await open()
    for (const amount of [0n, price - 1n]) await expect(contract.connect(alice).mint({ value: amount })).to.be.revertedWithCustomError(contract, 'IncorrectPayment').withArgs(price, amount)
    expect(await contract.totalMinted()).to.equal(0n)

  })

  it('limits membership to one NFT per wallet', async function () {
    await mintAlice()
    await expect(contract.connect(alice).mint({ value: price })).to.be.revertedWithCustomError(contract, 'AlreadyMember').withArgs(alice.address)

    expect(await contract.totalMinted()).to.equal(1n)
  })

  it('supports owner-issued memberships without opening public minting', async function () {
    await expect(contract.mintFor(alice.address)).to.emit(contract, 'MembershipIssued').withArgs(alice.address, 1n)

    expect(await contract.hasAccess(alice.address)).to.equal(true)
    await expect(contract.connect(alice).mintFor(bob.address)).to.be.revertedWithCustomError(contract, 'OwnableUnauthorizedAccount')
    await expect(contract.mintFor(ethers.ZeroAddress)).to.be.revertedWithCustomError(contract, 'InvalidRecipient')
    await expect(contract.mintFor(alice.address)).to.be.revertedWithCustomError(contract, 'AlreadyMember')
  })

  it('enforces the same supply cap for paid and owner-issued NFTs', async function () {

    await mintAlice()
    await contract.mintFor(bob.address)
    await contract.mintFor(owner.address)
    await expect(contract.connect(outsider).mint({ value: price })).to.be.revertedWithCustomError(contract, 'SoldOut')
    await expect(contract.mintFor(outsider.address)).to.be.revertedWithCustomError(contract, 'SoldOut')

  })

  it('moves membership to the recipient on transfer, including approved operators', async function () {
    await mintAlice()
    await contract.connect(alice).approve(outsider.address, 1)
    await contract.connect(outsider).transferFrom(alice.address, bob.address, 1)

    expect(await contract.hasAccess(alice.address)).to.equal(false)
    expect(await contract.membershipTokenOf(alice.address)).to.equal(0n)
    expect(await contract.hasAccess(bob.address)).to.equal(true)
    expect(await contract.membershipTokenOf(bob.address)).to.equal(1n)

  })

  it('prevents a transfer to an existing member without removing either membership', async function () {
    await mintAlice()
    await contract.mintFor(bob.address)
    await expect(contract.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWithCustomError(contract, 'AlreadyMember')

    expect(await contract.ownerOf(1)).to.equal(alice.address)
    expect(await contract.membershipTokenOf(bob.address)).to.equal(2n)
  })

  it('preserves membership on self-transfer', async function () {
    await mintAlice()
    await contract.connect(alice).transferFrom(alice.address, alice.address, 1)

    expect(await contract.hasAccess(alice.address)).to.equal(true)
    expect(await contract.membershipTokenOf(alice.address)).to.equal(1n)

  })

  it('does not expire or lose access when the sale closes', async function () {
    await mintAlice()
    await contract.setMintingOpen(false)
    await network.provider.send('evm_increaseTime', [50 * 365 * 24 * 60 * 60])
    await network.provider.send('evm_mine')

    expect(await contract.hasAccess(alice.address)).to.equal(true)
    await expect(contract.transferFrom(alice.address, owner.address, 1)).to.be.revertedWithCustomError(contract, 'ERC721InsufficientApproval')

    expect(contract.interface.hasFunction('burn')).to.equal(false)
    expect(contract.interface.hasFunction('revoke')).to.equal(false)

  })

  it('rejects unsafe NFT receivers and rolls back payment, supply, and membership', async function () {
    const receiver = await ethers.deployContract('RejectingReceiver')
    await open()
    await expect(receiver.mint(await contract.getAddress(), { value: price })).to.be.revertedWithCustomError(contract, 'ERC721InvalidReceiver')

    expect(await contract.totalMinted()).to.equal(0n)
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n)
    expect(await contract.hasAccess(await receiver.getAddress())).to.equal(false)
  })

  it('records access before safe-mint callbacks and prevents reentrant minting', async function () {
    const free = await ethers.deployContract('BlockSonarMembership', [owner.address, await feed.getAddress(), 7200, 3, baseURI])
    const receiver = await ethers.deployContract('ReenteringReceiver')
    await free.setMintingOpen(true)
    await receiver.mint(await free.getAddress(), { value: price })

    expect(await receiver.accessDuringCallback()).to.equal(true)
    expect(await receiver.reentrySucceeded()).to.equal(false)
    expect(await free.totalMinted()).to.equal(1n)

  })

  it('restricts withdrawals and rejects empty or invalid withdrawals', async function () {
    await expect(contract.withdraw(bob.address)).to.be.revertedWithCustomError(contract, 'NoFunds')
    await network.provider.send('hardhat_setBalance', [await contract.getAddress(), ethers.toQuantity(price)])
    await expect(contract.connect(alice).withdraw(alice.address)).to.be.revertedWithCustomError(contract, 'OnlyDeployer')
    await expect(contract.withdraw(ethers.ZeroAddress)).to.be.revertedWithCustomError(contract, 'InvalidRecipient')
    await expect(contract.withdraw(bob.address)).to.changeEtherBalances([contract, bob], [-price, price])

  })

  it('preserves proceeds when the withdrawal recipient rejects ETH', async function () {
    const reject = await ethers.deployContract('RejectEther')

    await network.provider.send('hardhat_setBalance', [await contract.getAddress(), ethers.toQuantity(price)])
    await expect(contract.withdraw(await reject.getAddress())).to.be.revertedWithCustomError(contract, 'WithdrawalFailed')

    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(price)

  })

  it('uses a two-step ownership handover', async function () {
    await contract.transferOwnership(bob.address)
    expect(await contract.owner()).to.equal(owner.address)

    await expect(contract.connect(alice).acceptOwnership()).to.be.revertedWithCustomError(contract, 'OwnableUnauthorizedAccount')
    await contract.connect(bob).acceptOwnership()

    expect(await contract.owner()).to.equal(bob.address)

  })

  it('implements ERC721 and ERC721 metadata interfaces', async function () {

    expect(await contract.supportsInterface('0x80ac58cd')).to.equal(true)
    expect(await contract.supportsInterface('0x5b5e139f')).to.equal(true)

  })

  it('charges $200 at changing ETH prices and rounds up, not down', async function () {

    expect(await contract.PRICE_USD()).to.equal(200n)
    const now = (await ethers.provider.getBlock('latest')).timestamp

    await feed.setRound(2, 2000n * 10n ** 8n, now, 2)

    expect(await contract.mintPrice()).to.equal(ethers.parseEther('0.1'))

    await feed.setRound(3, 3000n * 10n ** 8n, now, 3)

    const expected = (200n * 10n ** 18n * 10n ** 8n + 3000n * 10n ** 8n - 1n) / (3000n * 10n ** 8n)
    expect(await contract.mintPrice()).to.equal(expected)

  })

  it('rejects a stale payment quote and accepts a retry at the updated price', async function () {
    await open()
    const originalQuote = await contract.mintPrice()
    const { timestamp } = await ethers.provider.getBlock('latest')
    await feed.setRound(2, 2000n * 10n ** 8n, timestamp, 2)

    const updatedQuote = ethers.parseEther('0.1')
    await expect(contract.connect(alice).mint({ value: originalQuote }))
      .to.be.revertedWithCustomError(contract, 'IncorrectPayment')
      .withArgs(updatedQuote, originalQuote)
    expect(await contract.hasAccess(alice.address)).to.equal(false)
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n)

    await expect(contract.connect(alice).mint({ value: updatedQuote }))
      .to.emit(contract, 'MembershipPurchased')
      .withArgs(alice.address, 1n, updatedQuote)
    expect(await contract.hasAccess(alice.address)).to.equal(true)
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(updatedQuote)
  })

  it('refunds excess ETH when the current quote is lower than the submitted amount', async function () {
    await open()
    await expect(contract.connect(alice).mint({ value: price * 2n })).to.changeEtherBalances([alice, owner, contract], [-price, 0n, price])
    expect(await contract.hasAccess(alice.address)).to.equal(true)

  })

  it('uses feed decimals rather than assuming eight', async function () {
    const feed18 = await ethers.deployContract('MockEthUsdFeed', [18, ethers.parseEther('4000')])
    const member = await ethers.deployContract('BlockSonarMembership', [owner.address, await feed18.getAddress(), 7200, 3, baseURI])

    expect(await member.mintPrice()).to.equal(price)

  })

  it('rejects invalid feed configurations', async function () {
    const Factory = await ethers.getContractFactory('BlockSonarMembership')
    await expect(Factory.deploy(owner.address, ethers.ZeroAddress, 7200, 3, baseURI)).to.be.revertedWithCustomError(contract, 'InvalidPriceFeed')
    await expect(Factory.deploy(owner.address, await feed.getAddress(), 0, 3, baseURI)).to.be.revertedWithCustomError(contract, 'InvalidPriceAge')

    const invalid = await ethers.deployContract('MockEthUsdFeed', [19, 4000])
    await expect(Factory.deploy(owner.address, await invalid.getAddress(), 7200, 3, baseURI)).to.be.revertedWithCustomError(contract, 'InvalidPriceFeed')

  })

  it('blocks zero, negative, incomplete, zero-timestamp and future prices', async function () {
    const now = (await ethers.provider.getBlock('latest')).timestamp

    for (const [id, answer, updated, answered] of [[2, 0, now, 2], [2, -1, now, 2], [2, 400000000000n, now, 1], [0, 400000000000n, now, 0], [2, 400000000000n, 0, 2], [2, 400000000000n, now + 3600, 2]]) {
      await feed.setRound(id, answer, updated, answered)
      await expect(contract.mintPrice()).to.be.revertedWithCustomError(contract, 'InvalidOraclePrice')
    }

  })

  it('accepts an oracle price at its maximum age and rejects it one second later', async function () {

    const timestamp = (await ethers.provider.getBlock('latest')).timestamp

    await feed.setRound(2, 4000n * 10n ** 8n, timestamp, 2)
    await network.provider.send('evm_setNextBlockTimestamp', [timestamp + 7200])
    await network.provider.send('evm_mine')

    expect(await contract.mintPrice()).to.equal(price)

    await network.provider.send('evm_setNextBlockTimestamp', [timestamp + 7201])
    await network.provider.send('evm_mine')
    await expect(contract.mintPrice()).to.be.revertedWithCustomError(contract, 'StaleOraclePrice')

  })

  it('blocks stale-price purchases without affecting an existing lifetime member', async function () {

    await mintAlice()
    await network.provider.send('evm_increaseTime', [7201])
    await network.provider.send('evm_mine')
    await expect(contract.mintPrice()).to.be.revertedWithCustomError(contract, 'StaleOraclePrice')
    await expect(contract.connect(bob).mint({ value: price })).to.be.revertedWithCustomError(contract, 'StaleOraclePrice')

    expect(await contract.hasAccess(alice.address)).to.equal(true)
    expect(await contract.totalMinted()).to.equal(1n)

  })

  it('rolls back a purchase if excess ETH cannot be refunded', async function () {
    const receiver = await ethers.deployContract('RejectRefundReceiver')
    await open()
    await expect(receiver.mint(await contract.getAddress(), { value: price + 1n })).to.be.revertedWithCustomError(contract, 'RefundFailed')

    expect(await contract.totalMinted()).to.equal(0n)
    expect(await contract.hasAccess(await receiver.getAddress())).to.equal(false)
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n)

  })

})
