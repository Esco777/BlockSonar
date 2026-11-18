// Browser checkout against the real disposable local program; test keys stay in Node.
import assert from'node:assert/strict'
import{createServer}from'node:http'
import{once}from'node:events'
import{spawn}from'node:child_process'
import{fileURLToPath}from'node:url'
import{createPrivateKey,sign}from'node:crypto'
import{writeFile}from'node:fs/promises'
import{VersionedTransaction}from'@solana/web3.js'
import WebSocket from'ws'
import{MembershipAuth}from'../server/dist/server/membership-auth.js'
import{SolanaCheckout}from'../server/dist/server/solana-checkout.js'
import{serveStaticSite}from'../server/dist/server/static-site.js'
export async function testSolanaBrowser(service,buyer){
 const origin='http://127.0.0.1:5180',unconfigured={configured:false,chainId:31337,contractAddress:'',hasAccess:async()=>false,validSignature:async()=>false}
 const auth=new MembershipAuth({...unconfigured,network:'ethereum'},{NODE_ENV:'test',MEMBERSHIP_APP_ORIGINS:origin},Date.now,[{...unconfigured,network:'bnb',chainId:56},service]),checkout=new SolanaCheckout(service,auth)
 const server=createServer(async(req,res)=>{const url=new URL(req.url,origin);if(await auth.handle(req,res,url)||await checkout.handle(req,res,url))return;if(url.pathname.startsWith('/api/')){try{await auth.authorize(req,res,url)}catch(error){auth.reject(res,error);return}res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Analytics are outside this checkout test"}');return}await serveStaticSite(req,res,fileURLToPath(new URL('../dist/',import.meta.url)))})
 server.listen(5180,'127.0.0.1');await once(server,'listening')
 const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${process.env.SOLANA_TEST_FIXTURE_DIR}/chrome`,'about:blank'],{stdio:['ignore','ignore','pipe']})
 let ws
 try{
  const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000);chrome.stderr.on('data',chunk=>{log+=chunk.toString();const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(new URL(match[1]))}});chrome.on('error',reject)})
  const pages=await(await fetch(`http://${endpoint.host}/json/list`)).json();ws=new WebSocket(pages[0].webSocketDebuggerUrl);await once(ws,'open')
  let id=0;const pending=new Map()
  const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,result=>result.error?reject(new Error(result.error.message)):resolve(result.result));ws.send(JSON.stringify({id:call,method,params}))})
  ws.on('message',raw=>{const event=JSON.parse(String(raw));if(pending.has(event.id)){pending.get(event.id)(event);pending.delete(event.id)}
   if(event.method==='Runtime.bindingCalled'&&event.params.name==='solanaTestSign'){
    const request=JSON.parse(event.params.payload);let signature
    if(request.type==='message'){const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(buyer.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});signature=sign(null,Buffer.from(request.bytes),key)}
    else{const tx=VersionedTransaction.deserialize(Uint8Array.from(request.bytes));tx.sign([buyer]);signature=tx.signatures[0]}
    void send('Runtime.evaluate',{expression:`window.signRequests.get(${request.id}).resolve(${JSON.stringify([...signature])});window.signRequests.delete(${request.id})`,contextId:event.params.executionContextId})
   }
  })
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  const wait=async expression=>{for(let attempt=0;attempt<240;attempt++){if(await evaluate(expression))return;const error=await evaluate(`document.querySelector('.join-error')?.textContent||''`);if(error)throw new Error(error);await new Promise(resolve=>setTimeout(resolve,500))}throw new Error(`Browser timed out: ${expression}`)}
  await send('Runtime.enable');await send('Page.enable');await send('Runtime.addBinding',{name:'solanaTestSign'})
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false})
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.signRequests=new Map();let id=0;const sign=(type,bytes)=>new Promise((resolve,reject)=>{const request=++id;window.signRequests.set(request,{resolve,reject});window.solanaTestSign(JSON.stringify({id:request,type,bytes:Array.from(bytes)}))});window.solana={publicKey:undefined,async connect(){this.publicKey={toString:()=>${JSON.stringify(buyer.publicKey.toBase58())}};return {publicKey:this.publicKey}},async signMessage(bytes){return {signature:Uint8Array.from(await sign('message',bytes))}},async signTransaction(tx){tx.signatures[0]=Uint8Array.from(await sign('transaction',tx.serialize()));return tx},on(){},removeListener(){}};`})
  await send('Page.navigate',{url:origin+'/#/home'})
  await wait(`document.querySelectorAll('.join-network-selector button').length===3`)
  await evaluate(`document.querySelectorAll('.join-network-selector button')[2].click()`)
  await wait(`document.querySelectorAll('.join-network-selector button')[2].getAttribute('aria-pressed')==='true'`)
  await evaluate(`document.querySelector('.join-primary').click()`)
  await wait(`!!document.querySelector('.join-quote')&&!document.querySelector('.join-primary').disabled`)
  assert.match(await evaluate(`document.querySelector('.join-quote').textContent`),/2\.000000 SOL/)
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/blocksonar-native-network-selector.png',Buffer.from(shot.data,'base64'))
  assert.equal(await evaluate(`(async()=> (await fetch('/api/liquidity')).status)()`),401)
  await evaluate(`document.querySelector('.join-primary').click()`)
  await wait(`!!document.querySelector('.app-shell')`)
  const session=await evaluate(`(async()=> (await (await fetch('/api/auth/session')).json()))()`);assert.equal(session.authenticated,true);assert.equal(session.network,'solana');assert.equal(session.address,buyer.publicKey.toBase58())
  await wait(`!!document.querySelector('[aria-label="Wallet account menu"]')`)
  await evaluate(`document.querySelector('[aria-label="Wallet account menu"]').click()`)
  assert.match(await evaluate(`document.querySelector('.wallet-menu-account small').textContent`),/SOL/)
  await evaluate(`document.querySelector('.wallet-menu-sign-out').click()`)
  await wait(`!!document.querySelector('.join-primary')`)
  assert.equal(await evaluate(`document.querySelector('.join-wallet-label').textContent`),'Connect wallet')
  assert.equal(await evaluate(`(async()=> (await fetch('/api/auth/session')).status)()`),401)
  console.log('PASS: actual browser SOL quote, native NFT purchase, wallet transaction/message signatures, finalized membership access, SOL balance label and logout')
 }finally{ws?.close();chrome.kill('SIGTERM');auth.stop();server.closeAllConnections();server.close()}
}
