import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture} from './fixture.mjs';

it('configured fixture provision failures are bounded sanitized cleaned and never fall back to app CREATEDB',{timeout:35000},async()=>{
 const previous=process.env.HAYSTACK_TEST_PROVISION_COMMAND;const dir=await mkdtemp(path.join(os.tmpdir(),'haystack-helper-test-'));const marker=path.join(dir,'calls');
 try{
  for(const mode of ['nonzero','invalid-json','wrong-fields','wrong-database','timeout']){
   const helper=path.join(dir,mode);const code=`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv[2]==='--drop'){process.stdout.write('{}');process.exit(0);} ${mode==='timeout'?"setTimeout(()=>{},30000);":mode==='nonzero'?"process.stdout.write('SECRET-PROVISION-CANARY');process.exit(9);":mode==='invalid-json'?"process.stdout.write('SECRET-PROVISION-CANARY');":mode==='wrong-fields'?"process.stdout.write(JSON.stringify({'SECRET-PROVISION-CANARY':true}));":"process.stdout.write(JSON.stringify({jdbcUrl:'jdbc:postgresql://127.0.0.1:1/wrong',user:'runtime',passwordFile:'/missing'}));"}`;
   await writeFile(helper,code,{mode:0o700});process.env.HAYSTACK_TEST_PROVISION_COMMAND=helper;
   const started=Date.now();await assert.rejects(fixture(),error=>{assert.ok(!error.message.includes('SECRET-PROVISION-CANARY'));assert.match(error.message,/no runtime-identity fallback/);return true;});assert.ok(Date.now()-started<12000,'helper bound includes10second deadline');
  }
  const calls=(await readFile(marker,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,10);for(let i=0;i<calls.length;i+=2){assert.match(calls[i][0],/^haystack_current_[0-9a-f]{16}$/);assert.deepEqual(calls[i+1],['--drop',calls[i][0]]);}
 }finally{if(previous===undefined)delete process.env.HAYSTACK_TEST_PROVISION_COMMAND;else process.env.HAYSTACK_TEST_PROVISION_COMMAND=previous;}
});
