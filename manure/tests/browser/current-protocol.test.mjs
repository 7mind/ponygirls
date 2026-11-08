// Behavioral-Active / Blackbox-Group, specified generated browser boundary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as boundary from '../../web/dashboard/current-protocol.js';
import * as p from '../../web/dashboard/current/manure/api/index.js';
import {BaboonCodecContext} from '../../web/dashboard/current/BaboonSharedRuntime.js';
const ctx=BaboonCodecContext.Default;
const id='01234567-89ab-4def-8123-456789abcdef';
const artifactId='a'.repeat(32);

test('all 76 Baboon codec vectors pass strict browser schema validation',()=>{
  let count=0;
  for(const [name,type] of [['commands','ClientEnvelope'],['results','ServerEnvelope'],['content','ContentEnvelope'],['chunks','ChunkReceipt']]){
    const raw=readFileSync(new URL(`../../models/fixtures/${name}.json`,import.meta.url),'utf8');
    const vectors=boundary.parseStrict(raw);vectors.forEach(v=>boundary.validate(type,v));count+=vectors.length;
  }
  assert.equal(count,76);
});

test('strict parser rejects duplicate escaped keys, nested duplicates and malformed JSON',()=>{
  for(const raw of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"a":1,"a":2}}','[1,]','{"a":1,}','NaN','{}x','{"x":"\\x"}']){
    assert.throws(()=>boundary.parseStrict(raw),/bad-response/);
  }
  const raw='{"__proto__":{"safe":true},"unicode":"é𐐀","a":[null,true,-1,1e2]}';
  assert.equal(boundary.parseStrict(raw).__proto__.safe,true);
  assert.equal(boundary.parseStrict(raw).a[3],100);
});

test('strict browser schema rejects i64 numbers, wrong enums, keys and surrogate strings',()=>{
  const receipt={path:'f',offset:'9007199254740993',length:1,receivedBytes:'9223372036854775807'};
  boundary.validate('ChunkReceipt',receipt);
  for(const offset of [1,true,'01','-0','1.0','9223372036854775808'])assert.throws(()=>boundary.validate('ChunkReceipt',{...receipt,offset}));
  for(const bad of [{...receipt,length:true},{...receipt,extra:1},{...receipt,path:'\ud800'}])assert.throws(()=>boundary.validate('ChunkReceipt',bad));
  assert.throws(()=>boundary.validate('ClientEnvelope',{requestId:id,apiVersion:'1.0.0',command:{Whoami:{},Logout:{}}}));
  assert.throws(()=>boundary.validate('ArtifactKind','dir'));
});

test('dashboard builders use current generated commands with exact catalogue and tri-state patch',()=>{
  const state={q:' A\u0000Straße ',includeExpired:false,visibility:'external',itemState:'ready',sort:'created_by_user',direction:'desc'};
  const descriptor=boundary.catalogue('position',state,25);
  const command=descriptor[0];
  assert.ok(command instanceof p.Command_ListArtifacts);
  assert.equal(command.query.query,state.q);assert.equal(command.query.sort,p.CatalogueSort.CreatedByUser);
  assert.equal(command.query.direction,p.SortDirection.Desc);assert.equal(command.query.cursor,'position');
  assert.ok(boundary.access(artifactId,'external')[0].patch.expiry instanceof p.ExpiryChange_Keep);
  for(const descriptor of [boundary.whoami(),boundary.login('secret'),boundary.logout(),boundary.artifact(artifactId),boundary.manifest(artifactId),boundary.grant(artifactId),boundary.remove(artifactId),boundary.access(artifactId,'public'),boundary.rotate(artifactId)]){
    boundary.validate('ClientEnvelope',p.ClientEnvelope_JsonCodec.instance.encode(ctx,new p.ClientEnvelope(id,'1.0.0',descriptor[0])));
  }
});

test('request correlates generated result and never accepts wrong or legacy responses',async()=>{
  let sent;
  const fetch=async(url,opts)=>{
    sent={url,opts};const req=p.ClientEnvelope_JsonCodec.instance.decode(ctx,JSON.parse(opts.body));
    return {ok:true,status:200,text:async()=>JSON.stringify(p.ServerEnvelope_JsonCodec.instance.encode(ctx,new p.ServerEnvelope(req.requestId,new p.Result_Identity(new p.Principal('u','t',p.PrincipalType.Human)))))};
  };
  const result=await boundary.request(fetch,boundary.whoami());
  assert.equal(sent.url,'/api/current');assert.equal(sent.opts.method,'POST');assert.equal(sent.opts.credentials,'same-origin');
  assert.equal(result.user_id,'u');assert.equal(result.principal_type,'human');
  for(const raw of ['{"user_id":"legacy"}',JSON.stringify({requestId:id,result:{Ok:{}}})]){
    await assert.rejects(boundary.request(async()=>({ok:true,status:200,text:async()=>raw}),boundary.whoami()),/bad-response/);
  }
});

test('errors expose enumerated code only, not untrusted secret-bearing messages',async()=>{
  const fetch=async(_url,opts)=>{
    const req=JSON.parse(opts.body);
    return {ok:false,status:401,text:async()=>JSON.stringify({requestId:req.requestId,result:{Error:{failure:{code:'Unauthorized',message:'CANARY-secret',retryAfterSeconds:null}}}})};
  };
  await assert.rejects(boundary.request(fetch,boundary.whoami()),error=>error.message==='unauthorized'&&error.status===401&&!String(error).includes('CANARY'));
});

test('opted-in insecure HTTP context does not require secure-only crypto.randomUUID',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const getRandomValues=crypto.getRandomValues.bind(crypto);
  try {
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}});
    assert.equal(typeof crypto.randomUUID,'undefined');
    const first=boundary.requestId(),second=boundary.requestId();
    assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first,second);
  } finally { Object.defineProperty(globalThis,'crypto',original); }
});


test('search goldens carry actual published space distinct from profile and lexical HEAD nulls',()=>{
  const vectors=JSON.parse(readFileSync(new URL('../../models/fixtures/results.json',import.meta.url),'utf8'));
  const pages=vectors.filter(v=>v.result.SearchResults).map(v=>p.ServerEnvelope_JsonCodec.instance.decode(ctx,v).result.page);
  assert.equal(pages.length,2);
  const [published,head]=pages;
  assert.equal(published.hits[0].embeddingProfile,'b'.repeat(64));
  assert.equal(published.hits[0].embeddingSpace,'c'.repeat(64));
  assert.equal(head.hits[0].embeddingProfile,undefined);assert.equal(head.hits[0].embeddingSpace,undefined);
  assert.equal(vectors.filter(v=>v.result.SearchResults)[1].result.SearchResults.page.hits[0].embeddingSpace,null);
  assert.equal(published.countScope,p.SearchCountScope.CandidateWindow);
  assert.equal(head.countScope,p.SearchCountScope.ExactMatches);
  const missing=structuredClone(vectors.find(v=>v.result.SearchResults));
  delete missing.result.SearchResults.page.hits[0].embeddingSpace;
  assert.throws(()=>boundary.validate('ServerEnvelope',missing),/bad-response/);
});

// Specified contract: retrieval is a separate typed Search command, never a
// catalogue query with a different label or a hand-decoded response.
test('dashboard retrieval descriptor and projected enums use generated current Search codecs',()=>{
  const descriptor=boundary.search({q:'hayneedle',mode:'hybrid',visibility:'external',kind:'dir',createdByUser:'owner'},25);
  assert.ok(descriptor[0] instanceof p.Command_Search);
  assert.equal(descriptor[0].query.mode,p.SearchMode.Hybrid);
  assert.equal(descriptor[0].query.filter.kind,p.ArtifactKind.Directory);
  assert.equal(descriptor[0].query.filter.visibility,p.Visibility.External);
  assert.equal(descriptor[0].query.filter.createdByUser,'owner');
  assert.equal(descriptor[0].query.cursor,null);
  assert.equal(descriptor[0].query.limit,25);
  boundary.validate('ClientEnvelope',p.ClientEnvelope_JsonCodec.instance.encode(ctx,new p.ClientEnvelope(id,'1.0.0',descriptor[0])));
  assert.ok(boundary.capabilities()[0] instanceof p.Command_GetCapabilities);
  const vectors=JSON.parse(readFileSync(new URL('../../models/fixtures/results.json',import.meta.url),'utf8'));
  for(const mode of ['Path','Subdomain']) {
    const reply=structuredClone(vectors.find(v=>v.result.CapabilityInfo));
    reply.result.CapabilityInfo.capabilities.contentMode=mode;
    const capabilities=boundary.capabilities()[2](p.ServerEnvelope_JsonCodec.instance.decode(ctx,reply).result);
    assert.equal(capabilities.content_mode,mode.toLowerCase());
  }
  const pages=vectors.filter(v=>v.result.SearchResults).map(v=>descriptor[2](p.ServerEnvelope_JsonCodec.instance.decode(ctx,v).result));
  assert.equal(pages[0].count_scope,'candidatewindow');
  assert.equal(pages[1].count_scope,'exactmatches');
  assert.equal(pages[0].hits[0].evidence[0].field,'name');
  assert.equal(pages[0].hits[0].artifact.kind,'dir');
});
