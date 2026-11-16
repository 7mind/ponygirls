import {exact,object,parseStoredDocument,safe} from './core.ts';
import {isLosslessNumber,type JsonValue} from '../../web/src/lossless-json.ts';

export interface HumanContext {
  readonly command:string;
  readonly arguments:readonly string[];
  readonly requestId:string|undefined;
}
interface Metadata {readonly createdAt:string;readonly createdBy:string;readonly modifiedAt:string;readonly modifiedBy:string}
interface Item {readonly key:string;readonly revision:number;readonly document:{readonly json:string};readonly metadata:Metadata}
interface Document {readonly title:string;readonly type:string;readonly status:string;readonly importance:string;readonly 'human-attention':string;readonly description:string;readonly fields:JsonValue;readonly links?:readonly (readonly [string,string])[];readonly tags?:readonly string[]}
interface Receipt {readonly key:string;readonly revision:number;readonly replayed:boolean;readonly metadata:Metadata}
interface Identity {readonly userId:string;readonly userType:string;readonly tokenId:string;readonly activityProjectId:string}
interface Versions {readonly current:string;readonly minimum:string;readonly supported:readonly string[]}
interface Summary {readonly key:string;readonly project:string;readonly item:string;readonly revision:number;readonly title:string;readonly docType:string;readonly status:string;readonly importance:string;readonly humanAttention:string;readonly tags:readonly string[];readonly modifiedAt:string;readonly modifiedBy:string}
interface SearchPage {readonly items:readonly Summary[];readonly cursor:string|null}
interface Revision {readonly revision:number;readonly modifiedAt:string;readonly modifiedBy:string;readonly tokenId:string}
interface History {readonly revisions:readonly Revision[]}
interface Span {readonly start:number;readonly end:number;readonly message:string}
interface Analysis {readonly valid:boolean;readonly spans:readonly Span[]}
interface Values {readonly values:readonly string[]}
interface Completions {readonly suggestions:readonly string[]}
interface PendingOperation {readonly key:string;readonly expectedRevision:number;readonly requestId:string;readonly owner:readonly [string,string]}
interface Pending {readonly operations:readonly PendingOperation[];readonly recovery:string}
interface AccountUser {readonly id:string;readonly login:string;readonly displayName:string;readonly actor:string}
interface Token {readonly id:string;readonly name:string;readonly source:string;readonly createdAt:string|null;readonly revoked:boolean;readonly scopes:readonly string[]}
interface Account {readonly user:AccountUser;readonly tokens:readonly Token[];readonly scopes:readonly string[]}
interface Login {readonly user:AccountUser}
interface Status {readonly user:AccountUser;readonly authenticated:boolean;readonly pendingTokenIssue:boolean}
interface IssuedToken {readonly token:Token;readonly secretSaved:boolean}
interface Acknowledged {readonly acknowledged:boolean;readonly warning?:string}
interface RetrievedSource {readonly key:string;readonly revision:number;readonly score:number;readonly pointer:string;readonly text:string;readonly generation:string;readonly profile:string|null;readonly embeddingSpace:string|null;readonly policy:string;readonly field:string;readonly start:number|null;readonly end:number|null}
interface Retrieval {readonly mode:string;readonly countScope:string;readonly total:string;readonly rankingLimit:number|null;readonly sources:readonly RetrievedSource[]}

function metadata(value:Metadata):string[] {
  return [`Created: ${safe(value.createdAt)} by ${safe(value.createdBy)}`,`Modified: ${safe(value.modifiedAt)} by ${safe(value.modifiedBy)}`];
}
function block(label:string,text:string):string[] {return [label+':',...text.split('\n').map(line=>'  '+safe(line))];}
function append(lines:string[],values:readonly string[]):void {for(const value of values)lines.push(value);}
function list(label:string,values:readonly string[],empty:string):string[] {return values.length===0?[label+':',empty]:[label+':',...values.map(value=>'  - '+safe(value))];}
function accountUser(value:AccountUser):string[] {
  return [`Account: ${safe(value.id)}`,`Name: ${safe(value.displayName)}`,`Login: ${safe(value.login)}`,`Actor: ${safe(value.actor)}`];
}
function tokenDetails(value:Token):string[] {
  return [`Name: ${safe(value.name)}`,`Source: ${safe(value.source)}`,`State: ${value.revoked?'revoked':'active'}`,`Created: ${value.createdAt===null?'not reported':safe(value.createdAt)}`,`Scopes: ${value.scopes.length===0?'none':value.scopes.map(safe).join(', ')}`];
}
function tokens(values:readonly Token[]):string[] {
  if(values.length===0)return ['No tokens.'];
  const lines=[`Tokens: ${values.length}`];
  for(const value of values){
    lines.push(`  - ${safe(value.id)} | ${safe(value.name)} | ${safe(value.source)} | ${value.revoked?'revoked':'active'}`);
    lines.push(`    Created: ${value.createdAt===null?'not reported':safe(value.createdAt)}`,`    Scopes: ${value.scopes.length===0?'none':value.scopes.map(safe).join(', ')}`);
  }
  return lines;
}
function item(value:Item):string[] {
  const document=parseStoredDocument(value.document.json) as unknown as Document;
  const lines=[`Item: ${safe(value.key)}`,`Revision: ${value.revision}`,`Title: ${safe(document.title)}`,`Type: ${safe(document.type)}`,`Status: ${safe(document.status)}`,`Attention: ${safe(document['human-attention'])}`,`Importance: ${safe(document.importance)}`,...metadata(value.metadata)];
  append(lines,block('Description',document.description));append(lines,block('Fields (JSON)',exact(document.fields,true)));
  const links=document.links===undefined?[]:document.links;
  if(links.length===0)lines.push('Links: none');
  else {lines.push('Links:');for(const [kind,target] of links)lines.push(`  - ${safe(kind)} -> ${safe(target)}`);}
  const tags=document.tags===undefined?[]:document.tags;
  append(lines,tags.length===0?['Tags: none']:list('Tags',tags,'No tags.'));
  return lines;
}
function pending(value:Pending):string[] {
  if(value.operations.length===0)return ['No pending writes.'];
  const lines=[`Pending writes: ${value.operations.length}`];
  for(const operation of value.operations)lines.push(`Item: ${safe(operation.key)}`,`Expected revision: ${operation.expectedRevision}`,`Request ID: ${safe(operation.requestId)}`,`User: ${safe(operation.owner[0])}`,`Token: ${safe(operation.owner[1])}`);
  lines.push('Recovery: '+safe(value.recovery));return lines;
}
function retrieval(value:Retrieval):string[] {
  const lines=[`Mode: ${safe(value.mode)}`,`${safe(value.countScope)}: ${safe(value.total)}${value.rankingLimit===null?'':` (ranking limit ${value.rankingLimit})`}`];
  if(value.sources.length===0)return [...lines,'No sources.'];
  lines.push(`Sources: ${value.sources.length}`);
  for(const source of value.sources){
    lines.push(`Item: ${safe(source.key)}`,`Revision: ${source.revision}`,`Score: ${source.score}`,`Generation: ${safe(source.generation)}`,`Profile: ${source.profile===null?'not provided':safe(source.profile)}`,`Embedding space: ${source.embeddingSpace===null?'not provided':safe(source.embeddingSpace)}`,`Policy: ${safe(source.policy)}`,`Field: ${safe(source.field)}`,`Pointer: ${safe(source.pointer)}`,`UTF16 span: ${source.start===null||source.end===null?'not provided':`${source.start}..${source.end}`}`);append(lines,block('Text',source.text));
  }
  return lines;
}
function structured(value:unknown,indent:string):string[] {
  if(isLosslessNumber(value))return [indent+value.value];
  if(Array.isArray(value))return value.length===0?[indent+'(empty list)']:value.flatMap(child=>[indent+'-',...structured(child,indent+'  ')]);
  if(object(value))return Object.keys(value).length===0?[indent+'(empty object)']:Object.entries(value).flatMap(([key,child])=>object(child)||Array.isArray(child)?[indent+safe(key)+':',...structured(child,indent+'  ')]:[indent+safe(key)+': '+safe(exact(child,false))]);
  return [indent+safe(exact(value,false))];
}
function lines(context:HumanContext,result:unknown):string[] {
  const command=context.command==='call'?context.arguments[0]:context.command;
  const subject=context.command==='call'?undefined:context.arguments[0];
  if(command==='health')return ['healthy'];
  if(command==='search'){
    const value=result as SearchPage;const out=[`Returned ${value.items.length} summaries (not a total)`];
    for(const summary of value.items){
      out.push(`${safe(summary.key)}  revision ${summary.revision}  ${safe(summary.title)}`,`  Project: ${safe(summary.project)}`,`  Item: ${safe(summary.item)}`,`  Type: ${safe(summary.docType)}`,`  Status: ${safe(summary.status)}`,`  Attention: ${safe(summary.humanAttention)}`,`  Importance: ${safe(summary.importance)}`,`  Modified: ${safe(summary.modifiedAt)} by ${safe(summary.modifiedBy)}`);
      append(out,summary.tags.length===0?['  Tags: none']:list('Tags',summary.tags,'No tags.').map(line=>'  '+line));
    }
    if(typeof value.cursor==='string')out.push('Cursor: '+safe(value.cursor));return out;
  }
  if(command==='whoami'){const value=result as Identity;return [`User: ${safe(value.userId)}`,`Type: ${safe(value.userType)}`,`Token: ${safe(value.tokenId)}`,`Activity project: ${safe(value.activityProjectId)}`];}
  if(command==='versions'){const value=result as Versions;return [`Current API: ${safe(value.current)}`,`Minimum API: ${safe(value.minimum)}`,`Supported APIs: ${value.supported.map(safe).join(', ')}`];}
  if(command==='get')return item(result as Item);
  if(command==='history'){
    const value=result as History;return [`Revision history${subject===undefined?'':': '+safe(subject)}`,...(value.revisions.length===0?['No revisions.']:value.revisions.map(revision=>`  Revision ${revision.revision} | ${safe(revision.modifiedAt)} | by ${safe(revision.modifiedBy)} | token ${safe(revision.tokenId)}`))];
  }
  if(command==='values')return list(`Values${subject===undefined?'':' for '+safe(subject)} (bounded suggestions)`,(result as Values).values,'No values.');
  if(command==='complete')return list('Completions (bounded suggestions)',(result as Completions).suggestions,'No completions.');
  if(command==='analyze'){
    const value=result as Analysis;return [`Query: ${value.valid?'valid':'invalid'}`,...(value.spans.length===0?['No diagnostic spans.']:value.spans.map(span=>`  UTF16 ${span.start}..${span.end}: ${safe(span.message)}`))];
  }
  if(command==='retrieve')return retrieval(result as Retrieval);
  if(command==='pending')return pending(result as Pending);
  const actions:Readonly<Record<string,string>>={put:'Saved',edit:'Updated',archive:'Archived',unarchive:'Unarchived',attention:'Attention updated',restore:'Restored',replay:'Replayed write',reconcile:'Reconciled write'};
  if(command!==undefined&&Object.hasOwn(actions,command)){
    const value=result as Receipt;return [`${actions[command]}: ${safe(value.key)}`,`Revision: ${value.revision}`,`Outcome: ${value.replayed?'replayed original receipt':'committed'}`,...(context.requestId===undefined?[]:['Request ID: '+safe(context.requestId)]),...metadata(value.metadata)];
  }
  if(command==='login'){const value=result as Login;return ['Signed in: '+safe(value.user.displayName),...accountUser(value.user)];}
  if(command==='logout')return ['Signed out. This session was revoked.'];
  if(command==='account'||(command==='token'&&subject==='list')){const value=result as Account;return [...accountUser(value.user),`Scopes: ${value.scopes.length===0?'none':value.scopes.map(safe).join(', ')}`,...tokens(value.tokens)];}
  if(command==='status'){const value=result as Status;return [`Session: ${value.authenticated?'authenticated':'not authenticated'}`,...accountUser(value.user),`Pending token issue: ${value.pendingTokenIssue?'yes':'no'}`];}
  if(command==='token'&&subject==='issue'){const value=result as IssuedToken;return ['Token issued: '+safe(value.token.id),...tokenDetails(value.token),`Secret: ${value.secretSaved?'saved to the requested private file (not displayed)':'not saved'}`];}
  if(command==='token'&&subject==='revoke')return ['Token revoked: '+safe(context.arguments[1]!)];
  if(command==='token'&&subject==='acknowledge'){const value=result as Acknowledged;return value.acknowledged?['Token issue guard: acknowledged',...(value.warning===undefined?[]:['Recovery: '+safe(value.warning)])]:['No uncertain token issue guard.'];}
  return ['Result:',...structured(result,'  ')];
}
export function human(context:HumanContext,result:unknown):string {return lines(context,result).join('\n')+'\n';}
// Preserve the existing human stream frame representation independently of ordinary command views.
export function humanWatch(frame:unknown):string {return exact(frame,true).split('\n').map(safe).join('\n')+'\n';}
