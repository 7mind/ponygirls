// Behavioral/Blackbox/Good-Communication: disposable process and owned PG only.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,rename} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as api from '../../generated/typescript/haystack/api/index.ts';
import {BaboonCodecContext} from '../../generated/typescript/BaboonSharedRuntime.ts';
export {api};
export const context=BaboonCodecContext.Default;
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const rid=()=>{const bytes=randomBytes(16);let stamp=BigInt(Date.now());for(let i=5;i>=0;i--){bytes[i]=Number(stamp&255n);stamp>>=8n;}bytes[6]=(bytes[6]&15)|112;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
export const document=(over={})=>JSON.stringify({title:'t',description:'d',fields:{},type:'fact',status:'actual',importance:'low','human-attention':'cleared',links:[],tags:[],...over});
export const encode=(Type,value)=>Type.jsonCodec().encode(context,value);
export const decode=(Type,value)=>Type.jsonCodec().decode(context,value);
export async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export async function fixture(overrides={},configure=async()=>{}){
  assert.equal(process.env.HAYSTACK_OWNED_TEST_DB,'1','run scripts/test-current.sh with its owned PostgreSQL; no arbitrary data reads');
  assert.ok(process.env.HAYSTACK_SERVER_COMMAND,'explicit JVM/native command required');
  const dir=await mkdtemp(path.join(os.tmpdir(),'haystack-current-'));
  const tokens={alice:randomBytes(32).toString('base64url'),bot:randomBytes(32).toString('base64url')};
  for(const [name,token] of Object.entries(tokens))await writeFile(path.join(dir,name+'.sha'),createHash('sha256').update(token,'ascii').digest('hex')+'\n',{mode:0o600});
  const port=await freePort();const base=`http://127.0.0.1:${port}`;
  const config=JSON.parse(await readFile(path.join(root,'haystack/docs/scala-config.example.json'),'utf8'));
  Object.assign(config,{listenPort:port,webRoot:null,authReloadMs:100});
  const databaseName='haystack_current_'+randomBytes(8).toString('hex');
  let database;let dropped=false;let dropDatabase=async()=>{};
  const helper=process.env.HAYSTACK_TEST_PROVISION_COMMAND;
  const invokeHelper=async args=>{
    if(!path.isAbsolute(helper))throw new Error('provision helper must be an absolute executable path');
    let output;try{output=await promisify(execFile)(helper,args,{encoding:'buffer',timeout:10000,killSignal:'SIGKILL',maxBuffer:16384});}catch{throw new Error('owned fixture provisioning command failed; no runtime-identity fallback');}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output.stdout));}catch{throw new Error('invalid owned fixture provisioning response');}
  };
  if(helper){
    dropDatabase=async()=>{if(dropped)return;const response=await invokeHelper(['--drop',databaseName]);if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).length)throw new Error('invalid owned fixture cleanup response');dropped=true;};
    try{
      const provisioned=await invokeHelper([databaseName]);
      if(!provisioned||typeof provisioned!=='object'||Array.isArray(provisioned)||Object.keys(provisioned).sort().join(',')!=='jdbcUrl,passwordFile,user')throw new Error('invalid fixture database descriptor');
      for(const key of ['jdbcUrl','passwordFile','user'])if(typeof provisioned[key]!=='string'||!provisioned[key].length)throw new Error('invalid fixture database descriptor');
      if(!provisioned.jdbcUrl.startsWith('jdbc:postgresql://'))throw new Error('invalid fixture database descriptor');
      const target=new URL(provisioned.jdbcUrl.slice(5));
      if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.pathname!=='/'+databaseName||target.username||target.password||target.search||target.hash||!path.isAbsolute(provisioned.passwordFile)||(await readFile(provisioned.passwordFile)).length===0)throw new Error('invalid fixture database descriptor');
      database=provisioned;
    }catch{let clean=true;try{await dropDatabase();}catch{clean=false;}throw new Error(clean?'owned fixture provisioning failed; no runtime-identity fallback':'owned fixture provisioning and cleanup failed; no runtime-identity fallback');}
  }else{
    assert.equal(process.env.HAYSTACK_FIXTURE_ADMIN_AUTHORIZED,'1','direct CREATE DATABASE needs explicit owned fixture-admin authorization');
    const databaseUrl=new URL(process.env.HAYSTACK_TEST_JDBC.replace(/^jdbc:/,''));
    const admin=()=>new pg.Client({host:databaseUrl.hostname,port:Number(databaseUrl.port),database:databaseUrl.pathname.slice(1),user:process.env.HAYSTACK_TEST_DB_USER,password});
    const password=(await readFile(process.env.HAYSTACK_TEST_DB_PASSWORD_FILE,'utf8')).trimEnd();
    const command=async sql=>{const client=admin();await client.connect();try{await client.query(sql);}finally{await client.end();}};
    await command('CREATE DATABASE "'+databaseName+'"');
    dropDatabase=async()=>{if(dropped)return;await command('DROP DATABASE "'+databaseName+'" WITH (FORCE)');dropped=true;};
    database={jdbcUrl:process.env.HAYSTACK_TEST_JDBC.replace(/\/[^/]+$/,'/'+databaseName),user:process.env.HAYSTACK_TEST_DB_USER,passwordFile:process.env.HAYSTACK_TEST_DB_PASSWORD_FILE};
  }
  Object.assign(config.database,database);
  Object.assign(config.auth,{cookieSecure:false,allowedHosts:['127.0.0.1','localhost','haystack.test'],allowedOrigins:[base,'http://allowed.test'],insecureHttpOrigins:[],rateLimit:{windowMs:60000,max:10000},users:[
    {id:'alice',type:'human',displayName:'Alice',tokens:[{id:'browser',hashFile:path.join(dir,'alice.sha')}]},
    {id:'bot',type:'agent',displayName:'Bot',tokens:[{id:'default',hashFile:path.join(dir,'bot.sha')}]},
  ],...overrides});
  Object.assign(config.retrieval,{approvedFieldPrefixes:['']});
  try{await configure(config,{dir,port,base});}catch(error){await dropDatabase();throw error;}
  const configPath=path.join(dir,'config.json');
  const save=async()=>{await writeFile(configPath+'.tmp',JSON.stringify(config),{mode:0o600});await rename(configPath+'.tmp',configPath);};
  try{await save();}catch(error){await dropDatabase();throw error;}let processHandle;let output='';let errors='';
  const start=async()=>{
    processHandle=spawn('/bin/sh',['-c','exec '+process.env.HAYSTACK_SERVER_COMMAND+' serve "$1"','haystack-test',configPath],{cwd:root,stdio:['ignore','pipe','pipe']});
    processHandle.stdout.on('data',bytes=>{output+=bytes;});processHandle.stderr.on('data',bytes=>{errors+=bytes;});
    const deadline=Date.now()+15000;let ready=false;
    while(Date.now()<deadline){if(processHandle.exitCode!==null)throw new Error('server exited before readiness: '+output);try{const r=await fetch(base+'/api/v1/health',{headers:{Connection:'close'}});await r.text();if(r.ok){ready=true;break;}}catch{}await sleep(50);}
    assert.ok(ready,'server readiness deadline');
  };
  const stop=async()=>{if(!processHandle)return [0,null];if(processHandle.exitCode!==null||processHandle.signalCode!==null)return [processHandle.exitCode,processHandle.signalCode];const exited=once(processHandle,'exit');processHandle.kill('SIGTERM');const timeout=setTimeout(()=>processHandle.kill('SIGKILL'),3000);const result=await exited;clearTimeout(timeout);return result;};
  try{await start();}catch(error){await stop();await dropDatabase();throw error;}
  const call=async(route,value,options={})=>{
    const headers={'Content-Type':'application/json','X-Haystack-Version':'1.0.0',...(options.token?{Authorization:'Bearer '+options.token}:{}),...options.headers};
    const body=value===undefined?undefined:typeof value==='string'?value:JSON.stringify(value);
    if(Object.keys(headers).some(key=>key.toLowerCase()==='host'))return new Promise((resolve,reject)=>{
      const request=http.request(base+route,{method:options.method??'POST',headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const responseHeaders=new Headers();for(let i=0;i<response.rawHeaders.length;i+=2)responseHeaders.append(response.rawHeaders[i],response.rawHeaders[i+1]);resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:responseHeaders}));});});
      request.on('error',reject);request.end(body);
    });
    return fetch(base+route,{method:options.method??'POST',headers,...(body===undefined?{}:{body})});
  };
  const put=(key,doc=document(),expected=0,id=rid(),token=tokens.bot)=>call('/api/v1/put',encode(api.PutRequest,new api.PutRequest(key,new api.DocumentPayload(doc),expected,id)),{token});
  return {dir,port,base,tokens,config,configPath,call,put,async stop(){const result=await stop();await dropDatabase();return result;},start,async restart(){await stop();await start();},async reload(change){change(config.auth);await save();await sleep(250);},async save(){await save();await sleep(250);},logs:()=>output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}),output:()=>output+'\n'+errors};
}
