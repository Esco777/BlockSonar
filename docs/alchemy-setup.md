# Alchemy for DEX Intell

The official `alchemy-api` and `alchemy-cli` Codex skills and `@alchemy/cli` are
installed locally. They are available to Codex starting on the next turn. Setup
followed [Alchemy's agent skills guide](https://www.alchemy.com/docs/alchemy-agent-skills.md).

The account uses API-key authentication. A dedicated **BlockSonar DEX Intell**
app enables Base, Ethereum, BNB, and Solana Mainnet. The key is in the ignored `.env` file with owner-only
permissions, never in a frontend variable. The server loads this file with
`dotenv` and constructs `https://base-mainnet.g.alchemy.com/v2/<key>` internally.
Ethereum uses `https://eth-mainnet.g.alchemy.com/v2/<key>` with the same key.
Explicit `DEX_BASE_RPC_URL` and `DEX_ETHEREUM_RPC_URL` values override Alchemy.
Ethereum requires `DEX_ETHEREUM_POOLS` and `DEX_ETHEREUM_START_BLOCK`; pool
protocols are detected and verified automatically against Uniswap V2/V3 factories.

Alchemy's CLI requires Node 22 or newer. Node 24.5.0 was already installed on this
machine and was used for CLI setup. In a new terminal, use `nvm use 24.5.0` before
running CLI commands. The system's current default Node was not changed.

Alchemy free-tier Base log queries allow at most 10-block ranges. The worker
defaults to batches of 10 for Alchemy. It waits one second between batches while
catching up; when caught up it returns to the configured polling interval.
Do not increase the batch size without verifying the account's plan limits.
See [Alchemy's eth_getLogs documentation](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs).

The local server now has `DEX_DATABASE_URL` configured for a real PostgreSQL
database on `127.0.0.1:5433`; swaps from Ethereum, Base, and BNB are being
persisted. Start it with `npm run db:start` in a separate terminal. Alchemy supplies raw blockchain data and
does not replace this storage. The remaining settings are listed in
[.env.dex.example](../.env.dex.example). Once configured, run:

```sh
npm run start:server
```

Keep credentials in `.env`. If you use an additional `.env.dex` file, avoid setting
`ALCHEMY_API_KEY` to an empty value there: process environment variables take
precedence over dotenv. Never send API keys through chat or commit `.env` files.

Indexing uses finalized blocks, so the displayed feed intentionally trails the
latest chain tip. Coverage starts at the saved explicit start block; this does
not claim all historical or chain-wide swaps. No paid plan or production
deployment was enabled during this setup.

The Ethereum extension was verified against chain ID 1 and the canonical factories.
The saved USDC/WETH V2 pair is `0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc`;
the saved V3 0.05% pool is `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`.
A finalized 10-block query ending at block 26416303 returned 13 V3 swaps, all
successfully decoded by the adapter, and zero V2 swaps in that same range.
These were read-only validation requests, not an established database collection
history. `.env` now contains Ethereum pool addresses, a recent explicit start block,
and a 10-block batch size. PostgreSQL was subsequently configured locally.

BNB uses the same key at `https://bnb-mainnet.g.alchemy.com/v2/<key>` and an
independent chain-ID-56 worker. Configure `DEX_BSC_POOLS` and
`DEX_BSC_START_BLOCK`. Factory-verified PancakeSwap V2 and V3 pools are supported;
PancakeSwap Infinity is not included. `DEX_BSC_RPC_URL`, `DEX_BSC_BATCH_BLOCKS`
and `DEX_BSC_POLL_MS` provide independent provider and polling settings.

Live BNB validation queried finalized blocks ending at 133628659. The verified
USDT/WBNB V2 pair `0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae` returned three
swaps, all decoded successfully. The verified V3 0.05% pool
`0x36696169c63e42cd08ce11f5deebbcebae652050` returned no swaps in the same
10-block range. Their pool addresses, recent start block, and batch size are
saved in the ignored `.env`. This validation did not start persistent collection.

Solana now uses the same key with `SOLANA_MAINNET` enabled. Verified Orca and
Raydium CPMM pools are configured in `.env` and the independent worker is
persisting actual swaps. See [Solana collection](solana-dex.md).
