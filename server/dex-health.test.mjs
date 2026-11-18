import test from 'node:test'
import assert from 'node:assert/strict'
import { dexHealth } from './dist/src/lib/dex-health.js'
test('update connectivity cannot mask missing, failing, stale or backfilling collection',()=>{
 const now=1000000,healthy={lastAttemptAt:now,lastSuccessAt:now,lastErrorAt:null}
 assert.equal(dexHealth(false,'started',healthy,[],now),'Database not configured')
 assert.equal(dexHealth(true,'not configured',undefined,[],now),'Indexer not configured')
 assert.equal(dexHealth(true,'started',undefined,[],now),'Starting collection')
 assert.equal(dexHealth(true,'started',{...healthy,lastErrorAt:now+1},[],now),'Collection unavailable · retrying')
 assert.equal(dexHealth(true,'started',{...healthy,lastSuccessAt:now-90001},[],now),'Collection delayed')
 assert.equal(dexHealth(true,'started',healthy,[{status:'backfilling'}],now),'Catching up on history')
 assert.equal(dexHealth(true,'started',healthy,[],now),'Collection up to date')
})
