import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
// Candidate-relative arbitrary-cause fault child (R11): mandatory summary
// appends throw non-Error values (null/undefined/false/"") instead of named
// Errors. The fixed invocation-owned channel must preserve every cause with
// explicit String() presence — "null", "undefined", "false", and the empty
// string segment — rather than dropping them through truthiness checks.
const fs = createRequire(import.meta.url)('node:fs');
const originalAppend = fs.appendFileSync;
const originalWrite = fs.writeFileSync;
const agentDir = process.env.PI_SUBAGENTS_AGENT_DIR;
assert.equal(typeof agentDir, 'string');
const usagePath = join(agentDir, 'summary-usage.jsonl');
const errorPath = join(agentDir, 'summary-usage-error.jsonl');
const checkpointPath = join(agentDir, 'controller-arbitrary-causes-r11-checkpoint.json');
const attempts = [];
const thrownFor = (pathKind, kind) => {
  if (pathKind === 'usage' && kind === 'history') return { value: null, label: 'null' };
  if (pathKind === 'error' && kind === 'history') return { value: undefined, label: 'undefined' };
  if (pathKind === 'usage' && kind === 'prefix') return { value: false, label: 'false' };
  return { value: '', label: 'empty-string' };
};
fs.appendFileSync = function (path, data, ...rest) {
  if (path !== usagePath && path !== errorPath) return Reflect.apply(originalAppend, this, [path, data, ...rest]);
  assert.equal(typeof data, 'string');
  const record = JSON.parse(data);
  assert.ok(record.kind === 'history' || record.kind === 'prefix');
  const pathKind = path === usagePath ? 'usage' : 'error';
  const thrown = thrownFor(pathKind, record.kind);
  attempts.push({ pathKind, kind: record.kind, thrown: thrown.label });
  Reflect.apply(originalWrite, fs, [checkpointPath, JSON.stringify({ phase: 'arbitrary-cause-appends', pid: process.pid, attempts })]);
  throw thrown.value;
};
syncBuiltinESMExports();
