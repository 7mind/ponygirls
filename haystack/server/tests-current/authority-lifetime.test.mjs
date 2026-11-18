import {it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {fixture,api,encode,decode,sleep} from './fixture.mjs';

let f;
before(async()=>{f=await fixture({},async()=>{},{humans:['alice','carol']});});
after(async()=>{await f?.stop();});

it('healthy automatic protocol pongs keep a socket live across two real30second heartbeat intervals while an idle revoked session closes4401 at its first',{timeout:85000},async()=>{
 let socket;let idle;
 try{
  const login=await f.login();assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const pings=[];let secondPing;const second=new Promise(resolve=>{secondPing=resolve;});
  socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,Cookie:cookie}});socket.on('error',()=>{});socket.on('ping',bytes=>{pings.push(bytes.toString('hex'));if(pings.length===2)secondPing();});await once(socket,'open');
  const started=Date.now();
  const twoBeats=Promise.race([second,once(socket,'close').then(([code])=>{throw new Error('healthy ponging peer was closed: '+code);}),sleep(62000).then(()=>{throw new Error('two protocol heartbeat deadline exceeded');})]);twoBeats.catch(()=>{});
  const carol=await f.login({},'carol');
  idle=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,Cookie:carol.headers.get('set-cookie').split(';')[0]}});idle.on('error',()=>{});await once(idle,'open');const closed=once(idle,'close');
  // HTTP101/open can precede allocation of the upgraded stream resource.
  // Prove admission while still authorized, then leave the connection idle;
  // otherwise a correct pre-admission revocation can close immediately4401.
  const established=once(idle,'message');idle.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'idle-established',1,undefined))));assert.equal(decode(api.LiveFrame,JSON.parse(String((await established)[0]))).nonce,'idle-established');
  const revoked=Date.now();await f.reload(auth=>{auth.users=auth.users.filter(user=>user.id!=='carol');});
  const [code]=await Promise.race([closed,sleep(32000).then(()=>{throw new Error('revocation heartbeat deadline exceeded');})]);assert.equal(code,4401);assert.ok(Date.now()-revoked>=29000,'production heartbeat interval must not be shortened for tests');
  await twoBeats;
  assert.ok(Date.now()-started>=59000,'real production30second interval must not be shortened for tests');assert.equal(socket.readyState,WebSocket.OPEN);assert.notEqual(pings[0],pings[1]);assert.ok(pings.every(nonce=>nonce.length===16));
  const response=once(socket,'message');socket.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'after-two-intervals',123,undefined))));const value=decode(api.LiveFrame,JSON.parse(String((await response)[0])));assert.equal(value.kind,'pong');assert.equal(value.nonce,'after-two-intervals');
 }finally{idle?.terminate();socket?.terminate();}
});
