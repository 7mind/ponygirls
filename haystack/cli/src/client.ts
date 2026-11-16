import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {State, readBounded} from './state.ts';
import {type Arguments,text,number} from './args.ts';
import {CliError,fail,object,envelope,TIMEOUT_MS,RESPONSE_BYTES,PROTOCOL,serverFault,key,parseDocument,parseStoredDocument,requestId,usage} from './core.ts';
import {api,check,materialize,encode,decode,routes,failureSchema,type Schema,type Operation,type Codec,identitySchema,versions,ackSchema} from './protocol.ts';
export interface Settings {readonly origin:string;readonly timeout:number;readonly maxResponse:number;readonly auth:'token'|'session';readonly token:string|undefined;readonly tokenFile:string|undefined}
export function settings(args:Arguments,env:NodeJS.ProcessEnv,session:boolean,publicRoute:boolean):Settings {
  const value=text(args,'url')??env.HAYSTACK_URL;if(!value)usage('--url or HAYSTACK_URL is required');
  let url:URL;try {url=new URL(value);}catch{return fail('invalid-url','URL must be an http(s) origin without credentials, query, fragment or path',2);}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.pathname!==''&&url.pathname!=='/'))fail('invalid-url','URL must be an http(s) origin without credentials, query, fragment or path',2);
  if(url.protocol==='http:'&&!args.flags.has('allow-http'))fail('insecure-transport','HTTPS is required; --allow-http explicitly opts into cleartext private/loopback transport',2);
  const auth=session?'session':text(args,'auth')??((env.HAYSTACK_TOKEN||env.HAYSTACK_TOKEN_FILE||text(args,'token-file'))?'token':'session');
  if(session&&(text(args,'auth')==='token'||text(args,'token-file')!==undefined))usage('this command requires a password session, not bearer credentials');
  const token=env.HAYSTACK_TOKEN||undefined;const tokenFile=text(args,'token-file')??(env.HAYSTACK_TOKEN_FILE||undefined);
  if(!publicRoute&&auth==='token'&&token&&tokenFile)fail('ambiguous-credentials','TOKEN and TOKEN_FILE are both nonempty; select exactly one before credential access',2);
  return{origin:url.origin,timeout:number(args,'timeout-ms',TIMEOUT_MS,10,600_000),maxResponse:number(args,'max-response-bytes',RESPONSE_BYTES,1024,64*1024*1024),auth:auth as 'token'|'session',token,tokenFile};
}
export function tokenValue(value:string):string {
  if(!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)fail('invalid-credential','credential must be canonical 32-byte base64url (files may have one trailing LF)',2);
  return value;
}
export async function protectedFile(file:string,max:number):Promise<string> {
  let handle;
  try {const resolved=await realpath(file);const before=await lstat(resolved);if(!before.isFile()||before.uid!==process.getuid!()||(before.mode&0o077)!==0||before.nlink!==1||before.size>max)throw new Error();handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await handle.stat();if(!info.isFile()||info.dev!==before.dev||info.ino!==before.ino||info.uid!==before.uid||(info.mode&0o077)!==0||info.nlink!==1||info.size>max)throw new Error();return await readBounded(handle,max);}
  catch{return fail('invalid-credential','credential file must be bounded, owned by this user, owner-only resolved regular file; special files and hardlinks are refused',2);}finally{await handle?.close();}
}
export function validateInput(operation:Operation,raw:unknown):Record<string,unknown> {
  const descriptor=routes[operation];if(!check(descriptor.input,raw)||!object(raw))usage('request does not match the selected current generated schema');
  const input=materialize(descriptor.input,raw) as Record<string,unknown>;
  if(typeof input.key==='string')key(input.key);
  for(const name of ['revision','expectedRevision','offset'])if(input[name]!==undefined&&input[name]!==null&&(typeof input[name]!=='number'||(input[name] as number)<(name==='revision'?1:0)))usage('revision/offset is outside its supported range');
  if(operation==='put'){requestId(input.requestId as string);parseDocument((input.document as Record<string,unknown>).json as string);}
  if('limit'in input&&((input.limit as number)<1||(input.limit as number)>100))usage('limit must be 1..100');
  if(typeof input.query==='string') {
    if(input.query.length>4096)usage('query exceeds 4096 UTF16 units');
    if('caret'in input){const caret=input.caret as number;if(caret<0||caret>input.query.length||(/^[\uDC00-\uDFFF]$/.test(input.query[caret]??'')&&/^[\uD800-\uDBFF]$/.test(input.query[caret-1]??'')))usage('caret must be an in-range UTF16 boundary');}
  }
  if(typeof input.cursor==='string'&&Buffer.byteLength(input.cursor)>16384)usage('cursor is too large');
  return input;
}
export class Client {
  readonly config:Settings;readonly state:State;private credential:Promise<Record<string,string>>|undefined;
  constructor(config:Settings,state:State){this.config=config;this.state=state;}
  async credentials():Promise<Record<string,string>> {
    if(this.credential===undefined)this.credential=this.loadCredentials();return this.credential;
  }
  private async loadCredentials():Promise<Record<string,string>> {
    if(this.config.auth==='token'){
      const fromFile=this.config.token!==undefined||this.config.tokenFile===undefined?undefined:await protectedFile(this.config.tokenFile,128);
      const raw=this.config.token??(fromFile?.endsWith('\n')?fromFile.slice(0,-1):fromFile);if(raw===undefined)fail('unauthorized','provide HAYSTACK_TOKEN or HAYSTACK_TOKEN_FILE, or select --auth session',3);
      return{Authorization:'Bearer '+tokenValue(raw)};
    }
    const saved=await this.state.read('session');if(saved===undefined)fail('unauthorized','no password session for this origin; run login',3);
    const name=this.config.origin.startsWith('https:')?'__Host-haystack':'haystack-dev';
    if(typeof saved.cookie!=='string'||!saved.cookie.startsWith(name+'='))fail('unsafe-state','session does not match the selected origin/transport',2);
    const value=tokenValue(saved.cookie.slice(name.length+1));return{Cookie:name+'='+value,Origin:this.config.origin};
  }
  async raw(path:string,body:unknown,method:'GET'|'POST',authenticated:boolean,extra:Readonly<Record<string,string>>):Promise<{body:unknown;response:Response}> {
    return this.request(path,body,method,authenticated,extra,undefined);
  }
  private requestFailure(deadline:number|undefined,message:string):never {
    if(deadline!==undefined&&performance.now()>=deadline)fail('pagination-limit','pagination exceeded its total request deadline; no partial result returned',6);
    return fail('unavailable',message,6);
  }
  private async request(path:string,body:unknown,method:'GET'|'POST',authenticated:boolean,extra:Readonly<Record<string,string>>,deadline:number|undefined):Promise<{body:unknown;response:Response}> {
    const credentials=authenticated?await this.credentials():{};
    const remaining=deadline===undefined?this.config.timeout:Math.min(this.config.timeout,deadline-performance.now());
    if(remaining<=0)fail('pagination-limit','pagination exceeded its total request deadline; no partial result returned',6);
    const timeout=AbortSignal.timeout(Math.ceil(remaining));let response:Response;
    try{response=await fetch(this.config.origin+path,{method,redirect:'manual',headers:{Accept:'application/json','Content-Type':'application/json','X-Haystack-Version':PROTOCOL,...credentials,...extra},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:timeout});}
    catch {return this.requestFailure(deadline,'request failed or deadline exceeded; no automatic retry');}
    if(response.status>=300&&response.status<400){await response.body?.cancel();return fail('redirect-refused','redirect refused; credentials and request bodies are never forwarded or replayed',6);}
    const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>this.config.maxResponse)){await response.body?.cancel();return fail('too-large','response exceeds the configured byte limit',6);}
    const reader=response.body?.getReader();if(reader===undefined)return fail('invalid-response','response body missing',6);
    const chunks:Uint8Array[]=[];let bytes=0;
    try {while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>this.config.maxResponse){await reader.cancel();fail('too-large','response exceeds the configured byte limit',6);}chunks.push(next.value);}}
    catch(error){if(error instanceof CliError)throw error;return this.requestFailure(deadline,'response interrupted or deadline exceeded; no automatic retry');}finally{reader.releaseLock();}
    let parsed:unknown;
    try {if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new Error();parsed=envelope(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{return fail('invalid-response','server returned an invalid current-protocol JSON response',6);}
    if(!response.ok){
      if(path.startsWith('/api/account/v1')){if(!object(parsed)||!object(parsed.error)||typeof parsed.error.code!=='string'||typeof parsed.error.message!=='string')return fail('invalid-response','invalid account failure response',6);throw serverFault(parsed.error.code,response.status,{});}
      if(!check(failureSchema,parsed)||!object(parsed))return fail('invalid-response','invalid generated failure response',6);
      const failure=decode(api.Failure.jsonCodec(),materialize(failureSchema,parsed));const details:Record<string,unknown>={};if(failure.currentRevision!==undefined)details.currentRevision=failure.currentRevision;if(failure.spans.length)details.spans=failure.spans.map(span=>({start:span.start,end:span.end}));throw serverFault(failure.code,response.status,details);
    }
    return{body:parsed,response};
  }
  async domain(operation:Operation,input:unknown):Promise<unknown> {return this.domainRequest(operation,input,undefined);}
  async searchBefore(input:unknown,deadline:number):Promise<unknown> {
    const result=await this.domainRequest('search',input,deadline);
    if(performance.now()>=deadline)fail('pagination-limit','pagination exceeded its total request deadline; no partial result returned',6);
    return result;
  }
  private async domainRequest(operation:Operation,input:unknown,deadline:number|undefined):Promise<unknown> {
    input=validateInput(operation,input);const d=routes[operation];
    // Both directions use the generated codecs; schemas close their intentional TS cast-only boundary.
    const request:Codec<unknown>=d.request;const response:Codec<unknown>=d.response;
    const wire=encode(request,decode(request,input));const result=await this.request(d.path,wire,'POST',true,{},deadline);
    if(!check(d.output,result.body))return fail('invalid-response','server response violates the selected generated model',6);
    try {
      const decoded=decode(response,materialize(d.output,result.body));const out=encode(response,decoded);
      if(!object(out))throw new Error();
      if(operation==='get'){if(out.key!==(input as Record<string,unknown>).key||!object(out.document))throw new Error();parseStoredDocument(out.document.json as string);}
      if(operation==='put'){if(out.key!==(input as Record<string,unknown>).key||typeof out.revision!=='number'||out.revision<1)throw new Error();}
      return out;
    } catch{return fail('invalid-response','server response violates the selected generated model',6);}
  }
  async identity():Promise<api.Identity> {const value=await this.raw('/api/v1/whoami',undefined,'GET',true,{});if(!check(identitySchema,value.body))return fail('invalid-response','invalid identity response',6);return decode(api.Identity.jsonCodec(),value.body);}
  async health():Promise<unknown>{const value=await this.raw('/api/v1/health',undefined,'GET',false,{});if(!check(ackSchema,value.body)||!object(value.body)||value.body.ok!==true)return fail('invalid-response','invalid health response',6);return encode(api.Ack.jsonCodec(),decode(api.Ack.jsonCodec(),value.body));}
  async versions():Promise<unknown>{const value=await this.raw('/api/versions',undefined,'GET',false,{});if(!versions(value.body))return fail('version-mismatch','server versions are not the sole current API 1.0.0',6);return encode(api.VersionInfo.jsonCodec(),decode(api.VersionInfo.jsonCodec(),value.body));}
  async account(path:string,body:unknown,method:'GET'|'POST',schema:Schema,actor:string|undefined,authenticated:boolean):Promise<{body:unknown;response:Response}> {
    const extra:Record<string,string>={Origin:this.config.origin};if(actor!==undefined)extra['X-Account-Actor']=actor;
    const result=await this.raw('/api/account/v1'+path,body,method,authenticated,extra);if(!check(schema,result.body))return fail('invalid-response','invalid account response',6);return result;
  }
}
