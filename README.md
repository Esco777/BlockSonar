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

### Sepolia test deployment

Configure a funded Sepolia deployer, owner, and ETH/USD feed in the ignored `.env`. [Environment example](.env.membership.example)

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
