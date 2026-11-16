import * as api from '../../generated/typescript/haystack/api/index.js';
import {BaboonCodecContext} from '../../generated/typescript/BaboonSharedRuntime.js';
import {object, PROTOCOL} from './core.ts';
import {isLosslessNumber} from '../../web/src/lossless-json.ts';
export {api};
export interface Codec<T> {encode(context: BaboonCodecContext,value:T):unknown;decode(context:BaboonCodecContext,json:unknown):T}
export type Schema = 'str'|'i32'|'f64'|'i64'|'bit'|{readonly optional:Schema}|{readonly list:Schema}|{readonly shape:Readonly<Record<string,Schema>>}|{readonly enum:readonly string[]};
const optional=(s:Schema):Schema=>({optional:s});const list=(s:Schema):Schema=>({list:s});const shape=(s:Readonly<Record<string,Schema>>):Schema=>({shape:s});
const metadata=shape({createdAt:'str',createdBy:'str',modifiedAt:'str',modifiedBy:'str'});
const document=shape({json:'str'});
const span=shape({message:'str',start:'i32',end:'i32'});
const sort=shape({field:{enum:['key','title','project','type','status','importance','human-attention','modified-at','revision']},direction:{enum:['asc','desc']}});
const mode:Schema={enum:['Lexical','Semantic','Hybrid']};
export const failureSchema=shape({code:'str',message:'str',spans:list(span),currentRevision:optional('i32')});
export const liveSchema=shape({kind:{enum:['ping','pong','changed']},key:optional('str'),revision:optional('i32'),nonce:optional('str'),clientTs:optional('f64'),serverTs:optional('f64')});
export const identitySchema=shape({userId:'str',userType:{enum:['human','agent']},tokenId:'str',activityProjectId:'str'});
export const itemSchema=shape({key:'str',revision:'i32',document,metadata});
const summary=shape({key:'str',project:'str',item:'str',revision:'i32',title:'str',docType:'str',status:'str',importance:'str',humanAttention:'str',tags:list('str'),modifiedAt:'str',modifiedBy:'str'});
export const accountUserSchema=shape({id:'str',login:'str',displayName:'str',actor:'str'});
const token=shape({id:'str',name:'str',source:{enum:['configured','issued']},createdAt:optional('str'),revoked:'bit',scopes:list('str')});
export const accountSchema=shape({user:accountUserSchema,tokens:list(token),scopes:list('str')});
export const issueSchema=shape({token,secret:'str'});
export const loginSchema=shape({user:accountUserSchema});
export const ackSchema=shape({ok:'bit'});
function exactInteger(value: unknown): bigint|undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : undefined;
  if (!isLosslessNumber(value)) return undefined;
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value.value);
  if (match === null) return undefined;
  let digits = (match[2]! + (match[3] ?? '')).replace(/^0+/, '');
  if (digits === '') return 0n;
  const scale = (match[3] ?? '').length - Number(match[4] ?? '0');
  if (!Number.isSafeInteger(scale)) return undefined;
  if (scale > 0) {
    if (scale >= digits.length || !/^0*$/.test(digits.slice(-scale))) return undefined;
    digits = digits.slice(0, -scale);
  } else if (scale < 0) {
    if (digits.length - scale > 19) return undefined;
    digits += '0'.repeat(-scale);
  }
  if (digits.length > 19) return undefined;
  return BigInt(match[1]! + digits);
}
export function check(schema:Schema,value:unknown):boolean {
  if(typeof schema==='string') {
    if(schema==='str')return typeof value==='string';if(schema==='bit')return typeof value==='boolean';
    if(schema==='i32'){const n=exactInteger(value);return n!==undefined&&n>=-2147483648n&&n<=2147483647n;}
    if(schema==='f64')return (typeof value==='number'||isLosslessNumber(value))&&Number.isFinite(Number(isLosslessNumber(value)?value.value:value));
    if(schema==='i64'){
      try {const n=typeof value==='string'&&/^-?(0|[1-9][0-9]*)$/.test(value)?BigInt(value):exactInteger(value);return n!==undefined&&n>=-9223372036854775808n&&n<=9223372036854775807n;}catch{return false;}
    }
    return false;
  }
  if('optional'in schema)return value===undefined||value===null||check(schema.optional,value);
  if('list'in schema)return Array.isArray(value)&&value.every(v=>check(schema.list,v));
  if('enum'in schema)return typeof value==='string'&&schema.enum.includes(value);
  return object(value)&&Object.keys(value).every(k=>Object.hasOwn(schema.shape,k))&&Object.entries(schema.shape).every(([k,s])=>check(s,value[k]));
}
export function materialize(schema:Schema,value:unknown):unknown {
  if(typeof schema==='string') {
    if(schema==='i32'||schema==='f64')return Number(isLosslessNumber(value)?value.value:value);
    if(schema==='i64')return typeof value==='string'?value:exactInteger(value)!.toString();
    return value;
  }
  if('optional'in schema)return value===undefined||value===null?value:materialize(schema.optional,value);
  if('list'in schema)return(value as unknown[]).map(v=>materialize(schema.list,v));
  if('enum'in schema)return value;
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([name,child])=>[name,materialize(schema.shape[name]!,child)]));
}
interface Descriptor<T,U> {readonly path:string;readonly request:Codec<T>;readonly input:Schema;readonly response:Codec<U>;readonly output:Schema}
function route<T,U>(path:string,request:Codec<T>,input:Schema,response:Codec<U>,output:Schema):Descriptor<T,U>{return{path,request,input,response,output};}
export const routes = {
  get:route('/api/v1/get',api.GetRequest.jsonCodec(),shape({key:'str',revision:optional('i32')}),api.Item.jsonCodec(),itemSchema),
  put:route('/api/v1/put',api.PutRequest.jsonCodec(),shape({key:'str',document,expectedRevision:'i32',requestId:'str'}),api.PutResult.jsonCodec(),shape({key:'str',revision:'i32',metadata,replayed:'bit'})),
  search:route('/api/v1/search',api.SearchRequest.jsonCodec(),shape({query:'str',project:optional('str'),limit:'i32',cursor:optional('str'),sort}),api.SearchResult.jsonCodec(),shape({items:list(summary),cursor:optional('str')})),
  history:route('/api/v1/history',api.HistoryRequest.jsonCodec(),shape({key:'str'}),api.HistoryResult.jsonCodec(),shape({revisions:list(shape({revision:'i32',modifiedAt:'str',modifiedBy:'str',tokenId:'str'}))})),
  analyze:route('/api/v1/query/analyze',api.QueryRequest.jsonCodec(),shape({query:'str',caret:'i32'}),api.AnalyzeResult.jsonCodec(),shape({valid:'bit',spans:list(span)})),
  complete:route('/api/v1/complete',api.QueryRequest.jsonCodec(),shape({query:'str',caret:'i32'}),api.CompletionResult.jsonCodec(),shape({suggestions:list('str')})),
  values:route('/api/v1/values',api.ValuesRequest.jsonCodec(),shape({field:'str'}),api.ValuesResult.jsonCodec(),shape({values:list('str')})),
  retrieve:route('/api/v1/retrieve',api.RetrieveRequest.jsonCodec(),shape({query:'str',mode,project:optional('str'),includeArchived:'bit',offset:'i32',limit:'i32'}),api.RetrieveResult.jsonCodec(),shape({sources:list(shape({key:'str',revision:'i32',pointer:'str',text:'str',score:'f64',generation:'str',profile:optional('str'),embeddingSpace:optional('str'),policy:'str',field:'str',start:optional('i32'),end:optional('i32')})),mode,countScope:{enum:['ExactMatches','CandidateWindow']},total:'i64',rankingLimit:optional('i32')})),
};
export type Operation=keyof typeof routes;
export const context=BaboonCodecContext.Default;
export function encode<T>(codec:Codec<T>,value:T):unknown{return codec.encode(context,value);}
export function decode<T>(codec:Codec<T>,value:unknown):T{return codec.decode(context,value);}
export function versions(value:unknown):boolean {return object(value)&&value.current===PROTOCOL&&value.minimum===PROTOCOL&&Array.isArray(value.supported)&&value.supported.length===1&&value.supported[0]===PROTOCOL&&Object.keys(value).length===3;}
