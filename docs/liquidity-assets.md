Liquidity Intelligence Terminal assets

The heatmap view offers Bitcoin, Ethereum and Solana. Ethereum and Solana initially use Coinbase spot ETH-USD and SOL-USD, respectively. Existing Bitcoin exchange and futures choices remain available; choosing ETH or SOL from an unsupported BTC exchange/market switches to Coinbase spot.

The stream and snapshot endpoints accept an optional exact symbol alongside exchange/market. Requests without a symbol retain the existing Bitcoin default. Registered feeds validate the selected symbol, quote and venue. BTC histories retain their existing keys; additional symbols receive unique keys so live frames, replayed history, status and Sonar Walls cannot mix assets. Coinbase ETH uses $1 buckets, SOL uses $0.10, and BTC keeps $25 buckets. Historical candle requests already use the selected feed symbol. Low-price axis labels retain cents.

The Liquidation Blocks view retains its existing coverage; the new options apply to the liquidity heatmap and Sonar Walls. These are exchange order books, not on-chain DEX liquidity pools.

Verified real live Coinbase snapshots for all three assets, browser switching and responsive layout, plus 26 focused feed/order-book/history/candle tests.

Ethereum and Solana futures

ETHUSDT and SOLUSDT now have Bybit USDT perpetual futures feeds, plus matching Bybit spot feeds. Both keep their asset-sized price buckets and native coin quantities. Spot and futures history keys remain distinct, even when symbols match. The Futures button is visible from Coinbase spot and switches to Bybit; switching assets preserves the market type when a supported feed exists. Returning to a spot-only exchange selects spot. USDT notionals remain explicitly USDT rather than being mislabeled USD. Coinbase spot remains available.

Verified live Bybit ETH/SOL futures snapshots, Futures selection from Coinbase, preserving futures when switching ETH to SOL, returning to spot, responsive layout, and 27 focused tests. The separate Liquidation Blocks view is unchanged.
