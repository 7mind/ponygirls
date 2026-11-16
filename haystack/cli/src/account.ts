import path from 'node:path';
import {createHash} from 'node:crypto';
import {type FileHandle} from 'node:fs/promises';
import {type Client,tokenValue} from './client.ts';
import {CliError,fail,object} from './core.ts';
import {accountSchema,ackSchema,issueSchema,loginSchema} from './protocol.ts';
import {secretDestination,syncDirectory} from './state.ts';
async function current(client:Client):Promise<{body:Record<string,unknown>;actor:string}> {
  const result=await client.account('',undefined,'GET',accountSchema,undefined,true);const body=result.body as Record<string,unknown>;const user=body.user as Record<string,unknown>;
  if(typeof user.actor!=='string'||user.actor!==createHash('sha256').update('account-actor-v1:'+user.id).digest('hex'))return fail('invalid-response','invalid owner-bound account actor',6);
  return{body,actor:user.actor};
}
function cookie(client:Client,response:Response):string {
  const name=client.config.origin.startsWith('https:')?'__Host-haystack':'haystack-dev';const values=response.headers.getSetCookie();
  if(values.length!==1)return fail('invalid-response','login did not return one valid origin-bound session cookie',6);
  const parts=values[0]!.split(';').map(s=>s.trim());const first=parts.shift()!;
  if(!first.startsWith(name+'=')||!parts.includes('Path=/')||!parts.includes('HttpOnly')||!parts.includes('SameSite=Strict')||!parts.includes('Max-Age=34560000')||parts.some(p=>/^Domain=/i.test(p))||parts.includes('Secure')!==client.config.origin.startsWith('https:'))return fail('invalid-response','login did not return one valid origin-bound session cookie',6);
  return name+'='+tokenValue(first.slice(name.length+1));
}
export async function login(client:Client,name:string,password:string):Promise<unknown> {
  // A login deliberately replaces only a presented session, never an API bearer.
  const saved=await client.state.read('session');const extra:Record<string,string>={Origin:client.config.origin};
  if(saved!==undefined){const credentials=await client.credentials();Object.assign(extra,credentials);}
  const result=await client.raw('/api/account/v1/login',{login:name,password},'POST',false,extra);
  const {check}=await import('./protocol.ts');if(!check(loginSchema,result.body))return fail('invalid-response','invalid login response',6);
  const pair=cookie(client,result.response);await client.state.replace('session',{cookie:pair});return result.body;
}
export async function account(client:Client):Promise<unknown> {return(await current(client)).body;}
export async function status(client:Client):Promise<unknown> {const value=await current(client);return{authenticated:true,user:value.body.user,pendingTokenIssue:(await client.state.read('account-pending'))!==undefined};}
export async function logout(client:Client):Promise<unknown> {const owner=await current(client);const response=await client.account('/logout',{},'POST',ackSchema,owner.actor,true);if(!object(response.body)||response.body.ok!==true)return fail('invalid-response','invalid logout acknowledgement',6);await client.state.remove('session');return response.body;}
export async function revoke(client:Client,id:string):Promise<unknown>{if(id.length===0||id.length>256||/[\p{Cc}\p{Cf}]/u.test(id))return fail('usage','token ID must be a bounded nonempty opaque ID',2);const owner=await current(client);const result=await client.account('/tokens/'+encodeURIComponent(id)+'/revoke',{},'POST',ackSchema,owner.actor,true);if(!object(result.body)||result.body.ok!==true)return fail('invalid-response','invalid token revocation acknowledgement',6);return result.body;}
export async function acknowledge(client:Client):Promise<unknown> {const saved=await client.state.read('account-pending');if(saved===undefined)return{acknowledged:false};await client.state.remove('account-pending');return{acknowledged:true,warning:'lost token secrets cannot be recovered; inspect token list and revoke any unintended issued token before issuing again'};}
export async function issue(client:Client,name:string,file:string):Promise<unknown> {
  if((await client.state.read('account-pending'))!==undefined)fail('pending-account','a token issue has an unknown outcome; inspect token list/revoke, then explicitly token acknowledge. Never blind-retry issue',7);
  let destination:FileHandle|undefined;
  try {
    destination=await secretDestination(file);const owner=await current(client);
    await client.state.create('account-pending',{operation:'token-issue',name,actor:owner.actor});
    try {
      const issued=(await client.account('/tokens',{name,scopes:['api']},'POST',issueSchema,owner.actor,true)).body as Record<string,unknown>;
      const secret=tokenValue(issued.secret as string);await destination.writeFile(secret+'\n','utf8');await destination.sync();await syncDirectory(path.dirname(path.resolve(file)));
      await client.state.remove('account-pending');return{token:issued.token,secretSaved:true};
    }catch(error){throw new CliError('uncertain-account','token creation outcome is unknown or secret could not be saved. Do not repeat issue. Inspect token list/revoke, then explicitly token acknowledge',7,{pending:true});}
  } finally {await destination?.close();}
}
