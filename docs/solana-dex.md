# Solana swap collection

DEX Intell now has an independent Solana mainnet worker, using the existing
Alchemy key with `SOLANA_MAINNET` enabled. An explicit `DEX_SOLANA_RPC_URL`
can select another provider without changing decoder or storage code.

Supported adapters:

- Orca Whirlpool, verified owner `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`.
- Raydium CPMM, verified owner `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`.

Pool account discriminators, layouts, and mint addresses are checked. Swap
decoding follows [Orca's events](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/events.rs)
and [Raydium CPMM's events](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/states/events.rs).
Pool metadata comes from the finalized pool account. Official protocol APIs
were used only to discover initial addresses; they are not historical data sources.

The configured pools are:

- Orca SOL/USDC: `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`.
- Raydium CPMM SOL/USDC: `fAjTnZ9QqJkUmrr8cXutkYhpVge2qqtSZNt9qKn7YC2`.

Settings in the ignored `.env`:

```text
DEX_SOLANA_POOLS=<comma-separated case-sensitive pool addresses>
DEX_SOLANA_START_SLOT=<explicit first slot>
DEX_SOLANA_PAGE_SIZE=10
DEX_SOLANA_POLL_MS=10000
```

The worker checks the full mainnet genesis hash and queries finalized signatures
with `getSignaturesForAddress`, then retrieves each transaction with
`getTransaction` and transaction version support up to 1. Invocation-stack-aware
decoding accepts program-data events only from the verified owner program.
Failed transactions and failed/rolled-back CPI frames do not produce swaps.
Transfers, liquidity events and unrelated program data are not classified as swaps.
Truncated or unsupported log layouts and unavailable transactions fail the batch;
the cursor is retained for retry and the job exposes a failure status.

Migration 004 adds the protocol registry, `solana_indexer_state` and
`solana_transactions`. Each page commits raw transactions, normalized swaps and
pagination state together. Signature plus global transaction log index forms the
event identity; the chain-aware key keeps it separate from EVM events. Quantities
are decoded as u64 integers and stored as decimal strings, with no floating-point
conversion. Event transfer/protocol fee data stays in the raw transaction. Trader
attribution and USD pricing remain unavailable.

The durable `before` cursor allows long signature sweeps to resume after restart.
New signatures arriving during a sweep are processed in the next sweep. Only a
completed scan advances reported per-pool coverage and the signature anchor;
partial page results can appear in the feed before coverage is complete. The
coverage range uses **slots**, not block numbers, and the observation timestamp
does not claim to be the exact start-slot time. A missing or non-finalized saved
anchor blocks progress for investigation/retry; it is never silently skipped.
Quiet pools may have no transactions after the configured start slot.

Limitations: configured pools only; no chain-wide or automatic new-pool indexing.
Raydium AMM v4, CLMM, other Raydium variants, and pre-mint-field CPMM event
layouts are not supported. Provider-pruned or missing signature history cannot
establish complete coverage. The worker reports its scan scope rather than
claiming full Solana history. Account/program upgrades that change supported
layouts require a reviewed decoder update.

Validation includes pool ownership/layout checks, both swap directions, raw u64
precision, forged logs, CPI rollback, failed transactions, durable multi-page
resume, missing transaction rollback, deduplication and missing-anchor safeguards.
Live Alchemy checks decoded a real swap from each configured protocol. The
running worker and website API have also returned persisted Solana swaps.
