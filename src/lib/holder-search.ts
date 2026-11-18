import { compareNativeBalances, type HolderDirectory, type HolderView } from './holder-rankings.js'
export type HolderSearchParams = { minimum: string; whaleMinimum: string; size: 'all' | 'whales' | 'large'; view: HolderView; days: number; hidePrograms: boolean }
export type WhalePurchase = { wallet: string; balance: string; token: string; symbol: string; amount: string; signature: string; at: number }
export type HolderSearchResult = HolderDirectory & { id: string; parameters: HolderSearchParams; checked: number; warnings: string[]; purchases: WhalePurchase[]; purchaseStatus: 'loading' | 'complete' | 'partial' | 'unavailable'; whalesChecked: number; whalesTargeted: number }
export function parseHolderSearch(p: URLSearchParams): HolderSearchParams {
  const minimum = p.get('minimum') ?? '100', whaleMinimum = p.get('whaleMinimum') ?? '1000'
  if (![minimum, whaleMinimum].every(value => /^\d{1,30}(\.\d{1,18})?$/.test(value)) || compareNativeBalances(whaleMinimum, minimum) > 0 || compareNativeBalances(whaleMinimum, '0') === 0) throw new Error('Use valid balances with whale minimum at least the large-holder minimum and greater than zero')
  const size = p.get('size') ?? 'all', view = p.get('view') ?? 'largest', days = Number(p.get('days') ?? '7'), hide = p.get('hidePrograms') ?? 'false'
  if (!['all', 'whales', 'large'].includes(size) || !['largest', 'discovered', 'recent-activity'].includes(view) || ![1, 7, 30].includes(days) || !['true', 'false'].includes(hide)) throw new Error('Invalid wallet search filters')
  return { minimum, whaleMinimum, size: size as HolderSearchParams['size'], view: view as HolderView, days, hidePrograms: hide === 'true' }
}
export const holderSearchQuery = (params: HolderSearchParams) => new URLSearchParams((['minimum', 'whaleMinimum', 'size', 'view', 'days', 'hidePrograms'] as const).map(key => [key, String(params[key])])).toString()
