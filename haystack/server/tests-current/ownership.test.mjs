// Regression: readiness is evidence from our child, never a foreign /health.
// Behavioral-Active/Blackbox/Good-Communication; all listeners are owned here.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {fixture} from './fixture.mjs';

it('occupied listeners and children without their own fresh readiness marker receive zero fixture probes',async()=>{
 let requests=0;const listener=http.createServer((_request,response)=>{requests++;response.end('{}');});let unexpectedlyStarted;
 try{
  await assert.rejects((async()=>{unexpectedlyStarted=await fixture({},async(_config,{port})=>{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',resolve);});});})(),/occupied|unavailable|in use/iu);
  assert.equal(requests,0,'occupied listener must receive no health/auth requests');
 }finally{if(unexpectedlyStarted)await unexpectedlyStarted.stop();if(listener.listening)await new Promise(resolve=>listener.close(resolve));}
 const dir=await mkdtemp(path.join(os.tmpdir(),'haystack-owned-launcher-'));const script=path.join(dir,'unready.mjs');const counter=path.join(dir,'requests');let f;const command=process.env.HAYSTACK_SERVER_COMMAND;
 try{
  await writeFile(script,`import http from 'node:http';import fs from 'node:fs';const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));const server=http.createServer((_request,response)=>{fs.appendFileSync(${JSON.stringify(counter)},'request\\n');response.end('{}');});server.listen(config.listenPort,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  f=await fixture(); // An old ready line must not authorize the next child.
  process.env.HAYSTACK_SERVER_COMMAND=JSON.stringify(process.execPath)+' '+JSON.stringify(script);
  await assert.rejects(f.restart(),/readiness deadline/iu);
  assert.equal(await readFile(counter,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'','unready child must receive no health/auth requests');
 }finally{process.env.HAYSTACK_SERVER_COMMAND=command;if(f)await f.stop();await rm(dir,{recursive:true,force:true});}
});
