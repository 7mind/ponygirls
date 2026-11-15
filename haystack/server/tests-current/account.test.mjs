import {it} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import WebSocket from 'ws';
import {fixture,api,encode,decode,passwordHash,sleep} from './fixture.mjs';

const pair=response=>response.headers.get('set-cookie').split(';')[0];
const account=(f,cookie)=>f.call('/api/account/v1',undefined,{method:'GET',headers:{Cookie:cookie,'Sec-Fetch-Site':'same-origin'}});
const who=(f,credential)=>f.call('/api/v1/whoami',undefined,{method:'GET',...credential});
const actorHeaders=async(f,cookie)=>{const response=await account(f,cookie);assert.equal(response.status,200);return {'X-Account-Actor':(await response.json()).user.actor};};
const issue=async(f,cookie,name='terminal')=>f.call('/api/account/v1/tokens',{name,scopes:['api']},{headers:{Cookie:cookie,Origin:f.base,...await actorHeaders(f,cookie)}});
const revoke=async(f,cookie,id)=>f.call('/api/account/v1/tokens/'+encodeURIComponent(id)+'/revoke',{},{headers:{Cookie:cookie,Origin:f.base,...await actorHeaders(f,cookie)}});
const fault=async(response,status,code)=>{
 assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{error:{code,message:code.replaceAll('-',' ')}});
};

it('password browser sessions survive process restart, remain independent, and copied logout cookies fail',async()=>{
 const f=await fixture();try{
  const first=await f.login();const firstCookie=pair(first);const secondCookie=pair(await f.login());
  assert.notEqual(firstCookie,secondCookie);assert.ok(!firstCookie.includes(f.tokens.alice));
  for(const flag of ['HttpOnly','SameSite=Strict','Path=/','Max-Age=34560000'])assert.ok(first.headers.get('set-cookie').includes(flag));
  const user=(await first.json()).user;assert.deepEqual([user.id,user.login,user.displayName],['alice','alice','Alice']);assert.match(user.actor,/^[0-9a-f]{64}$/u);
  await f.restart();assert.equal((await account(f,firstCookie)).status,200);assert.equal((await account(f,secondCookie)).status,200);
  const logout=await f.call('/api/account/v1/logout',{},{headers:{Cookie:firstCookie,Origin:f.base,...await actorHeaders(f,firstCookie)}});assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await who(f,{headers:{Cookie:firstCookie}})).status,401);await fault(await account(f,firstCookie),401,'unauthorized');
  assert.equal((await account(f,secondCookie)).status,200);assert.equal((await who(f,{token:f.tokens.alice})).status,200);
  await f.restart();assert.equal((await who(f,{headers:{Cookie:firstCookie}})).status,401);assert.equal((await account(f,secondCookie)).status,200);
 }finally{await f.stop();}
});

it('account token issue is one-time, durable, browser-only, and separates every bearer from cookies',async()=>{
 const f=await fixture();try{
  const login=await f.login();const cookie=pair(login);const user=(await login.json()).user;const initial=await (await account(f,cookie)).json();
  assert.deepEqual(initial,{user,tokens:[{id:'browser',name:'browser',source:'configured',createdAt:null,revoked:false,scopes:['api']}],scopes:['api']});
  await fault(await f.call('/api/account/v1',undefined,{method:'GET',token:f.tokens.alice,headers:{'Sec-Fetch-Site':'same-origin'}}),401,'unauthorized');
  assert.equal((await who(f,{headers:{Cookie:'haystack-dev='+f.tokens.alice}})).status,401);
  assert.equal((await who(f,{token:cookie.split('=')[1]})).status,401);
  const minted=await issue(f,cookie);assert.equal(minted.status,200);const issued=await minted.json();assert.equal(issued.token.source,'issued');assert.equal(issued.token.name,'terminal');assert.deepEqual(issued.token.scopes,['api']);assert.ok(issued.token.createdAt);assert.match(issued.secret,/^[A-Za-z0-9_-]{43}$/u);
  assert.equal((await who(f,{token:issued.secret})).status,200);assert.equal((await who(f,{headers:{Cookie:'haystack-dev='+issued.secret}})).status,401);
  let view=await (await account(f,cookie)).json();assert.ok(!JSON.stringify(view).includes(issued.secret));assert.ok(!JSON.stringify(view).includes(f.tokens.alice));assert.equal(view.tokens.length,2);
  await fault(await f.call('/api/account/v1/tokens',{name:'forbidden',scopes:['api']},{token:issued.secret,headers:{Origin:f.base}}),401,'unauthorized');
  await fault(await f.call('/api/account/v1/tokens',{name:'scope',scopes:['admin']},{headers:{Cookie:cookie,Origin:f.base}}),403,'forbidden');
  await f.restart();assert.equal((await who(f,{token:issued.secret})).status,200);
  await fault(await revoke(f,cookie,'browser'),403,'forbidden');assert.equal((await who(f,{token:f.tokens.alice})).status,200);
  assert.equal((await revoke(f,cookie,issued.token.id)).status,200);assert.equal((await who(f,{token:issued.secret})).status,401);
  view=await (await account(f,cookie)).json();assert.equal(view.tokens.find(token=>token.id===issued.token.id).revoked,true);assert.ok(!JSON.stringify(view).includes(issued.secret));
  await f.restart();assert.equal((await who(f,{token:issued.secret})).status,401);
  for(const secret of [issued.secret,f.passwords.alice,f.tokens.alice,cookie.split('=')[1]])assert.ok(!f.output().includes(secret));
 }finally{await f.stop();}
});

it('runtime token ownership and password-only human accounts cannot be bypassed by another session',async()=>{
 const f=await fixture({},async config=>{config.auth.users.push({id:'bob',type:'human',displayName:'Bob',login:'bob',passwordHashFile:config.auth.users[0].passwordHashFile,enabled:true,tokens:[]});});try{
  const alice=pair(await f.login());const issued=await (await issue(f,alice)).json();
  const response=await f.call('/api/account/v1/login',{login:'bob',password:f.passwords.alice},{headers:{Origin:f.base}});assert.equal(response.status,200);const bob=pair(response);
  const view=await (await account(f,bob)).json();assert.equal(view.user.id,'bob');assert.deepEqual(view.tokens,[]);
  const aliceActor=(await (await account(f,alice)).json()).user.actor;
  const bobIssued=await (await issue(f,bob,'bob terminal')).json();
  for(const [route,body] of [['/api/account/v1/tokens',{name:'wrong owner',scopes:['api']}],['/api/account/v1/tokens/'+bobIssued.token.id+'/revoke',{}],['/api/account/v1/logout',{}]])await fault(await f.call(route,body,{headers:{Cookie:bob,Origin:f.base,'X-Account-Actor':aliceActor}}),409,'conflict');
  assert.equal((await account(f,bob)).status,200);assert.equal((await who(f,{token:bobIssued.secret})).status,200);
  assert.equal((await (await account(f,bob)).json()).tokens.length,1,'stale actor cannot create a token for the replacement cookie owner');
  for(const actor of [undefined,'malformed'])await fault(await f.call('/api/account/v1/tokens',{name:'invalid actor',scopes:['api']},{headers:{Cookie:bob,Origin:f.base,...(actor===undefined?{}:{'X-Account-Actor':actor})}}),400,'invalid');
  await fault(await revoke(f,bob,issued.token.id),404,'not-found');assert.equal((await who(f,{token:issued.secret})).status,200);
  assert.equal((await revoke(f,alice,issued.token.id)).status,200);assert.equal((await who(f,{token:issued.secret})).status,401);
 }finally{await f.stop();}
});

it('account boundary rejects ambiguous credentials, cross-authority origin, query strings and malformed JSON',async()=>{
 const f=await fixture();try{
  const cookie=pair(await f.login());
  for(const [body,code] of [['{"login":"alice","login":"bob","password":"x"}','invalid'],[{login:'alice',password:f.passwords.alice,token:'extra'},'invalid'],[{login:'alice'},'invalid']])await fault(await f.call('/api/account/v1/login',body,{headers:{Origin:f.base}}),400,code);
  await fault(await f.call('/api/account/v1/login',' '.repeat(16385),{headers:{Origin:f.base}}),413,'too-large');
  for(const login of ['alice','unknown'])await fault(await f.call('/api/account/v1/login',{login,password:'incorrect'},{headers:{Origin:f.base}}),401,'unauthorized');
  await fault(await f.call('/api/account/v1?query=forbidden',undefined,{method:'GET',headers:{Cookie:cookie,'Sec-Fetch-Site':'same-origin'}}),400,'invalid');
  await fault(await f.call('/api/account/v1',undefined,{method:'GET',headers:{Cookie:cookie+'; '+cookie,'Sec-Fetch-Site':'same-origin'}}),401,'unauthorized');
  await fault(await f.call('/api/account/v1',undefined,{method:'GET',headers:{Cookie:cookie,Origin:'http://allowed.test'}}),403,'forbidden');
  await fault(await f.call('/api/account/v1/tokens',{name:'foreign',scopes:['api']},{headers:{Cookie:cookie,Origin:'http://evil.test'}}),403,'forbidden');
  await fault(await f.call('/api/account/v1/tokens',{name:'missing-origin',scopes:['api']},{headers:{Cookie:cookie}}),403,'forbidden');
  const legacy=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base}});assert.equal(legacy.status,401);assert.equal(legacy.headers.get('set-cookie'),null);
 }finally{await f.stop();}
});

it('disabled and removed account credentials are durably invalidated rather than resurrected on re-enable',async()=>{
 for(const kind of ['disabled','removed']){
  const f=await fixture();try{
   const users=structuredClone(f.config.auth.users);const cookie=pair(await f.login());const issued=await (await issue(f,cookie)).json();
   await f.reload(auth=>{if(kind==='disabled')auth.users[0].enabled=false;else auth.users=auth.users.filter(user=>user.id!=='alice');});
   assert.equal((await who(f,{headers:{Cookie:cookie}})).status,401);assert.equal((await who(f,{token:issued.secret})).status,401);assert.equal((await who(f,{token:f.tokens.alice})).status,401);
   await f.reload(auth=>{auth.users=users;});await f.restart();
   assert.equal((await who(f,{headers:{Cookie:cookie}})).status,401);assert.equal((await who(f,{token:issued.secret})).status,401);assert.equal((await who(f,{token:f.tokens.alice})).status,200);assert.equal((await f.login()).status,200);
  }finally{await f.stop();}
 }
});

it('password replacement invalidates existing sessions and unavailable config is not reported as bad credentials',async()=>{
 const f=await fixture();try{
  const cookie=pair(await f.login());const file=f.config.auth.users[0].passwordHashFile;const original=await readFile(file);
  await writeFile(file,'invalid-synthetic-hash');await sleep(250);
  const unavailable=await account(f,cookie);await fault(unavailable,503,'unavailable');assert.equal(unavailable.headers.get('set-cookie'),null);
  await writeFile(file,original);await sleep(250);assert.equal((await account(f,cookie)).status,200);
  const replacement='synthetic-new-password';await writeFile(file,passwordHash(replacement)+'\n');await sleep(250);
  assert.equal((await who(f,{headers:{Cookie:cookie}})).status,401);
  await fault(await f.call('/api/account/v1/login',{login:'alice',password:f.passwords.alice},{headers:{Origin:f.base}}),401,'unauthorized');
  const next=await f.call('/api/account/v1/login',{login:'alice',password:replacement},{headers:{Origin:f.base}});assert.equal(next.status,200);assert.equal((await account(f,pair(next))).status,200);
  await writeFile(file,original);await sleep(250);await f.restart();assert.equal((await who(f,{headers:{Cookie:cookie}})).status,401,'restoring an old hash must not revive deleted sessions');
 }finally{await f.stop();}
});

it('cross-process logout is revalidated at live delivery and closes before any private changed frame',async()=>{
 const f=await fixture();let peer;let socket;try{
  peer=await fixture({},async(config,{base})=>{config.database=structuredClone(f.config.database);config.auth={...structuredClone(f.config.auth),allowedOrigins:[...f.config.auth.allowedOrigins,base]};});
  const cookie=pair(await f.login());const messages=[];
  socket=new WebSocket(f.base.replace('http:','ws:')+'/api/v1/live',{headers:{Origin:f.base,Cookie:cookie}});socket.on('error',()=>{});socket.on('message',bytes=>messages.push(decode(api.LiveFrame,JSON.parse(String(bytes)))));await once(socket,'open');
  const established=once(socket,'message');socket.send(JSON.stringify(encode(api.LiveFrame,new api.LiveFrame('ping',undefined,undefined,'cross-process',1,undefined))));await established;
  const closed=once(socket,'close');const logout=await peer.call('/api/account/v1/logout',{},{headers:{Cookie:cookie,Origin:peer.base,...await actorHeaders(peer,cookie)}});assert.equal(logout.status,200);
  assert.equal((await f.put('live:private-after-peer-logout')).status,200);
  assert.equal((await Promise.race([closed,sleep(2000).then(()=>{throw new Error('cross-process session close deadline');})]))[0],4401);
  assert.equal(messages.filter(frame=>frame.kind==='changed').length,0);assert.equal((await who(f,{headers:{Cookie:cookie}})).status,401);
 }finally{socket?.terminate();await peer?.stop();await f.stop();}
});
