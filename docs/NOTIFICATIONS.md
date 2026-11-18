# Header notifications

The header bell shakes only while the pointer hovers over it and stops immediately on mouse leave. New alert content alone triggers a separate three-second vibration and green pixel burst. Clicking only opens or closes the dropdown. Repeated polls with unchanged content do not trigger an update burst. Clicking opens a nonmodal dropdown; its close button, Escape, or an outside click closes it. Reduced-motion preferences disable animation. The bell and dropdown remain available on narrow screens.

The dropdown shows:

- The first two Sonar coins under the shared default signal rules, ordered exactly like the default Sonar table. Prices and 24h changes come from the already-loaded live market universe. Sample coins never appear as live notifications. Coin rows open their market reports; View Sonar opens the Sonar page.
- The first two newest pools across Ethereum, Solana, and BNB Chain, deduplicated by canonical chain/address. Discovery reuses the existing GeckoTerminal source and server cache. Pool rows open their actual pool pages; View pools opens BlockSonar Liquidity Pools. No extra DEX enrichment fan-out is performed for the dropdown.
- “Check out new narratives!” linking to Early Narrative Radar whenever a populated narrative snapshot is available. New evidence, changed category scores, or newly discovered themes update its content revision; a collection timestamp alone does not manufacture a new unread notification.

`GET /api/notifications` returns compact pool and narrative summaries. Collection coalesces concurrent requests, caches summaries for 15 seconds, and shares the existing discovery request budget/cache. The dropdown polls once per minute while the application tab is visible; returning to the tab checks immediately. Sonar updates arrive through the existing market state and do not add CoinGecko requests. Missing feeds keep useful sections visible and show delayed/unavailable status.

The unread dot reflects changes in the displayed coin data, pool identities, or narrative revision. Opening the dropdown marks the current content read; read state persists in browser local storage (`blocksonar-notifications-seen-v1`). Updates received while open are visible immediately and considered read. There are no push, email, or background notifications after the application closes.

## Liquidation block alerts

The bell also watches the existing BTC liquidation block map across Binance, Bybit, and OKX. Every three newly formed blocks produce **“Look at these liquidation blocks!”** in the dropdown and trigger the bell shake/green pixel burst. The alert link opens the Liquidation / Heatmap page directly on its liquidation-block view, including when that page is already open on the thermal view.

Counting uses the same grouping function as the map: candle/timeframe, $5 price bucket, side, and exchange. Multiple fills increasing one existing block do not count as new blocks. Restored events from before the current app session and duplicate/replayed blocks do not trigger alerts. Switching candle timeframe resets the unfinished group of three and baselines the regrouped map so changing the layout cannot manufacture alerts. If six new blocks arrive together, two alert records are created. The five latest records are retained for the current app session; alerts share the existing unread/read behavior and require no additional provider requests.

New-pool updates also show a “Check out the 2 newest liquidity pools!” alert linking to Liquidity Pools, with both pool names in its preview (a single-pool message is used if only one discovery is available). Changes in the newest pool identities trigger the existing unread indicator and feedback; unchanged polling responses do not. New-alert vibration runs for three seconds, with green pixel rain repeating during that same window. Only new alert content restarts the three-second effect; hovering and clicking do not. Reduced-motion preferences still disable animation.

Notification sections reorder by the most recently received content change: a new liquidation alert, changed Sonar leaders/prices, new pool identities, or changed narrative revision moves its section to the top. Updates arriving in the same response use source timestamps to break ties. Repeated polls with the same content do not promote a section or manufacture a new alert. Liquidation records remain newest-first inside their section. DOM order matches the displayed order for keyboard navigation.
