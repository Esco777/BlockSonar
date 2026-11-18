import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { PGlite } from '@electric-sql/pglite'
import { PrivatePreferences, preferenceOwner } from './dist/server/private-preferences.js'
const state = name => ({ lists: [{ id: 'one', name, assetIds: ['bitcoin'] }], activeId: 'one' })
const user = address => ({ network: 'ethereum', chainId: 11155111, address })
test('private lists survive reconnect, isolate authenticated wallets, and reject stale writes', async () => {
 const db = new PGlite(), service = new PrivatePreferences()
 service.db = { query: async (sql, args) => {const result = await db.query(sql,args);return {...result, rowCount:result.rows.length}}, end:()=>db.close() }
 const alice=preferenceOwner(user('0xAlice')),bob=preferenceOwner(user('0xBob'))
 try {
  assert.equal((await service.read(alice,'watchlists')).revision,0)
  assert.equal(await service.write(alice,'watchlists',state('Private Alice'),0),1)
  assert.equal((await service.read(bob,'watchlists')).value,null)
  assert.equal(await service.write(bob,'watchlists',state('Private Bob'),0),1)
  assert.equal((await service.read(alice,'watchlists')).value.lists[0].name,'Private Alice')
  assert.equal(await service.write(alice,'watchlists',state('New Alice'),1),2)
  assert.equal(await service.write(alice,'watchlists',state('Stale tab'),1),null)
  assert.equal(await service.write(alice,'watchlists',state('Stale initial save'),0),null)
  assert.equal((await service.read(alice,'watchlists')).value.lists[0].name,'New Alice')
  const response={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}}
  const req=Object.assign(Readable.from([JSON.stringify({owner:alice,revision:1,value:state('Cross-account overwrite')})]),{method:'PUT',headers:{'content-type':'application/json'}})
  await service.handle(req,response,new URL('http://localhost/api/preferences/watchlists?owner='+alice),user('0xBob'))
  assert.equal(response.status,409)
  assert.equal((await service.read(bob,'watchlists')).value.lists[0].name,'Private Bob')
  assert.notEqual(preferenceOwner({...user('0xAlice'),chainId:97}),alice)
  assert.notEqual(preferenceOwner({network:'solana',chainId:0,address:'Abc'}),preferenceOwner({network:'solana',chainId:0,address:'abc'}))
 }finally{await service.stop()}
})
