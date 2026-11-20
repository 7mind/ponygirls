import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLines, tokenLines } from '../src/tokens.js';

// Behavioral / Active / Blackbox / Atomic; the line model shared by every text view.
const joined = lines => lines.map(line => line.map(token => token.text).join('')).join('');

test('lines keep their line feeds, so the joined lines are the text', () => {
  for (const text of ['', 'a', 'a\n', 'a\nb', '\n', '\n\n', 'a\r\nb\r\n', 'a\n\nb\n']) assert.equal(textLines(text).join(''), text, JSON.stringify(text));
  assert.deepEqual(textLines('a\n\nb'), ['a\n', '\n', 'b']);
  assert.deepEqual(textLines('a\r\nb\r\n'), ['a\r\n', 'b\r\n']);
});

test('a token that spans lines is split at each line feed and keeps its classes', () => {
  const tokens = [{ cls: 'k', text: 'def' }, { cls: '', text: ' f():\n    ' }, { cls: 's', text: '"""one\ntwo"""' }, { cls: '', text: '\n\nend' }];
  const lines = tokenLines(tokens);
  assert.deepEqual(lines, [
    [{ cls: 'k', text: 'def' }, { cls: '', text: ' f():\n' }],
    [{ cls: '', text: '    ' }, { cls: 's', text: '"""one\n' }],
    [{ cls: 's', text: 'two"""' }, { cls: '', text: '\n' }],
    [{ cls: '', text: '\n' }],
    [{ cls: '', text: 'end' }],
  ]);
  assert.equal(joined(lines), tokens.map(token => token.text).join(''));
});

test('token lines and text lines agree on the line count', () => {
  for (const text of ['', 'a', 'a\n', '\n', 'a\n\nb', 'a\nb\n']) {
    assert.equal(tokenLines([{ cls: '', text }]).length, textLines(text).length, JSON.stringify(text));
  }
  assert.deepEqual(tokenLines([{ cls: 'x', text: '' }]), []);
});
