const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('MockEthUsdFeed', function () {
  const initialAnswer = 4000n * 10n ** 8n
  let feed

  beforeEach(async function () {
    feed = await ethers.deployContract('MockEthUsdFeed', [8, initialAnswer])
    await feed.waitForDeployment()
  })

  it('exposes the configured decimals and ETH/USD description', async function () {
    expect(await feed.decimals()).to.equal(8n)
    expect(await feed.description()).to.equal('ETH / USD')

  })

  it('initializes round one with the deployment timestamp', async function () {
    const receipt = await feed.deploymentTransaction().wait()
    const block = await ethers.provider.getBlock(receipt.blockNumber)

    expect(await feed.latestRoundData()).to.deep.equal([
      1n, initialAnswer, BigInt(block.timestamp), BigInt(block.timestamp), 1n,
    ])

  })

  it('replaces every round field and uses the supplied timestamp for both times', async function () {
    await feed.setRound(42, 2500n * 10n ** 8n, 1234567890, 43)

    expect(await feed.latestRoundData()).to.deep.equal([
      42n, 2500n * 10n ** 8n, 1234567890n, 1234567890n, 43n,
    ])

    await feed.setRound(44, initialAnswer, 1234567900, 44)
    expect(await feed.latestRoundData()).to.deep.equal([
      44n, initialAnswer, 1234567900n, 1234567900n, 44n,
    ])

    expect(await feed.decimals()).to.equal(8n)

  })

  it('allows any caller to configure a round for local tests', async function () {
    const [, caller] = await ethers.getSigners()
    await feed.connect(caller).setRound(2, 123, 456, 2)

    expect(await feed.latestRoundData()).to.deep.equal([2n, 123n, 456n, 456n, 2n])

  })

  for (const answer of [0n, -1n]) {
    it(`preserves an invalid oracle answer of ${answer} for consumer tests`, async function () {
      await feed.setRound(0, answer, 0, 0)
      expect(await feed.latestRoundData()).to.deep.equal([0n, answer, 0n, 0n, 0n])

    })
  }

  it('supports feeds with zero or eighteen decimal places', async function () {
    for (const decimals of [0, 18]) {
      const answer = 4000n * 10n ** BigInt(decimals)
      const otherFeed = await ethers.deployContract('MockEthUsdFeed', [decimals, answer])
      await otherFeed.waitForDeployment()

      expect(await otherFeed.decimals()).to.equal(BigInt(decimals))
      expect((await otherFeed.latestRoundData())[1]).to.equal(answer)
    }
  })
})
