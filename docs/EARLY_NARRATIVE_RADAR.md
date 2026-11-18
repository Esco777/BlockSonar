# Early Narrative Radar

Open **Early Narrative Radar** in the sidebar, or `#/narratives` after signing in.
The implementation adds to the existing app; it does not replace the heatmap,
Sonar, scanner, or membership flow.

## Run

Run `npm run start:server` and `npm run dev` in separate terminals. Vite proxies
`/api/narratives` to the existing Node service on port 4001. The production
server serves the same API and frontend together.

Collection begins when the backend starts, runs every 60 seconds, and is
independent of whether the dashboard is open. The dashboard checks the cached
snapshot every 30 seconds. Refresh requests a backend collection and recalculation, coalesced with any running update and throttled to once per minute. Normal dashboard polling only reads the latest snapshot.

No paid service, cloud AI request, or signup is activated. Public RSS and
CoinGecko requests can be unavailable or rate limited; their status appears in
Source health. CoinGecko's optional Demo key stays server-side.

## Accessible and unavailable sources

- CoinDesk and Cointelegraph published RSS feeds: headline, original link,
  publisher, publication time, collection time. No article scraping or full-body
  copying. A source failure preserves existing evidence and appears in the UI.
- CoinGecko category market data: IDs, category names, rolling 24-hour volume,
  category market capitalization/change, and reported top token IDs. Categories
  are cached for 15 minutes.
- Related-token requests use CoinGecko's category filter and unique coin IDs,
  not symbols. Chain/contract identity loads separately from its coin metadata.
  Native assets can legitimately have no token contract. No numeric relevance
  or DEX pool liquidity is fabricated.
- Reddit and X: not connected. Approved access/provider integration is needed;
  this version does not scrape either site or turn headlines into social mentions.
- Wallet activity, search interest, and narrative-linked executed trades: not
  connected. Smart-money assertions and these score components are unavailable.
- Existing Discover DEX data stays in Discover. A safe contract/category identity
  join is required before it can support a narrative's liquidity metric.

References: [CoinGecko categories](https://docs.coingecko.com/reference/coins-categories),
[coin markets](https://docs.coingecko.com/reference/coins-markets),
[Reddit access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).
Provider-specific subscriptions and approved access would require a separate
choice; no credentials are included in the browser bundle.

## Classification and discovery

With no AI model configured, the dashboard explicitly labels topic rules,
category-only discoveries, and unverified candidate phrases. Topic rules use
whole phrases and project/category context rather than ticker-only matches.
New candidate phrases require at least three unique headlines from at least
two publishers. Candidates do not automatically acquire token associations.
Candidates are an exploratory heuristic, not confirmed new narratives.

Optional local AI is supported through Ollama's `/api/chat`:

```sh
NARRATIVE_OLLAMA_MODEL=your-already-installed-local-model npm run start:server
```

`NARRATIVE_OLLAMA_URL` defaults to `http://127.0.0.1:11434` and is restricted to
loopback addresses. Install/configure a model separately; the application will
not download one. The adapter asks for structured groups, a short synthesis,
source IDs, and headline tone. Returned evidence IDs are checked against the
supplied headlines; tokens are still associated through CoinGecko category data.
Headlines are treated as untrusted text. Summaries are model interpretations
that must be checked against the linked sources, not independently verified facts.
Ollama failures fall back to labeled rules.

This adapter is for a locally running server. A model running outside a Docker
container is not reachable through the container's localhost; no external/cloud
endpoint is silently substituted. AI classification/briefs are unavailable in the
current no-model setup.

## Momentum model and history

Every chart point is an actual collection observation. Chart attention is the
count of deduplicated headlines plus permitted social posts published during the
preceding hour. The first RSS pull does not manufacture past chart points.
Duplicate URLs (including tracking-only variations) and duplicate normalized
headlines are removed, including syndicated copies across publishers.

Provisional score, 0–100:

| Component | Weight | Measurement |
| --- | --- | --- |
| Social acceleration | 30% | Change in successive hourly social-growth rates; needs three observed hours and nonzero baselines. Currently unavailable without a social collector. |
| Source diversity | 20% | Current-hour independent publishers divided by 5, capped at 100. |
| Volume confirmation | 20% | `clamp(50 + 50 × log2(current rolling-24h category volume / hour-ago value), 0, 100)`; needs an hour of history and category data newer than 30 minutes. This is a rolling-volume comparison, not one-hour traded volume. |
| On-chain activity | 15% | Unavailable until a verified activity source is integrated. |
| Tone change | 15% | `clamp(50 + 50 × (current model-estimated headline tone - hour-ago tone), 0, 100)`; unavailable without local AI and a baseline. This is headline tone, not measured investor sentiment. |

Missing components stay null and contribute no points. Weights are **not**
renormalized. Coverage shows the sum of available weights. Thus a news-only
observation can score at most 20, and news plus volume at most 40. A low partial
score must not be compared to a complete score without considering coverage.
Weights are initial assumptions and have not been validated as predictive.

The 1h/24h columns are score-point changes against observations at or just before
the target time, with at most 15 minutes of lag. Social growth is a separate
percentage and stays missing when social evidence is missing or its baseline is
zero. Market-cap change is explicitly labeled; it is not a token price return.

Server stage defaults: Early 30, Accelerating 50, Trending 70; at least two
current-hour publishers and one observed hour are required. A drop of 10 points
from the previous hour is Cooling Down. New/warming-up topics are Newly Detected.
Override validated server defaults using `NARRATIVE_RULES_JSON`, e.g.:

```sh
NARRATIVE_RULES_JSON='{"early":30,"accelerating":50,"trending":70,"minimumSources":2,"minimumAgeHours":1}' npm run start:server
```

Dashboard Settings provide local sensitivity/stage-display thresholds and an
in-app alert visibility toggle. Preferences are saved in the browser. They do
not rewrite backend alert records or subscribe to email/browser push alerts.

## Persistence and alerts

No existing database was found. A single-process atomic JSON store is used at
`data/early-narrative.json`, ignored by Git and Docker build context. Override
with `NARRATIVE_DATA_FILE` pointing to a writable persistent location. Read errors
disable collection rather than overwriting an unreadable history file.

Docker Compose mounts the `narrative-data` volume at `/app/data`. Back it up if
history matters. This is not a distributed database: run one narrative writer per
file. History is retained for 31 days (with bounded evidence, point, token cache,
and alert limits). Service restarts reload first-seen times, points, and original
alerts. Source health is refreshed rather than presented as live after restart.

Backend alerts include new narratives, score threshold crossings, social
acceleration (when available), volume confirmation, model headline-tone reversal,
and potentially overheated categories. Alerts are deduplicated by topic/type
with a six-hour cooldown. No wallet alerts are invented.

Each alert freezes its original time, score, coverage, stage, threshold rules,
and **only token prices actually known then**. Loading related tokens later does
not backfill prices into earlier alerts. Tracked IDs are polled in a bounded batch
for future observations. Horizon returns use the first observed price within 15
minutes after 1h, 6h, 24h, or 7d. Missing prices are unavailable, not zero or
interpolated. The journal's return is an equal-weight mean of available frozen-ID
returns, with attention-without-positive-return explicitly identified at 24h.
This is descriptive tracking, not a validated strategy backtest.

## API and modules

- `GET /api/narratives`: cached dashboard, source status, scoring rules, history,
  and original alert records.
- `GET /api/narratives/tokens?id=<observed-narrative-id>`: cached category members.
- `GET /api/narratives/identity?id=<loaded-coin-id>`: chain/contract metadata.

Only known narrative/token IDs are accepted. Requests use fixed provider hosts,
response-size bounds, request spacing, caching, shared in-flight requests,
HTTP/error backoff, and Retry-After handling. API keys never appear in responses.

Implementation is split into shared types/calculations (`src/lib/early-narrative.ts`),
collectors, classifier, scoring/alerts engine, store, service orchestration,
HTTP routes, and `src/components/EarlyNarrative.tsx` with scoped CSS.

## Validation and remaining integrations

Run `npm run test:server` and `npm run build`. Dedicated tests cover collection,
deduplication, classification, unsupported AI evidence, score coverage, warm-up,
frozen alerts, horizon quotes, token identity gating, persistence, and corruption
handling. Test fixtures are isolated from production data.

Current no-account mode supports news/category discovery, rule-based/candidate
grouping, partial scoring, dashboard comparisons/radar, verified category tokens,
and in-app alert/performance history. Full social monitoring, local-AI synthesis,
DEX contract joins, wallet activity, and search signals require actual configured
sources or provider integrations. No claimed full-coverage AI/social signal is
substituted for those missing capabilities.

## Automatic token updates

The backend refreshes a single shared batch of verified top-token market data every 60 seconds to populate the Emerging Narratives token cells with tickers and logos. Cells show their last observation time; failed requests preserve the last verified preview. The selected narrative coin list and popup also refresh automatically every 60 seconds, with a shared one-minute cache and provider backoff. These are REST updates, not a tick-by-tick stream. Category discovery still refreshes every 15 minutes, and rate limits can delay updates.


## Live score updates

Scores and RSS collection run every 60 seconds. The dashboard checks every 30 seconds; this is polling, not a blockchain or news websocket. Refresh uses `GET /api/narratives?refresh=1` and shares the same single-flight, once-per-minute backend budget. CoinGecko categories retain their 15-minute cache; increasing score cadence does not increase category request frequency. Provider backoff remains active.

Each narrative includes `scoredAt` and `changeSinceUpdate` alongside its original hourly/day changes. Snapshot `scoring` metadata reports cadence, expected next update, and live/partial/unavailable source coverage. A fresh HTTP response does not make an old score live: the UI marks calculation times older than three minutes as delayed. It updates that status even when a request fails.

The existing weights, stages, and frozen alert snapshots remain unchanged. Scores respond to actual available inputs, so repeated evidence can legitimately produce an unchanged score. The UI shows the maximum reachable score under current input coverage: 20% available weights means a ceiling of 20/100, not a renormalized 100. These heuristic scores are not probabilities of profit.

News diversity/tone components become unavailable after three minutes without a successful news feed collection. Market observations older than 30 minutes or dated in the future are excluded from current scoring and cannot seed a historical volume baseline. Cache hits retain the original successful fetch timestamp in source health. No social, wallet, or DEX activity is automatically treated as narrative evidence without a verified identity association.

At the faster cadence, retained chart history keeps minute observations for one day, five-minute samples through seven days, and hourly samples through 31 days. Sampling retains actual recorded points; it never generates past scores.

## Primary category activity ranking (current)

The primary table and radar now display a distinct **category activity score**, rather than the legacy coverage-weighted evidence score described above. The previous model often returned zero for categories with no recent headline or an unready hourly volume baseline, even when category market data existed.

This new index scores immediately from available measured category data and uses these provisional weights:

| Signal | Weight | Calculation |
| --- | --- | --- |
| 24h category momentum | 35 | `clamp(50 + 2.5 × category market-cap change percent, 0, 100)` |
| Trading turnover | 30 | `clamp(200 × rolling-24h volume / market cap, 0, 100)` |
| Volume trend | 20 | `clamp(50 + 50 × log2(current volume / recorded hour-ago volume), 0, 100)`; only with a valid same-model baseline |
| Recent news attention | 10 | `100 × (1 − exp(−current-hour unique items / 5))` |
| Publisher diversity | 5 | `clamp(current-hour independent publishers / 3 × 100, 0, 100)` |

Available inputs are averaged using their weights on a 0–100 scale. Missing market values are omitted; an unconfigured social or wallet source never contributes. A category with neither usable market data nor recent news has an unavailable score, not an invented zero. A genuinely zero measured activity score remains zero. News-only themes are labeled separately. These are activity heuristics, not profit probabilities or verified early investment opportunities.

The backend and frontend both rank descending by this score, with deterministic name/ID ties and unavailable scores last. Category rows no longer show the legacy coverage ceiling, absent-history messages, or per-row calculation-time clutter. The detail view shows the new signal breakdown and observation time. Existing evidence scores and historical alert journals remain intact, separately labeled; old evidence-model scores are never reused as activity-score history. Same-model score observations now power the 1h/24h changes as they accumulate.

Scoring still runs every minute, and the dashboard polls every 30 seconds. CoinGecko category caching is now five minutes (at most 12 category fetches/hour before provider backoff, versus the prior four/hour). This changes request frequency, not subscriptions or dependencies; usage still counts toward the configured CoinGecko plan. A source timestamp older than 15 minutes is labeled delayed; after one hour it is excluded from this activity index. Data can remain unchanged between provider updates. The application does not animate or fabricate score changes when upstream observations do not change.

## Live source health

Coverage & Provenance subscribes to the authenticated
`/api/narratives/sources/stream` event stream. It receives each source's checking,
success, or failure status as collection proceeds, independently of the 30-second
score-dashboard polling. Connections reconnect automatically; polling remains the
fallback. Leaving the page closes its subscription. Idle streams send heartbeats,
slow consumers are disconnected, and backend shutdown closes subscribers.

`Status checked` records when the collector evaluated a source (which can use its
cache). `Last successful collection` retains the actual cached observation time;
checking a cache or encountering an error never advances that time. Successful
collection times survive backend restarts. A stream connection itself never
requests upstream data, changes source quotas, or supplies missing Reddit/X access.
Provider collection intervals and cooldowns remain independent of live status updates.
