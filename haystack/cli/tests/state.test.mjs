// Specified Behavioral/Effectual/Good-Communication: private real filesystem state.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {State} from '../dist/cli/src/state.js';
test('session replacement is atomic: concurrent readers never observe an absent saved cookie',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'haystack-state-'));const state=new State(directory,'https://owned.test');
 try{
  await state.create('session',{cookie:'old'});let absent=0;let done=false;
  const reader=(async()=>{while(!done){if(await state.read('session')===undefined)absent++;}})();
  for(let i=0;i<100;i++)await state.replace('session',{cookie:'new-'+i});done=true;await reader;
  assert.equal(absent,0,'replacement must rename atomically, not unlink the saved cookie first');assert.equal((await stat(state.filename('session'))).mode&0o777,0o600);
 }finally{await rm(directory,{recursive:true,force:true});}
});
