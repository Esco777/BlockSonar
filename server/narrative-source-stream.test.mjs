import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {NarrativeSourceStream} from './dist/server/narrative-source-stream.js'
class Response extends EventEmitter {
 destroyed=false;writableLength=0;chunks=[]
 writeHead(status,headers){this.status=status;this.headers=headers}
 flushHeaders(){}
 write(data){this.chunks.push(data);return true}
 end(){this.destroyed=true;this.emit('close')}
 destroy(){this.end()}
}
test('source status streams immediately, pushes changes without upstream calls, and cleans up subscribers',async()=>{
 const initial=[{id:'news',name:'News feed',kind:'news',status:'unconfigured',message:'Waiting',updatedAt:null}]
 let listener,unsubscribed=0
 const stream=new NarrativeSourceStream({sourceHealth:async()=>initial,subscribeSources:fn=>{listener=fn;return()=>{unsubscribed++}}})
 const res=new Response();assert.equal(await stream.handle({},res,new URL('http://localhost/api/narratives/sources/stream')),true)
 assert.equal(res.status,200);assert.equal(res.headers['Content-Type'],'text/event-stream');assert.match(res.chunks[0],/event: sources/)
 listener([{...initial[0],checking:true}]);assert.match(res.chunks[1],/"checking":true/)
 listener([{...initial[0],status:'error',checkedAt:123,message:'Cloudflare blocked the request'}]);assert.match(res.chunks[2],/Cloudflare/);assert.match(res.chunks[2],/"checkedAt":123/)
 stream.stop();assert.equal(res.destroyed,true);assert.equal(unsubscribed,1)
})
test('source stream leaves other routes alone and disconnects stalled consumers',async()=>{
 let listener,unsubscribed=0
 const stream=new NarrativeSourceStream({sourceHealth:async()=>[],subscribeSources:fn=>{listener=fn;return()=>{unsubscribed++}}})
 assert.equal(await stream.handle({},new Response(),new URL('http://localhost/api/narratives')),false)
 const res=new Response();await stream.handle({},res,new URL('http://localhost/api/narratives/sources/stream'))
 res.writableLength=300000;listener([]);assert.equal(res.destroyed,true);assert.equal(unsubscribed,1);stream.stop()
})
