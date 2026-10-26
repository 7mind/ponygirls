import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addExpressionFilter, splitGlobalMode } from '../src/expression.ts';

test('BA specified: quick filters conjoin the entire opaque Boolean expression', () => {
  assert.equal(addExpressionFilter('A OR B', 'project', 'chronicle'), '(A OR B) AND project:"chronicle"');
  assert.equal(addExpressionFilter('{A OR B} AND NOT tag:"archived"', 'owner', 'alice'), '({A OR B} AND NOT tag:"archived") AND owner:"alice"');
  assert.equal(addExpressionFilter('', 'tag', 'source fidelity'), 'tag:"source fidelity"');
});

test('BA specified: global mode directives stay outside new Boolean groups', () => {
  assert.equal(addExpressionFilter('mode:semantic AND (A OR B)', 'tag', 'review'), 'mode:semantic ((A OR B)) AND tag:"review"');
  assert.equal(addExpressionFilter('A AND mode : lexical AND B', 'tag', 'review'), 'mode : lexical (A AND B) AND tag:"review"');
  assert.equal(addExpressionFilter('(A OR B) mode:hybrid', 'project', 'chronicle'), 'mode:hybrid ((A OR B)) AND project:"chronicle"');
  assert.equal(addExpressionFilter('MODE:Lexical', 'owner', 'alice'), 'MODE:Lexical owner:"alice"');
  assert.equal(addExpressionFilter('(A)mode:lexical{B}', 'tag', 'review'), 'mode:lexical ((A) {B}) AND tag:"review"');
});

test('BA specified: quoted, escaped and nested mode-like values are not directives', () => {
  assert.equal(addExpressionFilter('(tag:"mode:lexical" OR "mode:semantic") mode:hybrid', 'tag', 'review'), 'mode:hybrid ((tag:"mode:lexical" OR "mode:semantic")) AND tag:"review"');
  const quoted = String.raw`(tag:"say \"mode:lexical\"" OR NOT {tag:"mode:hybrid"}) mode:semantic`;
  assert.equal(addExpressionFilter(quoted, 'branch', String.raw`a"b\c`), String.raw`mode:semantic ((tag:"say \"mode:lexical\"" OR NOT {tag:"mode:hybrid"})) AND branch:"a\"b\\c"`);
  assert.equal(addExpressionFilter(String.raw`mode\:lexical OR NOT tag:"mode:hybrid"`, 'tag', 'review'), String.raw`(mode\:lexical OR NOT tag:"mode:hybrid") AND tag:"review"`);
});

test('BA specified: ambiguous unfinished input is not silently rewritten', () => {
  for (const expression of ['(A OR B', 'tag:"unterminated', '{A)', 'A\\']) assert.throws(() => addExpressionFilter(expression, 'tag', 'review'), /Close quotes and groups/);
  assert.throws(() => addExpressionFilter('A', 'tag:injection', 'review'), /Invalid quick-filter attribute/);
  for (const expression of ['mode:lexical AND A OR B', 'A OR B AND mode:lexical', 'A OR B mode:lexical', 'NOT mode:lexical', '(mode:lexical OR A)']) assert.throws(() => addExpressionFilter(expression, 'tag', 'review'), /outer AND directive/);
  assert.throws(() => addExpressionFilter('mode:lexical mode:semantic', 'tag', 'review'), /only one global mode/);
});

interface ModeCase { input: string; valid: boolean; mode?: string; body?: string }
const modeCases = JSON.parse(readFileSync(new URL('../../tests/archive-expression-cases.json', import.meta.url), 'utf8')) as ModeCase[];
test('BG specified: shared server/editor mode fixtures retain global scope and reject invalid directive rewrites', () => {
  for (const item of modeCases) {
    if (!item.valid) { assert.throws(() => addExpressionFilter(item.input, 'tag', 'review'), Error, item.input); continue; }
    const parts = splitGlobalMode(item.input);
    assert.equal(parts.mode, item.mode, item.input);
    const composed = addExpressionFilter(item.input, 'tag', 'review');
    assert.ok(composed.endsWith('tag:"review"'), item.input);
    assert.equal(splitGlobalMode(composed).mode, item.mode, item.input);
  }
});

// Regression: removing a mode's AND must not turn malformed syntax into a different valid query.
test('BA: invalid structural syntax cannot be repaired by directive extraction', () => {
  for (const expression of ['NOT AND mode:lexical A', 'A AND AND mode:lexical B', 'tag:mode:lexical AND A', '(NOT AND A) mode:lexical']) {
    assert.throws(() => addExpressionFilter(expression, 'tag', 'review'), Error, expression);
  }
});
