const { expect } = require('chai')
const { ethers } = require('hardhat')
const { Readable } = require('node:stream')
const { EventEmitter } = require('node:events')
class Response extends EventEmitter {
  headers = {}; body = ''; statusCode = 200
  setHeader(name, value) { this.headers[name] = value }
  getHeader(name) { return this.headers[name] }
  writeHead(status) { this.statusCode = status }
  end(body = '') { this.body = body }
}
describe('Membership mint, sign-in, resale and access walkthrough', function () {
  it('uses a real NFT sale to revoke seller access, admit the buyer, and pay commission', async function () {
    const { MembershipAuth } = await import('../../server/dist/server/membership-auth.js')
    const [owner, seller, buyer] = await ethers.getSigners()
    const feed = await ethers.deployContract('MockEthUsdFeed', [8, 4000n * 10n ** 8n])
    const nft = await ethers.deployContract('BlockSonarMembership', [owner.address, await feed.getAddress(), 7200, 10, 'ipfs://test/'])
    let now = Date.now()
    const origin = 'http://localhost:5173'
    const auth = new MembershipAuth({ network: 'ethereum', configured: true, chainId: 31337, contractAddress: await nft.getAddress(), hasAccess: address => nft.hasAccess(address), validSignature: async (address, message, signature) => ethers.verifyMessage(message, signature) === address }, { NODE_ENV: 'test', MEMBERSHIP_APP_ORIGINS: origin }, () => now)
    const jars = new Map()
    const request = (wallet, body) => Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', cookie: jars.get(wallet.address) || '' }, socket: { remoteAddress: wallet.address } })
    const call = async (wallet, path, body) => {
      const response = new Response()
      await auth.handle(request(wallet, body), response, new URL(path, origin))
      const cookies = new Map((jars.get(wallet.address) || '').split('; ').filter(Boolean).map(pair => pair.split('=')))
      for (const value of response.headers['Set-Cookie'] || []) { const [name, token] = value.split(';')[0].split('='); cookies.set(name, token) }
      jars.set(wallet.address, [...cookies].map(([name, token]) => `${name}=${token}`).join('; '))
      return response
    }
    const login = async wallet => {
      const challenge = await call(wallet, '/api/auth/challenge', { network: 'ethereum', address: wallet.address, chainId: 31337 })
      return call(wallet, '/api/auth/verify', { signature: await wallet.signMessage(JSON.parse(challenge.body).message) })
    }
    try {
      expect((await login(buyer)).statusCode).to.equal(403)
      await nft.setMintingOpen(true)
      await nft.connect(seller).mint({ value: await nft.mintPrice() })
      expect((await login(seller)).statusCode).to.equal(200)
      const price = ethers.parseEther('1')
      await nft.connect(seller).listForSale(1, price)
      await expect(nft.connect(buyer).buyMembership(1, { value: price })).to.changeEtherBalances([seller, owner], [price * 9n / 10n, price / 10n])
      now += 5001
      expect((await call(seller, '/api/auth/session')).statusCode).to.equal(403)
      expect((await login(buyer)).statusCode).to.equal(200)
      expect(await nft.hasAccess(seller.address)).to.equal(false)
      expect(await nft.hasAccess(buyer.address)).to.equal(true)
    } finally { auth.stop() }
  })
})
