# Wallet intelligence and discovery enrichment

## Current Alchemy connection

### Automatic holder lists and matching network tools

Both network tabs load a native-balance holder table immediately below the public
address form. No Find-button click is needed. The list polls every 60 seconds,
sorts largest-first with integer-safe decimal comparison, includes new addresses
returned by discovery, and reorders when their balances change. Manual refresh
remains available. Failed refreshes keep the last successful rows with a visible
stale-data message. Discovered addresses are not silently added to watchlists;
Track uses the existing watchlist limits, selection and persistence behavior.

Ethereum uses Blockscout's balance-ordered directory with a one-minute cache
(previously five minutes). Contracts are shown initially so the actual largest
returned account is not hidden; the existing contract filter remains available.
The original `eth` response field is preserved for compatibility.

Solana attempts Alchemy `getLargestAccounts`, then refreshes native balances and
account types using `getMultipleAccounts`. Alchemy currently rejects global
discovery on this account. In that case the list explicitly ranks **observed
addresses only**: watched public addresses and authorities in the latest 250
indexed Solana transactions, up to 100 candidates, returning the largest 30.
These are current native SOL balances, not the richest wallets across Solana.
When supported by the provider, global RPC membership can still be cached by a
node for up to two hours; current balances are rechecked before sorting. Program
and stake accounts can be hidden. Unsafe numeric balances are never rounded to
invent a ranking. See [Solana getLargestAccounts](https://solana.com/docs/rpc/http/getlargestaccounts).

Solana now also offers the Ethereum-style priced holdings summary, large-holding
and large-buy USD thresholds, an explicit unpriced-assets toggle, and tables for
large holdings and supported confirmed incoming swap legs. Current DefiLlama
quotes are clearly distinguished from historical execution values. Existing SOL
balances, valuation details, alerts, early purchases, pool links, cursor history,
and watchlist/alert preferences remain in place. Pricing errors do not hide them.

Endpoints: `/api/wallet-tracker/ethereum/holders` and
`/api/wallet-tracker/solana/holders`. Snapshots include source and coverage scope.
Builds and all 155 server tests pass, including precise ranking, rank changes,
native account types, directory caching, and honest Solana fallback scope.

Both wallet tabs now automatically use the existing server-only `ALCHEMY_API_KEY`
from the ignored root `.env`. The Alchemy app already enables Ethereum and Solana.
The UI identifies the source. Existing watchlists and observed history remain;
snapshots from a previous provider are refreshed after switching sources.

Ethereum uses Alchemy native balances, token balances/metadata, incoming/outgoing
transfer discovery and finalized receipts. Purchases still require authenticated
Uniswap V2/V3 events and observed wallet spend/receipt. Up to eight transactions
are examined per refresh. ERC-20 holdings process up to 30 nonzero positions
from the first 100-entry balance page; an explicit warning reports this limit.
Native balances remain available if token queries fail. Global large-holder
discovery continues to use Blockscout, separately from Alchemy wallet snapshots.

Solana uses finalized SOL, Token and Token-2022 balances, aggregating up to 200
token accounts per program with exact integer-derived balance strings. History
loads 20 finalized wallet-address signatures per page and accepts transaction
versions 0 and 1. Token-account-only incoming transfers may be absent. Supported
Orca Whirlpool and Raydium CPMM swap classification requires a recognized wallet
authority instruction, owner-verified pool, successful authenticated event, and
wallet spend/receipt. Unknown routes are not labeled verified purchases. Raw token
deltas are retained alongside approximate numeric activity display amounts.
Largest-holder concentration remains a sampled aggregation of owners from the
largest 20 token accounts, now also available through Alchemy RPC.

Adapters use bounded caches, in-flight coalescing and per-network request budgets.
Failures redact keys and URLs; missing transaction pages never advance the cursor.
If Alchemy is absent, the original Blockscout Ethereum provider and optional
Helius Solana provider remain selectable through server configuration. Errors do
not silently switch providers. Wallet polling remains browser-driven and separate
from shared DEX indexers. Wallet history remains file-backed.

DefiLlama supplies current valuation quotes. Missing prices remain unavailable;
current prices do not become historical execution prices or cost basis. Realized
P&L remains unavailable without complete priced history.

Validation: frontend build and all 149 server tests pass. Live API checks returned
Alchemy-backed Ethereum holdings/history and Solana balances/history, including
verified supported Solana swaps.

## Original discovery and optional Helius adapter

The existing GeckoTerminal new-pool discovery source, Liquidity Pools page, CoinGecko market data, memberships, and liquidity feeds remain in place. DEX Screener enriches exact discovered pool identities; its token endpoint is a fallback lookup, never a reason to substitute a different pool. No npm dependencies were added.

## Configuration and provider costs

DEX Screener public REST endpoints require no key. The official reference documents 300 requests/minute for pair/token lookups and 60/minute for orders/promotions. This implementation conservatively budgets 240 and 48 requests/minute respectively. Pair observations cache for 60 seconds; promotion orders for five minutes. Timestamped observations persist on the server. Promotion orders indicate historical paid promotion, not necessarily an active advertisement. No promotion observation is proof of organic trading.

Helius requires a server-only `HELIUS_API_KEY`. Export it in the environment of the existing Node backend (never use a `VITE_` variable):

```sh
export HELIUS_API_KEY='your-server-side-key'
npm run start:server
```

Run `npm run dev` in another terminal for development. Production continues to use the existing production scripts and server environment. The root .env is loaded automatically; other environment files must be explicitly loaded.

Helius provides free and paid plans with plan-specific credits, endpoint eligibility and throttles. This adapter imposes a shared ceiling of 60 upstream requests/minute, including RPC and transaction history. Each uncached wallet refresh uses one history call and three balance calls; holder inspection adds three RPC calls. Provider billing credits are not equivalent to request counts, especially for parsed history; consult the current account plan before enabling many wallets. No paid subscription, webhook, or third-party SDK is created automatically.

The adapter uses Helius's documented Enhanced Transactions history endpoint, now labeled legacy/maintenance by Helius. It remains isolated behind `WalletProvider` for migration to Parsed Events or an EVM provider. Confirm endpoint availability on your Helius plan. No Ethereum activity is implied by the EVM extension interface.

Sources: [DEX Screener API](https://docs.dexscreener.com/api/reference), [Helius Enhanced Transactions history](https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress), [Helius pricing](https://www.helius.dev/pricing).

## Persistence, polling, and coverage

Wallet history uses file persistence; DEX indexing separately uses PostgreSQL. Data is atomically written with restrictive file permissions to `data/intelligence.json` (override using `INTELLIGENCE_STORE_PATH`). This contains public address histories and market observations shared by this backend instance. Tracked-wallet lists and alert preferences are stored in PostgreSQL per authenticated membership wallet, independently of public address histories. Legacy browser lists are preserved without being automatically assigned to an account.

While Wallet Tracker is open, the selected wallet refreshes each minute and up to five other watched wallets refresh per minute in rotation. With 25 wallets, background coverage can take five minutes. Removing a watchlist entry stops its future browser polling; previously observed public history remains in the server store. Alerts are configurable in-app observations for the selected wallet, not push/email delivery. Closing the dashboard stops wallet polling. There is no webhook or always-on worker.

The optional Helius adapter loads up to 100 finalized transactions per page, including owned token-account changes; Alchemy loads 20 wallet-address signatures per page. Both use cursors and deduplicate signatures, and retains up to 10,000 transactions per wallet and 100 wallet caches. Retention bounds mean completeness is never asserted. Token-program and Token-2022 balances are supported. Provider failures retain the existing displayed snapshot and show an error; failed transactions remain visible but never count as purchases.

A maximum of 500 discovered pools is retained with up to 1,440 observations each. Upstream caching coalesces simultaneous requests, bounds entries, budgets provider calls, and respects numeric or HTTP-date Retry-After responses without retry storms. GeckoTerminal failure still surfaces the existing discovery status; when enrichment is unavailable, the client falls back to its original discovery request (after a 12-second enrichment request timeout) and labels the missing enrichment.

## Interpretation

- Canonical keys use normalized chain IDs and contract addresses. EVM addresses are case-insensitive; Solana addresses are case-sensitive. Different pools for one token remain separate. Different chains never merge based on ticker/name.
- Buy/sell counts are transaction counts, not unique buyers. Rolling 24-hour volume deltas can be negative and do not represent interval trading volume. Pool age continues to use the discovery creation timestamp.
- Purchases require a successful parsed SWAP with a swap event and wallet token movements. Intermediate route legs are netted by mint. Transfers, liquidity actions, unknown types, failed transactions, and observable internal movements are separate. Ownership relationships between different addresses are not inferred.
- Early buyers are observed successful incoming swap legs within ten minutes after a discovered pool's creation. Counts and timestamped count changes cover only queried wallet histories, not the whole market. A swap in that window does not establish which pool executed it. Repeat early buyers require different token contracts, not multiple pools of one token.
- Accumulation/distribution is a configurable repeated-direction heuristic over an observed hour, not a statistical anomaly score or wallet-quality ranking.
- Holder inspection aggregates owners of the largest 20 token accounts against current supply. It is a sampled lower bound that can include pool vaults, exchanges, and program custody; it is not a complete beneficial-owner distribution.
- FIFO realized P&L is implemented and tested for complete, explicitly priced trades including fees. The live provider does not supply reliable historical execution USD prices and complete opening inventory, so dashboard P&L is unavailable. Current DEX quotes are never used to invent historical profit. Transfers or unknown initial positions would require verified basis before enabling live P&L.

## Routes and validation

- `GET /api/discovery/pools?network=eth|solana|bsc&page=1..3`
- `GET /api/wallet-tracker?address=<Solana public key>&before=<optional signature>`
- `GET /api/intelligence` — scoped buyer summaries and timestamped count observations alongside pool market observations
- `GET /api/intelligence/token?mint=<Solana mint>` — DEX token pairs and provider-backed holder concentration

Frontend routes are `#/discover` and `#/wallet-tracker`. Vite proxies these APIs to the existing backend on port 4001. API errors redact provider URLs/credentials. The public APIs use process-wide budgets; deployments with multiple server replicas need a shared rate limiter and persistence service.

Run `npm run build`, `npm run test:server`. Added tests cover identity aliases and case sensitivity, duplicate pools, classification, failed transactions, routed token legs, early buyers, historical FIFO basis/fees/missing data, directional patterns, rate-limit caching, exact-pool enrichment, and persisted wallet history.

Live Helius results require the configured key and plan; deterministic tests use fake provider responses and do not spend API credits.

## DefiLlama connection

Wallet Tracker now includes a separate **Holdings value · DefiLlama** panel. The configured Alchemy or Helius adapter supplies observed balances and transactions; DefiLlama supplies current market prices from `https://coins.llama.fi/prices/current/{chain:contract,...}`. DefiLlama's documented free API is keyless. No Pro subscription or additional package is required. The public API documentation does not promise a fixed free-tier request allowance; this application imposes its own ceiling of 30 price requests/minute, caches for 60 seconds, and respects provider 429/Retry-After handling.

Price requests contain token identities only, never the watched wallet address. Native SOL is explicitly mapped to the wrapped SOL mint market quote. Address matching uses canonical chain IDs with case-sensitive Solana mints. Requests batch 50 unique tokens, with at most 200 unique price lookups per valuation; any additional balances remain visibly unpriced.

BlockSonar accepts only finite positive numeric prices with a timestamp no older than one hour (at most one minute into the future) and confidence at least 0.8. These thresholds are application policies. Missing timestamps, missing confidence, thinly covered tokens, invalid balances, and failed requests produce unavailable values. Partial results show a priced subtotal and coverage; they never claim a full wallet total. Amounts and USD estimates use JavaScript floating-point numbers and are approximate.

`GET /api/wallet-tracker/valuation?address=<Solana public key>` values the wallet's last server-observed balances. It returns the balance observation time separately from price timestamps. Without previously loaded balances, it explains that wallet balances must be loaded first. Pricing loads separately from activity tracking so price-provider failures cannot disable wallet monitoring. These values exclude unobserved assets, DeFi positions, and NFTs, and never feed historical P&L or cost basis.

DefiLlama does not replace the wallet transaction provider: its documented free endpoints cover token prices, protocols, TVL and other aggregate data, rather than arbitrary address transaction/balance histories. See the [official free API reference](https://api-docs.defillama.com/llms-free.txt). Historical-price endpoints exist but this connection deliberately does not infer historical execution values or profits from current holdings.

## Ethereum large holdings and supported buys

Open **Wallet Tracker → Ethereum · large holdings & buys**. The Ethereum tab has an independent private account watchlist, configurable large-holding and large-buy thresholds (defaults: $100,000 and $25,000), an explorer-listed large ETH-holder discovery button, and retained activity history. Existing Solana watchlists and the Helius connection remain unchanged.

This connection currently uses the public Ethereum Blockscout instance at `https://eth.blockscout.com/api/v2`. Live probes verified address information, ETH-holder listings, ERC-20 balances, transfers, transaction status, and raw event logs. It currently requires no key. **Blockscout documents per-instance API deprecation and migration to its Universal API**, so anonymous instance access is not a guaranteed long-term service. If access is withdrawn, this adapter will need migration to the authenticated Universal API; no paid plan or signup is activated automatically. See [Blockscout API overview](https://docs.blockscout.com/devs/apis), [official address endpoint reference](https://github.com/blockscout/agent-skills/blob/main/blockscout-analysis/references/blockscout-api/addresses.md), and [official transaction endpoint reference](https://github.com/blockscout/agent-skills/blob/main/blockscout-analysis/references/blockscout-api/transactions.md).

No package dependency or Ethereum RPC subscription was added. The server budgets all Ethereum Blockscout requests to 60/minute, caches wallet requests for a minute and holder discovery for five minutes, and respects upstream 429/Retry-After backoff. This is an application ceiling, not a guarantee of anonymous upstream capacity. A wallet refresh normally needs four discovery/holdings calls and up to two detail/log calls for each of eight transactions (20 ordinary calls before retries); failed calls can reduce coverage. Requests are spaced at least 350ms apart; transient transport/502/503/504 failures retry once within the same minute budget. HTTP 429 responses are not immediately retried. Only the selected Ethereum wallet polls every minute while this tab is open. Switching back to Solana stops Ethereum polling.

ETH and the first 200 eligible ERC-20 balance entries are shown, excluding provider-flagged spam/scam balances. Large-holder discovery returns the first 30 explorer-listed native ETH addresses, with an optional contract filter. These addresses can be exchange custody, staking infrastructure, contracts, or individuals; large holdings imply neither beneficial ownership nor trading skill. Contract balances may be restricted or unavailable for trading. Unpriced assets are explicitly separate from threshold-qualified holdings and do not count as zero.

Transaction history samples the latest eight distinct hashes from the first pages of ERC-20 transfers and direct address transactions, sorted by timestamp. The indexer supplies confirmed execution status and raw on-chain logs. A supported purchase requires all of:

- Successful, confirmed transaction initiated by the watched wallet.
- Complete first-page event logs; pagination/truncation withholds buy confirmation.
- A Swap emitted by an authenticated Ethereum Uniswap v2 or v3 pool. CREATE2 addresses use the official factory, init-code hash, token identities, and supported v3 fees (100, 500, 3000, 10000).
- Observable wallet spend (outgoing token amount or top-level ETH value), net incoming tokens, and a transfer path from an authenticated pool to the watched wallet for a purchased token.

Failed, pending, transfer-only, self-movement, mixed liquidity, unsupported DEX, and incomplete transactions do not count as purchases. Transactions involving unsupported smart-wallet execution or other recipients may remain unconfirmed. Uniswap v4, other DEXes, NFT trades, and complete internal native ETH tracing are not implemented. The activity table distinguishes top-level ETH transfer amounts from token movements and fees. A swap output can be a stablecoin or wrapped asset; the term purchase describes receipt from an observed swap, not a recommendation.

Authentication constants are from [Uniswap v2 SDK](https://github.com/Uniswap/v2-sdk/blob/main/src/constants.ts), [Uniswap v3 SDK](https://github.com/Uniswap/v3-sdk/blob/main/src/constants.ts), and [official deployments](https://developers.uniswap.org/deployments). This implementation reuses the existing ethers dependency; it does not install either SDK.

DefiLlama values holdings and supported purchased token quantities using current, timestamped quotes with the existing confidence/freshness checks. Native ETH uses the canonical wrapped ETH quote, just as native SOL uses wrapped SOL. A displayed large-buy USD value is explicitly a **current-value estimate**, not historical execution proceeds, transaction notional, realized profit, or cost basis. Missing quotes stay unavailable. Historical purchases are revalued at each refresh for consistency with that label. No Ethereum P&L or smart-money score is inferred.

Server history is atomically stored in `data/ethereum-wallets.json` (override `ETHEREUM_WALLET_STORE_PATH`), with 1,000 observed transactions per address and 50 cached addresses. Browser watchlists use `blocksonar-ethereum-wallets-v1` and support 25 entries. Removing an entry stops its selection/polling; retained public history is not deleted automatically. Store paths are excluded by the existing `data/` ignore rules.

Routes:

- `GET /api/wallet-tracker/ethereum?address=<Ethereum mainnet address>`
- `GET /api/wallet-tracker/ethereum/holders`

Tests cover decimal quantities, canonical ETH pricing identity, known mainnet pool addresses, v2/v3 purchases, routed receipts, spoofed pool events, third-party recipients, failed/pending transactions, incomplete logs, liquidity actions, transfers, self movements, missing fees/prices, signature deduplication, and persistence.

Ethereum partial-result handling preserves native balances when token/history endpoints are unavailable, and preserves token balances when the native endpoint fails. Coverage warnings identify these gaps. Detailed event confirmation has a ten-second work budget and current pricing has an eight-second wait budget; delayed work is never relabeled as a confirmed purchase or zero-valued holding.

Wallet balance hologram

Both network tabs include a neon holographic platform with a rotating asset logo and an observed balance. Before selection it walks through the native holder directory in directory order; after selection it walks through that wallet's holdings in source order. It advances every five seconds and wraps to the first entry. Pause, previous/next, and sequence buttons control the presentation. This display interval does not change the provider refresh interval or invent balance changes. The wallet owner, observation time, and directory scope remain visible.

Native and recognized assets use inline logos; Ethereum token metadata can supply an HTTPS logo, with a generic fallback if unavailable. Decimal quantities retain their exact value in the tooltip, and unavailable USD values remain explicitly unavailable. Reduced-motion preferences stop decorative motion while the balance sequence remains usable.

The hologram offers USD and Native display buttons, defaulting to USD and remembering the choice in browser storage. USD mode keeps native token quantities visible beneath the current value; native mode shows quantities first. Wallet Sonar uses server-side Alchemy Prices API quotes for both Ethereum and Solana, independently of the existing valuation tables. Missing prices, including unvalued directory balances, display “USD unavailable.” Visible asset quotes refresh every minute through the cached server endpoint.

Wallet Sonar now holds the native network coin stationary (ETH or SOL). Each five-second asset step draws three circuit traces toward a rectangular logo/ticker/balance card. The card switches on after extension, blinks off near the end, and the traces retract into the network coin before the next entry. Manual selection restarts the five-second interval. The USD/native controls and coin balance plaque stay visible; reduced-motion disables the decorative sequence and keeps the card visible.

The circuit display shows up to three compact asset boxes at once, using the current entry and the next two entries without duplicating short lists. Each box includes the asset logo, ticker, balance, native quantity/current USD counterpart, and owner link. Three circuit branches extend from the stationary network coin. The five-second cycle advances this three-entry window through the list.

The three branches now run a coordinated top-to-bottom sequence within each five-second cycle: circuits extend at 0–10%, 12–22%, and 24–34%; each corresponding box blinks on only after its circuit finishes. Boxes blink off top-to-bottom at 64–82%, then circuits retract top-to-bottom at 82–100%. All timing uses one cycle duration, preserving pause and reduced-motion behavior.

Blinking asset boxes use 90% of their previous width. Each box now links its asset contract/mint to DEX Screener in a new tab while retaining the wallet owner's explorer link. Native ETH and SOL link to their wrapped asset markets, explicitly labeled WETH market and Wrapped SOL market.

Wallet Sonar includes bottom-right Previous wallet / Next wallet buttons for the current network's saved watchlist. They wrap at either end and use the tracker's existing selection flow so the sonar, holdings, history, and selected watchlist button stay synchronized. The footer shows the selected wallet label and position. Buttons are disabled for an empty watchlist or an already selected single-wallet watchlist.

On Ethereum, Wallet Sonar's Change Wallet arrows now follow the displayed Large ETH Holders directory rather than the saved watchlist. Right moves down the ranked rows; left moves up, wrapping at the ends. If the selected address is outside the list, right begins at the first row. The contract-address filter applies to both the displayed table and arrow navigation. Browsing a holder selects its wallet data without adding it to the saved watchlist. Solana keeps its tracked-wallet navigation.

Rank labels display the first seven and last five address characters; the full address remains in the tooltip and links. Wallet Sonar now advances through non-overlapping groups of up to three assets. After the final group's complete five-second animation, it selects the next wallet in the current navigation list (next Large ETH Holder on Ethereum). It waits while balances load, does not skip empty/unavailable snapshots, and respects Pause. Single-asset wallets also advance after their full animation. A one-wallet list repeats its own assets instead of changing selection.

Circuit branches match the current batch size: three assets draw three branches, two draw the top two, and one draws only the top branch. Empty card slots remain reserved so a final single asset stays at the top rather than moving to the middle.

Wallet Sonar USD pricing now uses `GET /api/wallet-tracker/prices` with a validated Ethereum/Solana network and at most three token addresses. The server keeps `ALCHEMY_API_KEY` private and calls Alchemy Prices API. Native ETH/SOL use their canonical wrapped-token pricing identities. The coin plaque, animated boxes and sequence list multiply observed decimal balances by validated current Alchemy prices; they never fall back to previously supplied DefiLlama values. Unsupported prices stay unavailable. Other wallet analytics tables retain their existing valuation source. Verified live native ETH/SOL quotes, invalid-address rejection, and browser USD displays on both networks.
