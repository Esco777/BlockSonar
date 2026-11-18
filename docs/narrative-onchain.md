Early Narrative Radar on-chain source health

The Wallet / on-chain activity source uses the existing server-side ALCHEMY_API_KEY. Each minute it samples one finalized Ethereum block with transaction senders and one finalized Solana slot with transaction signatures. Collection runs concurrently with news retrieval. Three bounded RPC requests per cycle use request coalescing, one-minute caching, timeouts and provider backoff.

Source Health displays transaction counts, distinct Ethereum sending addresses, Solana signature counts (including votes), and the successful collection time. A missing key remains unconfigured; partial or failed provider calls report an error without exposing upstream errors or credentials. Stale block timestamps are rejected, and a healthy source becomes stale after three minutes without successful collection.

These are network activity samples, not narrative-specific wallet attribution. Narrative on-chain score components remain unavailable until verified token/wallet-to-narrative associations exist. News/market scoring and unrelated wallet trackers are preserved.

Official RPC references:
- https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-block-by-number
- https://www.alchemy.com/docs/chains/solana/solana-api-endpoints/get-block

Validation covers successful collections, sender deduplication, caching, missing keys, partial failures, credential redaction, stale chain data, narrative service persistence and existing scoring. A live application endpoint check confirmed both Ethereum and Solana collection.

Narrative Momentum chart repair

The chart now plots recorded `category-activity-v1` live scores used by the radar ranking, rather than headline-count attention (which is legitimately zero for market-only categories). Its scale is 0–100, with narrative names in the legend and score/time tooltips. Comparison and range controls use the same recorded history. Legacy model points, future observations, invalid scores, and absent values are not turned into scores. Collection outages insert gaps, accounting for the service's minute / five-minute / hourly history compaction. A single valid observation remains visible as a dot. No synthetic historical points or new provider subscription is required.
