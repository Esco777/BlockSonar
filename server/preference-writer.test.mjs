import test from 'node:test'
import assert from 'node:assert/strict'
import { PreferenceWriter } from './dist/src/lib/preference-writer.js'
test('private saves serialize revisions, preserve in-flight edits, and finish after navigating away', async () => {
 let finish;const gate=new Promise(resolve=>{finish=resolve}),calls=[]
 const fetcher=async (_url,options)=>{const payload=JSON.parse(options.body);calls.push(payload);if(calls.length===1)await gate;return Response.json({revision:payload.revision+1})}
 const statuses=[],writer=new PreferenceWriter('watchlists','alice',0,{name:'initial'},s=>statuses.push(s),fetcher)
 writer.update({name:'first'});writer.update({name:'latest'});writer.dispose();finish();await writer.flush()
 assert.deepEqual(calls.map(c=>[c.owner,c.revision,c.value.name]),[['alice',0,'first'],['alice',1,'latest']])
})
test('a rejected save retains unsaved data and never overwrites a changed sign-in',async()=>{
 const calls=[],statuses=[];let reject=true
 const writer=new PreferenceWriter('watchlists','alice',1,{name:'private'},s=>statuses.push(s),async(_url,o)=>{calls.push(JSON.parse(o.body));return reject?Response.json({error:'Your sign-in changed'},{status:409}):Response.json({revision:2})})
 writer.update({name:'unsaved'});await writer.flush()
 assert.equal(statuses.at(-1).unsaved,true);assert.match(statuses.at(-1).error,/sign-in changed/)
 writer.update({name:'latest unsaved'});await writer.flush();assert.equal(calls.length,1)
 reject=false;writer.retry();await writer.flush();assert.equal(calls.at(-1).owner,'alice');assert.equal(calls.at(-1).value.name,'latest unsaved');assert.equal(statuses.at(-1).unsaved,false)
})
