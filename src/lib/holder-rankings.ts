export type NativeHolder = { address: string; label: string | null; amount: string; accountType: string; isContract: boolean; firstSeenAt?: number; firstActivityAt?: number | null; activityBasis?: string }
export type HolderDirectory = { holders: NativeHolder[]; at: number; source: string; scope: string; delayed?: boolean }
export function compareNativeBalances(a: string, b: string): number {
  if (!/^\d+(\.\d+)?$/.test(a) || !/^\d+(\.\d+)?$/.test(b)) throw new Error('Invalid native balance')
  const [ai, af = ''] = a.split('.'), [bi, bf = ''] = b.split('.')
  const scale = Math.max(af.length, bf.length)
  const av = BigInt(ai + af.padEnd(scale, '0')), bv = BigInt(bi + bf.padEnd(scale, '0'))
  return av === bv ? 0 : av > bv ? -1 : 1
}
export const sortNativeHolders = (rows: NativeHolder[]) => [...rows].sort((a, b) => compareNativeBalances(a.amount, b.amount) || a.address.localeCompare(b.address))

export type HolderView = 'largest' | 'discovered' | 'recent-activity'
export function filterHolders(rows: NativeHolder[], view: HolderView, minimum: string, days: number, now: number, hidePrograms: boolean) {
  const cutoff = now - days * 86400000
  const filtered = rows.filter(h => (!hidePrograms || !h.isContract) && compareNativeBalances(h.amount, minimum) <= 0
    && (view !== 'recent-activity' || !h.isContract && h.firstActivityAt != null && h.firstActivityAt >= cutoff && h.firstActivityAt <= now))
  return view === 'discovered' ? filtered.sort((a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0) || compareNativeBalances(a.amount, b.amount)) : sortNativeHolders(filtered)
}

export type HolderTier = 'Whale' | 'Large holder' | 'Below threshold'
export function holderTier(amount: string, largeMinimum: string, whaleMinimum: string): HolderTier {
  if (compareNativeBalances(whaleMinimum, largeMinimum) > 0) throw new Error('Whale minimum must be at least the large-holder minimum')
  return compareNativeBalances(amount, whaleMinimum) <= 0 ? 'Whale' : compareNativeBalances(amount, largeMinimum) <= 0 ? 'Large holder' : 'Below threshold'
}
