import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
const names = ['COINGECKO_DEMO_API_KEY', 'COINGECKO_PRO_API_KEY', 'COINGECKO_API_KEY', 'CG_API_KEY', 'COINGECKO_API_PLAN'] as const
// Load only CoinGecko settings from the local files; leave other app settings alone.
export function loadCoinGeckoEnv() {
  for (const file of ['.env', '.env.local']) {
    try { const values = parse(readFileSync(file)); for (const name of names) if (!process.env[name]?.trim() && values[name]?.trim()) process.env[name] = values[name].trim() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('CoinGecko environment file could not be read') }
  }
  if (!process.env.COINGECKO_DEMO_API_KEY?.trim() && !process.env.COINGECKO_PRO_API_KEY?.trim() && (process.env.COINGECKO_API_PLAN?.trim().toLowerCase() || 'demo') === 'demo') {
    const generic = process.env.COINGECKO_API_KEY?.trim() || process.env.CG_API_KEY?.trim()
    if (generic) process.env.COINGECKO_DEMO_API_KEY = generic
  }
}
export function coinGeckoConfig(env = process.env) {
  const savedKey = (value: string | undefined) => {
    const key=value?.trim()
    return key && !/^(?:your(?:[_ -](?:actual|api|demo|pro))*[_ -]key(?:[_ -]here)?|replace[_ -]me)$/i.test(key) ? key : undefined
  }
  const pro = savedKey(env.COINGECKO_PRO_API_KEY), demo = savedKey(env.COINGECKO_DEMO_API_KEY), generic = savedKey(env.COINGECKO_API_KEY) || savedKey(env.CG_API_KEY)
  const plan = env.COINGECKO_API_PLAN?.trim().toLowerCase() || 'demo'
  if (!pro && !demo && generic && !['demo', 'pro'].includes(plan)) throw new Error('Set COINGECKO_API_PLAN to demo or pro')
  const mode: 'demo' | 'pro' | 'public' = pro ? 'pro' : demo ? 'demo' : generic ? plan as 'demo' | 'pro' : 'public'
  const key = pro || demo || generic
  const headers: Record<string, string> = mode === 'pro' ? { 'x-cg-pro-api-key': key! } : mode === 'demo' ? { 'x-cg-demo-api-key': key! } : {}
  return { mode, configured: !!key, base: mode === 'pro' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3', headers }
}
