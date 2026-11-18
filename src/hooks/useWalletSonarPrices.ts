import {useEffect,useState} from 'react'
import type {WalletHologramEntry} from '../lib/wallet-hologram'
import {quoteKey,type SwapQuote} from '../lib/swap-valuation'
export const sonarPriceToken = (mint:string) => mint === 'ETH' ? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' : mint === 'SOL' ? 'So11111111111111111111111111111111111111112' : mint
export function useWalletSonarPrices(chain:'ethereum'|'solana', entries:WalletHologramEntry[]) {
 const [quotes,setQuotes]=useState<Record<string,SwapQuote>>({})
 const tokens=[...new Set(entries.map(entry=>sonarPriceToken(entry.mint)))].sort().join(',')
 useEffect(()=>{
  if(!tokens)return
  const controller=new AbortController()
  const run=async()=>{
   try{
    const params=new URLSearchParams({chain,tokens})
    const response=await fetch(`/api/wallet-tracker/prices?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])})
    if(!response.ok)throw new Error('Prices unavailable')
    const data=await response.json()
    if(data.source!=='Alchemy')throw new Error('Unexpected price source')
    const prices:Record<string,SwapQuote>={}
    for(const quote of data.quotes ?? [])prices[quoteKey(chain,quote.token)]={priceUsd:quote.priceUsd,priceAt:quote.priceAt,source:'Alchemy'}
    if(!controller.signal.aborted)setQuotes(prices)
   }catch{if(!controller.signal.aborted)setQuotes({})}
  }
  void run();const timer=window.setInterval(()=>void run(),60000)
  return()=>{controller.abort();window.clearInterval(timer)}
 },[chain,tokens])
 return (entry:WalletHologramEntry) => {
  const quote=quotes[quoteKey(chain,sonarPriceToken(entry.mint))],amount=/^\d+(\.\d+)?$/.test(entry.amount)?Number(entry.amount):NaN
  if(quote?.priceUsd==null || quote.priceAt==null || !Number.isFinite(quote.priceUsd) || quote.priceUsd<=0 || !Number.isFinite(quote.priceAt) || Date.now()-quote.priceAt>3600000 || quote.priceAt>Date.now()+60000 || !Number.isFinite(amount))return null
  const value=amount*quote.priceUsd
  return Number.isFinite(value)?value:null
 }
}
