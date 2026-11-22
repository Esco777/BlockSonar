# DEX Intell

The Wallet Tracker navigation entry is now **DEX Intell**, at `#/dex-intell`.
The old hash still opens it. Existing Solana and Ethereum wallet tools, watchlists,
local preferences, APIs, discovery, coin analytics, and narrative sources remain intact.

## Swap Sonar animation

The DEX swaps tab now includes a code-native 3D coin/radar visualization directly
under the DEX Intell header. Input and output cards show token marks, names and
executed quantities from the currently filtered, indexed swaps. Supported marks
and decimal metadata are mapped by exact chain/address for WETH, USDC, WBNB,
BNB USDT, and wrapped SOL. Unknown assets use an address/generic mark and explicitly
show raw token units; decimals and USD prices are never guessed.

Integer-to-decimal conversion preserves the exact stored amount. Compact display
marks truncated quantities with an approximation symbol, exposes the full quantity
in the title, and avoids turning tiny nonzero quantities into zero. BNB USDT's
18 decimals are distinct from other networks' USDT contracts.

Initial/historical events are labeled recorded swaps; newly observed identities
are labeled newly indexed. The visualization samples queued events rather than
claiming to animate every chain transaction. The full table remains below. Its
source resets with chain/filter/page changes, retains the latest visual during
ordinary refreshes, and indicates delays without generating synthetic trades.
Pause/resume, replay, transaction links, mobile layouts and system reduced-motion
preferences are supported. The illustration uses CSS perspective, actual 3D
transforms and inline token SVG marks; no new image or rendering dependency.

## Repository inspection and file structure

The existing site is React/Vite with a Node HTTP server, file-backed narrative and
wallet intelligence, and no existing SQL database/migration system. DEX storage is
separate from those files; no existing data is converted or deleted.

- `src/components/DexIntell.tsx` and `.css`: swap feed, filters, pagination,
  coverage, access-token form, and preserved wallet intelligence.
- `src/lib/dex-intell.ts`: shared chain metadata and response types.
- `server/dex-api.ts`: bounded, parameterized queries, API authorization,
  rate limits, and SSE refresh notifications.
- `server/dex-store.ts`: pooled PostgreSQL connections and transactional migrations.
- `server/dex-rpc.ts`: interchangeable HTTP JSON-RPC provider and canonical pool verification.
- `server/dex-worker.ts`: independent Base/Ethereum/BNB worker instances and a separate Solana signature worker, resumable batches and finality checks.
- `server/dex-adapters.ts`: separate Uniswap V2/V3 event and factory adapters.
- `server/migrations/001-dex-intell.sql`: historical schema and query indexes.
- `server/migrations/002-ethereum-dex.sql`: Ethereum protocol registry and ambiguous swap storage.
- `server/migrations/003-bnb-dex.sql`: BNB PancakeSwap V2/V3 registry.

## Implemented increment

Base Mainnet **configured Uniswap V3 pools** and Ethereum Mainnet **configured Uniswap V2/V3 pools**, and BNB Chain **configured PancakeSwap V2/V3 pools**, not chain-wide indexing.
BNB factories follow PancakeSwap’s [V2 deployments](https://developer.pancakeswap.finance/contracts/v2/addresses) and [V3 deployments](https://developer.pancakeswap.finance/contracts/v3/addresses).
PancakeSwap V3 uses its own extended Swap event, including protocol fee fields; its topic differs from Uniswap V3.
The chain buttons in swaps and coverage are ordered Ethereum, Base, BNB Chain, Solana. Ethereum is selected initially.
Ethereum factory addresses follow the official [V2 deployments](https://developers.uniswap.org/docs/protocols/v2/deployments) and [V3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments).
Factory address is from [Uniswap's Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments).
Each pool's `factory`, tokens, fee (V3), and factory `getPool` (V3) or `getPair` (V2) result are verified via RPC.
V2 and V3 `Swap` events use separate ABI decoders. Ambiguous V2 flash/same-token swaps
are persisted in `dex_unclassified_swaps` with their raw payload and reason, and
reported as counts by chain/pool in `/api/data/coverage`. They do not enter directional analytics. Sender and recipient are not treated as traders.
Raw signed pool deltas are converted into positive input/output integer strings;
amounts are never converted to floating point. USD and wallet fields remain null.
Token metadata, USD pricing and beneficial trader attribution are not implemented.

Each worker checks its chain ID (Base 8453, Ethereum 1, or BNB 56), uses the RPC `finalized` head, and requires an
explicit start block. One batch per pool runs each polling cycle. Configure small
batches for restrictive providers. Archive availability is provider-dependent.
Failed ranges retry on the next cycle, retain their checkpoint, and expose job
status. Empty successful ranges advance coverage; failures do not.

Atomic transactions persist swaps, coverage, job status, and checkpoints together.
Chain/hash/log-index keys deduplicate events. PostgreSQL advisory locks prevent
two processes advancing the same pool concurrently. A changed finalized checkpoint
invalidates that pool's swaps, checkpoint, and coverage in one transaction and
replays from its original start block. No historical scores are produced during replay.
This deliberately favors correctness over speed for rare finalized-chain changes.

`GET /api/chains`, `/api/dex/swaps`, `/api/dex/swaps/:chain`,
`/api/data/coverage`, and `/api/dex/stream` are implemented.
`/api/dex/pools/new` explicitly reports discovery as pending.
Swap queries accept `chain`, `dex`, `pool`, `token`, `wallet`, `minUsd`, `from`,
`to`, `offset` (0–10000), and `limit` (1–100). UTC ISO dates are recommended.
Unpriced events do not match a minimum USD filter. Wallet filters do not match
unattributed events. SSE prompts clients to reread persisted history every 15 seconds;
it does not initiate indexing per browser. Feed queries are limited to 90/minute/IP,
streams to 100/process, SQL statements to 10 seconds, connections to five/process.
IP rate limits use the socket address, not untrusted forwarded headers.

## Local setup

This checkout now has a persistent project-local PostgreSQL database connected
through the ignored `.env`. Real swaps from all three supported chains have been
stored and verified through the dashboard API. Solana collection is also configured and returning persisted rows; see [Solana collection](solana-dex.md). For subsequent local sessions:

```sh
# Terminal 1: keep the database running
npm run db:start
# Terminal 2: keep indexing and the API running
npm run start:server
# Terminal 3: website development server
npm run dev
```

`db:start` uses prebuilt native PostgreSQL binaries from the development dependency
`embedded-postgres`, listens only on `127.0.0.1:5433`, uses SCRAM password
authentication, and stores data in the ignored `data/postgres` directory.
Credentials are generated into `.env` with owner-only permissions. Stopping the
database process retains records and checkpoints; the next start resumes them.
Running the helper again while the database is up safely reuses it. It refuses
to manage another database URL or replace credentials for an existing cluster.
This is a local development service; production still uses independently managed
PostgreSQL. Homebrew installation was stopped before compiling dependencies.

For a separate environment:

1. Provision PostgreSQL and Base and/or Ethereum JSON-RPC endpoints with historical logs and the
   `finalized` block tag, or use the local helper above.
2. Set the server variables in `.env.dex.example`. Never use a `VITE_` prefix.
   `DEX_BASE_POOLS` must contain Base Uniswap V3 pool addresses. To enable Ethereum,
   set `DEX_ETHEREUM_POOLS` (V2 pairs and/or V3 pools) and `DEX_ETHEREUM_START_BLOCK`.
   A shared Alchemy key alone does not opt in to Ethereum. Both chains may use the
   same key after enabling `BASE_MAINNET` and `ETH_MAINNET` in the Alchemy app.
   BNB is also opt-in: set `DEX_BSC_POOLS` and `DEX_BSC_START_BLOCK`, and enable
   `BNB_MAINNET` on the same Alchemy app. BNB uses `bnb-mainnet.g.alchemy.com`;
   `DEX_BSC_RPC_URL`, `DEX_BSC_BATCH_BLOCKS`, and `DEX_BSC_POLL_MS` override it.
   Per-chain overrides: `DEX_ETHEREUM_RPC_URL`, `DEX_ETHEREUM_BATCH_BLOCKS`,
   `DEX_ETHEREUM_POLL_MS` and the equivalent `DEX_BASE_*` values.
   For Alchemy, set `ALCHEMY_API_KEY` and leave `DEX_BASE_RPC_URL` blank. The
   server loads `.env` automatically and constructs the Base Mainnet endpoint.
   An explicit `DEX_BASE_RPC_URL` takes precedence for other providers.
   Alchemy defaults to 10-block log batches for free-tier compatibility. While
   behind the finalized head, the worker retries completed batches after one
   second; once caught up, it uses `DEX_POLL_MS` (default 10 seconds).
3. Run `npm run build:server`, then
   `node --env-file=.env.dex server/dist/server/index.js` after creating `.env.dex`.
4. Run `npm run dev` in another terminal and open `#/dex-intell`.

Versioned migrations run once at server startup inside a transaction and advisory lock.
Errors leave DEX queries returning 503 while existing services continue running.
No database URL means an explicit unconfigured response with zero fabricated data.
If an RPC is not configured, existing SQL history remains readable without indexing.
Restart the server after fixing initialization errors. Different pools run sequentially
within each worker. Base, Ethereum and BNB run independently, sharing one connection pool.
An invalid chain configuration is reported in the coverage response without stopping the other worker.

In production DEX endpoints fail closed unless `DEX_READ_TOKEN` is set. The UI can
send this bearer token from memory; it is never saved in browser storage. This is
operator access, **not completed subscriber membership authorization**. Integrate
wallet-signature sessions and membership checks before exposing this as a paid API.
Use TLS and trusted ingress rate limits in production. No deployment was performed.

## Migration and retention plan

Migration 001 creates the prompt's entity, event, checkpoint, job, and versioned
analytics tables. Only pool, swap, checkpoint, coverage, and job records are populated
by this increment. Other tables are reserved; their existence does not imply working
analytics. Existing website metrics continue using their current data sources.

No automatic deletion policy is enabled. Raw swaps and source payloads are retained.
Time partitioning is deferred to a separate migration with a cross-partition event
identity registry; PostgreSQL partitioned uniqueness must retain chain/hash/log-index
deduplication. Do not blindly partition by timestamp and lose event uniqueness.
Backup scheduling, restore verification, archival, growth monitoring, and partition
maintenance must be configured before sustained production collection. Until then,
operators must provision disk monitoring and PostgreSQL backups externally.

## Remaining phases, in prompt order

1. Inspection complete; initial schema and local module layout established.
2. Base configured-pool V3 worker and PostgreSQL storage implemented. Verify against
   a real operator RPC and full PostgreSQL instance before enabling collection.
3. Checkpoints, retries, idempotency, finalized reorg replay and per-pool coverage
   implemented. Operator-selectable backfill targets and gap audits remain pending.
4. DEX Intell live refresh, stored-history feed and coverage integrated.
5. Ethereum worker and verified Uniswap V2/V3 adapters implemented. BNB worker and verified PancakeSwap V2/V3 adapters are also implemented.
6. V4 singleton pool identity, Aerodrome stable and concentrated liquidity,
   PancakeSwap, factory pool creation and liquidity event collection.
7. Solana finalized signature worker with Orca Whirlpool and Raydium CPMM implemented; other Solana variants remain pending. See [Solana DEX collection](solana-dex.md).
8. Price provenance, metadata, wash-trading safeguards, baselines, versioned coin
   scoring and category aggregation from the stored events.
9. Token analytics/history/scores and wallet activity API, hype category/trending
   API, historical charts and version-preserving recalculation/backtesting.
10. Subscriber authorization, durable distributed queues, connection/cost monitoring,
    backups/restore drills, partitions/archives and full RPC integration tests.

Later-phase endpoints are not exposed as though implemented. No social hype,
market cap, liquidity, historical prices, categories, or scores are inferred from
incomplete swap-only observations.

## Validation

- Current Solana increment: frontend build and all 143 server tests pass.
- Live Alchemy validation verified Ethereum chain ID 1, both canonical WETH/USDC
  pools, and decoded all 13 V3 swaps returned for a finalized 10-block window.
- `npm run build` and `npm run build:server` pass.
- DEX tests cover private key configuration, provider precedence, V2/V3 factory
  verification and decoding, catch-up behavior, cross-chain event identity,
  ambiguous-event retention, and chain-isolated reorganization replay.
- Embedded PostgreSQL tests exercise the actual migration SQL, rollback,
  checkpoint resume, integer precision, deduplication, filtering, empty ranges,
  and finalized-reorganization replay. Advisory locks are mocked in this single
  connection test; cross-process locking needs full PostgreSQL verification.
- Isolated Chrome component checks pass at 1440px and 390px, including view and
  chain switching, preserved wallet tools, empty states, no mobile horizontal
  overflow, and no runtime exceptions. The membership login flow was not changed
  or exercised by this component preview.
- Alchemy setup verified Base chain ID, gas price, the factory-confirmed
  WETH/USDC pool, finalized-block reads, and a 10-block swap log query.
  Continuous ingestion into the local native PostgreSQL instance is now verified:
  all three migrations applied, and Ethereum, Base, and BNB swap endpoints return
  persisted rows. Browser checks confirmed real populated swap rows on desktop
  and mobile. Subscriber auth and production deployment remain unverified.
  See [Alchemy setup](alchemy-setup.md).

Swap Sonar USD readout

Swap Sonar displays a recorded USD value when supplied by the indexed event. Otherwise it requests current token quotes via `GET /api/dex/prices?chain=<chain>&tokens=<one-or-two-addresses>` and estimates the known-decimal input quantity's value, falling back to the output side when necessary. It does not sum the two sides. The display includes the quote timestamp and explicitly labels this as a current-value estimate, not historical execution value. Unknown decimals or missing/invalid quotes remain unavailable.

The price route reuses provider caching, timestamp validation, DEX access control and rate limits, and validates at most two token addresses. It does not alter recorded swaps, stored USD fields, historical USD filters, or execution-price coverage.

USD visibility: the animated coin plaque and swap table now display current-value USD estimates from the same shared quote set. The table labels estimates explicitly and exposes the quote time in a tooltip. Quotes refresh every minute, with up to eight known-decimal token identities per page batched two per request. Missing or stale quotes remain unavailable; neither estimated values nor their current prices alter recorded historical USD filters.

DEX USD pricing tries Alchemy first using the server-side `ALCHEMY_API_KEY`. CoinGecko supplies missing quotes by chain and token address using the existing server-side demo or pro settings. Without a CoinGecko key, the public endpoint is used with one address per request and may rate-limit. Each estimate reports its provider and quote timestamp. Missing, nonpositive, stale, and future-dated quotes remain unavailable.
