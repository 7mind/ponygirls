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
const cli=fileURLToPath(new URL('../dist/cli/src/main.js',import.meta.url));
const token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const secret=Buffer.alloc(32,1).toString('base64url');
const actor=createHash('sha256').update('account-actor-v1:alice').digest('hex');
const id='0193e8d5-6f5c-7a1b-8c2d-000000000001';
const doc='{"title":"horse\\u001b[31m","description":"d","fields":{"n":9007199254740993,"d":0.10,"e":1e2,"z":-0,"__proto__":true},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}';
const metadata={createdAt:'2026-11-16T00:00:00Z',createdBy:'bot',modifiedAt:'2026-11-16T00:00:00Z',modifiedBy:'bot'};
let home,base,server,wss,hits=[],items=new Map(),replays=new Map(),lose=false,badResponse=false,mode='normal';
function run(args,env={},input='') {return new Promise((resolve,reject)=>{const child=spawn(process.env.HAYSTACK_CLI_EXECUTABLE||process.execPath,[...(process.env.HAYSTACK_CLI_EXECUTABLE?[]:[cli]),...args],{env:{PATH:process.env.PATH,HOME:home,HAYSTACK_STATE_DIR:path.join(home,'state'),HAYSTACK_URL:base,HAYSTACK_TOKEN:token,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));child.stdin.end(input);});}
function ok(result){assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}
function fault(result,exit,code){assert.equal(result.code,exit,result.stderr);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).error.code,code);}
before(async()=>{
 home=await mkdtemp(path.join(os.tmpdir(),'haystack-cli-'));
 server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();const body=raw?JSON.parse(raw):undefined;hits.push({url:req.url,headers:req.headers,body});
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
 if(req.method==='GET')return send({user:{id:'alice',login:'alice',displayName:'Alice',actor},tokens:[],scopes:['api']});
 if(req.headers['x-account-actor']!==actor){send({error:{code:'conflict',message:'CANARY'}},409);return;}
 if(req.url==='/api/account/v1/tokens'){if(lose){lose=false;req.socket.destroy();return;}if(mode==='post-account-auth'){mode='normal';return send({error:{code:'forbidden',message:'CANARY'}},403);}return send({token:{id:'issued:one',name:body.name,source:'issued',createdAt:'2026-11-16T00:00:00Z',revoked:false,scopes:['api']},secret:token});}
 if(mode==='false-ack'&&req.url.endsWith('/revoke'))return send({ok:false});
 if(req.url.endsWith('/logout'))res.setHeader('set-cookie','haystack-dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send({ok:true});}
 if(req.url==='/api/v1/whoami')return send({userId:'bot',userType:'agent',tokenId:'worker',activityProjectId:'corporate-activity'});
 if(req.url==='/api/v1/put'){
 const prev=replays.get(body.requestId);if(prev){if(prev.body!==JSON.stringify(body))return fail('replay-conflict',409);return send({...prev.result,replayed:true});}
 const current=items.get(body.key);if((current?.revision??0)!==body.expectedRevision)return fail('conflict',409);
 const result={key:body.key,revision:body.expectedRevision+1,metadata,replayed:false};items.set(body.key,{key:body.key,revision:result.revision,document:body.document,metadata});replays.set(body.requestId,{body:JSON.stringify(body),result});if(lose){lose=false;req.socket.destroy();return;}if(mode==='post-put-auth'){mode='normal';return fail('unauthorized',401);}if(badResponse){badResponse=false;return send({key:body.key});}return send(result);}
 if(req.url==='/api/v1/get'){const item=items.get(body.key);return item?send(item):fail('not-found',404);}
 if(req.url==='/api/v1/history')return send({revisions:[{revision:1,modifiedAt:metadata.modifiedAt,modifiedBy:'bot',tokenId:'worker'}]});
 if(req.url==='/api/v1/search')return send({items:[...items.values()].map(v=>({key:v.key,project:'p',item:'i',revision:v.revision,title:'horse\u001b[31m',docType:'fact',status:'actual',importance:'low',humanAttention:'cleared',tags:[],modifiedAt:metadata.modifiedAt,modifiedBy:'bot'})),cursor:body.cursor?null:'opaque-cursor'});
 if(req.url==='/api/v1/retrieve')return send('{"sources":[],"mode":"Lexical","countScope":"ExactMatches","total":9223372036854775807,"rankingLimit":null}');
 if(req.url==='/api/v1/query/analyze')return send({valid:true,spans:[]});
 if(req.url==='/api/v1/complete')return send({suggestions:['type:fact']});
 if(req.url==='/api/v1/values')return send({values:['fact']});
 return fail('unavailable',503);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 wss=new WebSocketServer({server,path:'/api/v1/live',verifyClient:(info,done)=>{if(mode==='hang-upgrade')return;done(info.req.headers.origin===base&&info.req.headers.cookie===`haystack-dev=${secret}`&&!info.req.headers.authorization);}});wss.on('connection',ws=>{ws.on('message',bytes=>{const frame=JSON.parse(bytes);if(frame.kind==='ping')ws.send(JSON.stringify({...frame,kind:'pong',serverTs:Date.now()}));});setTimeout(()=>ws.send(JSON.stringify({kind:'changed',key:'p:i',revision:99,nonce:null,clientTs:null,serverTs:null})),20);});
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
