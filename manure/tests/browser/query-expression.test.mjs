// Specified Behavioral-Active / Blackbox-Atomic parser and editing contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { parseExpression, serializeExpression, completeExpression, acceptCompletion } from '../../web/dashboard/current-protocol.js';
const defaults = {q:'',mode:'catalogue',visibility:null,itemState:null,includeExpired:false,kind:null,createdByUser:null,sort:'created_at',direction:'desc'};
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
