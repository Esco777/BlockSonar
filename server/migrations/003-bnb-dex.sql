INSERT INTO dex_protocols(id,chain,factory) VALUES
 ('bsc-pancakeswap-v2','bsc','0xca143ce32fe78f1f7019d7d551a6402fc5350c73'),
 ('bsc-pancakeswap-v3','bsc','0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865')
ON CONFLICT DO NOTHING;
