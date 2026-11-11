// Specified Behavioral-Active / Blackbox-Group; controlled current transport.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Sha256,hashBlob,HASH_READ_BYTES} from '../../web/dashboard/sha256.js';
import {FileUpload} from '../../web/dashboard/quick-upload.js';
import * as current from '../../web/dashboard/current-protocol.js';
const id='a'.repeat(32);
const digest=data=>createHash('sha256').update(data).digest('hex');
const file=()=>Object.assign(new Blob(['screenshot bytes']),{name:'shot.png'});
function transport(options) {
  const state={inits:0,finishes:0,chunks:[],commands:[]};
  const fetch=async(url,opts)=>{
    if(opts.method==='PUT') {
      const data=Buffer.from(await opts.body.arrayBuffer()), offset=Number(new URL(url,'http://test').searchParams.get('offset'));
      assert.equal(opts.credentials,'same-origin');assert.equal(opts.headers['X-Chunk-Sha256'],digest(data));
      state.chunks.push({offset,data});
      if(options.chunkFailure && state.chunks.length===2) throw new Error('offline');
      return new Response(JSON.stringify({path:'shot.png',offset:String(offset),length:data.length,receivedBytes:String(offset+data.length)}));
    }
    const envelope=JSON.parse(opts.body), command=envelope.command, name=Object.keys(command)[0];
    state.commands.push(name);let result;
    if(name==='GetCapabilities') result={CapabilityInfo:{capabilities:{contentMode:'Path',searchModes:['Lexical'],metadataOnlySearch:true,chunkBytes:4,maxListLimit:50,maxRequestBodyBytes:'1048576',maxFileBytes:String(options.limit),maxArtifactBytes:String(options.limit),maxFilesPerArtifact:1,maxTtlSeconds:100,cataloguePolicy:'current'}}};
    if(name==='InitUpload') {
      state.inits++;assert.deepEqual(command.InitUpload.tags,[]);assert.equal(command.InitUpload.hostname,null);assert.equal(command.InitUpload.projectPath,null);assert.equal(command.InitUpload.visibility,options.visibility);assert.equal(command.InitUpload.files[0].File.sha256,digest(Buffer.from('screenshot bytes')));
      if(options.initFailure) throw new Error('offline');
      if(options.initError && state.inits===1) return new Response(JSON.stringify({requestId:envelope.requestId,result:{Error:{failure:{code:options.initError,message:'controlled admission',retryAfterSeconds:5}}}}),{status:options.initError==='QuotaExceeded'?413:429});
      result={UploadInitialized:{artifactId:id,chunkBytes:4,contentUrl:'http://test/view/'+id,externalPassword:options.visibility==='External'?'transient-password':null}};
    }
    if(name==='FinishUpload') {
      state.finishes++;if(options.finishFailure && state.finishes===1) throw new Error('offline');
      result={UploadFinished:{artifactId:id,state:'Ready',contentUrl:'http://test/view/'+id}};
    }
    return new Response(JSON.stringify({requestId:envelope.requestId,result}));
  };
  return {state,fetch,request:descriptor=>current.request(fetch,descriptor)};
}
const run=(item,t,check)=>item.run(t.request,t.fetch,check,new AbortController().signal,()=>{});
const check=()=>{};

test('incremental SHA256 matches independent vectors across padding and block boundaries',async()=>{
  for(const size of [0,1,55,56,63,64,65,127,128,1000000]) {
    const data=Buffer.alloc(size,0x61), h=new Sha256();
    for(let i=0;i<size;i+=17) h.update(data.subarray(i,i+17));
    assert.equal(h.hex(),digest(data));
  }
  assert.equal(await hashBlob(new Blob(['abc']),check),digest('abc'));
});

test('blob hashing reads bounded slices and cancellation stops the next read',async()=>{
  const data=Buffer.alloc(HASH_READ_BYTES*2+3,0x42);let largest=0,reads=0;
  const blob={size:data.length,slice(start,end){largest=Math.max(largest,end-start);reads++;return new Blob([data.subarray(start,end)]);}};
  assert.equal(await hashBlob(blob,check),digest(data));assert.equal(reads,3);assert.equal(largest,HASH_READ_BYTES);
  let checks=0;reads=0;
  await assert.rejects(hashBlob(blob,()=>{if(++checks===2) throw new Error('cancelled');}),/cancelled/);assert.equal(reads,1);
});

test('typed upload uses server chunks and retries failed bytes without a duplicate artifact',async()=>{
  const t=transport({chunkFailure:true,limit:100,visibility:'External'}), item=new FileUpload(file(),'external');
  await assert.rejects(run(item,t,check),/offline/);assert.equal(item.offset,4);assert.equal(item.password,'transient-password');
  await run(item,t,check);assert.equal(item.phase,'ready');assert.equal(t.state.inits,1);assert.equal(t.state.finishes,1);
  assert.deepEqual(t.state.chunks.map(c=>c.offset),[0,4,4,8,12]);
  assert.equal(Buffer.concat(t.state.chunks.filter((_,i)=>i!==1).map(c=>c.data)).toString(),'screenshot bytes');
  item.clear();assert.equal(item.password,null);assert.equal(item.file,null);assert.equal(item.link,null);
});

test('uncertain finish retries the same ID and duplicate concurrent submit is ignored',async()=>{
  const t=transport({finishFailure:true,limit:100,visibility:'Internal'}), item=new FileUpload(file(),'internal');
  const first=run(item,t,check);await run(item,t,check);await assert.rejects(first,/offline/);
  assert.equal(item.phase,'finalizing');assert.equal(item.password,null);await run(item,t,check);await run(item,t,check);
  assert.equal(item.phase,'ready');assert.equal(t.state.inits,1);assert.equal(t.state.chunks.length,4);assert.equal(t.state.finishes,2);
});

test('uncertain initialization never silently creates another reservation',async()=>{
  const t=transport({initFailure:true,limit:100,visibility:'Internal'}), item=new FileUpload(file(),'internal');
  await assert.rejects(run(item,t,check),/offline/);await run(item,t,check);
  assert.equal(item.phase,'init-uncertain');assert.equal(t.state.inits,1);assert.equal(t.state.chunks.length,0);
});

test('capability admission and stale session check prevent writes',async()=>{
  const t=transport({limit:1,visibility:'Internal'}), item=new FileUpload(file(),'internal');
  await assert.rejects(run(item,t,check),/too-large/);assert.equal(t.state.inits,0);
  await assert.rejects(run(new FileUpload(file(),'internal'),t,()=>{throw new Error('cancelled');}),/cancelled/);
  assert.equal(t.state.commands.length,1);
});


test('definitive quota and session admission rejection can retry initialization',async()=>{
  for(const initError of ['QuotaExceeded','SessionLimit']) {
    const t=transport({initError,limit:100,visibility:'Internal'}), item=new FileUpload(file(),'internal');
    await assert.rejects(run(item,t,check));
    assert.equal(item.phase,'staged');assert.equal(item.id,null);
    await run(item,t,check);assert.equal(item.phase,'ready');assert.equal(t.state.inits,2);
  }
});

test('malformed chunk receipts never advance offset and retries use the same artifact',async()=>{
  for(const change of [r=>{r.path='wrong';},r=>{r.offset='1';},r=>{r.length=3;},r=>{r.receivedBytes='0';},r=>{r.extra=true;}]) {
    const t=transport({limit:100,visibility:'Internal'}), item=new FileUpload(file(),'internal');
    const fetch=t.fetch;
    t.fetch=async(url,options)=>{
      const response=await fetch(url,options);
      if(options.method!=='PUT')return response;
      const receipt=await response.json();change(receipt);return new Response(JSON.stringify(receipt));
    };
    await assert.rejects(run(item,t,check),/bad-response/);assert.equal(item.offset,0);
    t.fetch=fetch;await run(item,t,check);assert.equal(item.phase,'ready');assert.equal(t.state.inits,1);
  }
});
