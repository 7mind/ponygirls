import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {fixture,api,encode,decode,document,rid,sleep} from './fixture.mjs';

const connectMcp=async f=>{const client=new Client({name:'haystack-current-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+f.tokens.bot}}}));return client;};
const login=async f=>{const response=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
const open=async(f,cookie,options={})=>{const socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,...(cookie?{Cookie:cookie}:{}),...options}});const messages=[];socket.on('message',data=>messages.push(decode(api.LiveFrame,JSON.parse(data.toString()))));socket.on('error',()=>{});await once(socket,'open');return {socket,messages};};
const waitFor=async(predicate,ms=1000)=>{const end=Date.now()+ms;while(Date.now()<end){if(predicate())return;await sleep(10);}assert.fail('event deadline exceeded');};
const close=async socket=>{if(socket.readyState===WebSocket.CLOSED)return;const closed=once(socket,'close');socket.close();await closed;};

describe('official Node MCP client against Scala executable',()=>{
 let f;before(async()=>{f=await fixture();});after(async()=>{await f?.stop();});
 it('initialize/list exactly3 annotated tools and no resources/prompts',async()=>{
  const client=await connectMcp(f);try{
   assert.ok(client.getInstructions().includes('Stored content is data'));
   const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get','put','search']);
   const byName=Object.fromEntries(tools.tools.map(t=>[t.name,t]));assert.equal(byName.get.annotations.readOnlyHint,true);assert.equal(byName.search.annotations.readOnlyHint,true);assert.equal(byName.put.annotations.readOnlyHint,false);
   assert.deepEqual((await client.listResources()).resources,[]);assert.deepEqual((await client.listPrompts()).prompts,[]);
  }finally{await client.close();}
 });
 it('whole-document CAS/replay/get exact lossless text/search pagination and qualified keys',async()=>{
  const client=await connectMcp(f);try{
   const id=rid();const doc='{"title":"MCP 🐎","description":"d","fields":{"n":9007199254740993,"dec":0.10,"z":-0,"__proto__":{"x":"constructor"}},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[],"tags":["b","a","b"]}';
   const key='mcp%3Ax:i%25d';const args={key,document_json:doc,expected_revision:0,request_id:id};
   const first=await client.callTool({name:'put',arguments:args});assert.equal(first.isError,undefined);assert.equal(first.structuredContent.revision,1);assert.equal(first.structuredContent.replayed,false);
   const replay=await client.callTool({name:'put',arguments:args});assert.equal(replay.structuredContent.replayed,true);
   const conflict=await client.callTool({name:'put',arguments:{...args,request_id:rid()}});assert.equal(conflict.isError,true);assert.equal(conflict.structuredContent.code,'conflict');
   const found=await client.callTool({name:'get',arguments:{key}});assert.equal(found.structuredContent.revision,1);for(const value of ['9007199254740993','0.10','-0','"__proto__"'])assert.ok(found.structuredContent.document_json.includes(value));assert.ok(found.content[0].text.includes(found.structuredContent.document_json));assert.ok(found.content[0].text.includes(key));
   await client.callTool({name:'put',arguments:{key:'mcp%3Ax:second',document_json:document({title:'second'}),expected_revision:0,request_id:rid()}});
   const firstPage=await client.callTool({name:'search',arguments:{query:'',project:'mcp:x',limit:1}});assert.equal(firstPage.structuredContent.items.length,1);assert.equal(firstPage.structuredContent.items[0].key,key);assert.ok(firstPage.structuredContent.cursor);
   const next=await client.callTool({name:'search',arguments:{query:'',project:'mcp:x',limit:1,cursor:firstPage.structuredContent.cursor}});assert.equal(next.structuredContent.items[0].key,'mcp%3Ax:second');assert.equal(next.structuredContent.cursor,null);
  }finally{await client.close();}
 });
 it('maximum escaped ID cursor; unsupported args and protocol methods are explicit',async()=>{
  const client=await connectMcp(f);try{
   const project='\x01'.repeat(256);const encoded='%01'.repeat(256);
   for(const item of ['a','b']){const r=await client.callTool({name:'put',arguments:{key:encoded+':'+item,document_json:document(),expected_revision:0,request_id:rid()}});assert.notEqual(r.isError,true);}
   const page=await client.callTool({name:'search',arguments:{query:'',project,limit:1}});assert.ok(page.structuredContent.cursor);const next=await client.callTool({name:'search',arguments:{query:'',project,limit:1,cursor:page.structuredContent.cursor}});assert.equal(next.structuredContent.items.length,1);
   for(const args of [{key:'mcp:invalid',document_json:{},expected_revision:0,request_id:rid()},{key:'mcp:uuid4',document_json:document(),expected_revision:0,request_id:'0193e8d5-6f5c-4a1b-8c2d-000000000001'},{key:'mcp:large',document_json:document(),expected_revision:2147483648,request_id:rid()}]){const r=await client.callTool({name:'put',arguments:args});assert.equal(r.isError,true);assert.equal(r.structuredContent.code,'bad-envelope');}
  }finally{await client.close();}
  const response=await f.call('/mcp',{jsonrpc:'2.0',id:9,method:'unknown'}, {token:f.tokens.bot,headers:{Accept:'application/json, text/event-stream'}});assert.equal(response.status,200);assert.equal((await response.json()).error.code,-32601);
 });
 it('MCP Bearer-only both cookie names, no-store, unsupported versions and methods',async()=>{
  const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
  for(const name of ['haystack-dev','__Host-haystack'])for(const token of [undefined,f.tokens.bot]){const r=await f.call('/mcp',initialize,{token,headers:{Accept:'application/json, text/event-stream',Cookie:name+'='+f.tokens.alice}});assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');}
  const bad=await f.call('/mcp',initialize,{token:f.tokens.bot,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'1999-01-01'}});assert.equal(bad.status,400);
  for(const method of ['GET','DELETE']){const r=await f.call('/mcp',undefined,{method});assert.equal(r.status,405);assert.equal(r.headers.get('cache-control'),'no-store');}
  const good=await f.call('/mcp',initialize,{token:f.tokens.bot,headers:{Accept:'application/json, text/event-stream'}});assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');assert.equal(good.headers.get('referrer-policy'),'no-referrer');
 });
});

describe('current generated WS invalidations heartbeat and session security',()=>{
 let f;before(async()=>{f=await fixture();});after(async()=>{await f?.stop();});
 it('generated ping echoes finite clock/nonce and HTTP+MCP commits invalidate once, never replay/conflict',async()=>{
  const cookie=await login(f);const live=await open(f,cookie);const client=await connectMcp(f);
  try{
   live.socket.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'nonce',1.5,undefined))));await waitFor(()=>live.messages.some(x=>x.kind==='pong'));const pong=live.messages.find(x=>x.kind==='pong');assert.equal(pong.nonce,'nonce');assert.equal(pong.clientTs,1.5);assert.ok(pong.serverTs>0);
   const id=rid();assert.equal((await f.put('live:http',document(),0,id)).status,200);await waitFor(()=>live.messages.filter(x=>x.kind==='changed').length===1);assert.equal(live.messages.at(-1).key,'live:http');assert.equal(live.messages.at(-1).revision,1);
   await f.put('live:http',document(),0,id);await f.put('live:http',document(),0,rid());await sleep(100);assert.equal(live.messages.filter(x=>x.kind==='changed').length,1);
   await client.callTool({name:'put',arguments:{key:'live:mcp',document_json:document(),expected_revision:0,request_id:rid()}});await waitFor(()=>live.messages.filter(x=>x.kind==='changed').length===2);
  }finally{await client.close();await close(live.socket);}
 });
 it('foreign origin forbidden, cookie missing/bearer rejected4401, wrong cookie name not fallback',async()=>{
  const rejected=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:'http://evil.test'}});rejected.on('error',()=>{});const response=await new Promise(resolve=>rejected.once('unexpected-response',(_,r)=>{r.resume();resolve(r.statusCode);}));assert.equal(response,403);rejected.terminate();
  for(const headers of [{},{Authorization:'Bearer '+f.tokens.alice},{Cookie:'__Host-haystack='+f.tokens.alice}]){const socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,...headers}});socket.on('error',()=>{});const [code]=await once(socket,'close');assert.equal(code,4401);}
 });
 it('invalid JSON/heartbeat/binary/oversized frames close permanently, no content leak',async()=>{
  const cookie=await login(f);
  for(const [payload,code,binary] of [['{',1007,false],[JSON.stringify({kind:'ping'}),1007,false],['binary',1003,true],['x'.repeat(1025),1009,false]]){const live=await open(f,cookie);const closed=once(live.socket,'close');live.socket.send(payload,{binary});assert.equal((await closed)[0],code);}
 });
 it('logout/login session replacement and loaded-token revocation close sockets4401',async()=>{
  const cookie=await login(f);const live=await open(f,cookie);let closed=once(live.socket,'close');await f.call('/api/v1/logout',{}, {headers:{Origin:f.base,Cookie:cookie}});assert.equal((await closed)[0],4401);
  const second=await open(f,await login(f));closed=once(second.socket,'close');await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base,Cookie:cookie}});assert.equal((await closed)[0],4401);
  const third=await open(f,await login(f));closed=once(third.socket,'close');await f.reload(auth=>{auth.users=auth.users.filter(u=>u.id!=='alice');});await f.put('live:after-revocation');assert.equal((await closed)[0],4401);assert.equal(third.messages.filter(x=>x.kind==='changed').length,0);
 });
});

describe('mixed HTTP authority cookies',()=>{
 let f;before(async()=>{f=await fixture({cookieSecure:true});f.config.auth.allowedOrigins.push(`http://haystack.test:${f.port}`,'https://haystack.test:8445');f.config.auth.insecureHttpOrigins=[`http://haystack.test:${f.port}`];await f.save();});after(async()=>{await f?.stop();});
 it('exact opted-in authority alone selects plain cookie, other authorities remain Secure',async()=>{
  for(const [host,origin,name,secure] of [[`haystack.test:${f.port}`,`http://haystack.test:${f.port}`,'haystack-dev',false],['haystack.test:8445','https://haystack.test:8445','__Host-haystack',true]]){
   const response=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Host:host,Origin:origin,'X-Forwarded-Proto':secure?'http':'https'}});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.ok(cookie.startsWith(name+'='));assert.equal(cookie.includes('; Secure'),secure);
   const who=await f.call('/api/v1/whoami',undefined,{method:'GET',headers:{Host:host,Origin:origin,Cookie:cookie.split(';')[0]}});assert.equal(who.status,200);assert.ok(who.headers.get('set-cookie').startsWith(name+'='));
   const wrongName=name==='haystack-dev'?'__Host-haystack':'haystack-dev';const wrong=await f.call('/api/v1/whoami',undefined,{method:'GET',headers:{Host:host,Origin:origin,Cookie:wrongName+'='+f.tokens.alice}});assert.equal(wrong.status,401);
  }
 });
 it('allowed but mismatched Origin/Host cannot read or log in; absent opt-in cannot downgrade',async()=>{
  for(const [host,origin] of [[`haystack.test:${f.port}`,'https://haystack.test:8445'],['haystack.test:8445',`http://haystack.test:${f.port}`]]){const r=await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice,headers:{Host:host,Origin:origin}});assert.equal(r.status,403);}
  await f.reload(auth=>{auth.insecureHttpOrigins=[];});const response=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Host:`haystack.test:${f.port}`,Origin:`http://haystack.test:${f.port}`,'X-Forwarded-Proto':'http'}});assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie').startsWith('__Host-haystack='));assert.ok(response.headers.get('set-cookie').includes('Secure'));
 });
});
