# BlockSonar

A crypto research dashboard with Sonar market analysis, liquidity heatmaps, DEX swap history, and NFT membership.

## Local setup

Run from the repository root with Node.js and npm.

```sh
npm ci
```

| Order | Command | Purpose |
| --- | --- | --- |
| 1 | `npm run contracts:node` | Start Hardhat on `127.0.0.1:8545`. Keep it running. |
| 2 | `npm run contracts:deploy:local` | Deploy membership, open test minting, and update local environment files. Run once per fresh Hardhat node. |
| 3 | `npm run db:start` | Start PostgreSQL for DEX Intell and private lists. Keep it running. |
| 4 | `npm run start:server` | Start the backend on port 4001. Keep it running. |
| 5 | `npm run dev` | Start Vite. Open the URL it prints, usually `http://localhost:5173`. |

Use separate terminals for the long-running commands. If the frontend or backend was already running when you deployed membership, restart it to load the updated settings.

In your wallet, select Hardhat with RPC `http://127.0.0.1:8545`, chain ID `31337`, and currency ETH. Use a funded Hardhat test account. On **Join Now**, mint a test membership, or sign in if the wallet already has one. Restarting Hardhat requires redeploying and minting again.

PostgreSQL keeps saved swaps on disk. Start it again after a reboot or after stopping the database process. Live DEX indexing also requires configured RPC access and pools. [DEX Intell setup](docs/dex-intell.md)

## Common commands

| Command | Purpose |
| --- | --- |
| `curl http://localhost:4001/health` | Check backend and exchange feed status. |
| `npm run market:check` | Check connectivity to CoinGecko's public API. |
| `npm run build` | Type-check and build the frontend. |
| `npm run build:server` | Compile the backend. |
| `npm run test:server` | Run backend tests. |
| `npm run contracts:compile` | Compile Solidity contracts. |
| `npm run contracts:test` | Run Hardhat tests. |
| `npm run membership:check -- CONTRACT_ADDRESS WALLET_ADDRESS` | Check a wallet's membership on the configured chain. |
| `npm run contracts:deploy:sepolia` | Deploy to Sepolia using configured RPC, deployer, and oracle settings. |

## Production

Use a persistent Node.js 22 service. Configure `VITE_MEMBERSHIP_CONTRACT_ADDRESS` and `VITE_MEMBERSHIP_CHAIN_ID` for an already deployed public-chain contract. Pass those two public values as build arguments for Docker. Configure `MEMBERSHIP_CONTRACT_ADDRESS`, `MEMBERSHIP_CHAIN_ID`, `MEMBERSHIP_APP_ORIGINS`, and `MEMBERSHIP_RPC_URL` as runtime variables. Keep RPC credentials out of Docker build arguments. [Membership access](docs/membership-access.md) · [Environment example](.env.membership.example)

```sh
npm ci --include=dev
npm run build:production
npm start
```

For Docker Compose, export the same public build variables and run `docker compose up --build -d`. Use `docker compose logs -f` to follow logs. For HTTPS reverse proxies, disable buffering for `/api/liquidity/stream` and allow an idle timeout of at least 60 seconds.

For a Render Docker web service, the default image uses the existing Sepolia deployment. On startup, missing membership address and chain settings come from the build, and the allowed origin defaults to the service’s `onrender.com` URL. Set `MEMBERSHIP_APP_ORIGINS` when using a custom domain. Sepolia defaults to a public RPC unless you configure `MEMBERSHIP_RPC_URL` or `ALCHEMY_API_KEY`.

For DEX Intell on Render, set `DEX_DATABASE_URL` to your hosted PostgreSQL connection string and configure `ALCHEMY_API_KEY` with Ethereum Mainnet access or set `DEX_ETHEREUM_RPC_URL`. With both connections configured, the app defaults to the two Ethereum USDC/WETH pools and starts at block `26416294` when both `DEX_ETHEREUM_POOLS` and `DEX_ETHEREUM_START_BLOCK` are unset. For Sonar live market data, set `COINGECKO_DEMO_API_KEY` or `COINGECKO_PRO_API_KEY` for your plan.

### Sepolia test deployment

Discover uses CoinGecko for new pools on its supported mainnets, including when membership runs on Sepolia. Set `COINGECKO_DEMO_API_KEY` or `COINGECKO_PRO_API_KEY` in the Render web service environment. Discover falls back to GeckoTerminal if CoinGecko is unavailable.

Configure a funded Sepolia deployer, owner, and ETH/USD feed in the ignored `.env`. [Environment example](.env.membership.example)

Set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` for deployment. Set `MEMBERSHIP_TESTNET_ADDRESS` in `.env` to check an existing deployment.

The [Solidity ABI](src/abis/BlockSonarMembership.json) is available as JSON.

```sh
npm run contracts:deploy:sepolia
export MEMBERSHIP_TESTNET_ADDRESS=0xYourNewAddress
npm run contracts:check:sepolia
npm run contracts:open:sepolia
```

Use the deployed address for both the frontend and backend on chain `11155111`. Run the open command with the owner wallet key, then sign in with a Sepolia membership. The Node backend serves the dashboard and connects to market data providers independently of the membership chain.

| Feature | Hosted requirements |
| --- | --- |
| Sonar | Access to CoinGecko's public API. Full coverage depends on the available market data. |
| Liquidity Pools and Heatmap | Access to pool data providers and exchange WebSockets. Allow long-lived streams through the proxy. |
| DEX Intell | Persistent PostgreSQL, chain RPC access, and configured pools and start blocks. |
| Early Narrative Radar | Access to RSS and CoinGecko. Use persistent storage for narrative history. |

Use an empty PostgreSQL database for fresh history, or follow the [database migration guide](docs/reliability-and-testnet.md#migrate-to-hosted-postgresql) to carry over saved swaps and indexing progress.

## Guides

- [Membership deployment and minting](docs/multichain-membership.md)
- [DEX Intell](docs/dex-intell.md) · [Solana DEX](docs/solana-dex.md) · [Alchemy setup](docs/alchemy-setup.md)
- [Early Narrative Radar](docs/EARLY_NARRATIVE_RADAR.md) · [Wallet intelligence](docs/wallet-intelligence.md) · [Notifications](docs/NOTIFICATIONS.md)
- [Private lists, backups, and testnet walkthrough](docs/reliability-and-testnet.md)

### Multi-chain selector on Render

The header selector and wallet switching require no new frontend variables. Wallet-added EVM networks use public, keyless RPC URLs. Keep `ALCHEMY_API_KEY` and all private RPC URLs in Render's server environment.

- DEX Intell uses the existing `DEX_DATABASE_URL` and indexing workers. Configure verified pools and start blocks with `DEX_BASE_POOLS` / `DEX_BASE_START_BLOCK`, `DEX_ETHEREUM_POOLS` / `DEX_ETHEREUM_START_BLOCK`, and `DEX_BSC_POOLS` / `DEX_BSC_START_BLOCK`. The Ethereum production default above still applies. For Solana, set `DEX_SOLANA_POOLS` and `DEX_SOLANA_START_SLOT`.
- Workers use the chain's Alchemy endpoint by default. Explicit overrides are `DEX_BASE_RPC_URL`, `DEX_ETHEREUM_RPC_URL`, `DEX_BSC_RPC_URL`, and `DEX_SOLANA_RPC_URL`. Optional same-chain fallbacks use the corresponding `_FALLBACK_RPC_URL` variables, including an Infura endpoint where it serves the required chain and RPC methods.
- The Solana wallet balance uses the same mainnet RPC settings, or an existing mainnet `MEMBERSHIP_SOLANA_RPC_URL` when DEX RPC settings are absent. Solana membership on a test cluster retains its existing checkout configuration.

### Hardhat networks and deployments

| Hardhat network | Chain ID | Development settings |
| --- | --- | --- |
| `hardhat` / `localhost` | 31337 | `LOCAL_RPC_URL` defaults to `http://127.0.0.1:8545` |
| `sepolia` | 11155111 | `SEPOLIA_RPC_URL` |
| `ethereum` | 1 | `ETHEREUM_RPC_URL` |
| `base` | 8453 | `BASE_RPC_URL` |
| `bnb` | 56 | `BNB_RPC_URL` |
| `bnbTestnet` | 97 | `BNB_TESTNET_RPC_URL` |

Use `npm run contracts:node` on loopback and `npm run contracts:deploy:local` in another terminal. Set `LOCAL_MEMBERSHIP_WRITE_ENV=false` to leave app settings alone. Hardhat's funded accounts are for local use only.

With Ethereum RPC credentials configured, `npm run contracts:test` includes the WETH fork test. Run `npm run contracts:test:fork` to run that test by itself. Both commands use `HARDHAT_FORK_RPC_URL` or the Ethereum mainnet endpoint for `ALCHEMY_API_KEY`. The fork defaults to block `21000000`, which you can override with `HARDHAT_FORK_BLOCK_NUMBER`. To run a persistent fork, set `HARDHAT_FORK_RPC_URL` to an Ethereum archive RPC URL and run `npm run contracts:node`. Restart the local node to reset its fork state, or unset both fork variables before restarting to create a fresh local chain. [Hardhat fork documentation](https://v2.hardhat.org/hardhat-network/docs/guides/forking-other-networks)

For public testnets and mainnets, use a dedicated `DEPLOYER_PRIVATE_KEY` in the deployment shell or a separate secret store. Run `npx hardhat run scripts/deploy-membership.cjs --network <network>` with `MEMBERSHIP_OWNER`, `MEMBERSHIP_MAX_PRICE_AGE_SECONDS`, `MEMBERSHIP_MAX_SUPPLY`, `MEMBERSHIP_BASE_URI`, and the correct chain’s `MEMBERSHIP_ETH_USD_FEED` or `MEMBERSHIP_BNB_USD_FEED`. Mainnet also requires `CONFIRM_MEMBERSHIP_MAINNET=ethereum:1`, `base:8453`, or `bnb:56`, matching the command. To verify the contract, submit the source or compiler standard JSON from `artifacts/build-info` to the target explorer. Use Solidity 0.8.26, optimizer enabled with 200 runs, Paris EVM, and the constructor values in the deployment JSON.

Render uses the backend DEX and membership RPC settings documented above. Keep Hardhat fork URLs and deployer keys in your development or deployment environment. The homepage selector changes analytics only. Use **Connect Wallet**, the explicit switch action in the dropdown, or membership sign-in when a wallet action needs a particular chain.
