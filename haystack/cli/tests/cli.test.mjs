// Specified Behavioral/Blackbox/Good-Communication: actual CLI processes and owned loopback service.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,stat,mkdir,symlink,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {terminalProcess} from './pty.mjs';
const cli=fileURLToPath(new URL('../dist/cli/src/main.js',import.meta.url));
const token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const secret=Buffer.alloc(32,1).toString('base64url');
const actor=createHash('sha256').update('account-actor-v1:alice').digest('hex');
const id='0193e8d5-6f5c-7a1b-8c2d-000000000001';
const doc='{"title":"horse\\u001b[31m","description":"d","fields":{"n":9007199254740993,"d":0.10,"e":1e2,"z":-0,"__proto__":true},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}';
const metadata={createdAt:'2026-11-16T00:00:00Z',createdBy:'bot',modifiedAt:'2026-11-16T00:00:00Z',modifiedBy:'bot'};
let home,base,server,wss,hits=[],items=new Map(),replays=new Map(),lose=false,badResponse=false,mode='normal',slowPages=[],liveKey='p:i',swapTokenFile,putEffects=[];
const allModes=['Lexical','Semantic','Hybrid'];let retrievalModes=allModes,retrievalPending='0';const refusedModes=new Map();
function run(args,env={},input='') {return new Promise((resolve,reject)=>{const child=spawn(process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,[...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),...args],{env:{PATH:process.env.PATH,HOME:home,HAYSTACK_STATE_DIR:path.join(home,'state'),HAYSTACK_URL:base,HAYSTACK_TOKEN:token,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));child.stdin.end(input);});}
function ok(result){assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}
function fault(result,exit,code){assert.equal(result.code,exit,result.stderr);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).error.code,code);}
before(async()=>{
 home=await mkdtemp(path.join(os.tmpdir(),'haystack-cli-'));
 server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();const body=raw?JSON.parse(raw):undefined;hits.push({method:req.method,url:req.url,headers:req.headers,body});
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(typeof value==='string'?value:JSON.stringify(value));};
 const fail=(code,status=400)=>send({code,message:'CANARY-SECRET-PASSWORD',spans:[],currentRevision:null},status);
 if(mode==='redirect'){res.writeHead(307,{location:base+'/api/v1/health'});res.end();return;}
 if(mode==='oversize'){send(' '.repeat(1024*1024));return;}
 if(mode==='malformed'){send('{');return;}
 if(mode==='delay'){setTimeout(()=>send({ok:true}),1000);return;}
 if(req.headers['x-haystack-version']!=='1.0.0'&&req.url!=='/api/versions'){fail('version-mismatch');return;}
 if(req.url==='/api/v1/health')return send({ok:true});
 if(req.url==='/api/versions')return send({current:'1.0.0',minimum:'1.0.0',supported:['1.0.0']});
 if(req.url==='/api/account/v1/login'){assert.equal(body.login,'alice');assert.equal(body.password,'protected-password');res.setHeader('set-cookie',`haystack-dev=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`);return send({user:{id:'alice',login:'alice',displayName:'Alice',actor}});}
 if(req.url.startsWith('/api/account/v1')){
 if(req.headers.authorization){send({error:{code:'invalid',message:'CANARY'}},400);return;}
 if(req.headers.cookie!==`haystack-dev=${secret}`){send({error:{code:'unauthorized',message:'CANARY'}},401);return;}
 if(req.method==='GET')return send({user:{id:'alice',login:'alice',displayName:'Alice',actor},tokens:mode==='token-rows'?[{id:'configured-human-token',name:'configured worker',source:'configured',createdAt:null,revoked:false,scopes:['api']},{id:'issued:human-complete-token-id',name:'retired worker',source:'issued',createdAt:metadata.createdAt,revoked:true,scopes:['api']}]:[],scopes:['api']});
 if(req.headers['x-account-actor']!==actor){send({error:{code:'conflict',message:'CANARY'}},409);return;}
 if(req.url==='/api/account/v1/tokens'){if(lose){lose=false;req.socket.destroy();return;}if(mode==='post-account-auth'){mode='normal';return send({error:{code:'forbidden',message:'CANARY'}},403);}return send({token:{id:'issued:one',name:body.name,source:'issued',createdAt:'2026-11-16T00:00:00Z',revoked:false,scopes:['api']},secret:token});}
 if(mode==='false-ack'&&req.url.endsWith('/revoke'))return send({ok:false});
 if(req.url.endsWith('/logout'))res.setHeader('set-cookie','haystack-dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send({ok:true});}
 if(req.url==='/api/v1/whoami')return send({userId:'bot',userType:'agent',tokenId:'worker',activityProjectId:'corporate-activity'});
 if(req.url==='/api/v1/put'){
 const prev=replays.get(body.requestId);if(prev){if(prev.body!==JSON.stringify(body))return fail('replay-conflict',409);return send({...prev.result,replayed:true,...(mode==='wrong-replay-revision'?{revision:99}:{})});}
 const current=items.get(body.key);if((current?.revision??0)!==body.expectedRevision)return fail('conflict',409);
 const result={key:body.key,revision:body.expectedRevision+1,metadata,replayed:false};items.set(body.key,{key:body.key,revision:result.revision,document:body.document,metadata});replays.set(body.requestId,{body:JSON.stringify(body),result});putEffects.push(body);if(mode==='wrong-put-revision')return send({...result,revision:99});if(lose){lose=false;req.socket.destroy();return;}if(mode==='post-put-auth'){mode='normal';return fail('unauthorized',401);}if(badResponse){badResponse=false;return send({key:body.key});}return send(result);}
 if(req.url==='/api/v1/get'){if(mode==='error-details')return send({code:'conflict',message:'CANARY-UNTRUSTED',currentRevision:17,spans:[]},409);const item=items.get(body.key);return item?send(item):fail('not-found',404);}
 if(req.url==='/api/v1/history')return send({revisions:mode==='empty-history'?[]:[{revision:1,modifiedAt:metadata.modifiedAt,modifiedBy:'bot',tokenId:'worker'}]});
 if(mode==='slow-pages'&&req.url==='/api/v1/search'){if(!body.cursor&&swapTokenFile!==undefined)await writeFile(swapTokenFile,secret+'\n',{mode:0o600});res.on('close',()=>slowPages.push({cursor:body.cursor,finished:res.writableEnded}));setTimeout(()=>send({items:[],cursor:body.cursor?null:'slow-cursor'}),400);return;}
 if(req.url==='/api/v1/search')return send({items:[...items.values()].map(v=>({key:v.key,project:'p',item:'i',revision:v.revision,title:'horse\u001b[31m',docType:'fact',status:'actual',importance:'low',humanAttention:'cleared',tags:[],modifiedAt:metadata.modifiedAt,modifiedBy:'bot'})),cursor:body.cursor?null:'opaque-cursor'});
 if(req.url==='/api/v1/capabilities'&&req.method==='GET')return send({modes:retrievalModes});
 if(req.url==='/api/v1/retrieve'){if(refusedModes.has(body.mode)){const [code,status,message]=refusedModes.get(body.mode);return send({code,message,spans:[],currentRevision:null},status);}return send(`{"sources":[],"mode":"${body.mode}","countScope":"ExactMatches","total":9223372036854775807,"rankingLimit":null,"pending":"${retrievalPending}"}`);}
 if(req.url==='/api/v1/query/analyze'){if(mode==='error-spans')return send({code:'invalid-query',message:'CANARY-UNTRUSTED',currentRevision:null,spans:[{start:2,end:5,message:'CANARY-UNTRUSTED'}]},400);return send({valid:true,spans:[]});}
 if(req.url==='/api/v1/complete')return send({suggestions:mode==='empty-completions'?[]:['type:fact']});
 if(req.url==='/api/v1/values')return send({values:mode==='empty-values'?[]:['fact']});
 return fail('unavailable',503);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 wss=new WebSocketServer({server,path:'/api/v1/live',verifyClient:(info,done)=>{if(mode==='hang-upgrade')return;done(info.req.headers.origin===base&&info.req.headers.cookie===`haystack-dev=${secret}`&&!info.req.headers.authorization);}});wss.on('connection',ws=>{ws.on('message',bytes=>{const frame=JSON.parse(bytes);if(frame.kind==='ping')ws.send(JSON.stringify({...frame,kind:'pong',serverTs:Date.now()}));});setTimeout(()=>ws.send(JSON.stringify({kind:'changed',key:liveKey,revision:99,nonce:null,clientTs:null,serverTs:null})),20);if(mode==='flood'){const timer=setInterval(()=>{if(ws.readyState===1&&ws.bufferedAmount<65536)ws.send(JSON.stringify({kind:'changed',key:'p'.repeat(220)+':'+ 'i'.repeat(220),revision:1,nonce:null,clientTs:null,serverTs:null}));},1);ws.on('close',()=>clearInterval(timer));}});
});
after(async()=>{wss.close();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});});
test('help and version are credential/state/network lazy; human default under pipe',async()=>{
 const n=hits.length;const help=await run(['--help'],{HAYSTACK_TOKEN_FILE:'/does/not/exist'});assert.equal(help.code,0);assert.match(help.stdout,/Examples:/);assert.match(help.stdout,/archive/);assert.equal(hits.length,n);
 assert.match((await run(['--version'])).stdout,/0.1.0/);
 const r=await run(['--allow-http','health'],{HAYSTACK_TOKEN_FILE:'/does/not/exist'});assert.equal(r.code,0);assert.match(r.stdout,/healthy/i);assert.ok(!r.stdout.startsWith('{'));assert.equal(hits.at(-1).headers.authorization,undefined);
});
test('global --json works on either side, stdout purity and stable errors',async()=>{
 for(const args of [['--json','--allow-http','whoami'],['whoami','--allow-http','--json']]){const r=await run(args);assert.equal(ok(r).result.userId,'bot');assert.equal(r.stderr,'');}
 const n=hits.length;fault(await run(['get','a:b:c','--json','--allow-http']),2,'invalid-id');assert.equal(hits.length,n);
 fault(await run(['get','p:absent','--allow-http','--json']),4,'not-found');
 fault(await run(['--json','--unknown']),2,'usage');
});
test('ambiguity and transport policy fail before reading credentials or sending',async()=>{
 const n=hits.length;fault(await run(['--json','--allow-http','whoami'],{HAYSTACK_TOKEN_FILE:'/missing'}),2,'ambiguous-credentials');
 fault(await run(['--json','whoami']),2,'insecure-transport');assert.equal(hits.length,n);
 fault(await run(['--json','whoami','--allow-http'],{HAYSTACK_TOKEN:'bad'}),2,'invalid-credential');
 fault(await run(['--json','whoami','--allow-http'],{HAYSTACK_URL:base+'/?token=CANARY'}),2,'invalid-url');
});
test('managed credential symlinks resolve to bounded regular owner-only files',async()=>{
 const file=path.join(home,'managed-token');const link=path.join(home,'managed-token-link');await writeFile(file,token+'\n',{mode:0o600});await symlink(file,link);
 assert.equal(ok(await run(['whoami','--json','--allow-http'],{HAYSTACK_TOKEN:'',HAYSTACK_TOKEN_FILE:link})).result.userId,'bot');
});
test('put/get preserve exact document numbers, request IDs and full identifiers',async()=>{
 const file=path.join(home,'document.json');await writeFile(file,doc);
 const result=ok(await run(['put','p:i','--file',file,'--expected-revision','0','--request-id',id,'--json','--allow-http']));assert.equal(result.requestId,id);assert.equal(result.result.revision,1);
 const put=hits.filter(h=>h.url==='/api/v1/put').at(-1);assert.equal(put.body.document.json,doc);assert.equal(put.body.expectedRevision,0);
 const r=ok(await run(['get','p:i','--json','--allow-http']));assert.equal(r.result.document.json,doc);
 const human=await run(['get','p:i','--allow-http']);assert.match(human.stdout,/p:i/);assert.match(human.stdout,/9007199254740993/);assert.ok(!human.stdout.includes('\u001b'));assert.ok(!human.stdout.includes('\x9b'));
});
test('read path accepts larger stored documents without narrowing them to new-write bounds',async()=>{
 const stored=doc.replace('\"description\":\"d\"','\"description\":\"'+ 'x'.repeat(1100000) +'\"');items.set('p:stored',{key:'p:stored',revision:1,document:{json:stored},metadata});
 const result=ok(await run(['get','p:stored','--json','--allow-http']));assert.equal(result.result.document.json,stored);items.delete('p:stored');
});
test('bad source JSON, duplicates, request IDs, precision and flags rejected locally',async()=>{
 const n=hits.length;
 for(const input of ['{"x":1,"x":2}','{"x":1e1000000}','{','{"x":"\\ud800"}']){fault(await run(['put','p:invalid','--file','-','--expected-revision','0','--json','--allow-http'],{},input),2,'invalid-document');}
 fault(await run(['put','p:i','--file','-','--expected-revision','9007199254740993','--json','--allow-http'],{},doc),2,'usage');
 fault(await run(['put','p:i','--file','-','--expected-revision','0','--request-id','0193e8d5-6f5c-4a1b-8c2d-000000000001','--json','--allow-http'],{},doc),2,'usage');
 fault(await run(['search','--limit','0','--json','--allow-http']),2,'usage');assert.equal(hits.length,n);
});
test('search paging/sort/query, count scope and i64 decoding remain explicit',async()=>{
 const r=ok(await run(['search','type:fact','--sort','title','--direction','desc','--limit','5','--cursor','previous','--json','--allow-http']));assert.equal(r.result.cursor,null);const h=hits.at(-1);assert.equal(h.body.query,'type:fact');assert.equal(h.body.sort.direction,'desc');assert.equal(h.body.cursor,'previous');
 assert.match((await run(['search','--allow-http'])).stdout,/not a total/);
 const retrieved=ok(await run(['retrieve','horse','--json','--allow-http']));assert.equal(retrieved.result.total,'9223372036854775807');
 assert.match((await run(['retrieve','horse','--allow-http'])).stdout,/ExactMatches.*9223372036854775807/);
 for(const args of [['analyze','type:fact'],['complete','type:'],['values','type'],['history','p:i']])assert.equal((await run([...args,'--json','--allow-http'])).code,0);
});
test('retrieve without --mode is hybrid when offered, otherwise lexical with a notice; an explicit mode is never substituted',async()=>{
 const notConfigured='semantic retrieval is not configured; lexical-only capability';const embeddingFailed='query embedding failed';
 const lexicalNotice=reason=>`Notice: Hybrid search is not available on this server: ${reason}; showing lexical results\n`;
 const calls=async args=>{const n=hits.length;const result=await run(['retrieve','horse',...args,'--json','--allow-http']);return {result,requests:hits.slice(n).map(h=>h.url==='/api/v1/retrieve'?h.body.mode:h.method+' '+h.url)};};
 try{
  retrievalPending='3';const hybrid=await calls([]);
  assert.deepEqual(hybrid.requests,['GET /api/v1/capabilities','Hybrid']);assert.deepEqual([ok(hybrid.result).result.mode,ok(hybrid.result).result.pending],['Hybrid','3']);
  assert.equal(hybrid.result.stderr,'Notice: 3 items are not yet indexed for semantic search; results may be incomplete\n');
  retrievalPending='0';retrievalModes=['Lexical'];const lexical=await calls([]);
  assert.deepEqual(lexical.requests,['GET /api/v1/capabilities','Lexical']);assert.equal(ok(lexical.result).result.mode,'Lexical');assert.equal(lexical.result.stderr,lexicalNotice(notConfigured));
  retrievalModes=allModes;refusedModes.set('Hybrid',['unavailable',503,embeddingFailed]);const retried=await calls([]);
  assert.deepEqual(retried.requests,['GET /api/v1/capabilities','Hybrid','Lexical']);assert.equal(ok(retried.result).result.mode,'Lexical');assert.equal(retried.result.stderr,lexicalNotice(embeddingFailed));
  // The downgrade stays visible when the lexical re-run fails too; the lexical failure keeps its own exit status.
  refusedModes.set('Lexical',['invalid-query',400,'CANARY-SECRET-PASSWORD']);const failedRetry=await calls([]);refusedModes.delete('Lexical');
  assert.deepEqual(failedRetry.requests,['GET /api/v1/capabilities','Hybrid','Lexical']);assert.deepEqual([failedRetry.result.code,failedRetry.result.stdout],[2,'']);
  const [notice,failure,...rest]=failedRetry.result.stderr.split('\n');assert.deepEqual([notice+'\n',rest],[lexicalNotice(embeddingFailed),['']]);
  assert.deepEqual([JSON.parse(failure).error.code,JSON.parse(failure).error.reason],['invalid-query',undefined]);assert.ok(!failedRetry.result.stderr.includes('CANARY'));
  refusedModes.set('Semantic',['unavailable',503,notConfigured]);const explicit=await calls(['--mode','semantic']);
  assert.deepEqual(explicit.requests,['Semantic']);fault(explicit.result,6,'unavailable');const error=JSON.parse(explicit.result.stderr).error;assert.deepEqual([error.message,error.reason,error.status],[notConfigured,'not-configured',503]);
 }finally{retrievalModes=allModes;retrievalPending='0';refusedModes.clear();}
});
test('lost ACK retains immutable private operation and blocks fresh writes until exact replay',async()=>{
 lose=true;const failed=await run(['put','p:lost','--file','-','--expected-revision','0','--request-id','0193e8d5-6f5c-7a1b-8c2d-000000000002','--json','--allow-http'],{},doc);fault(failed,7,'uncertain-write');assert.ok(!failed.stderr.includes('horse'));
 const beforePending=hits.length;const pending=ok(await run(['pending','--json','--allow-http'],{HAYSTACK_TOKEN:'intentionally-unavailable-token'}));assert.equal(hits.length,beforePending);assert.equal(pending.result.operation.requestId,'0193e8d5-6f5c-7a1b-8c2d-000000000002');
 const before=hits.filter(h=>h.url==='/api/v1/put').length;fault(await run(['put','p:fresh','--file','-','--expected-revision','0','--json','--allow-http'],{},doc),7,'pending-write');assert.equal(hits.filter(h=>h.url==='/api/v1/put').length,before);
 const replay=ok(await run(['replay','--json','--allow-http']));assert.equal(replay.result.replayed,true);const calls=hits.filter(h=>h.url==='/api/v1/put'&&h.body.key==='p:lost');assert.deepEqual(calls[0].body,calls[1].body);
});
test('malformed successful write response remains uncertain, reconcile replays original ID',async()=>{
 badResponse=true;fault(await run(['put','p:badack','--file','-','--expected-revision','0','--json','--allow-http'],{},doc),7,'uncertain-write');assert.equal(ok(await run(['reconcile','--json','--allow-http'])).result.replayed,true);
});
test('postcommit authority rejection retains exact domain operation for replay',async()=>{
 mode='post-put-auth';fault(await run(['put','p:postauth','--file','-','--expected-revision','0','--json','--allow-http'],{},doc),7,'uncertain-write');
 assert.ok(ok(await run(['pending','--json','--allow-http'])).result.operation);assert.equal(ok(await run(['replay','--json','--allow-http'])).result.replayed,true);
});
test('CAS helpers read head then write whole exact document; no implicit merges',async()=>{
 assert.equal(ok(await run(['archive','p:i','--json','--allow-http'])).result.revision,2);let p=hits.filter(h=>h.url==='/api/v1/put').at(-1);assert.equal(p.body.expectedRevision,1);assert.match(p.body.document.json,/9007199254740993/);assert.equal(JSON.parse(p.body.document.json).status,'archived');
 fault(await run(['unarchive','p:i','--json','--allow-http']),2,'usage');
 assert.equal(ok(await run(['unarchive','p:i','--status','actual','--json','--allow-http'])).result.revision,3);
 assert.equal(ok(await run(['attention','p:i','required','--json','--allow-http'])).result.revision,4);
 assert.equal(ok(await run(['restore','p:i','--revision','1','--json','--allow-http'])).result.revision,5);
});
test('password login/account/token/logout use only origin-bound private cookie + actor',async()=>{
 const pass=path.join(home,'password');await writeFile(pass,'protected-password\n',{mode:0o600});
 const login=await run(['login','alice','--password-file',pass,'--json','--allow-http']);assert.equal(ok(login).result.user.id,'alice');assert.ok(!login.stdout.includes(secret));assert.equal(hits.at(-1).headers.authorization,undefined);
 const entries=await readdir(path.join(home,'state'));assert.ok(entries.length);assert.equal((await stat(path.join(home,'state'))).mode&0o777,0o700);for(const entry of entries)assert.equal((await stat(path.join(home,'state',entry))).mode&0o777,0o600);
 const account=await run(['account','--json','--allow-http']);assert.equal(ok(account).result.user.actor,actor);assert.equal(hits.at(-1).headers.cookie,`haystack-dev=${secret}`);
 const secretFile=path.join(home,'issued-token');const issue=await run(['token','issue','--name','worker','--secret-file',secretFile,'--json','--allow-http']);assert.equal(issue.code,0,issue.stderr);assert.ok(!issue.stdout.includes(token));assert.equal((await readFile(secretFile,'utf8')).trim(),token);assert.equal((await stat(secretFile)).mode&0o777,0o600);assert.equal(hits.at(-1).headers['x-account-actor'],actor);
 assert.equal((await run(['token','revoke','issued:one','--json','--allow-http'])).code,0);
 assert.equal((await run(['status','--json','--allow-http'])).code,0);
 assert.equal((await run(['logout','--json','--allow-http'])).code,0);
 fault(await run(['account','--json','--allow-http']),3,'unauthorized');
});
test('postcommit account authority rejection never clears one-time secret guard',async()=>{
 const pass=path.join(home,'password');ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));mode='post-account-auth';
 fault(await run(['token','issue','--name','postauth','--secret-file',path.join(home,'postauth-token'),'--json','--allow-http']),7,'uncertain-account');
 const n=hits.length;fault(await run(['token','issue','--name','postauth','--secret-file',path.join(home,'postauth-token2'),'--json','--allow-http']),7,'pending-account');assert.equal(hits.length,n);
 ok(await run(['token','acknowledge','--json','--allow-http']));
});
test('non-replayable token issue lost response is blocked, never blind-retried',async()=>{
 const pass=path.join(home,'password');ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));lose=true;
 const destination=path.join(home,'lost-token');fault(await run(['token','issue','--name','lost','--secret-file',destination,'--json','--allow-http']),7,'uncertain-account');
 const count=hits.length;fault(await run(['token','issue','--name','lost','--secret-file',destination,'--json','--allow-http']),7,'pending-account');assert.equal(hits.length,count);
});
test('redirects, malformed/oversized replies and timeouts are sanitized and never followed',async()=>{
 for(const [value,extra,code] of [['redirect',[],'redirect-refused'],['malformed',[],'invalid-response'],['oversize',['--max-response-bytes','1024'],'too-large'],['delay',['--timeout-ms','100'],'unavailable']]){mode=value;const n=hits.length;const result=await run(['health','--json','--allow-http',...extra]);fault(result,6,code);assert.equal(hits.length,n+1);assert.ok(!result.stderr.includes('CANARY'));}mode='normal';
});
test('watch has bounded cancellation and clean NDJSON frames',async()=>{
 const result=await run(['watch','--json','--allow-http','--duration-ms','150','--max-events','1']);assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');const lines=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(lines.length,1);assert.equal(lines[0].event.kind,'changed');assert.equal(lines[0].event.revision,99);
});
test('state symlinks fail closed; session never leaks across origins',async()=>{
 const alternate=await mkdtemp(path.join(os.tmpdir(),'haystack-cli-link-'));const link=path.join(alternate,'state');await symlink(path.join(home,'state'),link);
 fault(await run(['account','--json','--allow-http'],{HAYSTACK_STATE_DIR:link}),2,'unsafe-state');await rm(alternate,{recursive:true,force:true});
 const n=hits.length;fault(await run(['account','--json','--allow-http'],{HAYSTACK_URL:base.replace('127.0.0.1','localhost')}),3,'unauthorized');assert.equal(hits.length,n);
});
test('environment bearer is exact transport text; file-only trailing LF is not accepted in env',async()=>{
 const n=hits.length;fault(await run(['whoami','--allow-http','--json'],{HAYSTACK_TOKEN:token+'\n'}),2,'invalid-credential');assert.equal(hits.length,n);
});
test('JSON help stays lazy and is valid machine output on either side of a command',async()=>{
 const n=hits.length;for(const args of [['--json','--help'],['get','p:i','--help','--json']]){const result=ok(await run(args,{HAYSTACK_TOKEN_FILE:'/missing'}));assert.equal(result.command,'help');assert.match(result.result.text,/Examples:/);}assert.equal(hits.length,n);
});
test('closed output pipe returns a sanitized output error without a Node stack trace',async()=>{
 const child=spawn(process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,[...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),'--json','--version'],{env:{PATH:process.env.PATH,HOME:home},stdio:['ignore','pipe','pipe']});child.stdout.destroy();let stderr='';child.stderr.on('data',b=>stderr+=b);const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,6,stderr);assert.equal(JSON.parse(stderr).error.code,'output-failed');assert.ok(!stderr.includes('node:internal'));
});
test('watch duration before authenticated open is a failure, not successful observation',async()=>{
 mode='hang-upgrade';try{fault(await run(['watch','--json','--allow-http','--duration-ms','50','--timeout-ms','1000']),6,'unavailable');}finally{mode='normal';}
});
test('token revoke requires positive acknowledgement, not merely HTTP200',async()=>{
 const pass=path.join(home,'password');ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));
 mode='false-ack';try{fault(await run(['token','revoke','issued:one','--json','--allow-http']),6,'invalid-response');}finally{mode='normal';}
});
// Regression: ordinary default output must be a domain view, not a pretty-printed DTO.
function human(result){assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');return result.stdout;}
test('human identity and versions use domain labels instead of raw DTOs',async()=>{
 const who=human(await run(['whoami','--allow-http']));assert.match(who,/^User: bot\nType: agent\nToken: worker\nActivity project: corporate-activity\n$/);assert.ok(!who.includes('"userId"'));
 const versions=human(await run(['versions','--allow-http']));assert.match(versions,/Current API: 1\.0\.0/);assert.match(versions,/Minimum API: 1\.0\.0/);assert.match(versions,/Supported APIs: 1\.0\.0/);
});
test('human item view decodes document text and preserves exact structured field numbers',async()=>{
 const text=doc.replace('"description":"d"','"description":"first line\\nsecond line"');ok(await run(['put','p:human-get','--file','-','--expected-revision','0','--json','--allow-http'],{},text));
 const view=human(await run(['get','p:human-get','--allow-http']));assert.match(view,/^Item: p:human-get\nRevision: 1\n/);assert.match(view,/Title: horse\\u\{1b\}\[31m/);assert.match(view,/Type: fact\nStatus: actual\nAttention: cleared\nImportance: low/);assert.match(view,/Description:\n  first line\n  second line/);assert.match(view,/Fields \(JSON\):\n  \{/);for(const n of ['9007199254740993','0.10','1e2','-0'])assert.ok(view.includes(n));assert.match(view,/Created: 2026-11-16T00:00:00Z by bot/);assert.match(view,/Modified: 2026-11-16T00:00:00Z by bot/);assert.match(view,/Links: none/);assert.match(view,/Tags: none/);assert.ok(!view.includes('"json":'));assert.ok(!view.includes('\\"title\\"'));assert.ok(!view.includes('\u001b'));
});
test('human history and suggestion lists include rows and explicit empty states',async()=>{
 const history=human(await run(['history','p:human-history','--allow-http']));assert.match(history,/Revision history: p:human-history/);assert.match(history,/Revision 1.*2026-11-16T00:00:00Z.*bot.*worker/);
 assert.match(human(await run(['values','type','--allow-http'])),/Values for type \(bounded suggestions\):\n  - fact/);
 assert.match(human(await run(['complete','type:','--allow-http'])),/Completions \(bounded suggestions\):\n  - type:fact/);
 assert.match(human(await run(['analyze','type:fact','--allow-http'])),/Query: valid/);
 try{mode='empty-history';assert.match(human(await run(['history','p:human-history','--allow-http'])),/No revisions\./);mode='empty-values';assert.match(human(await run(['values','type','--allow-http'])),/No values\./);mode='empty-completions';assert.match(human(await run(['complete','type:','--allow-http'])),/No completions\./);}finally{mode='normal';}
});
test('human pending view names exact operation IDs and recovery without document contents',async()=>{
 const request='0193e8d5-6f5c-7a1b-8c2d-000000000010';lose=true;fault(await run(['put','p:human-pending','--file','-','--expected-revision','0','--request-id',request,'--json','--allow-http'],{},doc),7,'uncertain-write');
 try{const view=human(await run(['pending','--allow-http']));assert.match(view,/Pending writes: 1/);assert.match(view,/Item: p:human-pending/);assert.match(view,/Expected revision: 0/);assert.ok(view.includes('Request ID: '+request));assert.match(view,/User: bot/);assert.match(view,/Token: worker/);assert.match(view,/Recovery: replay or reconcile/);assert.ok(!view.includes('horse'));assert.ok(!view.includes('"operations"'));}finally{ok(await run(['replay','--json','--allow-http']));}
 assert.match(human(await run(['pending','--allow-http'])),/No pending writes\./);
});
test('human mutation receipts label outcome, revision, provenance and full request ID',async()=>{
 const request='0193e8d5-6f5c-7a1b-8c2d-000000000011';const view=human(await run(['put','p:human-write','--file','-','--expected-revision','0','--request-id',request,'--allow-http'],{},doc));assert.match(view,/^Saved: p:human-write\nRevision: 1\nOutcome: committed/);assert.ok(view.includes('Request ID: '+request));assert.match(view,/Modified: 2026-11-16T00:00:00Z by bot/);assert.ok(!view.includes('"metadata"'));
 assert.match(human(await run(['archive','p:human-write','--allow-http'])),/^Archived: p:human-write\nRevision: 2/);
});
test('human login, account, status and token lists show owner and token metadata',async()=>{
 const pass=path.join(home,'human-password');await writeFile(pass,'protected-password\n',{mode:0o600});const login=human(await run(['login','alice','--password-file',pass,'--allow-http']));assert.match(login,/Signed in: Alice/);assert.match(login,/Account: alice/);assert.match(login,/Login: alice/);assert.ok(login.includes('Actor: '+actor));assert.ok(!login.includes(secret));
 const account=human(await run(['account','--allow-http']));assert.match(account,/Account: alice/);assert.match(account,/Scopes: api/);assert.match(account,/No tokens\./);assert.ok(!account.includes('"tokens"'));
 assert.match(human(await run(['status','--allow-http'])),/Session: authenticated/);
 try{mode='token-rows';const list=human(await run(['token','list','--allow-http']));assert.match(list,/Tokens: 2/);assert.match(list,/configured-human-token.*configured worker.*configured.*active/);assert.match(list,/issued:human-complete-token-id.*retired worker.*issued.*revoked/);assert.ok(list.includes('Created: 2026-11-16T00:00:00Z'));}finally{mode='normal';}
});
test('human token receipts and sign-out describe actions without printing secrets',async()=>{
 ok(await run(['token','acknowledge','--json','--allow-http']));const file=path.join(home,'human-issued-token');const issued=human(await run(['token','issue','--name','human worker','--secret-file',file,'--allow-http']));assert.match(issued,/Token issued: issued:one/);assert.match(issued,/Name: human worker/);assert.match(issued,/Secret: saved to the requested private file \(not displayed\)/);assert.ok(!issued.includes(token));
 assert.match(human(await run(['token','revoke','issued:one','--allow-http'])),/^Token revoked: issued:one/);
 assert.match(human(await run(['token','acknowledge','--allow-http'])),/No uncertain token issue guard\./);
 assert.match(human(await run(['logout','--allow-http'])),/^Signed out\./);
});
test('human typed calls use readable selected domain views while JSON protocol remains exact',async()=>{
 const view=human(await run(['call','values','--file','-','--allow-http'],{},'{"field":"type"}'));assert.match(view,/Values \(bounded suggestions\):\n  - fact/);assert.ok(!view.includes('"values"'));
 const json=await run(['whoami','--json','--allow-http']);assert.equal(json.stdout,'{"ok":true,"command":"whoami","result":{"userId":"bot","userType":"agent","tokenId":"worker","activityProjectId":"corporate-activity"}}\n');assert.equal(json.stderr,'');
 fault(await run(['get','p:human-missing','--json','--allow-http']),4,'not-found');
});
test('search all aborts the last in-flight page at its absolute total deadline',async()=>{
 mode='slow-pages';slowPages=[];swapTokenFile=path.join(home,'pagination-token');await writeFile(swapTokenFile,token+'\n',{mode:0o600});const before=hits.length;
 try{const result=await run(['search','--all','--timeout-ms','700','--allow-http','--json'],{HAYSTACK_TOKEN:'',HAYSTACK_TOKEN_FILE:swapTokenFile});fault(result,6,'pagination-limit');assert.equal(slowPages.length,2);assert.equal(slowPages[0].finished,true);assert.equal(slowPages[1].finished,false,'the final HTTP response must be cancelled, not merely rejected after arrival');assert.deepEqual(hits.slice(before).map(hit=>hit.headers.authorization),['Bearer '+token,'Bearer '+token]);}finally{mode='normal';swapTokenFile=undefined;}
});
test('human get and typed get render all broad field values without variadic-call overflow',async()=>{
 const broad=JSON.stringify({...JSON.parse(doc),fields:Array(200000).fill(0)});ok(await run(['put','p:human-broad','--file','-','--expected-revision','0','--json','--allow-http'],{},broad));
 assert.equal(ok(await run(['get','p:human-broad','--json','--allow-http'])).result.document.json,broad);
 for(const [args,input] of [[['get','p:human-broad'],''],[['call','get','--file','-'],'{"key":"p:human-broad","revision":null}']]){const view=human(await run([...args,'--allow-http'],{},input));assert.match(view,/^Item: p:human-broad/);assert.match(view,/Tags: none/);assert.equal([...view.matchAll(/^    0,?$/gm)].length,200000);}
});
test('human browse and typed browse preserve every returned summary field and provenance',async()=>{
 ok(await run(['put','p:human-summary','--file','-','--expected-revision','0','--json','--allow-http'],{},doc));
 const request='{"query":"","project":null,"limit":20,"cursor":null,"sort":{"field":"key","direction":"asc"}}';
 for(const [args,input] of [[['search'],''],[['call','search','--file','-'],request]]){const view=human(await run([...args,'--allow-http'],{},input));assert.match(view,/Modified: 2026-11-16T00:00:00Z by bot/);for(const field of ['Project: p','Item: i','Type: fact','Status: actual','Attention: cleared','Importance: low','Tags: none','Cursor: opaque-cursor'])assert.ok(view.includes(field),field);assert.ok(!view.includes('\u001b'));}
});
test('watch accepts a legal canonical key larger than the previous one-KiB frame cap',async()=>{
 const pass=path.join(home,'long-watch-password');await writeFile(pass,'protected-password\n',{mode:0o600});ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));
 liveKey='A'.repeat(256)+':'+ '%25'.repeat(256);
 try{const result=await run(['watch','--json','--allow-http','--duration-ms','1000','--max-events','1']);const frame=ok(result).event;assert.equal(frame.kind,'changed');assert.equal(frame.key,liveKey);}finally{liveKey='p:i';}
});
test('qualified components enforce the server UTF16 bound without rejecting128 supplementary scalars',async()=>{
 const n=hits.length;fault(await run(['get','p:'+encodeURIComponent('😀'.repeat(129)),'--json','--allow-http']),2,'invalid-id');assert.equal(hits.length,n);
 const valid='p:'+encodeURIComponent('😀'.repeat(128));ok(await run(['put',valid,'--file','-','--expected-revision','0','--json','--allow-http'],{},doc));assert.equal(ok(await run(['get',valid,'--json','--allow-http'])).result.key,valid);
});
test('watch duration and cancellation bound pending stdout delivery without reporting false success',async()=>{
 const pass=path.join(home,'blocked-watch-password');await writeFile(pass,'protected-password\n',{mode:0o600});ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));
 async function observe(consume,cancel){return new Promise((resolve,reject)=>{
  const child=spawn(process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,[...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),'watch','--json','--allow-http','--duration-ms',cancel?'10000':'1200','--max-events','100000'],{env:{PATH:process.env.PATH,HOME:home,HAYSTACK_STATE_DIR:path.join(home,'state'),HAYSTACK_URL:base,HAYSTACK_TOKEN:token},stdio:['ignore','pipe','pipe']});
  let forced=false,stderr='';if(consume)child.stdout.on('data',()=>{});child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  const stop=setTimeout(()=>{forced=true;child.kill('SIGKILL');},3200);const interrupt=cancel?setTimeout(()=>child.kill('SIGINT'),1200):undefined;
  child.on('close',(code,signal)=>{clearTimeout(stop);clearTimeout(interrupt);child.stdout.destroy();resolve({forced,code,signal,stderr});});
 });}
 mode='flood';try{const control=await observe(true,false);assert.equal(control.forced,false);assert.equal(control.code,0,control.stderr);for(const cancel of [false,true]){const blocked=await observe(false,cancel);assert.equal(blocked.forced,false,'watch remained alive with an unread stdout pipe');assert.equal(blocked.code,6,blocked.stderr);assert.equal(JSON.parse(blocked.stderr).error.code,'output-failed');}}finally{mode='normal';}
});
test('watch still rejects malformed canonical IDs and frames beyond its bounded queue budget',async()=>{
 const pass=path.join(home,'hostile-watch-password');await writeFile(pass,'protected-password\n',{mode:0o600});ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));
 try{for(const [key,code] of [['a:b:c','invalid-response'],['x'.repeat(70*1024),'unavailable']]){liveKey=key;fault(await run(['watch','--json','--allow-http','--duration-ms','1000','--max-events','1']),6,code);}}finally{liveKey='p:i';}
});
test('put ACKs bind create, update and replay revisions to their frozen CAS input',async()=>{
 const key='p:ack-positive';const create='0193e8d5-6f5c-7a1b-8c2d-000000000020';const update='0193e8d5-6f5c-7a1b-8c2d-000000000021';const advance='0193e8d5-6f5c-7a1b-8c2d-000000000022';
 const send=(expected,request)=>run(['put',key,'--file','-','--expected-revision',String(expected),'--request-id',request,'--json','--allow-http'],{},doc);
 assert.equal(ok(await send(0,create)).result.revision,1);assert.equal(ok(await send(1,update)).result.revision,2);assert.equal(ok(await send(2,advance)).result.revision,3);
 const replay=ok(await send(1,update));assert.equal(replay.result.revision,2);assert.equal(replay.result.replayed,true);assert.equal(putEffects.filter(effect=>effect.key===key).length,3);
});
test('wrong but schema-valid put ACK revisions retain exact intent until correctly bound replay',async()=>{
 const key='p:ack-negative';const request='0193e8d5-6f5c-7a1b-8c2d-000000000023';items.set(key,{key,revision:2,document:{json:doc},metadata});
 const directory=path.join(home,'state');const pendingFiles=async()=>(await readdir(directory)).filter(file=>file.includes('.pending-'));
 mode='wrong-put-revision';try{
  const result=await run(['put',key,'--file','-','--expected-revision','2','--request-id',request,'--json','--allow-http'],{},doc);
  assert.equal(items.get(key).revision,3);assert.equal(putEffects.filter(effect=>effect.key===key).length,1);
  assert.equal(result.code,7,`schema-valid wrong ACK accepted: ${result.stdout}; pendingFiles=${JSON.stringify(await pendingFiles())}`);fault(result,7,'uncertain-write');assert.equal(JSON.parse(result.stderr).error.requestId,request);
  const files=await pendingFiles();assert.equal(files.length,1);const retained=await readFile(path.join(directory,files[0]),'utf8');const operation=JSON.parse(retained).operation;
  assert.deepEqual(operation,{key,document:{json:doc},expectedRevision:2,requestId:request});assert.deepEqual(operation,putEffects.find(effect=>effect.key===key));
  mode='wrong-replay-revision';fault(await run(['replay','--json','--allow-http']),7,'uncertain-write');assert.equal(await readFile(path.join(directory,files[0]),'utf8'),retained);
  mode='normal';const replay=ok(await run(['replay','--json','--allow-http']));assert.equal(replay.requestId,request);assert.equal(replay.result.revision,3);assert.equal(replay.result.replayed,true);assert.equal(putEffects.filter(effect=>effect.key===key).length,1);assert.deepEqual(await pendingFiles(),[]);
  const attempts=hits.filter(hit=>hit.url==='/api/v1/put'&&hit.body.key===key);assert.equal(attempts.length,3);for(const attempt of attempts)assert.deepEqual(attempt.body,operation);
 }finally{mode='normal';}
});
// Regression: help must be scoped and discoverable without configuration, state or credentials.
test('command and token action help is scoped, discoverable and offline',async()=>{
 const before=hits.length;const unavailable={HAYSTACK_URL:'',HAYSTACK_TOKEN_FILE:'/missing',HAYSTACK_STATE_DIR:'/missing/state'};
 for(const args of [['get','--help'],['--help','get'],['help','get'],['get','p:i','--help']]){const view=human(await run(args,unavailable));assert.match(view,/Usage: haystack get PROJECT:ITEM/);assert.match(view,/--revision/);assert.match(view,/Examples:/);assert.ok(!view.includes('token issue --name'));}
 for(const args of [['token','issue','--help'],['help','token','issue']]){const view=human(await run(args,unavailable));assert.match(view,/Usage: haystack token issue --name NAME --secret-file NEW-FILE/);assert.match(view,/once|one-time/);assert.match(view,/0600/);}
 assert.match(human(await run(['help','token'],unavailable)),/token revoke TOKEN-ID/);
 fault(await run(['help','unknown','--json'],unavailable),2,'usage');assert.equal(hits.length,before);
});
// Regression: unused token flags and action arity must fail before URL/session/state lookup.
test('token action arity and irrelevant flags are rejected before configuration or effects',async()=>{
 const before=hits.length;
 for(const args of [['token','list','--name','ignored'],['token','revoke','issued:one','--secret-file','/missing'],['token','acknowledge','--name','ignored'],['token','list','extra'],['token','issue','extra'],['token','revoke'],['token','unknown']]){const result=await run([...args,'--json'],{HAYSTACK_URL:'',HAYSTACK_STATE_DIR:'/missing/state'});fault(result,2,'usage');assert.match(JSON.parse(result.stderr).error.message,/token/);}
 const bad=await run(['token','list','--name','SENSITIVE-INPUT']);assert.equal(bad.code,2);assert.match(bad.stderr,/--name/);assert.match(bad.stderr,/haystack token list --help/);assert.ok(!bad.stderr.includes('SENSITIVE-INPUT'));assert.equal(hits.length,before);
 const arity=await run(['get']);assert.equal(arity.code,2);assert.match(arity.stderr,/haystack get PROJECT:ITEM/);assert.match(arity.stderr,/haystack get --help/);
});
// Regression: sanitized machine diagnostics were discarded by the human error view.
test('human errors preserve safe revision and UTF16 details without leaking remote messages',async()=>{
 try{
  mode='error-details';const conflict=await run(['get','p:diagnostic','--allow-http']);assert.equal(conflict.code,5);assert.equal(conflict.stdout,'');assert.match(conflict.stderr,/Current revision: 17/);assert.match(conflict.stderr,/HTTP status: 409/);assert.ok(!conflict.stderr.includes('CANARY'));
  const json=await run(['get','p:diagnostic','--allow-http','--json']);assert.equal(json.stderr,'{"ok":false,"error":{"code":"conflict","message":"revision or account owner changed; re-read and deliberately edit","status":409,"currentRevision":17}}\n');
  mode='error-spans';const query=await run(['analyze','bad','--allow-http']);assert.equal(query.code,2);assert.match(query.stderr,/UTF16 2\.\.5/);assert.ok(!query.stderr.includes('CANARY'));
 }finally{mode='normal';}
});
const ansi=/\x1b\[[0-9;]*m/g;
const plain=value=>value.replace(ansi,'');
function tty(args,env,width,terminals){return terminalProcess([process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),...args],{PATH:process.env.PATH,HOME:home,HAYSTACK_STATE_DIR:path.join(home,'state'),HAYSTACK_URL:base,HAYSTACK_TOKEN:token,TERM:'tmux-256color',...env},width,terminals);}
test('colour controls preserve plain pipes and explicit modes override environment',async()=>{
 const normal=human(await run(['whoami','--allow-http']));assert.ok(!normal.includes('\x1b'));
 for(const args of [['--color','always','whoami','--allow-http'],['whoami','--color=always','--allow-http']]){const view=human(await run(args,{NO_COLOR:'1',TERM:'dumb'}));assert.ok(view.includes('\x1b['));assert.equal(plain(view),normal);}
 for(const args of [['--color','never','whoami','--allow-http'],['whoami','--color','auto','--allow-http']])assert.equal(human(await run(args)),normal);
 const help=human(await run(['--color','always','--help']));assert.ok(help.includes('\x1b['));assert.equal(plain(help),human(await run(['--help'])));
 for(const args of [['--color','invalid','--help','--json'],['--color','--json'],['--color','always','--color','never','--json']])fault(await run(args),2,'usage');
});
test('real PTY auto colour honours nonempty NO_COLOR and TERM=dumb at 80 and 120 columns',async()=>{
 for(const width of [80,120]){
  const normal=human(await tty(['whoami','--allow-http'],{},width,'both'));assert.ok(normal.includes('\x1b['));assert.match(plain(normal),/^User: bot\nType: agent\n/);
  for(const env of [{NO_COLOR:'1'},{TERM:'dumb'}])assert.ok(!human(await tty(['whoami','--allow-http'],env,width,'both')).includes('\x1b'));
  assert.ok(human(await tty(['whoami','--allow-http'],{NO_COLOR:''},width,'both')).includes('\x1b['));
  assert.ok(!human(await tty(['whoami','--color','never','--allow-http'],{},width,'both')).includes('\x1b'));
  assert.ok(human(await tty(['whoami','--color','always','--allow-http'],{NO_COLOR:'1',TERM:'dumb'},width,'both')).includes('\x1b['));
 }
});
test('help and stderr use their own terminal capability without styling redirected stdout',async()=>{
 const help=await tty(['get','--help'],{},80,'stdout');assert.equal(help.code,0,help.stderr);assert.ok(help.stdout.includes('\x1b['));assert.match(plain(help.stdout),/Usage: haystack get PROJECT:ITEM/);
 const error=await tty(['get'],{},120,'stderr');assert.equal(error.code,2);assert.equal(error.stdout,'');assert.ok(error.stderr.includes('\x1b['));assert.match(plain(error.stderr),/haystack get --help/);
 const redirected=await tty(['whoami','--allow-http'],{},120,'stderr');assert.equal(redirected.code,0,redirected.stderr);assert.ok(!redirected.stdout.includes('\x1b'));
 const errorPipe=await tty(['get'],{},80,'stdout');assert.equal(errorPipe.code,2);assert.ok(!errorPipe.stderr.includes('\x1b'));
 const forced=await run(['--color','always','get'],{NO_COLOR:'1',TERM:'dumb'});assert.equal(forced.code,2);assert.ok(forced.stderr.includes('\x1b['));
 for(const args of [['--unknown','--color','always'],['--url','--color','always']]){const lexical=await run(args,{NO_COLOR:'1',TERM:'dumb'});assert.equal(lexical.code,2);assert.ok(lexical.stderr.includes('\x1b['));}
 const suppressed=await tty(['--unknown','--color','never'],{},80,'both');assert.equal(suppressed.code,2);assert.ok(!suppressed.stderr.includes('\x1b'));
});
test('JSON success help errors and watch ignore colour in pipes and terminals without payload changes',async()=>{
 const expected='{"ok":true,"command":"whoami","result":{"userId":"bot","userType":"agent","tokenId":"worker","activityProjectId":"corporate-activity"}}\n';
 for(const mode of ['auto','always','never']){
  const args=['whoami','--json','--color',mode,'--allow-http'];const pipe=await run(args);assert.equal(pipe.stdout,expected);assert.equal(pipe.stderr,'');const terminal=await tty(args,{},80,'both');assert.equal(terminal.stdout,expected);assert.equal(terminal.stderr,'');
  const help=ok(await run(['get','--help','--json','--color',mode]));assert.match(help.result.text,/Usage: haystack get/);assert.ok(!help.result.text.includes('\x1b'));
  const error=await tty(['get','--json','--color',mode],{},120,'both');fault(error,2,'usage');assert.ok(!error.stderr.includes('\x1b'));
 }
 const pass=path.join(home,'colour-watch-password');await writeFile(pass,'protected-password\n',{mode:0o600});ok(await run(['login','alice','--password-file',pass,'--json','--allow-http']));
 const watch=await run(['watch','--json','--color','always','--allow-http','--duration-ms','1000','--max-events','1']);assert.equal(ok(watch).event.kind,'changed');assert.ok(!watch.stdout.includes('\x1b'));
});
test('styled human data still escapes untrusted terminal controls and preserves complete content',async()=>{
 const key='p:colour';ok(await run(['put',key,'--file','-','--expected-revision','0','--json','--allow-http'],{},doc));
 const unstyled=human(await run(['get',key,'--allow-http']));const styled=human(await run(['get',key,'--color','always','--allow-http']));assert.ok(styled.includes('\x1b['));assert.equal(plain(styled),unstyled);assert.match(styled,/horse\\u\{1b\}\[31m/);assert.ok(!plain(styled).includes('\x1b'));for(const value of [key,'9007199254740993','0.10','1e2','-0'])assert.ok(styled.includes(value));
});
// Regression: static command requirements must precede URL, credentials, state and input reads.
test('required command options are checked before configuration or input access',async()=>{
 const before=hits.length;const unavailable={HAYSTACK_URL:'',HAYSTACK_STATE_DIR:'/missing/state',HAYSTACK_TOKEN_FILE:'/missing/token'};
 const cases=[
  [['token','issue','--name','fixture'],'--secret-file'],[['token','issue','--secret-file','/missing/secret'],'--name'],[['token','issue'],'--name'],
  [['login','alice'],'--password-file'],[['put','p:i','--file','/missing/document'],'--expected-revision'],[['put','p:i','--expected-revision','0'],'--file'],
  [['edit','p:i'],'--file'],[['call','get'],'--file'],[['restore','p:i'],'--revision'],[['unarchive','p:i'],'--status'],
  [['token','issue','--name','','--secret-file','/missing/secret'],'--name'],[['token','issue','--name','fixture','--secret-file',''],'--secret-file'],
  [['login','alice','--password-file',''],'--password-file'],[['put','p:i','--expected-revision','','--stdin'],'--expected-revision'],
  [['put','p:i','--expected-revision','0','--file',''],'--file'],[['edit','p:i','--file',''],'--file'],[['call','get','--file',''],'--file'],
  [['restore','p:i','--revision',''],'--revision'],[['unarchive','p:i','--status',''],'--status'],
 ];
 for(const [args,option] of cases){const result=await run([...args,'--json'],unavailable);fault(result,2,'usage');assert.ok(JSON.parse(result.stderr).error.message.includes(option),JSON.stringify({args,error:JSON.parse(result.stderr).error}));}
 const human=await run(['token','issue','--name','SENSITIVE-INPUT'],unavailable);assert.equal(human.code,2);assert.match(human.stderr,/--secret-file is required/);assert.match(human.stderr,/haystack token issue --help/);assert.ok(!human.stderr.includes('SENSITIVE-INPUT'));assert.equal(hits.length,before);
});
test('exclusive file and stdin command sources are checked before configuration or input access',async()=>{
 const before=hits.length;
 for(const args of [['put','p:i','--expected-revision','0'],['edit','p:i'],['call','get']]){
  const result=await run([...args,'--file','/missing/input','--stdin','--json'],{HAYSTACK_URL:'',HAYSTACK_STATE_DIR:'/missing/state'});fault(result,2,'usage');assert.equal(JSON.parse(result.stderr).error.message,'choose --file or --stdin, not both');
 }
 assert.equal(hits.length,before);
});
test('valid static requirements preserve file stdin alternatives and ordinary configuration checks',async()=>{
 const before=hits.length;const shapes=[['token','issue','--name','fixture','--secret-file','/missing/secret'],['login','alice','--password-file','/missing/password'],['restore','p:i','--revision','1'],['unarchive','p:i','--status','actual']];
 for(const command of [['put','p:i','--expected-revision','0'],['edit','p:i'],['call','get']])for(const source of [['--file','/missing/input'],['--file','-'],['--stdin']])shapes.push([...command,...source]);
 for(const args of shapes){const result=await run([...args,'--json'],{HAYSTACK_URL:'',HAYSTACK_STATE_DIR:'/missing/state'});fault(result,2,'usage');assert.equal(JSON.parse(result.stderr).error.message,'--url or HAYSTACK_URL is required',JSON.stringify(args));}
 assert.equal(hits.length,before);
});
