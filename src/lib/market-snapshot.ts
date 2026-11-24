export type MarketSnapshot={global:{marketCap:number;volume:number;capChange:number|null;volumeChange:number|null;at:number}|null;breadth:{advancing:number;declining:number;unchanged:number;total:number;at:number}|null;sentiment:{value:number;label:string;at:number}|null;errors:string[];checkedAt:number}
export const GLOBAL_MARKET_DELAY_MS = 10 * 60_000
export const GLOBAL_MARKET_MAX_AGE_MS = 30 * 60_000
export const GLOBAL_MARKET_REFRESH_MS = 20_000
