import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = process.argv[2];
assert(root, 'Pass the absolute packaged Pi root');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { WebSocketServer } = createRequire(join(root, 'package.json'))('ws');
const { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } = await load('dist/index.js');
const { fauxAssistantMessage } = await load('node_modules/@earendil-works/pi-ai/dist/index.js');
const { closeOpenAICodexWebSocketSessions } = await load('node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js');
const token = `synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic'}})).toString('base64url')}.synthetic`;
const text = 'Packaged loopback summary';
const events = [
 {type:'response.output_item.added',item:{type:'message',id:'message',role:'assistant',status:'in_progress',content:[]}},
 {type:'response.content_part.added',part:{type:'output_text',text:''}},
 {type:'response.output_text.delta',delta:text},
 {type:'response.output_item.done',item:{type:'message',id:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}},
 {type:'response.completed',response:{id:'completed',status:'completed',output:[],usage:{input_tokens:5,output_tokens:3,total_tokens:8}}},
];
const sse = events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('');

for (const automatic of [false, true]) for (const transport of ['sse','auto']) {
 const directory=mkdtempSync(join(tmpdir(),'pi-packaged-compaction-'));
 let http=0, websocket=0, session;
 const server=createServer((request,response)=>{http++; request.resume(); response.writeHead(200,{'content-type':'text/event-stream'}); response.end(sse);});
 const sockets=new WebSocketServer({server});
 sockets.on('connection',socket=>socket.on('message',()=>{
  websocket++;
  socket.send(JSON.stringify({type:'response.created',response:{id:'created',status:'in_progress'}}));
  if(websocket===1){for(const event of events.slice(0,3))socket.send(JSON.stringify(event)); socket.close(1011,'synthetic_disconnect');}
  else for(const event of events)socket.send(JSON.stringify(event));
 }));
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 try {
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const runtime=await ModelRuntime.create({authPath:join(directory,'auth.json'),modelsPath:null,modelsStorePath:join(directory,'models-store'),refreshOnCreate:false,allowModelNetwork:false});
  const model={id:'synthetic',name:'Synthetic',api:'openai-codex-responses',provider:'synthetic',baseUrl,reasoning:true,input:['text'],contextWindow:100000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  runtime.registerProvider('synthetic',{api:model.api,baseUrl,apiKey:token,models:[model]});
  const manager=SessionManager.inMemory(directory);
  const loader={getExtensions:()=>({extensions:[],errors:[],runtime:createExtensionRuntime()}),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>'Synthetic test only.',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{}};
  ({session}=await createAgentSession({cwd:directory,agentDir:directory,model,modelRuntime:runtime,resourceLoader:loader,sessionManager:manager,noTools:true,settingsManager:SettingsManager.inMemory({transport,httpIdleTimeoutMs:2000,compaction:{reserveTokens:4096,keepRecentTokens:1},retry:{enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:1}})}));
  manager.appendMessage({role:'user',content:'Synthetic question',timestamp:1});
  const previous=fauxAssistantMessage('Synthetic prior reply');
  const inputTokens=automatic ? 96000 : 100;
  manager.appendMessage({...previous,api:model.api,provider:model.provider,model:model.id,usage:{...previous.usage,input:inputTokens,totalTokens:inputTokens}});
  session.agent.state.messages=manager.buildSessionContext().messages;
  if(automatic)await session.prompt('Continue the synthetic conversation'); else await session.compact();
  const entries=manager.getEntries().filter(entry=>entry.type==='compaction');
  assert.equal(entries.length,1); assert(entries[0].summary.includes(text));
  assert.equal(http,automatic&&transport==='sse'?2:1);
  assert.equal(websocket,transport==='sse'?0:automatic?2:1);
  console.log(JSON.stringify({automatic,transport,http,websocket,compactions:entries.length,result:'passed'}));
 } finally {
  session?.dispose(); closeOpenAICodexWebSocketSessions();
  for(const socket of sockets.clients)socket.terminate();
  await new Promise(resolve=>sockets.close(resolve)); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  rmSync(directory,{recursive:true,force:true});
 }
}
