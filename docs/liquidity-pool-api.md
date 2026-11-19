# New pool discovery

Discovery and pool notifications use CoinGecko’s onchain new-pools endpoint for Ethereum, Solana and BNB Chain. The server uses the existing CoinGecko Demo or Pro configuration and keeps the API key private. When the key is missing or the request fails, the server uses public GeckoTerminal. Cards show which provider supplied the pool data, including USD prices.

The server caches results by network and page for 60 seconds, coalesces concurrent requests and respects provider rate-limit backoff. The Discover page supports the first three pages and retries on its next automatic refresh.
