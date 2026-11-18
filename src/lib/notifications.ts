import { analyzeAssets, compareSonarSignals, DEFAULT_SIGNAL_RULES, type SonarAsset } from './sonar-research.js'
import { deduplicatePools } from './token-identity.js'
import type { DiscoveredPool } from './discover-markets.js'
export type NotificationFeed = {
  pools: Array<Pick<DiscoveredPool,'id'|'network'|'address'|'name'|'symbol'|'createdAt'|'image'>>
  poolsCheckedAt: number | null; poolsDelayed: boolean
  narratives: { updatedAt: number | null; revision: string | null; count: number }
}
export function topSonarNotifications(coins: SonarAsset[], live: boolean) {
  return live ? analyzeAssets(coins,DEFAULT_SIGNAL_RULES).sort(compareSonarSignals).slice(0,2) : []
}
export function newestPoolNotifications(pools: DiscoveredPool[]) {
  return deduplicatePools(pools).filter(pool=>Number.isFinite(pool.createdAt)).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id)).slice(0,2)
}
export function notificationRevision(coins: SonarAsset[], feed: NotificationFeed | null): string {
  if(!coins.length&&!feed?.pools.length&&!feed?.narratives.revision)return ''
  return JSON.stringify([coins.map(c=>[c.id,c.price,c.change]),feed?.pools.map(p=>p.id)??[],feed?.narratives.revision??null])
}

export type NotificationSection = 'sonar' | 'pools' | 'narratives' | 'liquidations'
export type NotificationOrderState = Partial<Record<NotificationSection,{revision:string;sequence:number;sourceAt:number}>>
export type NotificationSectionUpdate = {section:NotificationSection;revision:string|null;sourceAt:number|null}
/** Promote changed content on arrival; polling timestamps alone never move a section. */
export function updateNotificationOrder(previous:NotificationOrderState,updates:NotificationSectionUpdate[]):NotificationOrderState {
  const changed=updates.filter(update=>update.revision&&previous[update.section]?.revision!==update.revision)
  if(!changed.length)return previous
  const sequence=Math.max(0,...Object.values(previous).map(item=>item.sequence))+1
  const next={...previous}
  for(const update of changed)next[update.section]={revision:update.revision!,sequence,sourceAt:update.sourceAt!==null&&Number.isFinite(update.sourceAt)?update.sourceAt:0}
  return next
}
export function orderedNotificationSections(state:NotificationOrderState):NotificationSection[] {
  const sections:NotificationSection[]=['sonar','pools','narratives','liquidations']
  return sections.sort((a,b)=>(state[b]?.sequence??0)-(state[a]?.sequence??0)||(state[b]?.sourceAt??0)-(state[a]?.sourceAt??0))
}
