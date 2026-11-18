// Fixture safety: readiness is evidence from our own child, never a foreign
// listener on the fixture port, and only an owned loopback database is used.
// Behavioral-Active/Blackbox/Good-Communication; all listeners are owned here.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {fixture,ownedDescriptor} from './fixture.mjs';

const ShortReadinessMs=300;

it('a foreign listener on the fixture port receives zero probes and the fixture refuses to start',async()=>{
 let requests=0;const listener=http.createServer((_request,response)=>{requests++;response.end('{}');});let unexpectedlyStarted;
 try{
  await assert.rejects((async()=>{unexpectedlyStarted=await fixture({},async(_config,{port})=>{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',resolve);});});})(),/occupied|unavailable|in use/iu);
  assert.equal(requests,0,'occupied listener must receive no health/auth requests');
 }finally{if(unexpectedlyStarted)await unexpectedlyStarted.stop();if(listener.listening)await new Promise(resolve=>listener.close(resolve));}
});

it('a child without its own fresh readiness marker receives zero probes, even after a ready predecessor',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'haystack-fixture-safety-'));const script=path.join(dir,'child.mjs');const launches=path.join(dir,'launches');const counter=path.join(dir,'requests');let f;
 try{
  // The first launch announces readiness and answers health; the second listens without announcing it.
  await writeFile(script,`import http from 'node:http';import fs from 'node:fs';const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));fs.appendFileSync(${JSON.stringify(launches)},'launch\\n');const first=fs.readFileSync(${JSON.stringify(launches)},'utf8').split('\\n').length===2;const server=http.createServer((_request,response)=>{if(!first)fs.appendFileSync(${JSON.stringify(counter)},'request\\n');response.end('{}');});server.listen(config.listenPort,'127.0.0.1',()=>{if(first)console.log('haystack: ready');});process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  f=await fixture({},async()=>{},{serverCommand:JSON.stringify(process.execPath)+' '+JSON.stringify(script)});
  await assert.rejects(f.restart(ShortReadinessMs),/readiness deadline/iu);
  assert.equal((await readFile(launches,'utf8')).split('\n').length,3,'the unready child was launched');
  assert.equal(await readFile(counter,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'','unready child must receive no health/auth requests');
 }finally{if(f)await f.stop();await rm(dir,{recursive:true,force:true});}
});

it('database descriptors that are not loopback or that carry credentials are refused',()=>{
 const name='haystack_current_0123456789abcdef';const valid={jdbcUrl:`jdbc:postgresql://127.0.0.1:5432/${name}`,user:'haystack',passwordFile:'/owned/password'};
 assert.deepEqual(ownedDescriptor(valid,name),valid);
 for(const jdbcUrl of [`jdbc:postgresql://10.0.0.1:5432/${name}`,`jdbc:postgresql://db.example:5432/${name}`,`jdbc:postgresql://user:secret@127.0.0.1:5432/${name}`,`jdbc:postgresql://127.0.0.1:5432/${name}?password=secret`,`jdbc:postgresql://127.0.0.1:5432/other`])
  assert.throws(()=>ownedDescriptor({...valid,jdbcUrl},name),/invalid fixture database descriptor/u,jdbcUrl);
 assert.throws(()=>ownedDescriptor({...valid,password:'secret'},name),/invalid fixture database descriptor/u);
});
