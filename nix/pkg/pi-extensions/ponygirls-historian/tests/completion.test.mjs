import assert from 'node:assert/strict';
import test from 'node:test';
import extension from '../index.ts';
import { completeHistorianArguments } from '../src/complete.ts';

let command;
extension({ registerCommand: (_name, spec) => { command = spec; }, on() {} });

test('historian registers grammar-aware argument completion', () => {
  assert.equal(typeof command.getArgumentCompletions, 'function');
  const complete = command.getArgumentCompletions;
  assert.deepEqual(complete('jo').map(item => item.value), ['journal']);
  assert.deepEqual(complete('default o').map(item => item.value), ['default on', 'default off']);
  assert.deepEqual(complete('default model i').map(item => item.value), ['default model inherit']);
  assert.deepEqual(complete('focus i').map(item => item.value), ['focus inherit']);
  assert.equal(complete('focus arbitrary text'), null);
  assert.equal(complete('journal '), null);
});

test('provider/model completions retain the command prefix and finish with thinking levels', () => {
  const models = [{ provider: 'fixture', id: 'journal' }, { provider: 'fixture', id: 'main' }];
  const complete = prefix => completeHistorianArguments(prefix, models);
  assert.deepEqual(complete('default model f').map(item => item.value), ['default model fixture ']);
  assert.deepEqual(complete('model fixture j').map(item => item.value), ['model fixture journal ']);
  assert.deepEqual(complete('model fixture journal h').map(item => item.value), ['model fixture journal high']);
  assert.deepEqual(complete('default model fixture journal ').map(item => item.label), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(complete('model inherit '), null);
  assert.equal(complete('model fixture journal off '), null);
  assert.equal(complete('default focus arbitrary text'), null);
});
