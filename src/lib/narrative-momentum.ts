import type {Narrative} from './early-narrative.js'
import {CATEGORY_SCORE_MODEL} from './narrative-ranking.js'
export function narrativeMomentumChart(narratives:Pick<Narrative,'id'|'points'>[],ids:string[],end:number,hours:number):Array<Record<string,number|null>> {
 const rows=new Map<number,Record<string,number|null>>()
 const selected=narratives.filter(item=>ids.includes(item.id)),start=end-hours*3600000
 const emptyRow=(time:number)=>Object.fromEntries([['time',time],...selected.map(item=>[item.id,null])]) as Record<string,number|null>
 for(const item of selected){
 let previous:number|null=null
 for(const point of [...item.points].sort((a,b)=>a.time-b.time)){
  if(!Number.isFinite(point.time)||point.time<start||point.time>end||point.scoreModel!==CATEGORY_SCORE_MODEL)continue
  const resolution=(time:number)=>end-time<=86400000?60000:end-time<=7*86400000?300000:3600000
  if(previous!==null&&point.time-previous>Math.max(resolution(previous),resolution(point.time))*3){const gap=Math.floor((previous+point.time)/2);const missing=rows.get(gap)??emptyRow(gap);missing[item.id]=null;rows.set(gap,missing)}
  previous=point.time
  const row=rows.get(point.time)??emptyRow(point.time)
  row[item.id]=typeof point.liveScore==='number'&&Number.isFinite(point.liveScore)&&point.liveScore>=0&&point.liveScore<=100?point.liveScore:null
  rows.set(point.time,row)
 }}
 return [...rows.values()].sort((a,b)=>a.time!-b.time!)
}
