import type { Narrative } from './early-narrative.js'
export const CATEGORY_SCORE_MODEL = 'category-activity-v1' as const
export const CATEGORY_SIGNAL_LABELS = { momentum: '24h category market-cap momentum', turnover: '24h trading volume / market cap', volumeTrend: 'Volume trend vs one hour ago', attention: 'Recent news attention', publishers: 'Independent news publishers' }
export type CategorySignal = keyof typeof CATEGORY_SIGNAL_LABELS
export type CategoryRanking = { model: typeof CATEGORY_SCORE_MODEL; score: number | null; calculatedAt: number; observedAt: number | null; status: 'current' | 'delayed' | 'news-only' | 'unavailable'; inputs: Array<{ key: CategorySignal; value: number; weight: number }>; changeSinceUpdate: number | null; change1h: number | null; change24h: number | null }
export function rankNarratives(items: Narrative[]): Narrative[] {
  return [...items].sort((a,b) => (b.liveRanking?.score ?? -1) - (a.liveRanking?.score ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
