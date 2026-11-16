// Specified Behavioral/Blackbox/Group: sole-current codecs and exact-number boundary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {envelope,parseDocument,key,safe,uuidv7} from '../dist/cli/src/core.js';
import {api,encode,decode,check,materialize,routes,identitySchema,versions} from '../dist/cli/src/protocol.js';
test('lossless envelope numbers never coerce to string-typed identity fields',()=>{
 const value=envelope('{"userId":9007199254740993,"total":9223372036854775807}');
 assert.equal(check(identitySchema,{...value,userType:'agent',tokenId:'t',activityProjectId:'p'}),false);
});
test('generated codecs retain full i64 range and reject overflow or noninteger total',()=>{
 for(const raw of ['9223372036854775807','-9223372036854775808']){const value=envelope(`{"sources":[],"mode":"Lexical","countScope":"ExactMatches","total":${raw},"rankingLimit":null}`);assert.equal(check(routes.retrieve.output,value),true);const decoded=decode(api.RetrieveResult.jsonCodec(),materialize(routes.retrieve.output,value));assert.equal(decoded.total,BigInt(raw));assert.equal(encode(api.RetrieveResult.jsonCodec(),decoded).total,raw);}
 for(const raw of ['9223372036854775808','1.1']){assert.equal(check(routes.retrieve.output,envelope(`{"sources":[],"mode":"Lexical","countScope":"ExactMatches","total":${raw},"rankingLimit":null}`)),false);}
});
test('version discovery requires exactly sole current, not removed or future coexistence',()=>{
 assert.equal(versions({current:'1.0.0',minimum:'1.0.0',supported:['1.0.0']}),true);
 for(const v of ['0.9.0','9.0.0']){assert.equal(versions({current:v,minimum:v,supported:[v]}),false);assert.equal(versions({current:'1.0.0',minimum:'1.0.0',supported:['1.0.0',v]}),false);}
});
test('UUIDv7 and canonical Unicode/percent identities never silently normalize',()=>{
 assert.match(uuidv7(),/^[0-9a-f-]{14}7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(key('a%3Ab:caf%C3%A9'),'a%3Ab:caf%C3%A9');
 for(const v of ['a:b:c','a%3ab:c','a:%41','a:%00','a:%FF','a:'])assert.throws(()=>key(v));
 assert.equal(safe('\x1b\x9b\r\n\u202e'),String.raw`\u{1b}\u{9b}\u{d}\u{a}\u{202e}`);
});
test('i32 validates exact numeric tokens before any binary floating conversion',()=>{
 const common={key:'p:i',document:{json:'{}'},requestId:'0193e8d5-6f5c-7a1b-8c2d-000000000001'};
 for(const raw of ['1.0000000000000001','2147483647.00000001','-0.00000000000000001'])assert.equal(check(routes.put.input,envelope(JSON.stringify(common).slice(0,-1)+`,"expectedRevision":${raw}}`)),false);
});
test('valid documents may omit links and contain broad bounded fields arrays',()=>{
 const doc={title:'t',description:'d',fields:[0],type:'fact',status:'actual',importance:'low','human-attention':'cleared'};
 assert.doesNotThrow(()=>parseDocument(JSON.stringify(doc)));
 assert.doesNotThrow(()=>parseDocument(JSON.stringify({...doc,fields:Array(150000).fill(0),links:[]})));
});
