// Specified, Behavioral-Active / Blackbox / Atomic: the untrusted-to-player data boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAsciicast } from '../src/asciicast.js';

const v2 = {version: 2, width: 80, height: 24};
const v3 = {version: 3, term: {cols: 100, rows: 30}};
const output = [0, 'o', '\u001b[32mfirst\u001b[0m\r\n'];
const cast = (header, ...events) => [header, ...events].map(item => JSON.stringify(item)).join('\n');

test('v2 timings stay absolute and v3 timings stay relative, including unknown events and exit', () => {
  const resize = [2, 'r', '90x30'];
  const second = [1, 'o', 'next'];
  assert.deepEqual(parseAsciicast(cast(v2, output, resize, [3, 'o', 'next'])), [v2, output, resize, [3, 'o', 'next']]);
  const delta = cast(v3, output, resize, [1, 'future', {ignored: true}], second, [2, 'x', '0']);
  const commented = delta.replace('\n', '\n# generated sample\n\n').replaceAll('\n', '\r\n');
  assert.deepEqual(parseAsciicast(commented), [v3, output, resize, [1, 'x', ''], second, [2, 'x', '']]);
});

test('replay sees only display data and a valid idle limit, not captured input or recording options', () => {
  const header = {...v2, title: 'sample', idle_time_limit: 2, audioUrl: 'https://unused.invalid', command: 'echo sample'};
  assert.deepEqual(parseAsciicast(cast(header, output, [1, 'i', 'typed'], [2, 'm', 'part two'])),
    [{...v2, idle_time_limit: 2}, output, [1, 'x', ''], [2, 'm', 'part two']]);
  assert.deepEqual(parseAsciicast(cast({...v2, width: 0, height: 0}, output)), [v2, output]);
});

test('malformed or unsupported files fail without leaking input text into diagnostics', () => {
  const invalid = 'not JSON';
  assert.throws(() => parseAsciicast(cast(v2, output) + '\n' + invalid), {message:'Invalid terminal recording on line 3.'});
  assert.throws(() => parseAsciicast(cast({version: 1}, output)), /v2 and v3/);
  assert.throws(() => parseAsciicast(cast({version: 3}, output)), /terminal size on line 1/);
  assert.throws(() => parseAsciicast(cast(v2, [0, 'o', []])), /event data on line 2/);
  assert.throws(() => parseAsciicast(cast(v3, [0, 'x', '0'])), /no output/);
});

test('initial and resized terminal dimensions are both bounded', () => {
  assert.throws(() => parseAsciicast(cast({...v2, width: 65536}, output)), /size on line 1 exceeds/);
  assert.throws(() => parseAsciicast(cast(v3, output, [1, 'r', '512x256'])), /size on line 3 exceeds/);
  assert.throws(() => parseAsciicast(cast(v2, output, [1, 'r', '0x24'])), /Invalid terminal size on line 3/);
});

test('the complete timeline must fit player timers and v2 times must not go backwards', () => {
  assert.throws(() => parseAsciicast(cast(v2, output, [2, 'o', 'next'], [1, 'm', ''])), /event time on line 4/);
  assert.throws(() => parseAsciicast(cast(v3, output, [-1, 'm', ''])), /event time on line 3/);
  assert.throws(() => parseAsciicast(cast(v3, output, [2_000_000, 'm', ''], [200_000, 'x', '0'])), /duration exceeds/);
  assert.throws(() => parseAsciicast(cast(v2, output) + '\n[1e309,"o","past range"]'), /event time on line 3/);
});

test('event, marker and resize counts are bounded independently of the byte limit', () => {
  const prefix = cast(v3, output);
  assert.throws(() => parseAsciicast(prefix + '\n[0,"x","0"]'.repeat(50_000)), /50,000 event preview limit/);
  assert.throws(() => parseAsciicast(prefix + '\n[0,"m",""]'.repeat(1001)), /too many markers/);
  assert.throws(() => parseAsciicast(prefix + '\n[0,"r","80x24"]'.repeat(1001)), /too many resizes/);
});
