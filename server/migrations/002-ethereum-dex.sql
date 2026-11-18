INSERT INTO dex_protocols(id,chain,factory) VALUES
 ('ethereum-uniswap-v2','ethereum','0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'),
 ('ethereum-uniswap-v3','ethereum','0x1f98431c8ad98523631ae4a59f267346ea31f984')
ON CONFLICT DO NOTHING;

-- Preserve ambiguous flash/same-token swap payloads without fabricating direction.
CREATE TABLE IF NOT EXISTS dex_unclassified_swaps (
 chain text NOT NULL REFERENCES chains(id), tx_hash text NOT NULL, log_index integer NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, at timestamptz NOT NULL,
 pool text NOT NULL, protocol text NOT NULL REFERENCES dex_protocols(id), reason text NOT NULL,
 raw jsonb NOT NULL, PRIMARY KEY(chain,tx_hash,log_index),
 FOREIGN KEY(chain,pool) REFERENCES dex_pools(chain,address)
);
CREATE INDEX IF NOT EXISTS dex_unclassified_pool ON dex_unclassified_swaps(chain,pool,at DESC);
