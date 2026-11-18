# Native-network memberships

The homepage offers Ethereum, BNB Chain and Solana. A user selects a network, connects its wallet, and buys that network's membership NFT with ETH, BNB or SOL. A verified membership on **any one** network grants the same dashboard and API access. No bridge or Ethereum destination wallet is required for a Solana purchase.

Each deployment has its own supply cap and token IDs; the cap is not aggregated across networks. Buying on one chain does not create NFTs on the others. Ethereum/BNB memberships use the same ERC-721 contract and one-NFT-per-wallet ownership rule. Solana memberships are standard transferable SPL NFTs with immutable Metaplex metadata and master editions; the checkout rejects an existing member, but standard SPL transfers can put several memberships in one wallet. Access follows the holder.

## Funds and authority

`BlockSonarMembership.sol` retains native ETH/BNB purchase proceeds. Its immutable `deployer` alone can call `withdraw(recipient)`, even if the administrative owner changes. `MEMBERSHIP_OWNER` controls sale activation and owner-issued NFTs; it does not acquire withdrawal rights when different from the deployer. The contract refunds overpayment.

The Solana program retains SOL in its `treasury` PDA. Only the original deployment authority recorded at initialization may administer the sale or withdraw. Withdrawals preserve account rent. A purchase charges exactly the execution quote up to the user's cap; account creation rent and transaction fees are additional. No automatic payout is made to a wallet.

Existing Solidity deployments are not upgradeable. They keep their original behavior; the homepage blocks new purchases against the legacy deployment lacking `deployer()`, while existing NFT holders may still sign in. Deploy the revised contract and update configuration to activate retained funds. A new deployment does not automatically migrate old NFTs.

## Server and wallet access

`GET /api/auth/networks` provides public deployment details, without API keys or RPC URLs. The frontend uses this server configuration for all networks. Changing the selected network signs out and clears the displayed wallet. Ethereum/BNB use an injected EVM wallet; Solana uses an injected Solana wallet such as Phantom.

Each single-use signed login challenge and opaque HttpOnly session is bound to its network, chain, configured contract/program, wallet and website origin. EVM signatures support EOAs and ERC-1271 wallets. Solana uses Ed25519 message signatures. Solana membership verification reads finalized SPL token accounts and validates the program-owned mint registry and mint PDA, rather than trusting a ticker or NFT image. Counterfeit/unregistered NFTs grant no access. Transfers revoke access on the next membership check.

Only the fixed `/api/membership/solana/{access,quote,balance,prepare,submit,status}` checkout operations are public. They require an allowed website Origin, JSON POST and bounded requests. They do not expose an arbitrary RPC proxy. The backend prepares a transaction for wallet review, binds its exact message to a short-lived checkout intent, verifies the returned signature and submits it through the private RPC. Users sign their own transactions; the server holds no purchasing wallet key. Sign-in follows finalized confirmation. If confirmation times out, inspect the submitted transaction before retrying.

## Ethereum and BNB deployment

Copy the relevant settings from `.env.membership.example` into your existing environment. Do not replace an existing environment file or expose a private key with a `VITE_` prefix.

1. Configure a funded deployer, administrative owner, metadata URI, supply and correct Chainlink native/USD feed on the target chain.
2. Compile and test with `npm run contracts:test`.
3. Deploy explicitly with `npm run contracts:deploy:sepolia`, `npm run contracts:deploy:bnb-testnet`, `npm run contracts:deploy:bnb`, or `npm run contracts:deploy:ethereum`. The script verifies ETH/USD versus BNB/USD feed descriptions and never creates a mock on public chains. Set `ETHEREUM_RPC_URL` for Ethereum mainnet deployment.
4. Set the server deployment fields: Ethereum `MEMBERSHIP_CONTRACT_ADDRESS`, `MEMBERSHIP_CHAIN_ID`, `MEMBERSHIP_RPC_URL`; BNB `MEMBERSHIP_BNB_CONTRACT_ADDRESS`, `MEMBERSHIP_BNB_CHAIN_ID`, `MEMBERSHIP_BNB_RPC_URL`. Alchemy API-key URLs can supply the supported Ethereum/BNB RPCs. Keep existing public Ethereum `VITE_` settings aligned for production build validation.
5. Verify the deployment record and `deployer()` address, then explicitly open public minting as the administrative owner. Restart the backend after changing its configuration.

Public deployment spends funds and is a separate operational step. The local Hardhat deployment is test-only.

## Solana build and activation

Install Rust and official Solana/Agave SBF tools. This repository pins Rust dependencies in `solana/Cargo.lock`. No Anchor CLI is required.

1. Securely back up the program signing key. On a fresh checkout, run `npm run solana:keygen` before building. It creates an ignored keypair and updates `declare_id!` to its public ID. The command refuses to overwrite an existing key. Set `MEMBERSHIP_SOLANA_PROGRAM_ID` to that ID.
2. Run `npm run solana:test` and `npm run solana:build` (`cargo build-sbf`, architecture v0).
3. Set `MEMBERSHIP_SOLANA_CLUSTER` (`devnet` first), its private RPC, the deployer keypair file path, canonical Pyth SOL/USD price account, metadata URI and supply. The Pyth feed must have full verification, the exact SOL/USD feed ID, positive price, confidence within 1%, and a fresh publication within the configured age (maximum 300 seconds). The account is fixed at initialization.
4. Explicitly deploy `solana/target/deploy/blocksonar_membership.so` with the matching program keypair and intended deployer as upgrade authority. Confirm network, program ID and signer before sending.
5. Run `npm run solana:admin -- initialize`. Only the actual program upgrade authority can initialize the config. The sale starts closed. Run `npm run solana:admin -- open` when ready.
6. **Before enabling production, make the program immutable** by revoking its upgrade authority after initialization. Production verification rejects an upgradeable program, because upgrades could otherwise change the treasury withdrawal rules. This operation is irreversible; verify the program and configuration first.
7. Restart the backend with the deployed program settings. `npm run solana:admin -- close` closes minting; `npm run solana:admin -- withdraw SOLANA_RECIPIENT_ADDRESS` withdraws as the original deployer.

A reliable Pyth price publisher/pusher is required to keep the configured account fresh. A sponsored feed may update less often than the checkout's maximum age; do not assume it provides checkout freshness. Provision the required Pyth service/credentials or update infrastructure before activating a public sale. An Alchemy RPC key transports chain data but does not sign Pyth prices. Stale or missing oracle data disables purchases; existing memberships can still authenticate. No production SOL sale is enabled merely by adding the selector.

## Verification

`npm run test:server` covers network-bound sessions, real EVM/Ed25519 signatures, counterfeit NFT rejection, cluster mismatch, production upgrade authority and oracle freshness/verification checks. `npm run contracts:test` covers ETH/BNB quotes, retained funds, refunds and original-deployer withdrawal permissions.

For an isolated full Solana test, build the SBF program and obtain the public Metaplex program bytecode using official Solana tools (for example `solana program dump --url devnet metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s /tmp/blocksonar-metaplex.so`). Run `npm run solana:test:integration`. Set `SOLANA_TOOLS_BIN` if the validator is not on PATH and `SOLANA_TEST_METADATA_SO` for a different bytecode path. Port 8899 must be unused. The harness generates a new temporary ledger, mock Pyth account and disposable wallets, tests actual NFT creation/transfer, retained funds and unauthorized withdrawals, and stops its validator. It never sends public-chain transactions. Set `SOLANA_TEST_BROWSER=1` to also exercise the actual SOL checkout and sign-in in Chrome (set `CHROME_BIN` if needed); build the frontend first. Temporary signing keys are test-only.

For production also configure exact HTTPS `MEMBERSHIP_APP_ORIGINS`; see [membership access](membership-access.md) for session lifetime and scaling requirements. Membership records access rights; these contracts do not operate the dashboard, store its historical analytics, or guarantee service availability.
