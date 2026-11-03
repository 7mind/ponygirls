import {it} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,api,encode,decode,document,sleep} from './fixture.mjs';

it('production Main handles SIGTERM with clean resource drain and exit0',{timeout:20000},async()=>{
 const f=await fixture();try{const [code,signal]=await f.stop();assert.equal(signal,null);assert.equal(code,0);}finally{await f.stop();}
});

it('controlled provider uses approved corpus only, durable worker publication and explicit outage without write coupling',async()=>{
 let release;let blocked=true;let outage=false;const gate=new Promise(resolve=>{release=resolve;});const calls=[];
 const provider=http.createServer(async(request,response)=>{const body=[];for await(const chunk of request)body.push(chunk);const input=JSON.parse(Buffer.concat(body).toString());calls.push(input);
  if(outage){response.writeHead(503);response.end('{}');return;}
  if(blocked)await gate;
  const data=input.input.map((text,index)=>({index,embedding:text.includes('harbour')?[1,0]:[0,1]}));response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data}));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));let f;
 try{
  f=await fixture({},async(config,{dir})=>{
   const credential=path.join(dir,'model-key');await writeFile(credential,'',{mode:0o600});
   Object.assign(config.retrieval,{approvedFieldPrefixes:['/public'],maxChunkBytes:4096,embedding:{operationUrl:`http://127.0.0.1:${provider.address().port}/embeddings`,model:'controlled-fixture',revision:'immutable-fixture-v1',dimensions:2,sendDimensions:true,documentPrefix:'DOC:',queryPrefix:'QUERY:',normalization:'cosine',credentialFile:credential,deadlineMs:5000,maxResponseBytes:65536,maxBatch:4,maxInputBytes:8192,maxRequestBytes:65536}});
  });
  const canary='DO-NOT-EMBED-SENSITIVE-FIELD';
  const started=Date.now();const put=await f.put('model:one',document({title:'harbour approved metadata',fields:{public:'harbour approved string',private:canary,n:9001}}));assert.equal(put.status,200);assert.ok(Date.now()-started<1000,'write must not await blocked model');
  const until=Date.now()+5000;while(!calls.length&&Date.now()<until)await sleep(10);assert.ok(calls.length,'durable job reaches actual provider');
  assert.equal((await f.call('/api/v1/get',encode(api.GetRequest,new api.GetRequest('model:one',undefined)),{token:f.tokens.bot})).status,200);
  const browse=await f.call('/api/v1/search',encode(api.SearchRequest,new api.SearchRequest('','model',20,undefined,new api.SearchSort('key','asc'))),{token:f.tokens.bot});assert.equal(browse.status,200);
  const serialized=JSON.stringify(calls);assert.ok(serialized.includes('harbour'));assert.ok(!serialized.includes(canary));assert.ok(!serialized.includes('9001'));
  blocked=false;release();
  const semantic=()=>f.call('/api/v1/retrieve',encode(api.RetrieveRequest,new api.RetrieveRequest('harbour',api.RetrievalMode.Semantic,'model',false,0,10)),{token:f.tokens.alice});
  let page;const deadline=Date.now()+5000;while(Date.now()<deadline){const response=await semantic();assert.equal(response.status,200);page=decode(api.RetrieveResult,await response.json());if(page.sources.length)break;await sleep(50);}
  assert.equal(page.sources.length,1);assert.equal(page.sources[0].key,'model:one');assert.equal(page.sources[0].revision,1);assert.equal(page.countScope,'CandidateWindow');assert.ok(page.rankingLimit>0);assert.ok(calls.some(c=>c.input.some(text=>text.startsWith('QUERY:'))));
  outage=true;const unavailable=await semantic();assert.equal(unavailable.status,503);assert.equal(decode(api.Failure,await unavailable.json()).code,'unavailable');
  const update=await f.put('model:one',document({title:'harbour updated',fields:{public:'harbour next',private:canary}}),1);assert.equal(update.status,200);
  const lexical=await f.call('/api/v1/retrieve',encode(api.RetrieveRequest,new api.RetrieveRequest('harbour',api.RetrievalMode.Lexical,'model',false,0,10)),{token:f.tokens.alice});assert.equal(lexical.status,200);assert.equal(decode(api.RetrieveResult,await lexical.json()).sources[0].revision,2);
 }finally{blocked=false;release();await f?.stop();await new Promise(resolve=>provider.close(resolve));}
});
