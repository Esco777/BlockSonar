import { ProviderCache } from './provider-cache.js'
const networks: Record<string,string> = {ethereum:'eth-mainnet',base:'base-mainnet',bsc:'bnb-mainnet',solana:'solana-mainnet'}
export class AlchemyDexPrices {
  constructor(private apiKey: string | undefined, private cache = new ProviderCache(), private now = Date.now) {}
  async getQuotes(chain: string, tokens: string[]) {
    const network = networks[chain]
    if (!this.apiKey || !network) throw new Error('Alchemy USD pricing is not configured')
    const addresses = [...new Set(tokens)].sort().map(address => ({network,address}))
    const result = await this.cache.get<{data?:Array<{network:string;address:string;error?:unknown;prices?:Array<{currency:string;value:string;lastUpdatedAt:string}>}>}>(`https://api.g.alchemy.com/prices/v1/${this.apiKey}/tokens/by-address`,'alchemy-dex-prices',30,60000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({addresses})})
    if (!Array.isArray(result.data)) throw new Error('Alchemy USD prices unavailable')
    const at = this.now()
    const quotes = tokens.map(token => {
      const same = (address:string) => chain === 'solana' ? address === token : address.toLowerCase() === token.toLowerCase()
      const row = result.data!.find(row => row.network === network && typeof row.address === 'string' && same(row.address))
      const price = !row?.error ? row?.prices?.find(price => price.currency === 'usd') : undefined
      const value = price && /^\d+(\.\d+)?$/.test(price.value) ? Number(price.value) : NaN
      const timestamp = price ? Date.parse(price.lastUpdatedAt) : NaN
      const valid = Number.isFinite(value) && value > 0 && Number.isFinite(timestamp) && at - timestamp <= 3600000 && timestamp <= at + 60000
      return {token,priceUsd:valid ? value : null,priceAt:valid ? timestamp : null}
    })
    return {source:'Alchemy',at,quotes}
  }
}
