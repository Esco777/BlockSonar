import type { Narrative, NarrativeCategory } from '../src/lib/early-narrative.js'
import { CATEGORY_SCORE_MODEL, rankNarratives, type CategoryRanking, type CategorySignal } from '../src/lib/narrative-ranking.js'
const HOUR = 3600000
const clamp = (n: number) => Math.max(0,Math.min(100,n))
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
/** An activity index from available measured signals, separate from the legacy evidence model. */
export function calculateCategoryRankings(narratives: Narrative[], categories: NarrativeCategory[], now: number, newsAvailable: boolean): Narrative[] {
  const byId = new Map(categories.map(category => [category.id, category]))
  return rankNarratives(narratives.map(narrative => {
    const category = byId.get(narrative.categoryId ?? '')
    const market = category && category.updatedAt <= now && now-category.updatedAt <= HOUR ? category : null
    const recent = narrative.evidence.filter(e => e.publishedAt > now-HOUR && e.publishedAt <= now && e.collectedAt <= now)
    const publishers = new Set(recent.map(e => e.publisher)).size
    const comparable = narrative.points.filter(p => p.scoreModel === CATEGORY_SCORE_MODEL && p.time < now)
    const at = (target: number) => [...comparable].reverse().find(p => p.time <= target && target-p.time <= 15*60000)
    const hour = at(now-HOUR), day = at(now-24*HOUR)
    const inputs: CategoryRanking['inputs'] = []
    const add = (key: CategorySignal,value: number,weight: number) => { if (finite(value)) inputs.push({key,value:clamp(value),weight}) }
    if (market) {
      if (finite(market.change24h)) add('momentum',50+market.change24h*2.5,35)
      if (finite(market.volume) && market.volume >= 0 && finite(market.marketCap) && market.marketCap > 0) add('turnover',market.volume/market.marketCap*200,30)
      if (finite(market.volume) && market.volume >= 0 && hour?.volume != null && hour.volume > 0) add('volumeTrend',50+Math.log2(Math.max(.001,market.volume/hour.volume))*50,20)
    }
    const marketInputs = inputs.length
    // A working news feed with no mention is zero attention; an absent market and no news is unknown.
    if (newsAvailable && (marketInputs > 0 || recent.length > 0)) {
      add('attention',100*(1-Math.exp(-recent.length/5)),10)
      add('publishers',publishers/3*100,5)
    }
    const weight = inputs.reduce((sum,i)=>sum+i.weight,0)
    const score = weight ? Math.round(inputs.reduce((sum,i)=>sum+i.value*i.weight,0)/weight*10)/10 : null
    const prior = comparable.at(-1)
    const delta = (previous: number | null | undefined) => score !== null && previous != null ? Math.round((score-previous)*10)/10 : null
    const liveRanking: CategoryRanking = { model:CATEGORY_SCORE_MODEL,score,calculatedAt:now,observedAt:marketInputs ? market!.updatedAt : recent.length ? Math.max(...recent.map(e=>e.collectedAt)) : null,status: score === null ? 'unavailable' : !marketInputs ? 'news-only' : now-market!.updatedAt > 15*60000 ? 'delayed' : 'current',inputs,changeSinceUpdate:delta(prior?.liveScore),change1h:delta(hour?.liveScore),change24h:delta(day?.liveScore) }
    const points = narrative.points.map(p=>p.time===now ? {...p,liveScore:score,scoreModel:CATEGORY_SCORE_MODEL,volume:market?.volume ?? null} : p)
    return {...narrative,liveRanking,points}
  }))
}
