import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAnsi, ansiTokens, escapeTokens } from '../src/ansi.js';

// Behavioral / Active / Blackbox / Atomic; ECMA-48 SGR interpretation and removal of other sequences.
const E = '\x1b';
const run = text => ansiTokens(text).map(token => [token.cls, token.text]);
const plain = text => ansiTokens(text).map(token => token.text).join('');

test('colours, weights and resets become classes on the following text', () => {
  assert.deepEqual(run(`a${E}[31mred${E}[1mbold${E}[0m plain`), [['', 'a'], ['ansi-fg-1', 'red'], ['ansi-bold ansi-fg-1', 'bold'], ['', ' plain']]);
  assert.deepEqual(run(`${E}[1;4;32mx${E}[22my${E}[24;39mz`), [['ansi-bold ansi-underline ansi-fg-2', 'x'], ['ansi-underline ansi-fg-2', 'y'], ['', 'z']]);
  assert.deepEqual(run(`${E}[2;3mx${E}[23my${E}[mz`), [['ansi-dim ansi-italic', 'x'], ['ansi-dim', 'y'], ['', 'z']]);
  assert.deepEqual(run(`${E}[97;41m FAILED ${E}[49m.`), [['ansi-fg-15 ansi-bg-1', ' FAILED '], ['ansi-fg-15', '.']]);
  assert.deepEqual(run(`${E}[90mgrey${E}[104mx`), [['ansi-fg-8', 'grey'], ['ansi-fg-8 ansi-bg-12', 'x']]);
  assert.deepEqual(run(`${E}[;31mx`), [['ansi-fg-1', 'x']], 'an empty parameter is a reset');
});

test('palette colours below 16 are kept; other extended colours select the default colour', () => {
  assert.deepEqual(run(`${E}[38;5;2mx${E}[38;5;11my${E}[48;5;1mz`), [['ansi-fg-2', 'x'], ['ansi-fg-11', 'y'], ['ansi-fg-11 ansi-bg-1', 'z']]);
  assert.deepEqual(run(`${E}[31m${E}[38;5;208mx`), [['', 'x']]);
  assert.deepEqual(run(`${E}[31m${E}[38;2;255;100;0;1mx`), [['ansi-bold', 'x']], 'the three colour operands are consumed, the next code applies');
  assert.deepEqual(run(`${E}[31m${E}[38:2::255:100:0;4mx`), [['ansi-underline', 'x']]);
  assert.deepEqual(run(`${E}[1;38mx`), [['ansi-bold', 'x']], 'a truncated extended colour changes nothing after it');
});

test('other sequences are removed and leave the colour state alone', () => {
  assert.equal(plain(`${E}[2K${E}[1Gline${E}[?25h${E}[10;20H`), 'line');
  assert.equal(plain(`${E}]0;window title\x07text`), 'text');
  assert.equal(plain(`${E}]8;;https://example.org${E}\\link${E}]8;;${E}\\ after`), 'link after');
  assert.equal(plain(`${E}(Bascii${E}=${E}>${E}7${E}8`), 'ascii');
  assert.equal(plain(`lone ${E}`), 'lone ');
  assert.deepEqual(run(`${E}[31ma${E}[2Kb`), [['ansi-fg-1', 'a'], ['ansi-fg-1', 'b']]);
  assert.deepEqual(run(`${E}[31 qx`), [['', 'x']], 'a CSI with intermediates is not SGR');
});

test('an unterminated title sequence never swallows more than its line', () => {
  assert.equal(plain(`${E}]0;no terminator\nnext line\n`), '\nnext line\n');
});

test('line feeds stay in the text, so rendered lines match the lines of the file', () => {
  const text = `${E}[32mok${E}[0m one\n${E}[31mtwo\nthree${E}[0m\n`;
  assert.equal(plain(text), 'ok one\ntwo\nthree\n');
  assert.equal(plain(text).split('\n').length, text.split('\n').length);
});

test('detection and the raw view: every ESC is its own token and the text is unchanged', () => {
  assert.equal(hasAnsi('no escapes [31m here'), false);
  assert.equal(hasAnsi(`${E}[31m`), true);
  const text = `${E}[1mbold${E}[0m and ${E}`;
  const tokens = escapeTokens(text);
  assert.equal(tokens.map(token => token.text).join(''), text);
  assert.deepEqual(tokens.filter(token => token.cls === 'ctl-esc').map(token => token.text), [E, E, E]);
  assert.deepEqual(escapeTokens('plain'), [{ cls: '', text: 'plain' }]);
  assert.deepEqual(escapeTokens(''), []);
});
