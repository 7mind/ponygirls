// Behavioral-Active Blackbox-Atomic: specified safe presentation grammar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inlineParts, messageBlocks } from '../src/message-format.ts';

test('fenced code retains exact Unicode, indentation and trailing newlines for copying', () => {
  assert.deepEqual(messageBlocks('Intro\n\n```ts\n  const x = "猫🦄";\n\n```\nAfter'), [
    { kind: 'text', text: 'Intro\n\n' }, { kind: 'code', text: '  const x = "猫🦄";\n\n', language: 'ts' }, { kind: 'text', text: 'After' },
  ]);
});
test('fences support tilde, CRLF and longer outer delimiters, not inner shorter fences', () => {
  assert.deepEqual(messageBlocks('~~~~json\r\n```\r\n~~~\r\n~~~~'), [{ kind: 'code', text: '```\r\n~~~\r\n', language: 'json' }]);
  assert.deepEqual(messageBlocks('````md\n```ts\nx\n```\n````\n'), [{ kind: 'code', text: '```ts\nx\n```\n', language: 'md' }]);
});
test('incomplete fences and raw HTML remain literal text', () => {
  for (const text of ['', '```ts\nunclosed', '<script>alert(1)</script>', '[link](javascript:alert(1))', '```a`b\nx\n```']) assert.deepEqual(messageBlocks(text), [{ kind: 'text', text }]);
});
test('adjacent code blocks and plain text are not joined or reformatted', () => {
  assert.deepEqual(messageBlocks('```\na\n```\n~~~py\nb\n~~~\n'), [{ kind: 'code', text: 'a\n', language: '' }, { kind: 'code', text: 'b\n', language: 'py' }]);
});
test('operators and incomplete delimiter runs stay literal', () => {
  for (const text of ['2 * 3 * 4', '```ts', '``', '** spaced **', 'a*b*c']) assert.deepEqual(inlineParts(text), [{ kind: 'text', text }]);
});
test('inline code is opaque to surrounding emphasis parsing', () => {
  assert.deepEqual(inlineParts('*`*`'), [{ kind: 'text', text: '*' }, { kind: 'code', text: '*' }]);
  assert.deepEqual(inlineParts('*Use `*` as wildcard*'), [{ kind: 'text', text: '*Use ' }, { kind: 'code', text: '*' }, { kind: 'text', text: ' as wildcard*' }]);
});
test('untrusted delimiter and whitespace runs finish within a subprocess deadline', () => {
  const module = new URL('../src/message-format.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', `import { messageBlocks, inlineParts } from ${JSON.stringify(module)}; for (const text of [String.fromCharCode(96).repeat(300000) + 'x', '\\n'.repeat(300000)]) { messageBlocks(text); inlineParts(text); }`], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
test('inline formatting never interprets HTML or links', () => {
  assert.deepEqual(inlineParts('A **bold** *italic* `猫🦄` <b>literal</b>'), [
    { kind: 'text', text: 'A ' }, { kind: 'strong', text: 'bold' }, { kind: 'text', text: ' ' }, { kind: 'emphasis', text: 'italic' }, { kind: 'text', text: ' ' }, { kind: 'code', text: '猫🦄' }, { kind: 'text', text: ' <b>literal</b>' },
  ]);
  assert.deepEqual(inlineParts('plain\n[link](javascript:alert(1))'), [{ kind: 'text', text: 'plain\n[link](javascript:alert(1))' }]);
});
