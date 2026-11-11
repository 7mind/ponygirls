// Specified Behavioral-Active / Blackbox-Atomic parser and editing contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { parseExpression, serializeExpression, completeExpression, acceptCompletion, QUERY_LIMIT } from '../../web/dashboard/current-protocol.js';
const defaults = {q:'',mode:'catalogue',visibility:null,itemState:null,includeExpired:false,kind:null,createdByUser:null,sort:'created_at',direction:'desc',tags:[],hostname:null,projectPath:null};
test('expression defaults, metadata and raw retrieval phrases', () => {
  assert.deepEqual(parseExpression(''), defaults);
  assert.deepEqual(parseExpression('Access:public state:ready expired:true sort:name direction:asc "two  words"'), {...defaults,q:'two  words',visibility:'public',itemState:'ready',includeExpired:true,sort:'name',direction:'asc'});
  assert.deepEqual(parseExpression('mode:lexical kind:dir owner:"A B" "two  words" OR -third'), {...defaults,mode:'lexical',kind:'dir',createdByUser:'A B',q:'"two  words" OR -third'});
  assert.equal(parseExpression('text:"a:b \\"x\\""').q, 'a:b "x"');
});
test('invalid expressions never fall back to bare search', () => {
  for (const query of ['access:PUBLIC','access:public access:internal','unknown:a','"unfinished','text:"\\q"','a"b"','a:b:c','text:x bare','kind:file','owner:me','mode:semantic','mode:lexical x state:ready','mode:lexical x expired:false','mode:lexical x sort:name','mode:lexical x direction:desc','x'.repeat(4097),'\ud800','text:"\\ud800"']) {
    assert.throws(() => parseExpression(query), undefined, query);
  }
});
test('serializer round trips exact literal text including Unicode and escaping', () => {
  const reordered = Object.fromEntries(Object.entries({...defaults,q:'literal'}).reverse());
  assert.deepEqual(parseExpression(serializeExpression(reordered)),{...defaults,q:'literal'});
  for (const mode of ['catalogue','lexical','semantic','hybrid']) for (const q of ['two  words','a:b "x"\\',' OR -not (word) ','🦄\nline']) {
    const value = {...defaults,mode,q,visibility:'external',...(mode === 'catalogue' ? {itemState:'ready',sort:'name',direction:'asc',includeExpired:true} : {kind:'dir',createdByUser:'A:B "C"'})};
    assert.deepEqual(parseExpression(serializeExpression(value)),value);
  }
});
test('completion replaces touched token including suffix and restores scalar-safe caret', () => {
  const query = 'text:"kept  literal" aczzz:pubzzz sort:name';
  const field = completeExpression(query, query.indexOf('zzz')) .find(h => h.label === 'access:');
  assert.ok(field);
  const accepted = acceptCompletion(query, field);
  assert.equal(accepted.expression, 'text:"kept  literal" access:pubzzz sort:name');
  const hint = completeExpression(accepted.expression, accepted.caret).find(h => h.label === 'public');
  assert.ok(hint);
  const result = acceptCompletion(accepted.expression,hint);
  assert.equal(result.expression,'text:"kept  literal" access:public sort:name');
  assert.equal(result.caret, result.expression.indexOf(' sort:name'));
  assert.deepEqual(completeExpression('🦄',1),[]);
  assert.deepEqual(completeExpression('text:"hello world"',10),[]);
  assert.throws(() => acceptCompletion('🦄',{start:1,end:2,insertText:'a',caret:1}));
});
test('closed values, mode applicability, and completed token boundaries guide hints', () => {
  assert.deepEqual(completeExpression('access:p',8).map(h=>h.label),['public']);
  assert.equal(completeExpression('mode:lexical x ',15).some(h=>h.label==='state:'),false);
  assert.equal(completeExpression('access:public ',14).some(h=>h.label==='access:'),false);
  assert.ok(completeExpression('ac',2).some(h=>h.label==='access:'));
  assert.deepEqual(completeExpression('text:"unfinished',16),[]);
  assert.deepEqual(completeExpression('text:x',-1),[]);
});

test('shared Python/browser expression contract fixtures', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../fixtures/query-expressions.json',import.meta.url),'utf8'));
  for (const fixture of fixtures) {
    if (fixture.error) assert.throws(()=>parseExpression(fixture.query),undefined,fixture.name);
    else assert.deepEqual(parseExpression(fixture.query),fixture.expected,fixture.name);
  }
});


test('explicit metadata is exact, repeatable tags conjoin in all modes and round trip', () => {
  for (const mode of ['catalogue','lexical','semantic','hybrid']) {
    const expression = `mode:${mode} tag:Alpha tag:" alpha " hostname:"HOST.Example" project:" /work/A " text:needle`;
    const state = {...defaults,mode,q:'needle',tags:['Alpha',' alpha '],hostname:'HOST.Example',projectPath:' /work/A '};
    assert.deepEqual(parseExpression(expression),state);
    assert.deepEqual(parseExpression(serializeExpression(state)),state);
    for (const field of ['tag:','hostname:','project:']) assert(completeExpression(`mode:${mode} text:needle `,`mode:${mode} text:needle `.length).some(h=>h.label===field));
  }
  assert(completeExpression('tag:one ',8).some(h=>h.label==='tag:'), 'repeatable tag remains available');
  for (const [expression,message] of [
    ['tag:a tag:a','Duplicate tag; specify each tag once.'],
    [Array.from({length:33},(_,i)=>'tag:t'+i).join(' '),'At most 32 tags are allowed.'],
    ['tag:" "','Tag must be nonblank and at most 128 Unicode scalar values.'],
    ['tag:'+ '🦄'.repeat(129),'Tag must be nonblank and at most 128 Unicode scalar values.'],
    ['hostname:" "','Hostname must be nonblank and at most 253 Unicode scalar values.'],
    ['hostname:'+ '🦄'.repeat(254),'Hostname must be nonblank and at most 253 Unicode scalar values.'],
    ['project:" "','Project path must be nonblank and at most 4096 Unicode scalar values.']
  ]) assert.throws(()=>parseExpression(expression),error=>error.message===message,expression);
  assert.equal(parseExpression('tag:'+'🦄'.repeat(128)).tags[0].length,256);
  assert.equal(parseExpression('hostname:'+'🦄'.repeat(253)).hostname.length,506);
});


test('maximum metadata and text round trip independently without exhausting expression budget', () => {
  const tags=Array.from({length:32},(_,i)=>'🦄'.repeat(126)+String.fromCharCode(65+i)+' ');
  for(const mode of ['catalogue','lexical','semantic','hybrid']) {
    const state={...defaults,mode,tags,hostname:'🦄'.repeat(252)+' ',projectPath:'🦄'.repeat(4095)+' ',q:'x'.repeat(4096)};
    const encoded=serializeExpression(state);
    assert.deepEqual(parseExpression(encoded),state);
    const draft='text:'+JSON.stringify(state.q)+' ';
    const hint=completeExpression(draft+'proj',draft.length+4).find(h=>h.label==='project:');
    assert(hint,'large expressions still offer metadata fields');
    assert.equal(acceptCompletion(draft+'proj',hint).expression,draft+'project:');
  }
  const escaped={...defaults,tags:Array.from({length:32},(_,i)=>'\0'.repeat(126)+String.fromCharCode(65+i)+' '),hostname:'\0'.repeat(252)+' ',projectPath:'\0'.repeat(4095)+' ',q:'\0'.repeat(4095)+' '};
  for(const mode of ['catalogue','lexical','semantic','hybrid']) {
    const state={...escaped,mode};
    assert.deepEqual(parseExpression(serializeExpression(state)),state,'escaped maximum metadata and text remain representable');
  }
  for(const mode of ['lexical','semantic','hybrid']) {
    assert.equal(parseExpression(`mode:${mode} `+JSON.stringify('x'.repeat(4094))).q.length,4096);
    assert.throws(()=>parseExpression(`mode:${mode} `+JSON.stringify('x'.repeat(4095))),error=>error.message==='Search text exceeds 4096 UTF-16 code units.');
  }
  assert.deepEqual(parseExpression(' '.repeat(QUERY_LIMIT)),defaults);
  assert.throws(()=>parseExpression(' '.repeat(QUERY_LIMIT+1)),error=>error.message===`Query exceeds ${QUERY_LIMIT} UTF-16 code units.`);
  for(const mode of ['catalogue','lexical','semantic','hybrid']) assert.throws(()=>parseExpression(`mode:${mode} text:`+JSON.stringify('x'.repeat(4097))),error=>error.message==='Search text exceeds 4096 UTF-16 code units.');
});
