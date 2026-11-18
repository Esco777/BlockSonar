/** Provider chain aliases resolve before address comparison. Solana is case sensitive. */
export function canonicalChain(chain: string): string {
  return ({ eth: 'ethereum', '1': 'ethereum', '56': 'bsc', '101': 'solana' } as Record<string, string>)[chain.toLowerCase()] ?? chain.toLowerCase()
}
export function assetKey(chain: string, address: string): string {
  const network = canonicalChain(chain)
  return `${network}:${network === 'solana' ? address : address.toLowerCase()}`
}
export function deduplicatePools<T extends { network: string; address: string }>(pools: T[]): T[] {
  return [...new Map(pools.map(pool => [assetKey(pool.network, pool.address), pool])).values()]
}
export function validAddress(chain: string, address: string): boolean {
  if (canonicalChain(chain) !== 'solana') return /^0x[0-9a-fA-F]{40}$/.test(address)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let value = 0n
  for (const character of address) value = value * 58n + BigInt(alphabet.indexOf(character))
  let bytes = 0
  while (value > 0n) { bytes++; value >>= 8n }
  return bytes + (address.match(/^1*/)?.[0].length ?? 0) === 32
}
