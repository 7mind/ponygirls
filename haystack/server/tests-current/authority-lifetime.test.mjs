import {it} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {fixture,api,encode,decode,document,rid,sleep} from './fixture.mjs';

it('revocation while a real HTTP body is held denies dispatch without a committed item or replay',async()=>{
 const f=await fixture();let request;
 try{
  const users=f.config.auth.users;const key='authority:body-held';const id=rid();
  const body=Buffer.from(JSON.stringify(encode(api.PutRequest,new api.PutRequest(key,new api.DocumentPayload(document()),0,id))));
  const response=new Promise((resolve,reject)=>{
   request=http.request(f.base+'/api/v1/put',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,Authorization:'Bearer '+f.tokens.alice,'X-Haystack-Version':'1.0.0'}},incoming=>{const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('end',()=>resolve({status:incoming.statusCode,headers:incoming.headers,text:Buffer.concat(chunks).toString()}));});request.on('error',reject);request.flushHeaders();request.write(body.subarray(0,1));
  });
  assert.equal((await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice})).status,200);
  await sleep(100);await f.reload(auth=>{auth.users=users.filter(user=>user.id!=='alice');});
  assert.equal((await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice})).status,401,'loaded authority must be revoked before body release');
  request.end(body.subarray(1));
  const denied=await response;assert.equal(denied.status,401);assert.equal(decode(api.Failure,JSON.parse(denied.text)).code,'unauthorized');assert.equal(denied.headers['set-cookie'],undefined);
  const missing=await f.call('/api/v1/get',encode(api.GetRequest,new api.GetRequest(key,undefined)),{token:f.tokens.bot});assert.equal(missing.status,404);
  const history=await f.call('/api/v1/history',encode(api.HistoryRequest,new api.HistoryRequest(key)),{token:f.tokens.bot});assert.deepEqual(decode(api.HistoryResult,await history.json()).revisions,[]);
  await f.reload(auth=>{auth.users=users;});const retry=await f.put(key,document(),0,id,f.tokens.alice);assert.equal(retry.status,200);assert.equal(decode(api.PutResult,await retry.json()).replayed,false,'unaccepted held request must not persist a replay');
 }finally{request?.destroy();await f.stop();}
});

it('failed real live handshakes and normal socket close release all per-token capacity',async()=>{
 const f=await fixture();let socket;
 try{
  const login=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  for(let i=0;i<16;i++){const failed=await f.call('/api/v1/live',undefined,{method:'GET',headers:{Origin:f.base,Cookie:cookie}});assert.equal(failed.status,426);assert.equal(failed.headers.get('cache-control'),'no-store');}
  for(const extra of [{'Sec-WebSocket-Key':'invalid','Sec-WebSocket-Version':'13'},{'Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version':'12'}])for(let i=0;i<8;i++){
   const failed=await f.call('/api/v1/live',undefined,{method:'GET',headers:{Host:'127.0.0.1:'+f.port,Origin:f.base,Cookie:cookie,Connection:'Upgrade',Upgrade:'websocket',...extra}});assert.equal(failed.status,400);assert.equal(failed.headers.get('cache-control'),'no-store');
  }
  for(let i=0;i<12;i++){
   socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,Cookie:cookie}});socket.on('error',()=>{});await once(socket,'open');
   const message=once(socket,'message');socket.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'lifetime-'+i,123,undefined))));
   const value=decode(api.LiveFrame,JSON.parse(String((await message)[0])));assert.equal(value.kind,'pong');assert.equal(value.nonce,'lifetime-'+i);
   const closed=once(socket,'close');socket.close();await closed;
  }
 }finally{socket?.terminate();await f.stop();}
});

it('healthy automatic protocol pongs keep a socket live across two real30second heartbeat intervals',{timeout:85000},async()=>{
 const f=await fixture();let socket;
 try{
  const login=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const pings=[];let secondPing;const second=new Promise(resolve=>{secondPing=resolve;});
  socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,Cookie:cookie}});socket.on('error',()=>{});socket.on('ping',bytes=>{pings.push(bytes.toString('hex'));if(pings.length===2)secondPing();});await once(socket,'open');
  const started=Date.now();
  await Promise.race([second,once(socket,'close').then(([code])=>{throw new Error('healthy ponging peer was closed: '+code);}),sleep(62000).then(()=>{throw new Error('two protocol heartbeat deadline exceeded');})]);
  assert.ok(Date.now()-started>=59000,'real production30second interval must not be shortened for tests');assert.equal(socket.readyState,WebSocket.OPEN);assert.notEqual(pings[0],pings[1]);assert.ok(pings.every(nonce=>nonce.length===16));
  const response=once(socket,'message');socket.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'after-two-intervals',123,undefined))));const value=decode(api.LiveFrame,JSON.parse(String((await response)[0])));assert.equal(value.kind,'pong');assert.equal(value.nonce,'after-two-intervals');
 }finally{socket?.terminate();await f.stop();}
});
