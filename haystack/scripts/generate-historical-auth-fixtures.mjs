#!/usr/bin/env node
// Synthetic characterization only: execute the actual baseline loader in a
// disposable module directory, not a replica regex or a deployed Node server.
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ItemService} from '../characterization/node/dist/application/service.js';
import {InMemoryItemRepository} from '../characterization/node/dist/storage/memory.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const names=['auth-config','auth-tokens'];
const sources=await Promise.all(names.map(name=>readFile(path.join(root,'characterization/node/evidence/'+name+'.ts.txt'),'utf8')));
const hash=text=>createHash('sha256').update(text).digest('hex');
const work=await mkdtemp(path.join(tmpdir(),'haystack-old-auth-fixture-'));
try{
 await writeFile(path.join(work,'package.json'),'{"type":"module"}');
 for(let i=0;i<names.length;i++)await writeFile(path.join(work,i===0?'config.js':'tokens.js'),stripTypeScriptTypes(sources[i],{mode:'strip'}));
 const {loadAuth}=await import(pathToFileURL(path.join(work,'config.js')).href);
 const token=Buffer.alloc(32,1).toString('base64url');const hashFile=path.join(work,'token.sha');await writeFile(hashFile,hash(token));
 const doc='{"title":"synthetic historical identity","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}';
 const inputs=[...[0x1c,0x1d,0x1e,0x1f,0x85,0x200b].map(cp=>({name:'non-whitespace-'+cp.toString(16),userId:'prior'+String.fromCodePoint(cp)+'writer',tokenId:'prior'+String.fromCodePoint(cp)+'browser',accepted:true})),
  {name:'astral-user-limit',userId:'😀'.repeat(64),tokenId:'browser',accepted:true},
  {name:'astral-token-limit',userId:'writer',tokenId:'😀'.repeat(32),accepted:true},
  {name:'astral-user-over-limit',userId:'😀'.repeat(65),tokenId:'browser',accepted:false},
  {name:'astral-token-over-limit',userId:'writer',tokenId:'😀'.repeat(33),accepted:false},
  ...[0x09,0x0b,0x0c,0x20,0xa0,0x1680,0x2000,0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff].map(cp=>({name:'whitespace-'+cp.toString(16),userId:'prior'+String.fromCodePoint(cp)+'writer',tokenId:'browser',accepted:false}))];
 const fixtures=[];
 for(let i=0;i<inputs.length;i++){
  const input=inputs[i];let principal;let accepted=true;
  try{principal=(await loadAuth({activityProjectId:'agent-activity',users:[{id:input.userId,type:'human',displayName:'Synthetic old identity',tokens:[{id:input.tokenId,hashFile}]}],cookieSecure:false,allowedHosts:['127.0.0.1'],allowedOrigins:[]})).authenticate(token);}catch{accepted=false;}
  assert.equal(accepted,input.accepted,input.name);
  const entry={...input,userUtf16:input.userId.length,tokenUtf16:input.tokenId.length};
  if(accepted){
   assert.equal(principal.userId,input.userId);assert.equal(principal.tokenId,input.tokenId);
   const service=new ItemService(new InMemoryItemRepository(),{now:()=>new Date('2026-10-07T18:00:00Z')});
   const key='identity:'+input.name;const requestId=`0193e8d5-6f5c-7a1b-8c2d-${String(i+1).padStart(12,'0')}`;
   const receipt=await service.put({key,documentJson:doc,expectedRevision:0,requestId},principal);assert.equal(receipt.revision,1);assert.equal(receipt.metadata.createdBy,input.userId);
   Object.assign(entry,{key,requestId,revision:receipt.revision,documentCanonical:(await service.get(key)).documentCanonical});
  }
  fixtures.push(entry);
 }
 const output=path.join(root,'server/src/test/resources/haystack/historical-auth');await mkdir(output,{recursive:true});
 await writeFile(path.join(output,'manifest.json'),JSON.stringify({format:'old-production-static-identity-v1',baseline:'e9fda183db02898aa4b2110e47febb816b2e9ffe',sourceDigests:Object.fromEntries(names.map((name,i)=>[name,hash(sources[i])])),provenance:'Actual baseline loadAuth/token file authentication; accepted identities acknowledged by frozen actual old ItemService and memory adapter. Synthetic tokens/files only.',fixtures},null,2)+'\n');
 console.log(`Historical static identity fixtures: ${fixtures.length}, old acknowledged: ${fixtures.filter(x=>x.accepted).length}`);
}finally{await rm(work,{recursive:true,force:true});}
