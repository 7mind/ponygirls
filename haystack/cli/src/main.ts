#!/usr/bin/env node
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {Arguments,parse,validate,text,required,number,help,helpHint,fileOption} from './args.ts';
import {Client,settings,protectedFile,validateInput} from './client.ts';
import {State,stateDirectory,readBounded} from './state.ts';
import {CliError,fail,usage,key,integer,uuidv7,requestId,parseDocument,envelope,object,exact,safe,VERSION,INPUT_BYTES,DOCUMENT_BYTES} from './core.ts';
import {api,encode,routes,type Operation} from './protocol.ts';
import * as writes from './writes.ts';
import * as accounts from './account.ts';
import {watch} from './watch.ts';
import {retrieve} from './retrieve.ts';
import {human,humanWatch,humanError} from './human.ts';
import {Presentation} from './presentation.ts';
import {LiveOutput} from './output.ts';
async function output(stream:NodeJS.WritableStream,value:string):Promise<void>{return new Promise((resolve,reject)=>{stream.write(value,error=>{if(error!==undefined&&error!==null)reject(new CliError('output-failed','could not write command output',6,{}));else resolve();});});}
async function source(file:string,limit:number,timeout:number,secret:boolean):Promise<string> {
  if(file==='-'){
    if(process.stdin.isTTY)usage('stdin must be explicitly piped; use a file instead of typing credentials into a visible terminal');
    const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>process.stdin.destroy(new Error('input deadline')),timeout);
    try{for await(const raw of process.stdin){const bytes=Buffer.from(raw);size+=bytes.length;if(size>limit)fail(secret?'invalid-credential':'too-large','input exceeds the allowed byte limit',2);chunks.push(bytes);}return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
    catch(error){if(error instanceof CliError)throw error;return fail(secret?'invalid-credential':'invalid-input','input unreadable, invalid UTF8 or deadline exceeded',2);}finally{clearTimeout(timer);}
  }
  if(secret)return protectedFile(file,limit);
  let handle;try{handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK);const info=await handle.stat();if(!info.isFile()||info.size>limit)throw new Error();return await readBounded(handle,limit);}catch{return fail('invalid-input','input must be a bounded UTF8 regular file',2);}finally{await handle?.close();}
}
function wireItem(value:unknown):Record<string,unknown>{if(!object(value))return fail('invalid-response','invalid item response',6);return value;}
async function run(args:Arguments,env:NodeJS.ProcessEnv,presentation:Presentation):Promise<void> {
  if(args.flags.has('version')){if(args.words.length)usage('--version does not take a command');await output(process.stdout,args.json?exact({ok:true,command:'version',result:{version:VERSION}},false)+'\n':presentation.heading(`haystack ${VERSION}`)+'\n');return;}
  if(args.flags.has('help')||args.words.length===0||args.words[0]==='help'){const text=help(args);await output(process.stdout,args.json?exact({ok:true,command:'help',result:{text}},false)+'\n':presentation.help(text));return;}
  const command=validate(args);const session=['login','logout','status','account','token','watch'].includes(command);
  const config=settings(args,env,session,command==='health'||command==='versions'||command==='pending');const state=new State(stateDirectory(env,text(args,'state-dir')),config.origin);const client=new Client(config,state);
  const word=args.words[1];let result:unknown;let operationId:string|undefined;let notices:readonly string[]=[];
  if(command==='watch'){
    const duration=number(args,'duration-ms',60_000,1,86_400_000);const max=number(args,'max-events',1000,1,1_000_000);const destination=new LiveOutput(process.stdout);
    const emit=async(frame:unknown,signal:AbortSignal)=>destination.write(args.json?exact({ok:true,command:'watch',event:frame},false)+'\n':humanWatch(frame,presentation),signal);
    try{await watch(client,duration,max,emit);}finally{destination.close();}return;
  }
  if(command==='health')result=await client.health();
  else if(command==='versions')result=await client.versions();
  else if(command==='whoami')result=encode(api.Identity.jsonCodec(),await client.identity());
  else if(command==='get'){const id=key(word!);const revision=text(args,'revision');result=await client.domain('get',encode(api.GetRequest.jsonCodec(),new api.GetRequest(id,revision===undefined?undefined:integer(revision,1,2147483647,'revision'))));}
  else if(command==='history')result=await client.domain('history',encode(api.HistoryRequest.jsonCodec(),new api.HistoryRequest(key(word!))));
  else if(command==='values'){if(word!.length===0||word!.length>1024)usage('field must be a bounded nonempty string');result=await client.domain('values',encode(api.ValuesRequest.jsonCodec(),new api.ValuesRequest(word!)));}
  else if(command==='analyze'||command==='complete'){const query=word!;const caret=number(args,'caret',query.length,0,4096);result=await client.domain(command,encode(api.QueryRequest.jsonCodec(),new api.QueryRequest(query,caret)));}
  else if(command==='retrieve'){
    const raw=text(args,'mode');const explicit=raw===undefined?undefined:raw==='lexical'?api.RetrievalMode.Lexical:raw==='semantic'?api.RetrievalMode.Semantic:raw==='hybrid'?api.RetrievalMode.Hybrid:usage('mode must be lexical, semantic or hybrid');
    const project=text(args,'project');const includeArchived=args.flags.has('include-archived');const offset=number(args,'offset',0,0,2147483647);const limit=number(args,'limit',20,1,100);
    const retrieved=await retrieve(client,explicit,mode=>encode(api.RetrieveRequest.jsonCodec(),new api.RetrieveRequest(word!,mode,project,includeArchived,offset,limit)));result=retrieved.result;notices=retrieved.notices;
  } else if(command==='search'){
    const query=word??'';const limit=number(args,'limit',20,1,100);const sort=new api.SearchSort(text(args,'sort')??'modified-at',text(args,'direction')??'desc');let cursor=text(args,'cursor');
    const seen=new Set<string>();const items:unknown[]=[];const deadline=performance.now()+config.timeout;let pages=0;let totalBytes=0;
    do {
      if(performance.now()>=deadline||++pages>1000)fail('pagination-limit','pagination exceeded its finite request deadline or 1000-page bound; resume explicitly with the last cursor',6);
      const request=encode(api.SearchRequest.jsonCodec(),new api.SearchRequest(query,text(args,'project'),limit,cursor,sort));
      const response=wireItem(await(args.flags.has('all')?client.searchBefore(request,deadline):client.domain('search',request)));
      totalBytes+=Buffer.byteLength(exact(response,false));if(totalBytes>config.maxResponse)fail('too-large','combined search pages exceed the configured response byte limit',6);
      items.push(...response.items as unknown[]);cursor=typeof response.cursor==='string'?response.cursor:undefined;
      if(cursor!==undefined){if(seen.has(cursor))fail('invalid-response','server repeated a pagination cursor; refusing an unbounded loop',6);seen.add(cursor);}
    } while(args.flags.has('all')&&cursor!==undefined);
    if(args.flags.has('all')&&performance.now()>=deadline)fail('pagination-limit','pagination exceeded its total request deadline; no partial result returned',6);
    result={items,cursor:cursor??null};
  } else if(command==='put'||command==='call'){
    let input:Record<string,unknown>;let op:Operation;
    if(command==='put'){
      const id=key(word!);const expected=integer(required(args,'expected-revision'),0,2147483647,'expected-revision');const rid=requestId(text(args,'request-id')??uuidv7());
      const document=await source(fileOption(args),DOCUMENT_BYTES,config.timeout,false);parseDocument(document);
      input=encode(api.PutRequest.jsonCodec(),new api.PutRequest(id,new api.DocumentPayload(document),expected,rid)) as Record<string,unknown>;op='put';
    }else{
      if(!Object.hasOwn(routes,word!))usage('call supports only get, put, search, history, analyze, complete, values, retrieve');op=word as Operation;
      const raw=await source(fileOption(args),INPUT_BYTES,config.timeout,false);try{const parsed=envelope(raw);if(!object(parsed))throw new Error();input=parsed;}catch{usage('typed call input must be valid JSON without duplicate keys');}
    }
    input=validateInput(op,input);
    if(op==='put'){const saved=await state.locked(()=>writes.put(client,input));result=saved.result;operationId=saved.requestId;}else result=await client.domain(op,input);
  } else if(['edit','archive','unarchive','attention','restore'].includes(command)){
    const id=key(word!);const rid=requestId(text(args,'request-id')??uuidv7());let replacement:string|undefined;
    if(command==='edit'){replacement=await source(fileOption(args),DOCUMENT_BYTES,config.timeout,false);parseDocument(replacement);}
    const target=command==='restore'?integer(required(args,'revision'),1,2147483647,'revision'):undefined;
    const status=command==='unarchive'?required(args,'status'):undefined;if(status==='archived')usage('unarchive status must not be archived');
    const attention=command==='attention'?args.words[2]:undefined;if(command==='attention'&&attention!=='required'&&attention!=='cleared')usage('attention must be required or cleared');
    const saved=await state.locked(async()=>{
      const current=wireItem(await client.domain('get',encode(api.GetRequest.jsonCodec(),new api.GetRequest(id,undefined))));
      if(command==='restore'){const old=wireItem(await client.domain('get',encode(api.GetRequest.jsonCodec(),new api.GetRequest(id,target))));replacement=(old.document as Record<string,unknown>).json as string;}
      else if(command!=='edit'){
        const original=(current.document as Record<string,unknown>).json as string;const document=parseDocument(original);if(!object(document))throw new Error('document');
        if(command==='archive')document.status='archived';if(command==='unarchive')document.status=status!;if(command==='attention')document['human-attention']=attention!;replacement=exact(document,false);
      }
      parseDocument(replacement!);
      return writes.put(client,encode(api.PutRequest.jsonCodec(),new api.PutRequest(id,new api.DocumentPayload(replacement!),current.revision as number,rid)) as Record<string,unknown>);
    });result=saved.result;operationId=saved.requestId;
  } else if(command==='pending'){result=(await state.locked(()=>writes.inspect(state))).result;
  } else if(command==='replay'||command==='reconcile'){
    const saved=await state.locked(()=>writes.pending(client,true));result=saved.result;if('requestId'in saved)operationId=saved.requestId;
  } else if(command==='login'){
    const file=required(args,'password-file');if(word!.length===0||word!.length>128)usage('login must be a bounded nonempty string');let password=await source(file,16*1024,config.timeout,true);if(password.endsWith('\n'))password=password.slice(0,-1);if(password.length===0||password.length>1024||password.includes('\0'))fail('invalid-credential','password is empty or invalid',2);
    result=await state.locked(()=>accounts.login(client,word!,password));
  } else if(command==='account')result=await accounts.account(client);
  else if(command==='status')result=await accounts.status(client);
  else if(command==='logout')result=await state.locked(()=>accounts.logout(client));
  else if(command==='token'){
    if(word==='list'&&args.words.length===2)result=await accounts.account(client);
    else if(word==='acknowledge'&&args.words.length===2)result=await state.locked(()=>accounts.acknowledge(client));
    else if(word==='revoke'&&args.words.length===3)result=await state.locked(()=>accounts.revoke(client,args.words[2]!));
    else if(word==='issue'&&args.words.length===2){const name=required(args,'name');const file=required(args,'secret-file');if(name.length===0||name.length>128||name!==name.trim()||/[\p{Cc}]/u.test(name))usage('token name must be 1..128 characters without surrounding whitespace or control characters');result=await state.locked(()=>accounts.issue(client,name,file));}
    else usage('use token list, issue, revoke ID or acknowledge');
  } else usage('unimplemented command');
  for(const notice of notices)await output(process.stderr,'Notice: '+safe(notice)+'\n');
  await output(process.stdout,args.json?exact({ok:true,command,...(operationId===undefined?{}:{requestId:operationId}),result},false)+'\n':human({command,arguments:args.words.slice(1),requestId:operationId},result,presentation));
}
async function main(argv:string[],env:NodeJS.ProcessEnv):Promise<void> {
  process.stdout.on('error',()=>{process.exitCode=6;});process.stderr.on('error',()=>{process.exitCode=6;});
  let json=argv.includes('--json');let args:Arguments|undefined;const flags=new Map<string,string|boolean>();
  const presentation=(terminal:boolean)=>new Presentation({color:flags.get('color'),json,terminal,noColor:env.NO_COLOR,term:env.TERM});
  try{args=parse(argv,flags);json=args.json;await run(args,env,presentation(process.stdout.isTTY===true));}
  catch(error){const fault=error instanceof CliError?error:new CliError('internal','internal client failure; no submitted data or credentials are included',6,{});process.exitCode=fault.exit;const payload={ok:false,error:{code:fault.code,message:fault.message,...fault.details}};await output(process.stderr,json?exact(payload,false)+'\n':humanError(fault,presentation(process.stderr.isTTY===true),helpHint(args))).catch(()=>{process.exitCode=6;});}
}
await main(process.argv.slice(2),process.env);
