INSERT INTO dex_protocols(id,chain,factory) VALUES
 ('solana-orca-whirlpool','solana','whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
 ('solana-raydium-cpmm','solana','CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS solana_indexer_state (
 pool text PRIMARY KEY, anchor_signature text, next_before text,
 pending_head text, pending_slot bigint, pending_time bigint
);
CREATE TABLE IF NOT EXISTS solana_transactions (
 signature text PRIMARY KEY, slot bigint NOT NULL, at timestamptz NOT NULL,
 status text NOT NULL, raw jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS solana_transactions_slot ON solana_transactions(slot);
