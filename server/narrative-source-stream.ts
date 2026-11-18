import type {IncomingMessage,ServerResponse} from 'node:http'
import type {NarrativeSource} from '../src/lib/early-narrative.js'
type SourceService={sourceHealth():Promise<NarrativeSource[]>;subscribeSources(listener:(sources:NarrativeSource[])=>void):()=>void}
/** Authenticated status events only; opening a stream never requests upstream data. */
export class NarrativeSourceStream {
 private clients=new Set<ServerResponse>()
 constructor(private service:SourceService){}
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){
  if(url.pathname!=='/api/narratives/sources/stream')return false
  if(this.clients.size>=128){res.writeHead(503);res.end('Source status capacity reached');return true}
  const sources=await this.service.sourceHealth()
  if(res.destroyed)return true
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no',Connection:'keep-alive'})
  res.flushHeaders();this.clients.add(res)
  const write=(sources:NarrativeSource[])=>{
   if(res.destroyed)return
   if(res.writableLength>256*1024){res.destroy();return}
   res.write(`event: sources\ndata: ${JSON.stringify({sources,at:Date.now()})}\n\n`)
  }
  const unsubscribe=this.service.subscribeSources(write)
  const heartbeat=setInterval(()=>{if(res.writableLength>256*1024)res.destroy();else if(!res.destroyed)res.write(': heartbeat\n\n')},15000)
  heartbeat.unref()
  res.once('close',()=>{clearInterval(heartbeat);unsubscribe();this.clients.delete(res)})
  write(sources)
  return true
 }
 stop(){for(const res of this.clients)res.end();this.clients.clear()}
}
