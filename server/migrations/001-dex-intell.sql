CREATE TABLE IF NOT EXISTS chains (id text PRIMARY KEY, chain_id integer UNIQUE, name text NOT NULL);
INSERT INTO chains VALUES ('base',8453,'Base'),('ethereum',1,'Ethereum'),('bsc',56,'BNB Chain'),('solana',NULL,'Solana') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS dex_protocols (id text PRIMARY KEY, chain text NOT NULL REFERENCES chains(id), factory text NOT NULL, UNIQUE(chain,factory));
INSERT INTO dex_protocols VALUES ('base-uniswap-v3','base','0x33128a8fc17869897dce68ed026d694621f6fdfd') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS tokens (chain text REFERENCES chains(id), address text, decimals integer CHECK(decimals BETWEEN 0 AND 255), symbol text, PRIMARY KEY(chain,address));
CREATE TABLE IF NOT EXISTS token_categories (chain text, token text, category text, PRIMARY KEY(chain,token,category), FOREIGN KEY(chain,token) REFERENCES tokens(chain,address));
CREATE TABLE IF NOT EXISTS dex_pools (chain text REFERENCES chains(id), address text, protocol text REFERENCES dex_protocols(id), token0 text NOT NULL, token1 text NOT NULL, created_at timestamptz, PRIMARY KEY(chain,address));
CREATE TABLE IF NOT EXISTS dex_swaps (
  chain text NOT NULL REFERENCES chains(id), tx_hash text NOT NULL, log_index integer NOT NULL,
  block_number bigint NOT NULL, block_hash text NOT NULL, at timestamptz NOT NULL,
  pool text NOT NULL, protocol text NOT NULL, token_in text NOT NULL, token_out text NOT NULL,
  amount_in numeric(78,0) NOT NULL CHECK(amount_in>0), amount_out numeric(78,0) NOT NULL CHECK(amount_out>0),
  wallet text, usd_value numeric, pricing_provenance jsonb, finality text NOT NULL,
  raw jsonb NOT NULL, PRIMARY KEY(chain,tx_hash,log_index), FOREIGN KEY(chain,pool) REFERENCES dex_pools(chain,address)
);
CREATE INDEX IF NOT EXISTS dex_swaps_time ON dex_swaps(chain,at DESC,block_number DESC,log_index DESC);
CREATE INDEX IF NOT EXISTS dex_swaps_pool ON dex_swaps(chain,pool,at DESC);
CREATE INDEX IF NOT EXISTS dex_swaps_token_in ON dex_swaps(chain,token_in,at DESC);
CREATE INDEX IF NOT EXISTS dex_swaps_token_out ON dex_swaps(chain,token_out,at DESC);
CREATE INDEX IF NOT EXISTS dex_swaps_wallet ON dex_swaps(chain,wallet,at DESC) WHERE wallet IS NOT NULL;
CREATE TABLE IF NOT EXISTS indexer_checkpoints (chain text, pool text, block_number bigint NOT NULL, block_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chain,pool));
CREATE TABLE IF NOT EXISTS data_coverage (chain text, pool text, start_block bigint NOT NULL, end_block bigint NOT NULL, started_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), scope text NOT NULL DEFAULT 'Configured pool only; contiguous finalized RPC batches', PRIMARY KEY(chain,pool));
CREATE TABLE IF NOT EXISTS backfill_jobs (chain text, pool text, start_block bigint NOT NULL, target_block bigint, status text NOT NULL, attempts integer NOT NULL DEFAULT 0, last_error text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chain,pool));
CREATE TABLE IF NOT EXISTS analytics_calculation_versions (id text PRIMARY KEY, definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- Future adapters write only after their normalized event semantics have been verified.
CREATE TABLE IF NOT EXISTS liquidity_events (chain text, tx_hash text, event_index integer, at timestamptz NOT NULL, pool text, kind text, raw jsonb NOT NULL, PRIMARY KEY(chain,tx_hash,event_index));
CREATE TABLE IF NOT EXISTS wallets (chain text, address text, PRIMARY KEY(chain,address));
CREATE TABLE IF NOT EXISTS wallet_activity (chain text, wallet text, tx_hash text, event_index integer, at timestamptz NOT NULL, kind text NOT NULL, PRIMARY KEY(chain,wallet,tx_hash,event_index));
CREATE TABLE IF NOT EXISTS token_price_history (chain text, token text, at timestamptz, price numeric NOT NULL, provenance jsonb NOT NULL, PRIMARY KEY(chain,token,at));
CREATE TABLE IF NOT EXISTS token_volume_history (chain text, token text, at timestamptz, window_seconds integer, volume_usd numeric, coverage jsonb NOT NULL, PRIMARY KEY(chain,token,at,window_seconds));
CREATE TABLE IF NOT EXISTS token_metrics_history (chain text, token text, at timestamptz, version text REFERENCES analytics_calculation_versions(id), metrics jsonb NOT NULL, coverage jsonb NOT NULL, PRIMARY KEY(chain,token,at,version));
CREATE TABLE IF NOT EXISTS coin_score_history (chain text, token text, at timestamptz, version text REFERENCES analytics_calculation_versions(id), score numeric CHECK(score BETWEEN 0 AND 100), contributions jsonb NOT NULL, coverage jsonb NOT NULL, confidence numeric CHECK(confidence BETWEEN 0 AND 1), PRIMARY KEY(chain,token,at,version));
CREATE TABLE IF NOT EXISTS category_score_history (category text, at timestamptz, version text REFERENCES analytics_calculation_versions(id), score numeric CHECK(score BETWEEN 0 AND 100), contributions jsonb NOT NULL, coverage jsonb NOT NULL, confidence numeric, PRIMARY KEY(category,at,version));
CREATE TABLE IF NOT EXISTS narrative_momentum_history (narrative text, at timestamptz, version text REFERENCES analytics_calculation_versions(id), metrics jsonb NOT NULL, coverage jsonb NOT NULL, PRIMARY KEY(narrative,at,version));
