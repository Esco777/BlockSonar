import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import type { WhaleSonarFeed } from '../lib/whale-sonar'
export default function WhaleBuyCard({ chain, feed }: { chain: 'ethereum' | 'solana'; feed?: WhaleSonarFeed | null }) {
  const [, refreshClock] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => refreshClock(value => value + 1), 30000); return () => window.clearInterval(timer) }, [])
  const now = Date.now()
  const purchase = feed?.latest && feed.latest.at >= now - 86400000 && feed.latest.at <= now ? feed.latest : null
  const id = purchase ? `${purchase.wallet}:${purchase.signature}:${purchase.token}` : ''
  const previous = useRef(id), [highlight, setHighlight] = useState(false)
  useEffect(() => {
    const changed = id && id !== previous.current
    previous.current = id; setHighlight(false)
    if (!changed) return
    setHighlight(true)
    const timer = window.setTimeout(() => setHighlight(false), 2000)
    return () => window.clearTimeout(timer)
  }, [id])
  const addressExplorer = chain === 'ethereum' ? 'https://etherscan.io/address/' : 'https://solscan.io/account/'
  const txExplorer = chain === 'ethereum' ? 'https://etherscan.io/tx/' : 'https://solscan.io/tx/'
  const short = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`
  return <aside className={`wallet-whale-buy ${highlight ? 'wallet-whale-buy-new' : ''}`} aria-label="Recent whale purchase">
    <div className="wallet-whale-buy-heading"><span><ArrowDownLeft size={15} /> RECENT WHALE BUY</span><small>{chain === 'ethereum' ? 'ETHEREUM' : 'SOLANA'} · {feed?.delayed ? 'UPDATES DELAYED' : feed?.checking ? 'CHECKING' : purchase ? 'VERIFIED SWAP' : 'AWAITING PURCHASE'}</small></div>
    {purchase ? <div className="wallet-whale-buy-details">
      <div><strong title={purchase.token}>{purchase.amount} {purchase.symbol}</strong><p><a href={`${addressExplorer}${purchase.wallet}`} target="_blank" rel="noreferrer" title={purchase.wallet}>{short(purchase.wallet)}</a> acquired tokens · <time dateTime={new Date(purchase.at).toISOString()} title={new Date(purchase.at).toLocaleString()}>{new Date(purchase.at).toLocaleString()}</time></p><small>Whale balance at search: {Number(purchase.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {chain === 'ethereum' ? 'ETH' : 'SOL'}</small></div>
      <a className="wallet-whale-buy-tx" href={`${txExplorer}${purchase.signature}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={13} /></a>
    </div> : <p className="wallet-whale-buy-empty" role="status">{!feed?.active ? 'Run Search below to monitor whale purchases.' : feed.delayed ? 'Purchase updates are delayed. The whale purchases section below shows feed status.' : feed.checking ? `Checking verified whale purchases… ${feed.checked} / ${feed.targeted} wallets checked.` : 'No verified whale purchase found in the current search.'}</p>}
    <p className="wallet-whale-buy-scope">Active search · up to three qualifying whale wallets · periodic refresh{feed?.observedAt ? ` · last search ${new Date(feed.observedAt).toLocaleTimeString()}` : ''}</p>
  </aside>
}
