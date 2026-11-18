Liquidity pool API-key integration

Pool discovery attempts the Alchemy Trading API with the server-side ALCHEMY_API_KEY for Ethereum, Solana and BNB. The adapter validates network/address identity (including 32-byte EVM pool IDs), creation timestamps and numeric fields. Opaque pageKey pagination supports the existing first three UI pages. Requests use provider caching, budgets, backoff and timeouts; keys never reach the browser.

Live verification: the existing key is accepted by Alchemy Prices API but rejected by Trading API pool discovery with HTTP 401. Trading API is documented as private preview. Until access is available, the working GeckoTerminal discovery feed remains explicitly labeled and an access notice appears. Successful token quotes from Alchemy replace the corresponding pool base-token USD price and carry a separate Alchemy price label; unknown quotes retain discovery pricing without false attribution. Liquidity/volume are not falsely relabeled as Alchemy-derived.

Once Trading API requests succeed, Alchemy-discovered pool rows supply the supported metrics without using public discovery or DEX Screener enrichment for those rows. The existing source fallback remains available during provider failures. Empty/missing metrics are not invented. Pool notification discovery uses the same path.

Verification: all three networks returned 20 fallback pools; 14 Ethereum tokens received Alchemy USD quotes during the check. Twelve focused tests passed, both builds passed, and browser checks cover the working cards, source/access notices and responsive layout.

Official endpoint: https://www.alchemy.com/docs/data/trading-api/endpoints/discovery/get-new-pools
