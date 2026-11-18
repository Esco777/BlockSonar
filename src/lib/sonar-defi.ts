export type SonarDefi = {
 source: 'DefiLlama'
 ethereum: {tvl: number; fetchedAt: number} | null
 solana: {tvl: number; fetchedAt: number} | null
 dex: {volume24h: number; fetchedAt: number} | null
}
