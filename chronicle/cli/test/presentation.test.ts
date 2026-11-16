import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const executable = process.env['CHRONICLE_CLI_EXECUTABLE'];
const moduleUrl = executable === undefined ? new URL('../src/output.js', import.meta.url) : pathToFileURL(resolve(dirname(executable), '../lib/chronicle-cli/dist/cli/src/output.js'));
const { Presentation, useColor }: typeof import('../src/output.js') = await import(moduleUrl.href);
const { CliError }: typeof import('../src/errors.js') = await import(new URL('./errors.js', moduleUrl).href);
// Specified: Behavioral-Active Blackbox-Atomic presentation policy; actual PTY acceptance is separate.
test('automatic colour requires this stream to be a TTY and honours nonempty NO_COLOR and dumb TERM', () => {
  for (const [tty, env, expected] of [
    [false, {}, false], [true, {}, true], [true, { NO_COLOR: '' }, true], [true, { NO_COLOR: '0' }, false], [true, { NO_COLOR: '1' }, false], [true, { TERM: 'dumb' }, false], [true, { TERM: 'tmux-256color' }, true],
  ] as const) assert.equal(useColor('auto', false, tty, env), expected);
  assert.equal(useColor('always', false, false, { NO_COLOR: '1', TERM: 'dumb' }), true);
  assert.equal(useColor('never', false, true, {}), false);
  for (const mode of ['auto', 'always', 'never'] as const) assert.equal(useColor(mode, true, true, {}), false);
});
test('styled presentation changes no data, full provenance, exact i64 or control escaping', () => {
  const value = { Session: { result: { id: '11111111-1111-4111-8111-111111111111', source: { collectorNamespace: 'owned-source', producerSessionId: 'full-source-id' }, total: '9223372036854775807', text: 'hé🙂\u001b]52;attack\u0007\u202e\u009b31m\nline two', 'key\u001b[2J\n\t': null, spans: [{ messageId: 'full-message-id', start: 0, end: 12 }], view: { revision: 3, generationId: null } } } };
  const plain = new Presentation(false).output(value, false); const colored = new Presentation(true).output(value, false);
  assert.match(colored, /\u001b\[/); assert.equal(colored.replace(/\u001b\[[0-9;]*m/g, ''), plain);
  for (const term of ['full-source-id', 'owned-source', 'full-message-id', '9223372036854775807', '\\u001b]52;attack\\u0007\\u202e\\u009b31m', 'key\\u001b[2J\\n\\t']) assert.ok(colored.includes(term), term);
  assert.ok(!colored.includes('\u001b]52')); assert.ok(!colored.includes('\u001b[2J')); assert.ok(!colored.includes('\u202e'));
  const json = new Presentation(true).output(value, true); assert.ok(!json.includes('\u001b')); assert.deepEqual(JSON.parse(json), value);
});
test('help and errors use the same safe palette without interpreting message controls', () => {
  const presentation = new Presentation(true);
  assert.match(presentation.help('Usage: chronicle messages UUID\n\nExamples:\n'), /\u001b\[/);
  const failure = presentation.failure(new CliError('usage', 'safe\u001b]52;attack\u0007'), 'Run chronicle messages --help.');
  assert.match(failure, /\u001b\[/); assert.ok(failure.includes('safe\\u001b]52;attack\\u0007')); assert.ok(!failure.includes('\u001b]52'));
});
