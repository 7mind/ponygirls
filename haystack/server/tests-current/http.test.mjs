import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,api,encode,decode,document,rid,sleep} from './fixture.mjs';

describe('current Scala HTTP/auth/domain',()=>{
 let f;before(async()=>{f=await fixture();});after(async()=>{await f?.stop();});
 const fault=async(response,status,code)=>{assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');const body=decode(api.Failure,await response.json());assert.equal(body.code,code);return body;};
 const login=async(token=f.tokens.alice)=>{const r=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(token)),{headers:{Origin:f.base}});assert.equal(r.status,200);const value=decode(api.LoginResult,await r.json());assert.equal(value.versions.current,'1.0.0');assert.deepEqual(value.versions.supported,['1.0.0']);return r.headers.get('set-cookie');};
 const get=(key,revision)=>f.call('/api/v1/get',encode(api.GetRequest,new api.GetRequest(key,revision)),{token:f.tokens.alice});
 it('exact bearer, missing/wrong credentials, ambiguous cookie+bearer, no-store errors',async()=>{
  for(const authorization of [undefined,'Bearer nope','bearer '+f.tokens.alice,'Bearer  '+f.tokens.alice,'Bearer '+f.tokens.alice+' x'])await fault(await f.call('/api/v1/get',{},authorization?{headers:{Authorization:authorization}}:{}),401,'unauthorized');
  const cookie=(await login()).split(';')[0];
  await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice,headers:{Cookie:cookie}}),401,'ambiguous-credentials');
  await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',headers:{Cookie:cookie+'; '+cookie}}),401,'ambiguous-credentials');
 });
 it('current version info and explicit removed/future version rejection',async()=>{
  const versions=await fetch(f.base+'/api/versions');assert.equal(decode(api.VersionInfo,await versions.json()).current,'1.0.0');
  for(const version of ['0.9.0','9.0.0'])await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice,headers:{'X-Haystack-Version':version}}),400,'version-mismatch');
 });
 it('login ignores stale cookies; rolling cookie flags/restart persistence/logout',async()=>{
  const response=await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:f.base,Cookie:'haystack-dev=stale'}});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');for(const flag of ['haystack-dev=','HttpOnly','Path=/','SameSite=Strict','Max-Age=15552000'])assert.ok(cookie.includes(flag));assert.ok(!cookie.includes('Secure'));
  const pair=cookie.split(';')[0];await f.restart();
  const who=await f.call('/api/v1/whoami',undefined,{method:'GET',headers:{Cookie:pair}});assert.equal(who.status,200);assert.ok(who.headers.get('set-cookie').includes('Max-Age=15552000'));
  const identity=decode(api.Identity,await who.json());assert.deepEqual([identity.userId,identity.userType,identity.tokenId,identity.activityProjectId],['alice','human','browser','agent-activity']);
  const logout=await f.call('/api/v1/logout',{}, {headers:{Cookie:pair,Origin:f.base}});assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
  // Logout ends browser session sockets but does not revoke uniform static bearer.
  assert.equal((await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice})).status,200);
 });
 it('Host and Origin validation, cookie CSRF, bearer without browser Origin',async()=>{
  const cookie=(await login()).split(';')[0];
  await fault(await f.call('/api/v1/put',{}, {headers:{Cookie:cookie}}),403,'forbidden');
  await fault(await f.call('/api/v1/login',encode(api.LoginRequest,new api.LoginRequest(f.tokens.alice)),{headers:{Origin:'http://evil.test'}}),403,'forbidden');
  await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice,headers:{Origin:'http://evil.test'}}),403,'forbidden');
  await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice,headers:{Host:'evil.test'}}),403,'forbidden');
  assert.equal((await f.put('http:csrf')).status,200);
  const cookieWrite=await f.call('/api/v1/put',encode(api.PutRequest,new api.PutRequest('http:cookie',new api.DocumentPayload(document()),0,rid())),{headers:{Cookie:cookie,Origin:f.base}});assert.equal(cookieWrite.status,200);
 });
 it('full lossless document, Unicode/prototype keys/numbers, tags/links order, both identities stamp history',async()=>{
  const doc='{"title":"café 🐎","description":"d","fields":{"__proto__":{"constructor":9007199254740993},"n":0.10,"e":1e2,"z":-0,"a":[null,true,"𝄞"]},"type":"fact","status":"actual","importance":"low","human-attention":"required","links":[["rel","http:absent"],["rel","http:absent"]],"tags":["b","a","b"]}';
  const key='p%3Ax:caf%C3%A9%20%F0%9F%90%8E';const id=rid();
  const first=decode(api.PutResult,await (await f.put(key,doc,0,id)).json());assert.equal(first.revision,1);assert.equal(first.metadata.modifiedBy,'bot');
  const current=decode(api.Item,await (await get(key)).json());for(const raw of ['9007199254740993','0.10','1e2','-0','"__proto__"','🐎'])assert.ok(current.document.json.includes(raw));
  assert.equal(current.metadata.createdAt,first.metadata.createdAt,'PG and receipt timestamp agree exactly');
  const replay=decode(api.PutResult,await (await f.put(key,doc,0,id)).json());assert.equal(replay.replayed,true);assert.deepEqual(replay.metadata,first.metadata);
  assert.equal((await f.put(key,doc.replace('café','human edit'),1,rid(),f.tokens.alice)).status,200);
  const old=decode(api.Item,await (await get(key,1)).json());assert.equal(old.document.json,current.document.json);assert.equal(old.metadata.createdBy,'bot');
  const now=decode(api.Item,await (await get(key)).json());assert.equal(now.metadata.modifiedBy,'alice');assert.equal(now.metadata.createdBy,'bot');
  const history=await f.call('/api/v1/history',encode(api.HistoryRequest,new api.HistoryRequest(key)),{token:f.tokens.bot});const h=decode(api.HistoryResult,await history.json());assert.deepEqual(h.revisions.map(x=>[x.revision,x.modifiedBy,x.tokenId]),[[2,'alice','browser'],[1,'bot','default']]);
 });
 it('CAS, terminal replay persistence, no ID mutation, UUIDv7 envelope, duplicate-key errors',async()=>{
  const key='http:cas';const doc=document();const id=rid();assert.equal((await f.put(key,doc,0,id)).status,200);
  await fault(await f.put(key,document({title:'changed'}),0,id),409,'replay-conflict');
  const failed=rid();const first=await fault(await f.put(key,doc,0,failed),409,'conflict');
  assert.equal((await f.put(key,document({title:'next'}),1)).status,200);
  const again=await fault(await f.put(key,doc,0,failed),409,'conflict');assert.equal(again.currentRevision,first.currentRevision);
  const invalidId=rid();await fault(await f.put('http:invalid','{}',0,invalidId),400,'invalid-document');await fault(await f.put('http:invalid',doc,0,invalidId),409,'replay-conflict');
  const syntaxId=rid();await fault(await f.put('http:syntax','{"title":"a","title":"b"}',0,syntaxId),400,'bad-envelope');assert.equal((await f.put('http:syntax',doc,0,syntaxId)).status,200);
  await fault(await f.put('http:uuid4',doc,0,'0193e8d5-6f5c-4a1b-8c2d-000000000001'),400,'bad-envelope');
  await fault(await f.put('a:b:c',doc),400,'invalid-id');await fault(await f.put('http:missing',doc,1),404,'not-found');
 });
 it('concurrent same-ID commits produce one durable revision and stable replay outcomes',async()=>{
  const id=rid();const responses=await Promise.all(Array.from({length:16},()=>f.put('http:concurrent',document(),0,id)));for(const r of responses)assert.equal(r.status,200);
  const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results.filter(r=>!r.replayed).length,1);assert.ok(results.every(r=>r.revision===1));
  const h=await f.call('/api/v1/history',encode(api.HistoryRequest,new api.HistoryRequest('http:concurrent')),{token:f.tokens.alice});assert.equal(decode(api.HistoryResult,await h.json()).revisions.length,1);
 });
 it('global complete-set sorting, scope-bound saved cursor, live archive semantics',async()=>{
  for(const [id,title] of [['a','zebra'],['b','alpha'],['c','middle']])assert.equal((await f.put('sort:'+id,document({title}))).status,200);
  const search=async(query,project,limit,cursor,sort=new api.SearchSort('title','asc'))=>f.call('/api/v1/search',encode(api.SearchRequest,new api.SearchRequest(query,project,limit,cursor,sort)),{token:f.tokens.alice});
  const page=decode(api.SearchResult,await(await search('','sort',1)).json());assert.equal(page.items[0].title,'alpha');assert.ok(page.cursor);
  const next=decode(api.SearchResult,await(await search('','sort',1,page.cursor)).json());assert.equal(next.items[0].title,'middle');
  await fault(await search('','sort',2,page.cursor),400,'invalid-cursor');await fault(await search('','http',1,page.cursor),400,'invalid-cursor');
  await f.put('sort:b',document({title:'alpha',status:'archived'}),1);const defaultPage=decode(api.SearchResult,await(await search('','sort',10)).json());assert.equal(defaultPage.items.length,2);const archivePage=decode(api.SearchResult,await(await search('archived:all','sort',10)).json());assert.equal(archivePage.items.length,3);
 });
 it('analyze UTF16 spans, parser-backed completion, observed values and invalid input',async()=>{
  const analyze=await f.call('/api/v1/query/analyze',encode(api.QueryRequest,new api.QueryRequest('"🐎 alpha" AND unknown:x',24)),{token:f.tokens.bot});const value=decode(api.AnalyzeResult,await analyze.json());assert.equal(value.valid,false);assert.equal(value.spans[0].start,15);assert.equal(value.spans[0].end,24);
  const complete=await f.call('/api/v1/complete',encode(api.QueryRequest,new api.QueryRequest('sta',3)),{token:f.tokens.bot});assert.ok(decode(api.CompletionResult,await complete.json()).suggestions.includes('status:'));
  const values=await f.call('/api/v1/values',encode(api.ValuesRequest,new api.ValuesRequest('type')),{token:f.tokens.bot});assert.ok(decode(api.ValuesResult,await values.json()).values.includes('fact'));
  await fault(await f.call('/api/v1/values',encode(api.ValuesRequest,new api.ValuesRequest('bad')),{token:f.tokens.bot}),404,'not-found');
  await fault(await f.call('/api/v1/get','{"key":"a:b","key":"c:d","revision":null}',{token:f.tokens.bot}),400,'bad-envelope');
  await fault(await f.call('/api/v1/search',{query:'',project:null,limit:1,cursor:null,sort:{field:'evil',direction:'asc'}},{token:f.tokens.bot}),400,'bad-envelope');
 });
 it('explicit metadata lexical retrieval, pointer provenance, archived/scope filters, semantic unavailable',async()=>{
  await f.put('retrieve:one',document({title:'distinctive zebra',fields:{visible:'quartz retrieval fixture',n:12}}));
  await f.put('retrieve:archived',document({title:'distinctive zebra',status:'archived'}));
  const search=mode=>f.call('/api/v1/retrieve',encode(api.RetrieveRequest,new api.RetrieveRequest('quartz',mode,'retrieve',false,0,10)),{token:f.tokens.alice});
  const response=await search(api.RetrievalMode.Lexical);assert.equal(response.status,200);const result=decode(api.RetrieveResult,await response.json());assert.equal(result.sources.length,1);assert.equal(result.sources[0].pointer,'/visible');assert.equal(result.sources[0].key,'retrieve:one');assert.equal(result.countScope,'ExactMatches');
  for(const mode of [api.RetrievalMode.Semantic,api.RetrievalMode.Hybrid])await fault(await search(mode),503,'unavailable');
 });
 it('dynamic successes/faults are no-store/no-referrer and oversized envelopes fail closed',async()=>{
  for(const response of [await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.bot}),await f.call('/api/v1/does-not-exist',{}, {token:f.tokens.bot})]){assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');}
  await fault(await f.call('/api/v1/get',' '.repeat(3*1024*1024+1),{token:f.tokens.bot}),413,'too-large');
 });
 it('configured principal rate admission rejects overflow without changing identities',async()=>{
  const limited=await fixture({rateLimit:{windowMs:60000,max:1}});try{
   assert.equal((await limited.call('/api/v1/whoami',undefined,{method:'GET',token:limited.tokens.bot})).status,200);
   const denied=await limited.call('/api/v1/whoami',undefined,{method:'GET',token:limited.tokens.bot});assert.equal(denied.status,429);assert.equal(decode(api.Failure,await denied.json()).code,'rate-limited');
   assert.equal((await limited.call('/api/v1/whoami',undefined,{method:'GET',token:limited.tokens.alice})).status,200);
  }finally{await limited.stop();}
 });
 it('actual reverse proxy preserves no-store and identities while allowlisted logs omit body/key/token canaries',async()=>{
  const rows=[];const proxy=http.createServer((request,response)=>{
   const started=Date.now();const outgoing=http.request({host:'127.0.0.1',port:f.port,path:request.url,method:request.method,headers:{...request.headers,host:`127.0.0.1:${f.port}`}},incoming=>{
    rows.push({route:'api',requestId:randomUUID(),status:incoming.statusCode,durationMs:Date.now()-started});response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
   });outgoing.on('error',()=>{response.writeHead(503,{'Cache-Control':'no-store'});response.end();});request.pipe(outgoing);
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  try{
   const base=`http://127.0.0.1:${proxy.address().port}`;const headers=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Haystack-Version':'1.0.0'});
   for(const [token,user] of [[f.tokens.alice,'alice'],[f.tokens.bot,'bot']]){const r=await fetch(base+'/api/v1/whoami',{headers:headers(token)});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(decode(api.Identity,await r.json()).userId,user);}
   const title='LOG-TITLE-CANARY';const key='http:LOG-KEY-CANARY';const query='LOG-QUERY-CANARY';
   const put=await fetch(base+'/api/v1/put',{method:'POST',headers:headers(f.tokens.alice),body:JSON.stringify(encode(api.PutRequest,new api.PutRequest(key,new api.DocumentPayload(document({title})),0,rid())))});assert.equal(put.status,200);
   for(const text of [query,'unknown:"'+query+'"'])await fetch(base+'/api/v1/search',{method:'POST',headers:headers(f.tokens.alice),body:JSON.stringify(encode(api.SearchRequest,new api.SearchRequest(text,undefined,20,undefined,new api.SearchSort('key','asc'))))});
   const logs=JSON.stringify(rows)+'\n'+f.output();for(const secret of [title,key,query,f.tokens.alice,f.tokens.bot,'Bearer '])assert.ok(!logs.includes(secret));
   assert.ok(f.logs().some(row=>row.route==='put'&&row.result==='ok'&&row.userId==='alice'));assert.equal(rows.length,5);
  }finally{await new Promise(resolve=>proxy.close(resolve));}
 });
 it('reload revocation and fail-closed invalid replacement, without session secret logging',async()=>{
  const canary='SECRET-QUERY-CANARY';await f.call('/api/v1/search',encode(api.SearchRequest,new api.SearchRequest(canary,undefined,20,undefined,new api.SearchSort('key','asc'))),{token:f.tokens.bot});
  await f.reload(auth=>{auth.users=auth.users.filter(x=>x.id!=='bot');});await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.bot}),401,'unauthorized');
  await f.reload(auth=>{auth.users[0].tokens=[];});await fault(await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.alice}),503,'unavailable');
  assert.ok(!f.output().includes(f.tokens.alice));assert.ok(!f.output().includes(f.tokens.bot));assert.ok(!f.output().includes(canary));
  const allowed=new Set(['requestId','route','status','result','userId','tokenId','revision','durationMs']);assert.ok(f.logs().length>10);for(const row of f.logs()){for(const key of Object.keys(row))assert.ok(allowed.has(key));for(const key of ['requestId','route','status','result'])assert.ok(key in row);}
 });
});
