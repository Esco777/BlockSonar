import type { groupLiquidationEvents } from './liquidation-feeds.js'
export type LiquidationBlockAlert = { id:string; createdAt:number; blockKeys:string[]; message:'Look at these liquidation blocks!' }
type Block=ReturnType<typeof groupLiquidationEvents>[number]
/** Count chart blocks, not fills; restored history and timeframe regrouping never create alerts. */
export class LiquidationBlockAlerts {
  private timeframe:number|null=null
  private seen=new Map<string,number>()
  private pending:string[]=[]
  private sequence=0
  private ignoreBefore:number
  private entries:LiquidationBlockAlert[]=[]
  constructor(startedAt=Date.now()){this.ignoreBefore=startedAt}
  update(blocks:Block[],timeframeSeconds:number):LiquidationBlockAlert[]{
    if(this.timeframe!==null&&this.timeframe!==timeframeSeconds){
      this.timeframe=timeframeSeconds;this.seen=new Map(blocks.map(b=>[b.key,b.latestAt]));this.pending=[]
      return this.entries
    }
    this.timeframe=timeframeSeconds
    const created=blocks.filter(b=>!this.seen.has(b.key)&&b.latestAt>=this.ignoreBefore).sort((a,b)=>a.latestAt-b.latestAt||a.key.localeCompare(b.key))
    for(const block of blocks)this.seen.set(block.key,Math.max(this.seen.get(block.key)??0,block.latestAt))
    let changed=false
    for(const block of created){
      this.pending.push(block.key)
      if(this.pending.length===3){
        this.entries=[{id:`liquidation-blocks:${++this.sequence}:${block.latestAt}`,createdAt:block.latestAt,blockKeys:this.pending,message:'Look at these liquidation blocks!' as const},...this.entries].slice(0,5)
        this.pending=[];changed=true
      }
    }
    // Keep long-running sessions bounded and ignore evicted historical replays.
    if(this.seen.size>20000){
      const ordered=[...this.seen].sort((a,b)=>a[1]-b[1])
      const remove=ordered.slice(0,ordered.length-15000)
      this.ignoreBefore=Math.max(this.ignoreBefore,(remove.at(-1)?.[1]??0)+1)
      for(const [key]of remove)this.seen.delete(key)
    }
    return changed?[...this.entries]:this.entries
  }
}
