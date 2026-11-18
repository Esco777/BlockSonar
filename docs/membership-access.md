BlockSonar membership access enforcement

The membership NFT records ownership; the app and backend enforce access. The access-enforcement integration does not change membership ownership rules. The later treasury revision retains paid mint funds and restricts withdrawals to the immutable original deployer; a new deployment is required to use that revision. The access-only integration originally required no transactions. The later multichain tests use isolated local deployments and test funds only; no public deployment or real payment has been made. See [native-network memberships](multichain-membership.md).

Sign-in

1. The homepage confirms the connected wallet is on the configured chain and holds a membership NFT.
2. The server issues a five-minute, single-use, browser-cookie-bound Sign-In with Ethereum message containing the approved website origin, wallet address, chain, expiry and membership contract resource.
3. The wallet signs the message. This is an off-chain signature, not a paid transaction or token approval.
4. The server validates the signature and independently calls hasAccess on the configured contract. EOA signatures and ERC-1271 contract-wallet signatures are supported by the verifier.
5. Successful authentication creates an opaque eight-hour session in an HttpOnly, SameSite=Strict cookie. Production cookies additionally require Secure and use the __Host- prefix. Tokens are not placed in browser storage or URLs.

Protected data

All backend /api/* data routes and /stream require the session before running their handlers. Only /api/auth/* authentication endpoints are public; /health returns a minimal running status. The static homepage and app bundle remain public, as expected for browser assets. Public third-party exchange/market APIs are independent of BlockSonar's membership gate.

Membership checks coalesce per wallet and cache results for at most five seconds. Expiry and session revocation are checked on every protected request. Open liquidity and DEX event streams recheck every ten seconds, and close immediately when the current server session logs out. Ownership loss revokes that wallet's sessions when detected; allow up to approximately fifteen seconds for existing streams to stop. Provider failures deny data rather than treating membership as valid. The app revalidates its server session every ten seconds and matches the wallet, chain and contract. Sign-out, wallet changes and chain changes invalidate sessions. Delayed sign-in work cannot recreate a session after logout.

Normal member requests no longer require manually entering a DEX subscriber token: the main server authenticates membership before calling DEX routes. The standalone DEX module retains its existing token checks unless its caller explicitly supplies the authenticated-membership flag.

Configuration

- MEMBERSHIP_CONTRACT_ADDRESS and MEMBERSHIP_CHAIN_ID: deployed membership contract and its chain. Keep these aligned with VITE_MEMBERSHIP_CONTRACT_ADDRESS and VITE_MEMBERSHIP_CHAIN_ID used by the frontend.
- MEMBERSHIP_RPC_URL: server-side RPC for that chain. For Ethereum or Sepolia, the existing ALCHEMY_API_KEY can supply the default RPC. Local development defaults to http://127.0.0.1:8545 on chain 31337.
- MEMBERSHIP_APP_ORIGINS: comma-separated exact website origins. Production requires explicitly configured HTTPS origins, for example https://app.example.com. Development allows localhost/127.0.0.1 ports 3000, 4001, 5173 and 5174.
- NODE_ENV=production: enables Secure cookies and rejects local test-chain membership configuration. The deployment's RPC chain, bytecode and PRICE_USD constant are verified by the backend.

The local deployment helper now updates both frontend and backend membership configuration; restart both processes after a redeployment. Production builds require the public frontend contract and chain. Production startup checks the backend deployment against the built frontend and validates the RPC settings and HTTPS origins.

The local server has been matched to the existing local frontend contract. Production still requires a public-chain deployment, matching server/frontend configuration, HTTPS and the approved app origin. Do not deploy the local test contract as a production membership source.

Sessions and challenges currently live in one backend process: a restart signs users out. A multi-instance deployment needs sticky routing or a shared session/challenge store before scaling out. Rate limits use the actual socket address rather than trusting spoofable forwarded headers; account for the reverse proxy when configuring a production deployment. A member may sign back in after a restart without repurchasing membership.

Validation

Unit tests cover real wallet signatures, nonce replay, wrong signer/origin/chain, nonmembers, expiry, ownership loss, cookie security, provider failures, rate limits, logout during verification, and stream closure. Live application checks used the existing local member and a nonmember without any blockchain transactions. Browser checks covered sign-in, real protected DEX data, session restore, HTTP-only cookies, logout/address clearing, and rejected signatures.

References: https://eips.ethereum.org/EIPS/eip-4361 and https://docs.ethers.org/v6/api/hashing/#verifyMessage
