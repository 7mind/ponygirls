import {readdir} from 'node:fs/promises';
import {State,privateDirectory} from './state.ts';
import {createHash} from 'node:crypto';
import {type Client} from './client.ts';
import {CliError,fail,object} from './core.ts';
export interface WriteResult {readonly result:unknown;readonly requestId:string}
interface Lane {readonly kind:string;readonly owner:readonly string[]}
async function lane(client:Client):Promise<Lane>{const identity=await client.identity();const owner=[identity.userId,identity.tokenId];return{kind:'pending-'+createHash('sha256').update(JSON.stringify(owner)).digest('hex'),owner};}
function operation(value:Record<string,unknown>,owner:readonly string[]):Record<string,unknown>{if(!Array.isArray(value.owner)||JSON.stringify(value.owner)!==JSON.stringify(owner)||!object(value.operation)||typeof value.operation.requestId!=='string')return fail('unsafe-state','pending operation has invalid ownership or envelope',2);return value.operation;}
function terminal(error:unknown):boolean{return error instanceof CliError&&typeof error.details.status==='number'&&error.details.status>=400&&error.details.status<500&&![401,403,408].includes(error.details.status);}
async function send(client:Client,kind:string,input:Record<string,unknown>):Promise<WriteResult>{
  try {const result=await client.domain('put',input);await client.state.remove(kind);return{result,requestId:input.requestId as string};}
  catch(error){if(terminal(error)){await client.state.remove(kind);const failure=error as CliError;throw new CliError(failure.code,failure.message,failure.exit,{...failure.details,requestId:input.requestId});}throw new CliError('uncertain-write','write outcome is unknown; exact document/CAS/request ID retained privately. Run pending then replay (or reconcile); never generate a replacement ID',7,{requestId:input.requestId,pending:true});}
}
export async function put(client:Client,input:Record<string,unknown>):Promise<WriteResult>{
  const current=await lane(client);const pending=await client.state.read(current.kind);
  if(pending!==undefined){const op=operation(pending,current.owner);throw new CliError('pending-write','an uncertain write is retained for this principal; replay it before sending another operation',7,{requestId:op.requestId,pending:true});}
  await client.state.create(current.kind,{owner:current.owner,operation:input});
  return send(client,current.kind,input);
}
export async function pending(client:Client,replay:boolean):Promise<WriteResult|{result:unknown}>{
  const current=await lane(client);const saved=await client.state.read(current.kind);if(saved===undefined){if(replay)fail('no-pending-write','no retained operation for this origin and principal',2);return{result:{operation:null}};}
  const input=operation(saved,current.owner);if(replay)return send(client,current.kind,input);
  return{result:{operation:{key:input.key,expectedRevision:input.expectedRevision,requestId:input.requestId},owner:current.owner,recovery:'replay or reconcile sends the original exact operation; a head/history comparison alone cannot prove an acknowledged outcome'}};
}

export async function inspect(state:State):Promise<{result:unknown}> {
  await privateDirectory(state.directory);const saved=[];
  for(const filename of (await readdir(state.directory)).sort()) {
    if(!filename.startsWith(state.prefix+'.pending-')||!/^pending-[0-9a-f]{64}\.json$/.test(filename.slice(state.prefix.length+1)))continue;
    const kind=filename.slice(state.prefix.length+1,-5);const value=await state.read(kind);if(value===undefined)continue;
    if(!Array.isArray(value.owner)||value.owner.length!==2||!value.owner.every(v=>typeof v==='string'))fail('unsafe-state','invalid pending operation owner',2);
    const input=operation(value,value.owner as string[]);
    saved.push({key:input.key,expectedRevision:input.expectedRevision,requestId:input.requestId,owner:value.owner});
  }
  return{result:{operation:saved.length===1?saved[0]:null,operations:saved,recovery:'replay or reconcile requires the original authenticated principal and sends its original exact operation; a head/history comparison alone is not proof'}};
}
