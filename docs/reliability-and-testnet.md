# Private lists, backups, and testnet checks

Coin watchlists and Ethereum/Solana tracked-wallet lists now live in PostgreSQL, keyed by the authenticated membership wallet, network, and chain. A connected wallet alone cannot read lists. The backend chooses the identity from its session; request parameters cannot select another owner. Saves use revisions so two tabs cannot silently overwrite each other. Signing out or changing wallet removes the previous account's dashboard. Lists are available on another device after signing in with the same wallet on the same membership network.

Legacy localStorage entries are preserved, but are not displayed or automatically assigned to the next person who signs in: their original owner was never recorded. They remain accessible to someone with access to that browser profile. Private storage means access control between app users, not end-to-end encryption or protection from a server/database administrator.

## Collection status

DEX Intell shows the update connection separately from swap collection. Collection reports starting, catching up, delayed, retrying, partially unavailable, or up to date, with the last successful collection check. A successful poll can have zero new swaps. Existing pool coverage and error details remain available under Data coverage. Narrative source-health and observation timestamps remain in the Narrative Radar.

## Backups

The backend starts an automatic backup if none exists or the latest successful backup is six hours old. It checks again each minute and retains the latest 14 completed backups by default. Backups include a consistent PostgreSQL snapshot (including private preferences) and the latest valid narrative, intelligence, Ethereum-wallet and holder-discovery JSON files. Environment files, signing keys, and database credentials are excluded. Backups contain sensitive account preferences; their directory is private and ignored by Git.

Install PostgreSQL client tools matching the server major version or newer, and set `PG_BIN_DIR` if they are not on PATH. On this project, `.tools/postgresql/bin`, Homebrew libpq paths, and PATH are searched. Container deployments also need compatible `pg_dump` and `pg_restore` binaries installed in the runtime image (the volume alone does not provide the tools). A minimal local-only installer is available as `npm run tools:postgres`; remote TLS databases should use normal PostgreSQL clients with TLS support.

Optional environment settings:

```dotenv
BLOCKSONAR_BACKUP_DIR=backups
BLOCKSONAR_BACKUP_INTERVAL_MS=21600000
BLOCKSONAR_BACKUP_KEEP=14
# BLOCKSONAR_BACKUPS_DISABLED=true
# PG_BIN_DIR=/path/to/postgresql/bin
```

Create and verify a backup:

```sh
npm run backup:create
npm run backup:verify -- /absolute/path/to/backups/backup-TIMESTAMP-ID
```

Verification checks every checksum, restores into a newly generated temporary database on the same server, compares every public table's row count to the exported snapshot, validates the JSON files, and removes only that temporary database. The database role needs permission to create databases for this check. The active database is never a restore target. A `restore-verification.json` report is saved in the backup directory. PostgreSQL archives should only be restored from trusted sources.

For an actual recovery, stop the app, create a new empty database, decompress `database.dump.gz` into a private temporary directory, then restore it with `pg_restore --no-owner --no-acl --exit-on-error`, and point `DEX_DATABASE_URL` at the recovered database. Restore the JSON files to their configured paths after preserving the originals. Test sign-in, private lists and indexer progress before resuming use. Do not overwrite a live database or data directory as part of a test.

These are local backups. Copy verified snapshots to a separately secured disk or backup service to protect against losing the computer. The app does not claim an off-site backup exists.

## Migrate to hosted PostgreSQL

1. Stop the local BlockSonar backend to pause indexing and list edits. Keep local PostgreSQL running and run `npm run backup:create` from the repository root.
2. Create a new, empty database on the hosting provider. Set `TARGET_DATABASE_URL` in your shell to the new database's connection URL, using the provider's TLS settings. Run these commands from the generated backup directory with compatible PostgreSQL client tools installed.

   ```sh
   umask 077
   gzip -dc database.dump.gz > database.dump
   pg_restore --no-owner --no-acl --exit-on-error \
     --dbname="${TARGET_DATABASE_URL:?Set the target database URL first}" database.dump
   ```

3. Set `DEX_DATABASE_URL` in the hosted backend's environment. Retain the configured DEX pools and start blocks for jobs you want to resume. Start the backend, sign in, and check **DEX Intell → Data coverage** for saved ranges and fresh collection.

For a fresh start, point `DEX_DATABASE_URL` at an empty database and let the backend create its tables. Early Narrative Radar's history is stored separately. To carry it over, copy `data/early-narrative.json` (or the backup's `narratives.json`) to persistent storage and point `NARRATIVE_DATA_FILE` at the restored file.

Hardhat membership NFTs stay on Hardhat. Mint a membership on Sepolia for test sign-in. Saved private lists are scoped to the wallet, membership network, and chain, so restoring a database preserves Hardhat lists under their original identity.

## Membership walkthrough

Run the automated local flow before public testnet deployment:

```sh
npm run contracts:test
npm run contracts:walkthrough
```

The walkthrough deploys a fresh contract on an isolated Hardhat chain, rejects nonmember sign-in, mints a membership, signs in its holder, executes a user-to-user sale, checks the 90/10 payout, revokes the seller's session and authenticates the buyer. No public-chain transactions are sent.

For Sepolia or BNB Testnet:

1. Choose the network and configure a funded test-only deployer, public owner address, supply, metadata URI, RPC, and matching Chainlink feed in the existing environment. Keep secrets out of chat and `VITE_*` settings. Check `.env.membership.example` and the deployment guide.
2. Run `npm run contracts:deploy:sepolia` or `npm run contracts:deploy:bnb-testnet` only when deployment is intended. Save the deployment record. Minting starts closed.
3. Set `MEMBERSHIP_TESTNET_ADDRESS` to that contract and run `npm run contracts:check:sepolia` or `npm run contracts:check:bnb-testnet`. These checks are read-only and verify network, contract constants, owner, deployer, supply, and a usable oracle quote.
4. Configure a separate test app instance to use the testnet deployment. As owner, enable minting. With wallet A, mint and sign in. Create a private coin list and a tracked-wallet list; verify wallet B cannot see them.
5. With A, call `listForSale(tokenId, priceInWei)`. With B, call `buyMembership(tokenId)` with exactly that value. Verify B owns the NFT, A gets 90%, and the current owner gets 10% (whole-wei rounding applies).
6. Within the membership recheck window, A loses API access and B can sign in. A's private preferences remain stored for A; membership transfer does not transfer account data to B. Ordinary ERC721 transfers remain possible and do not charge the resale commission.
7. Restart the test backend before PostgreSQL, then bring PostgreSQL online. Verify collection and private storage recover. Create and verify a backup, and confirm the restored row counts.

Public testnet execution still requires the chosen network and funded signer; the local walkthrough does not prove a public testnet deployment has occurred.

## Whale and large-holder views

Wallet trackers open with whales and large holders sorted by native balance. Default cutoffs are 100 ETH for large holders and 1,000 ETH for whales; on Solana they are 1,000 SOL and 10,000 SOL. These are configurable app filters, not universal market definitions. Use Holder size to show both groups, whales only, or other large holders. Discovery-date and first-recorded-activity filters still apply. Source coverage stays visible; an observed-address fallback is not a complete network-wide ranking.

### Search and whale purchases

Click **Search** immediately beside Whale minimum to submit the balance cutoffs, holder-size group, discovery/first-activity view, age window, and contract/program filter. Changing draft filters does not relabel existing results. Search uses authenticated backend endpoints for Ethereum and Solana; it does not send transactions or automatically add addresses to a private watchlist.

Ethereum search samples up to 30 transaction senders from the latest finalized block and up to 20 explorer-listed large accounts, then rechecks native balances and account code at that finalized block. Solana search samples up to 80 recent finalized-block signers and up to 20 RPC-listed large accounts, then rechecks their native account balances with a finalized minimum context slot. Unsafe balance quantities and unavailable reads are omitted with an explicit warning. These are bounded samples, not a complete index of every address. Shared live reads are cached for 10 seconds and repeated equivalent searches for 15 seconds.

The **Whale purchases** section checks up to three non-contract wallets that meet the whale balance cutoff, prioritizing recent activity. It shows supported verified token acquisitions in the last 24 hours, their amounts, time, and transaction links. Ethereum uses authenticated Uniswap v2/v3 purchase classification and up to eight recent transactions plus retained observed history. Solana checks up to five finalized transactions per wallet and requires authenticated Orca/Raydium pool events, wallet authority, spend, receipt and a proven output mint. Transfers, failed transactions, airdrops, and unrelated incoming tokens do not establish purchases. The cutoff applies at search time, not at the historical purchase time. Missing history does not imply no buying activity.

Purchase checks run in the background and the page polls their progress. Refreshing one minute after completion reruns the applied search. Searches are rate limited per authenticated membership identity; current results stay visible during retries.

### Wallet Sonar recent-buy box

The Wallet Sonar panel on Ethereum and Solana shows the latest verified buy from the active whale search, including token quantity, wallet, purchase time, current search balance, and the transaction link. A newly observed buy briefly highlights the box. The last verified purchase stays visible across matching search refreshes while the wallet still qualifies; it expires after 24 hours and is cleared when the search no longer includes that whale. Delayed updates are labeled. The box uses the existing periodic search and purchase checks rather than a separate network-wide instant-alert subscription.

## CoinGecko / Sonar connection

Sonar's coin universe uses the original direct browser connection to CoinGecko's public `/api/v3/coins/markets` endpoint. It requires no API key, loads 250-coin pages until 1,500 distinct eligible coins are collected, and waits 12 seconds between pages. It can scan up to 12 pages to replace duplicate or incomplete records; reaching that bound with fewer coins is labeled incomplete. Rate-limited requests honor Retry-After (bounded to 60–300 seconds) and retry once. Partial results remain visible, and incomplete scans do not establish daily baselines. Public provider limits can still delay a scan.

The authenticated backend market routes remain available for global market totals and other server consumers. Server CoinGecko keys stay private; recognized example placeholders are treated as unconfigured. `npm run market:check` checks the backend provider connection, not the browser's complete Sonar scan.

Sonar also displays supplemental DefiLlama Ethereum/Solana TVL and reported DEX 24-hour volume through its authenticated backend. That panel refreshes every five minutes independently of CoinGecko prices and rankings.
