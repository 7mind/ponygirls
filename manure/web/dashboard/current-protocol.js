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
    if (['kind','visibility','state','principalType'].includes(key)) { field = field === 'Directory' ? 'dir' : field.toLowerCase(); }
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
