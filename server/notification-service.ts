import { createHash } from 'node:crypto'
import type { NarrativeSnapshot } from '../src/lib/early-narrative.js'
import type { DiscoveredPool } from '../src/lib/discover-markets.js'
import type { NotificationFeed } from '../src/lib/notifications.js'
export class NotificationService {
  private pending:Promise<NotificationFeed>|null=null
  private cached:{at:number;value:NotificationFeed}|null=null
  constructor(private pools:{notificationPools():Promise<{pools:DiscoveredPool[];checkedAt:number|null;delayed:boolean}>},private radar:{snapshot():Promise<NarrativeSnapshot>}){}
  async snapshot():Promise<NotificationFeed> {
    if(this.cached&&Date.now()-this.cached.at<15000)return this.cached.value
    if(this.pending)return this.pending
    this.pending=this.collect().finally(()=>{this.pending=null})
    return this.pending
  }
  private async collect():Promise<NotificationFeed> {
    const [pools,narratives]=await Promise.allSettled([this.pools.notificationPools(),this.radar.snapshot()])
    const snapshot=narratives.status==='fulfilled'?narratives.value:null
    const signature=snapshot?.narratives.map(n=>[n.id,n.liveRanking?.score??n.score,n.evidence.map(e=>e.id)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
    const value:NotificationFeed={pools:pools.status==='fulfilled'?pools.value.pools.map(({id,network,address,name,symbol,createdAt,image})=>({id,network,address,name,symbol,createdAt,image})):this.cached?.value.pools??[],poolsCheckedAt:pools.status==='fulfilled'?pools.value.checkedAt:this.cached?.value.poolsCheckedAt??null,poolsDelayed:pools.status!=='fulfilled'||pools.value.delayed,narratives:{updatedAt:snapshot?.updatedAt??null,revision:signature?.length?createHash('sha256').update(JSON.stringify(signature)).digest('hex'):null,count:snapshot?.narratives.length??0}}
    this.cached={at:Date.now(),value};return value
  }
}
