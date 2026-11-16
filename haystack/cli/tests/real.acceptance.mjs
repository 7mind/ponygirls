// Behavioral/Blackbox/Good-Communication: actual CLI + source-bound native/JVM server + owned PG.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {fixture,document,rid,sleep} from '../../server/tests-current/fixture.mjs';
const cli=fileURLToPath(new URL('../dist/cli/src/main.js',import.meta.url));
let f,home;
const exactDoc='{"title":"distinctive zebra","description":"quartz protocol recovery","fields":{"n":9007199254740993,"d":0.10,"e":1e2,"z":-0,"visible":"quartz retrieval fixture"},"type":"fact","status":"actual","importance":"low","human-attention":"cleared"}';
function start(args,env={},input=''){return startProcess(args,env,input,true);}
function startProcess(args,env,input,machine){
 const child=spawn(process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,[...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),...args,...(machine?['--json']:[]),'--allow-http'],{env:{PATH:process.env.PATH,HOME:home,HAYSTACK_STATE_DIR:path.join(home,'state'),HAYSTACK_URL:f.base,HAYSTACK_TOKEN:f.tokens.bot,...env},stdio:['pipe','pipe','pipe']});
 const done=new Promise((resolve,reject)=>{let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});child.stdin.end(input);return{child,done};
}
const run=(args,env,input)=>start(args,env,input).done;
const runHuman=(args,input)=>startProcess(args,{},input,false).done;
function human(r){assert.equal(r.code,0,r.stderr);assert.equal(r.stderr,'');return r.stdout;}
function ok(r){assert.equal(r.code,0,r.stderr);assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function fault(r,exit,code){assert.equal(r.code,exit,r.stderr);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).error.code,code);}
before(async()=>{assert.equal(process.env.HAYSTACK_OWNED_TEST_DB,'1');home=await mkdtemp(path.join(os.tmpdir(),'haystack-cli-real-'));f=await fixture();});
after(async()=>{await f?.stop();if(f?.dir)await rm(f.dir,{recursive:true,force:true});if(home)await rm(home,{recursive:true,force:true});});
test('real current health/versions/identity and removed/future protocol rejection',async()=>{
 assert.equal(ok(await run(['health'])).result.ok,true);assert.equal(ok(await run(['versions'])).result.current,'1.0.0');assert.equal(ok(await run(['whoami'])).result.userId,'bot');
 for(const version of ['0.9.0','9.0.0']){const r=await f.call('/api/v1/whoami',undefined,{method:'GET',token:f.tokens.bot,headers:{'X-Haystack-Version':version}});assert.equal(r.status,400);assert.equal((await r.json()).code,'version-mismatch');}
});
test('real omitted-links document/lexemes, explicit same-ID replay and typed CAS rejection',async()=>{
 const request=rid();const first=ok(await run(['put','cli:one','--file','-','--expected-revision','0','--request-id',request],{},exactDoc));assert.equal(first.result.revision,1);assert.equal(first.requestId,request);
 const replay=ok(await run(['put','cli:one','--file','-','--expected-revision','0','--request-id',request],{},exactDoc));assert.equal(replay.result.replayed,true);
 const item=ok(await run(['get','cli:one']));for(const token of ['9007199254740993','0.10','1e2','-0'])assert.ok(item.result.document.json.includes(token));assert.ok(!item.result.document.json.includes('"links"'));
 fault(await run(['put','cli:one','--file','-','--expected-revision','0'],{},exactDoc),5,'conflict');
 const raw=`{"key":"cli:one","document":{"json":${JSON.stringify(exactDoc)}},"expectedRevision":1.0000000000000001,"requestId":"${rid()}"}`;
 fault(await run(['call','put','--file','-'],{},raw),2,'usage');assert.equal(ok(await run(['get','cli:one'])).result.revision,1);
});
test('real helpers preserve history and archive/attention/restore CAS contracts',async()=>{
 assert.equal(ok(await run(['attention','cli:one','required'])).result.revision,2);assert.equal(ok(await run(['archive','cli:one'])).result.revision,3);
 assert.equal(ok(await run(['search','--project','cli'])).result.items.length,0);
 assert.equal(ok(await run(['unarchive','cli:one','--status','actual'])).result.revision,4);assert.equal(ok(await run(['restore','cli:one','--revision','1'])).result.revision,5);
 const old=ok(await run(['get','cli:one','--revision','1']));assert.ok(!old.result.document.json.includes('"links"'));assert.equal(ok(await run(['history','cli:one'])).result.revisions.length,5);
});
test('real exact browse cursors/sort, analysis/completion/values and retrieval provenance',async()=>{
 for(const key of ['cli:two','cli:three'])ok(await run(['put',key,'--file','-','--expected-revision','0'],{},document({title:key})));
 const first=ok(await run(['search','--project','cli','--sort','key','--direction','asc','--limit','1']));assert.equal(first.result.items[0].key,'cli:one');assert.ok(first.result.cursor);
 const second=ok(await run(['search','--project','cli','--sort','key','--direction','asc','--limit','1','--cursor',first.result.cursor]));assert.equal(second.result.items[0].key,'cli:three');
 assert.equal(ok(await run(['search','--project','cli','--sort','key','--direction','asc','--limit','1','--all'])).result.items.length,3);
 fault(await run(['search','--project','cli','--sort','key','--direction','asc','--limit','2','--cursor',first.result.cursor]),2,'invalid-cursor');
 assert.equal(ok(await run(['analyze','type:fact'])).result.valid,true);assert.ok(Array.isArray(ok(await run(['complete','type:'])).result.suggestions));assert.ok(ok(await run(['values','type'])).result.values.includes('fact'));
 const result=ok(await run(['retrieve','quartz','--project','cli'])).result;assert.equal(result.countScope,'ExactMatches');assert.equal(typeof result.total,'string');assert.ok(result.sources.length>0);assert.equal(result.sources[0].key,'cli:one');assert.equal(result.sources[0].revision,5);assert.ok(result.sources[0].policy);
 for(const mode of ['semantic','hybrid'])fault(await run(['retrieve','quartz','--mode',mode]),6,'unavailable');
});
test('real password session/account/one-time token/revoke survive server restart',async()=>{
 const pass=path.join(home,'password');await writeFile(pass,f.passwords.alice+'\n',{mode:0o600});assert.equal(ok(await run(['login','alice','--password-file',pass])).result.user.id,'alice');assert.equal(ok(await run(['account'])).result.user.id,'alice');
 const file=path.join(home,'new-token');const issued=ok(await run(['token','issue','--name','owned-cli','--secret-file',file]));assert.equal(issued.result.secretSaved,true);assert.equal((await stat(file)).mode&0o777,0o600);const token=(await readFile(file,'utf8')).trim();assert.ok(!JSON.stringify(issued).includes(token));
 await f.restart();assert.equal(ok(await run(['status'])).result.user.id,'alice');assert.equal(ok(await run(['whoami'],{HAYSTACK_TOKEN:token})).result.userId,'alice');
 ok(await run(['token','revoke',issued.result.token.id]));fault(await run(['whoami'],{HAYSTACK_TOKEN:token}),3,'unauthorized');
});
test('real human views decode documents and label receipts, provenance and account operations',async()=>{
 const request=rid();const saved=human(await runHuman(['put','cli:human','--file','-','--expected-revision','0','--request-id',request],exactDoc));assert.match(saved,/^Saved: cli:human\nRevision: 1/);assert.ok(saved.includes('Request ID: '+request));
 assert.match(human(await runHuman(['whoami'],'')),/^User: bot\nType: agent\nToken: default/);
 const item=human(await runHuman(['get','cli:human'],''));assert.match(item,/Title: distinctive zebra/);assert.match(item,/Description:\n  quartz protocol recovery/);assert.match(item,/Fields \(JSON\):/);for(const n of ['9007199254740993','0.10','1e2','-0'])assert.ok(item.includes(n));assert.match(item,/Modified: .* by bot/);assert.ok(!item.includes('"json"'));
 assert.match(human(await runHuman(['history','cli:human'],'')),/Revision 1.*bot.*default/);assert.match(human(await runHuman(['search','--project','cli'],'')),/Modified: .* by bot/);assert.match(human(await runHuman(['values','type'],'')),/  - fact/);assert.match(human(await runHuman(['pending'],'')),/No pending writes\./);
 const retrieved=human(await runHuman(['retrieve','quartz','--project','cli'],''));for(const label of ['ExactMatches:','Generation:','Policy:','Pointer:','UTF16 span:'])assert.ok(retrieved.includes(label));
 const pass=path.join(home,'password');assert.match(human(await runHuman(['login','alice','--password-file',pass],'')),/Signed in: Alice/);assert.match(human(await runHuman(['account'],'')),/Account: alice/);assert.match(human(await runHuman(['status'],'')),/Session: authenticated/);assert.match(human(await runHuman(['token','list'],'')),/browser.*configured.*active/);
 const file=path.join(home,'human-token');const issued=human(await runHuman(['token','issue','--name','human-display','--secret-file',file],''));assert.match(issued,/Token issued:/);assert.match(issued,/Secret: saved/);assert.ok(!issued.includes((await readFile(file,'utf8')).trim()));const id=ok(await run(['token','list'])).result.tokens.find(token=>token.name==='human-display').id;assert.ok(human(await runHuman(['token','revoke',id],'')).includes('Token revoked: '+id));
});
test('real qualified IDs agree with exact UTF16 component limits',async()=>{
 const valid='cli-unicode:'+encodeURIComponent('😀'.repeat(128));ok(await run(['put',valid,'--file','-','--expected-revision','0'],{},exactDoc));assert.equal(ok(await run(['get',valid])).result.key,valid);
 const invalid='cli-unicode:'+encodeURIComponent('😀'.repeat(129));fault(await run(['get',invalid]),2,'invalid-id');const rejected=await f.put(invalid);assert.equal(rejected.status,400);assert.equal((await rejected.json()).code,'invalid-id');
});
test('real live watch preserves a complete legal key exceeding one KiB',async()=>{
 const key='A'.repeat(256)+':'+ '%25'.repeat(256);const watching=start(['watch','--duration-ms','10000','--max-events','1']);let settled=false;watching.done.finally(()=>settled=true);
 for(let i=0;i<30&&!settled;i++){await sleep(100);assert.equal((await f.put(key,document(),i)).status,200);}
 const result=ok(await watching.done);assert.equal(result.event.key,key);assert.equal(result.event.kind,'changed');
});
test('real idle watch crosses two full 30-second transport heartbeat periods',async()=>{
 const result=await run(['watch','--duration-ms','65000','--max-events','100']);assert.equal(result.code,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
test('real live watch requires session, emits only NDJSON changed frames, then cancels',async()=>{
 fault(await run(['watch','--auth','token','--duration-ms','100']),2,'usage');
 const watching=start(['watch','--duration-ms','10000','--max-events','1']);let settled=false;watching.done.finally(()=>settled=true);
 for(let i=0;i<30&&!settled;i++){await sleep(100);const response=await f.put('cli-watch:item'+i);assert.equal(response.status,200);}
 const result=await watching.done;assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');const lines=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(lines.length,1);assert.equal(lines[0].event.kind,'changed');assert.match(lines[0].event.key,/^cli-watch:/);
 const cancelled=start(['watch','--duration-ms','10000']);await sleep(300);cancelled.child.kill('SIGINT');assert.equal((await cancelled.done).code,0);
 ok(await run(['logout']));fault(await run(['account']),3,'unauthorized');
});
test('real committed write with deliberately discarded ACK replays original durable outcome',async()=>{
 let discard=true;const seen=[];const proxy=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(req.url==='/api/v1/put')seen.push(bytes.toString());
  const response=await fetch(f.base+req.url,{method:req.method,headers:{'Content-Type':'application/json','X-Haystack-Version':'1.0.0',Authorization:req.headers.authorization},...(req.method==='POST'?{body:bytes}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});const body=await response.arrayBuffer();
  if(discard&&req.url==='/api/v1/put'){discard=false;req.socket.destroy();return;}res.writeHead(response.status,{'Content-Type':'application/json'});res.end(Buffer.from(body));
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{const origin=`http://127.0.0.1:${proxy.address().port}`;fault(await run(['put','cli:lost','--file','-','--expected-revision','0'],{HAYSTACK_URL:origin},exactDoc),7,'uncertain-write');
  assert.ok(ok(await run(['pending'],{HAYSTACK_URL:origin})).result.operation.requestId);const replay=ok(await run(['replay'],{HAYSTACK_URL:origin}));assert.equal(replay.result.replayed,true);assert.equal(seen.length,2);assert.equal(seen[0],seen[1]);assert.equal(ok(await run(['history','cli:lost'])).result.revisions.length,1);
 }finally{await new Promise(resolve=>proxy.close(resolve));}
});
test('real committed update with a schema-valid wrong ACK retains exact intent until bound replay',async()=>{
 const key='cli:wrong-ack';assert.equal((await f.put(key)).status,200);assert.equal((await f.put(key,document(),1)).status,200);
 const request=rid();const seen=[];let corrupt=true;
 const proxy=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(req.url==='/api/v1/put')seen.push(bytes.toString());
  const response=await fetch(f.base+req.url,{method:req.method,headers:{'Content-Type':'application/json','X-Haystack-Version':'1.0.0',Authorization:req.headers.authorization},...(req.method==='POST'?{body:bytes}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});const body=await response.json();
  if(corrupt&&req.url==='/api/v1/put'&&response.ok){assert.equal(body.revision,3);body.revision=99;corrupt=false;}
  res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{
  const origin=`http://127.0.0.1:${proxy.address().port}`;fault(await run(['put',key,'--file','-','--expected-revision','2','--request-id',request],{HAYSTACK_URL:origin},exactDoc),7,'uncertain-write');
  assert.equal(ok(await run(['get',key])).result.revision,3);assert.equal(ok(await run(['history',key])).result.revisions.length,3);
  const directory=path.join(home,'state');const pendingFiles=async()=>(await readdir(directory)).filter(file=>file.includes('.pending-'));const files=await pendingFiles();assert.equal(files.length,1);
  const retained=JSON.parse(await readFile(path.join(directory,files[0]),'utf8'));assert.equal(retained.origin,origin);assert.deepEqual(retained.operation,{key,document:{json:exactDoc},expectedRevision:2,requestId:request});assert.deepEqual(retained.operation,JSON.parse(seen[0]));
  const replay=ok(await run(['replay'],{HAYSTACK_URL:origin}));assert.equal(replay.requestId,request);assert.equal(replay.result.revision,3);assert.equal(replay.result.replayed,true);assert.equal(seen.length,2);assert.equal(seen[0],seen[1]);assert.deepEqual(await pendingFiles(),[]);assert.equal(ok(await run(['history',key])).result.revisions.length,3);
 }finally{await new Promise(resolve=>proxy.close(resolve));}
});
