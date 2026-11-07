/* Strict current boundary around the pinned generated Baboon codecs.
 * No storage, no secret logging, no alternate REST requests or DTO decoders.
 */
import * as p from './current/manure/api/index.js';
import { BaboonCodecContext } from './current/BaboonSharedRuntime.js';
import { schema } from './current-schema.js';
const ctx = BaboonCodecContext.Default;
const version = p.ClientEnvelope.BaboonDomainVersion;
// randomUUID is secure-context-only; explicitly opted-in HTTP hosting still
// has getRandomValues. Never replace correlation UUID generation with Math.random.
export function requestId() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
const bad = () => { throw new Error('bad-response'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validate(type, value) {
  if (type.endsWith(' | None')) { if (value === null) { return; } return validate(type.slice(0,-7),value); }
  if (type.startsWith('list[')) { if (!Array.isArray(value)) { bad(); } value.forEach(v=>validate(type.slice(5,-1),v)); return; }
  if (type === 'str') {
    if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) { bad(); }
    return;
  }
  if (type === 'UUID') { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) { bad(); } return; }
  if (type === 'Int64') {
    if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(value) || BigInt(value) < -(1n<<63n) || BigInt(value) >= (1n<<63n)) { bad(); }
    return;
  }
  if (type === 'Int32') { if (!Number.isInteger(value) || value < -(2**31) || value >= 2**31) { bad(); } return; }
  if (type === 'bool') { if (typeof value !== 'boolean') { bad(); } return; }
  if (type === 'float') { if (typeof value !== 'number' || !Number.isFinite(value)) { bad(); } return; }
  const spec = schema[type];
  if (!spec) { bad(); }
  if (spec.enum) { if (!spec.enum.includes(value)) { bad(); } return; }
  if (!object(value)) { bad(); }
  if (spec.variants) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || !Object.hasOwn(spec.variants,keys[0])) { bad(); }
    return validate(spec.variants[keys[0]],value[keys[0]]);
  }
  const keys = Object.keys(spec.fields);
  if (Object.keys(value).length !== keys.length || keys.some(k=>!Object.hasOwn(value,k))) { bad(); }
  keys.forEach(k=>validate(spec.fields[k],value[k]));
}

// A complete JSON parser, not a duplicate-key regex. JSON.parse's reviver cannot
// see duplicate keys; reject those before generated decoding, including nested.
export function parseStrict(text) {
  let pos = 0;
  function whitespace() { while (pos < text.length && /[\x20\t\r\n]/.test(text[pos])) { pos++; } }
  function string() {
    const start = pos++;
    while (pos < text.length) {
      if (text[pos] === '\\') { pos += 2; }
      else if (text[pos++] === '"') { return JSON.parse(text.slice(start,pos)); }
    }
    bad();
  }
  function value(depth) {
    if (depth > 128) { bad(); }
    whitespace();
    if (text[pos] === '"') { return string(); }
    if (text[pos] === '{') {
      pos++; whitespace(); const result = Object.create(null);
      if (text[pos] === '}') { pos++; return result; }
      while (true) {
        whitespace(); if (text[pos] !== '"') { bad(); }
        const key = string(); if (Object.hasOwn(result,key)) { bad(); }
        whitespace(); if (text[pos++] !== ':') { bad(); }
        result[key] = value(depth+1); whitespace();
        const separator = text[pos++]; if (separator === '}') { return result; } if (separator !== ',') { bad(); }
      }
    }
    if (text[pos] === '[') {
      pos++; whitespace(); const result=[];
      if (text[pos] === ']') { pos++; return result; }
      while (true) {
        result.push(value(depth+1)); whitespace(); const separator=text[pos++];
        if (separator === ']') { return result; } if (separator !== ',') { bad(); }
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(pos));
    if (!token) { bad(); } pos+=token[0].length; return JSON.parse(token[0]);
  }
  try { const result=value(0); whitespace(); if (pos !== text.length) { bad(); } return result; }
  catch (_error) { bad(); }
}

function local(value) {
  if (Array.isArray(value)) { return value.map(local); }
  if (!object(value)) { return value; }
  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  const output = {};
  Object.keys(source).forEach(key => {
    if (key === '$type') { return; }
    let field = source[key];
    if (['kind','visibility','state','principalType','mode','field','countScope','contentMode'].includes(key)) {
      field = field === 'Directory' ? 'dir' : field === 'ManifestPath' ? 'manifestpath' : field === 'CandidateWindow' ? 'candidatewindow' : field === 'ExactMatches' ? 'exactmatches' : field.toLowerCase();
    }
    output[key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase())] = local(field);
  });
  if (value instanceof p.ManifestEntry_File) { output.kind='file'; }
  if (value instanceof p.ManifestEntry_Directory) { output.kind='dir'; }
  return output;
}

export async function request(fetch, descriptor) {
  const [command, expected, project] = descriptor;
  const id = requestId();
  const envelope = new p.ClientEnvelope(id,version,command);
  const wire = p.ClientEnvelope_JsonCodec.instance.encode(ctx,envelope);
  validate('ClientEnvelope',wire);
  const res = await fetch('/api/current',{method:'POST',credentials:'same-origin',
    headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(wire)});
  const text = await res.text();
  if (text.length > 4*1024*1024) { bad(); }
  const json=parseStrict(text);validate('ServerEnvelope',json);
  const result=p.ServerEnvelope_JsonCodec.instance.decode(ctx,json);
  if (result.requestId !== id && !(result.requestId === '00000000-0000-0000-0000-000000000000' && result.result instanceof p.Result_Error && !res.ok)) { bad(); }
  if (result.result instanceof p.Result_Error) {
    const code=result.result.failure.code.replace(/[A-Z]/g,(letter,index)=>(index?'-':'')+letter.toLowerCase());
    const error=new Error(code);error.status=res.status;throw error;
  }
  if (!res.ok || !(result.result instanceof expected)) { bad(); }
  return project(result.result);
}

export const whoami = () => [new p.Command_Whoami(),p.Result_Identity,r=>local(r.principal)];
export const login = token => [new p.Command_Login(token),p.Result_Identity,r=>local(r.principal)];
export const logout = () => [new p.Command_Logout(),p.Result_Ok,()=>({ok:true})];
export const search = (state,limit) => [new p.Command_Search(new p.SearchQuery(
  state.q,p.SearchMode[state.mode[0].toUpperCase()+state.mode.slice(1)],
  new p.SearchFilter(state.visibility ? p.Visibility[state.visibility[0].toUpperCase()+state.visibility.slice(1)] : null,
    state.kind ? p.ArtifactKind[state.kind === 'dir' ? 'Directory' : 'File'] : null,state.createdByUser || null),
  limit,null)),p.Result_SearchResults,r=>local(r.page)];
export const catalogue = (cursor,state,limit) => [new p.Command_ListArtifacts(new p.CatalogueQuery(
  state.q,state.includeExpired,state.visibility ? p.Visibility[state.visibility[0].toUpperCase()+state.visibility.slice(1)] : null,
  state.itemState ? p.ArtifactState[state.itemState[0].toUpperCase()+state.itemState.slice(1)] : null,
  p.CatalogueSort[state.sort.split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join('')],
  state.direction === 'asc' ? p.SortDirection.Asc : p.SortDirection.Desc,limit,cursor)),p.Result_Catalogue,r=>local(r.page)];
export const artifact = id => [new p.Command_GetArtifact(id),p.Result_ArtifactInfo,r=>local(r.artifact)];
export const manifest = id => [new p.Command_GetManifest(id),p.Result_ArtifactManifest,r=>local(r.manifest)];
export const grant = id => [new p.Command_CreateGrant(id),p.Result_GrantCreated,r=>local(r)];
export const remove = id => [new p.Command_DeleteArtifact(id),p.Result_Ok,()=>({ok:true})];
export const access = (id,visibility) => [new p.Command_PatchArtifact(id,new p.ArtifactPatch(null,
  p.Visibility[visibility[0].toUpperCase()+visibility.slice(1)],new p.ExpiryChange_Keep())),p.Result_ArtifactPatched,r=>{
    const value=local(r.artifact);if(r.externalPassword !== null){value.external_password=r.externalPassword;}return value;
  }];
export const rotate = id => [new p.Command_RotateExternalPassword(id),p.Result_PasswordRotated,r=>local(r)];

export const capabilities = () => [new p.Command_GetCapabilities(),p.Result_CapabilityInfo,r=>{
  const value=local(r.capabilities);
  value.search_modes=r.capabilities.searchModes.map(mode=>mode.toLowerCase());
  return value;
}];
export const initUpload = (file,visibility,sha256) => [new p.Command_InitUpload(file.name,p.ArtifactKind.File,
  p.Visibility[visibility[0].toUpperCase()+visibility.slice(1)],null,
  [new p.ManifestEntry_File(file.name,BigInt(file.size),sha256)]),p.Result_UploadInitialized,r=>{
    const value=local(r);value.external_password=r.externalPassword === undefined ? null : r.externalPassword;return value;
  }];
export const finishUpload = id => [new p.Command_FinishUpload(id),p.Result_UploadFinished,r=>local(r)];
export async function putChunk(fetch,id,path,offset,data,sha256,signal) {
  const response=await fetch('/api/current/artifacts/'+id+'/chunks?'+new URLSearchParams({path,offset:String(offset)}),{
    method:'PUT',credentials:'same-origin',signal,
    headers:{Accept:'application/json','Content-Type':'application/octet-stream','X-Chunk-Sha256':sha256},body:data});
  const text=await response.text();
  if(text.length>4*1024*1024) bad();
  const json=parseStrict(text);
  if(!response.ok) {
    validate('ServerEnvelope',json);
    const decoded=p.ServerEnvelope_JsonCodec.instance.decode(ctx,json);
    if(!(decoded.result instanceof p.Result_Error)) bad();
    const error=new Error(decoded.result.failure.code.replace(/[A-Z]/g,(s,i)=>(i?'-':'')+s.toLowerCase()));
    error.status=response.status;throw error;
  }
  validate('ChunkReceipt',json);
  const receipt=p.ChunkReceipt_JsonCodec.instance.decode(ctx,json);
  if(receipt.path!==path || receipt.offset!==BigInt(offset) || receipt.length!==data.size ||
    receipt.receivedBytes<BigInt(offset+data.size)) bad();
}

export const QUERY_LIMIT = 4096;
export const SORTS = Object.freeze(['name', 'kind', 'visibility', 'state', 'total_bytes', 'file_count', 'created_at', 'expires_at', 'created_by_user']);
const FIELDS = Object.freeze({
  mode: {values:['catalogue','lexical','semantic','hybrid'], detail:'Search mode'},
  access: {values:['internal','external','public'], detail:'Artifact access'},
  state: {values:['ready','uploading','publishing'], scope:'catalogue', detail:'Publication state'},
  expired: {values:['true','false'], scope:'catalogue', detail:'Include expired artifacts'},
  kind: {values:['file','dir'], scope:'retrieval', detail:'Artifact kind'},
  owner: {scope:'retrieval', detail:'Exact creator · JSON quotes allowed'},
  sort: {values:SORTS, scope:'catalogue', detail:'Global catalogue sort'},
  direction: {values:['asc','desc'], scope:'catalogue', detail:'Catalogue sort direction'},
  text: {detail:'Exact search text · JSON quotes allowed'}
});
export class ExpressionError extends Error {
  constructor(message, start, end) { super(message); this.name = 'ExpressionError'; this.start = start; this.end = end; }
}
export function scalarBoundary(text, offset) {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length &&
    !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}
function unicode(text, start, end) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (next >= 0xdc00 && next <= 0xdfff) continue;
    } else if (!(code >= 0xdc00 && code <= 0xdfff)) continue;
    throw new ExpressionError('Query must contain valid Unicode scalar values.', start, end);
  }
}
function scan(text, lenient) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/u.test(text[i])) { i++; continue; }
    const start = i;
    let quoted = false, escaped = false;
    while (i < text.length) {
      const char = text[i];
      if (!quoted && /\s/u.test(char)) break;
      if (escaped) escaped = false;
      else if (quoted && char === '\\') escaped = true;
      else if (char === '"') quoted = !quoted;
      i++;
    }
    if (quoted && !lenient) throw new ExpressionError('Use a complete JSON string with valid escapes.', start, i);
    tokens.push({raw:text.slice(start,i), start, end:i, unfinished:quoted});
  }
  return tokens;
}
function valueOf(raw, start, end) {
  if (!raw) throw new ExpressionError('Expected a value immediately after the colon.', start, end);
  let value;
  if (raw.startsWith('"')) {
    try { value = JSON.parse(raw); } catch (_) { throw new ExpressionError('Use a complete JSON string with valid escapes.', start, end); }
  } else {
    if (/[":]/u.test(raw)) throw new ExpressionError('Separate tokens with whitespace; quote literal colons or quotes using a JSON string.', start, end);
    value = raw;
  }
  unicode(value,start,end);
  return value;
}
export function parseExpression(expression) {
  if (expression.length > QUERY_LIMIT) throw new ExpressionError('Query exceeds 4096 UTF-16 code units.', QUERY_LIMIT, expression.length);
  unicode(expression,0,expression.length);
  const values = new Map(), positions = new Map(), bare = [];
  for (const token of scan(expression,false)) {
    const colon = token.raw.startsWith('"') ? -1 : token.raw.indexOf(':');
    if (colon < 0) { bare.push({raw:token.raw,value:valueOf(token.raw,token.start,token.end)}); continue; }
    const field = token.raw.slice(0,colon).toLowerCase();
    if (!Object.hasOwn(FIELDS,field)) throw new ExpressionError('Unknown field; use a supported query field.',token.start,token.start+colon);
    if (values.has(field)) throw new ExpressionError('Duplicate field; specify each field once.',token.start,token.end);
    const value = valueOf(token.raw.slice(colon+1),token.start+colon+1,token.end);
    const spec = FIELDS[field];
    if (spec.values && !spec.values.includes(value)) throw new ExpressionError('Invalid '+field+' value; use '+spec.values.join(', ')+'.',token.start+colon+1,token.end);
    if (field === 'owner' && !value.trim()) throw new ExpressionError('Owner must not be blank.',token.start+colon+1,token.end);
    values.set(field,value); positions.set(field,token);
  }
  const mode = values.get('mode') || 'catalogue';
  for (const [field,token] of positions) {
    const scope = FIELDS[field].scope;
    if (scope === 'catalogue' && mode !== 'catalogue') throw new ExpressionError('Catalogue-only fields cannot be used in retrieval mode.',token.start,token.end);
    if (scope === 'retrieval' && mode === 'catalogue') throw new ExpressionError('Retrieval-only fields require lexical, semantic or hybrid mode.',token.start,token.end);
  }
  if (values.has('text') && bare.length) throw new ExpressionError('text: cannot be combined with bare search terms.',0,expression.length);
  const decoded = values.has('text') ? values.get('text') : bare.map(token=>token.value).join(' ');
  if (mode !== 'catalogue' && !decoded.trim()) throw new ExpressionError('Retrieval mode requires nonblank search text.',expression.length,expression.length);
  const q = values.has('text') || mode === 'catalogue' ? decoded : bare.map(token=>token.raw).join(' ');
  return {q, mode, visibility:values.get('access') ?? null, itemState:values.get('state') ?? null,
    includeExpired:values.get('expired') === 'true', kind:values.get('kind') ?? null,
    createdByUser:values.get('owner') ?? null, sort:values.get('sort') || 'created_at', direction:values.get('direction') || 'desc'};
}
export function serializeExpression(state) {
  const parts = [];
  if (state.mode !== 'catalogue') parts.push('mode:'+state.mode);
  if (state.visibility) parts.push('access:'+state.visibility);
  if (state.mode === 'catalogue') {
    if (state.itemState) parts.push('state:'+state.itemState);
    if (state.includeExpired) parts.push('expired:true');
    if (state.sort !== 'created_at') parts.push('sort:'+state.sort);
    if (state.direction !== 'desc') parts.push('direction:'+state.direction);
  } else {
    if (state.kind) parts.push('kind:'+state.kind);
    if (state.createdByUser) parts.push('owner:'+(/^[^\s":]+$/u.test(state.createdByUser) ? state.createdByUser : JSON.stringify(state.createdByUser)));
  }
  const candidates = state.q ? [state.q, JSON.stringify(state.q), 'text:'+JSON.stringify(state.q)].sort((a,b)=>a.length-b.length) : [''];
  const expected = {...state,visibility:state.visibility || null,itemState:state.itemState || null,kind:state.kind || null,createdByUser:state.createdByUser || null};
  for (const text of candidates) {
    const expression = [...parts,...(text ? [text] : [])].join(' ');
    try { if (JSON.stringify(parseExpression(expression)) === JSON.stringify(expected)) return expression; } catch (_) { /* Try the next lossless literal encoding. */ }
  }
  throw new ExpressionError('Query cannot be represented within the expression limit.',0,0);
}
export function acceptCompletion(expression, hint) {
  if (!scalarBoundary(expression,hint.start) || !scalarBoundary(expression,hint.end) || hint.start > hint.end ||
      typeof hint.insertText !== 'string' || !scalarBoundary(hint.insertText,hint.caret)) throw new Error('Invalid completion edit.');
  const result = expression.slice(0,hint.start)+hint.insertText+expression.slice(hint.end);
  if (result.length > QUERY_LIMIT) throw new Error('Completion exceeds query limit.');
  unicode(result,0,result.length);
  return {expression:result,caret:hint.start+hint.caret};
}
export function completeExpression(expression, caret) {
  if (!scalarBoundary(expression,caret) || expression.length > QUERY_LIMIT) return [];
  try { unicode(expression,0,expression.length); } catch (_) { return []; }
  const tokens = scan(expression,true);
  const token = tokens.find(t=>caret >= t.start && caret <= t.end);
  if (token && (token.unfinished || token.raw.startsWith('"'))) return [];
  const start = token ? token.start : caret, end = token ? token.end : caret;
  const raw = token ? token.raw : '', colon = raw.indexOf(':');
  const modeToken = tokens.find(t=>/^mode:/i.test(t.raw));
  const mode = modeToken ? modeToken.raw.slice(5).replace(/^"|"$/g,'') : 'catalogue';
  const used = new Set(tokens.filter(t=>t!==token && t.raw.includes(':') && !t.raw.startsWith('"')).map(t=>t.raw.split(':')[0].toLowerCase()));
  const hints = [];
  const add = (label,detail,from,to,insertText) => {
    const hint = {label,detail,start:from,end:to,insertText,caret:insertText.length};
    try { acceptCompletion(expression,hint); hints.push(hint); } catch (_) { /* Omit edits that exceed the query boundary. */ }
  };
  if (colon >= 0 && caret > start+colon) {
    const field = raw.slice(0,colon).toLowerCase(), spec = FIELDS[field];
    const prefix = expression.slice(start+colon+1,caret);
    if (!spec || !spec.values || prefix.includes('"') || used.has(field)) return [];
    for (const value of spec.values) if (value.startsWith(prefix) && raw.slice(colon+1) !== value) {
      const separator = end === expression.length ? ' ' : '';
      add(value,spec.detail,start+colon+1,end,value+separator);
    }
  } else {
    const prefix = expression.slice(start,caret).toLowerCase();
    for (const [field,spec] of Object.entries(FIELDS)) {
      if (!field.startsWith(prefix) || used.has(field) || spec.scope === 'catalogue' && mode !== 'catalogue' || spec.scope === 'retrieval' && mode === 'catalogue') continue;
      add(field+':',spec.detail,start,colon >= 0 ? start+colon+1 : end,field+':');
    }
  }
  return hints.slice(0,12);
}
