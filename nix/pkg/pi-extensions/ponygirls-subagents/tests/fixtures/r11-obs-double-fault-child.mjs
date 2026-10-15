import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const fs = createRequire(import.meta.url)('node:fs');
const originalAppend = fs.appendFileSync;
const originalWrite = fs.writeFileSync;
const agentDir = process.env.PI_SUBAGENTS_AGENT_DIR;
const mode = process.env.PI_CONTROLLER_R8_OBSERVER_MODE;
assert.equal(typeof agentDir, 'string');
assert.ok(mode === 'current' || mode === 'actual-stale-generation');
const usagePath = join(agentDir, 'summary-usage.jsonl');
const errorPath = join(agentDir, 'summary-usage-error.jsonl');
const entryPath = join(agentDir, 'provider-entries.jsonl');
const checkpointPath = join(agentDir, 'controller-observer-channel-r8-parent-checkpoint.json');
const attempts = [];
let prior;
let current;
fs.appendFileSync = function (path, data, ...rest) {
  if (path === entryPath) {
    const record = JSON.parse(data);
    if (record.generation === 1) {
      assert.equal(typeof record.taskRunId, 'string');
      prior = { taskRunId: record.taskRunId, generation: record.generation, agentId: record.agentId };
    }
    return Reflect.apply(originalAppend, this, [path, data, ...rest]);
  }
  if (path !== usagePath && path !== errorPath) return Reflect.apply(originalAppend, this, [path, data, ...rest]);
  assert.equal(typeof data, 'string');
  const record = JSON.parse(data);
  assert.ok(record.kind === 'history' || record.kind === 'prefix');
  if (path === usagePath) {
    current = { taskRunId: process.env.PI_SUBAGENTS_TASK_RUN_ID, generation: process.env.PI_SUBAGENTS_EXECUTION_GENERATION, agentId: process.env.PI_SUBAGENTS_AGENT_ID };
    assert.equal(typeof current.taskRunId, 'string');
    assert.equal(current.generation, '2');
    if (mode === 'actual-stale-generation') {
      assert.notEqual(prior, undefined, 'actual generation-1 ORIGINAL ENTRY required');
      assert.notEqual(prior.taskRunId, current.taskRunId);
      assert.equal(prior.generation, 1);
      process.env.PI_SUBAGENTS_TASK_RUN_ID = prior.taskRunId;
      process.env.PI_SUBAGENTS_EXECUTION_GENERATION = String(prior.generation);
    }
  }
  attempts.push({ pathKind: path === usagePath ? 'usage' : 'error', record, currentInvocation: current, genuinePriorEntry: prior });
  Reflect.apply(originalWrite, fs, [checkpointPath, JSON.stringify({ phase: 'actual-required-appends-with-invocation-and-prior-entry-identity', mode, pid: process.pid, attempts })]);
  if (path === errorPath) {
    process.env.PI_SUBAGENTS_TASK_RUN_ID = current.taskRunId;
    process.env.PI_SUBAGENTS_EXECUTION_GENERATION = current.generation;
  }
  throw new Error(path === usagePath ? 'CONTROLLER_R8_REQUIRED_SUMMARY_USAGE_APPEND_FAULT' : 'CONTROLLER_R8_REQUIRED_ERROR_CHECKPOINT_APPEND_FAULT');
};
syncBuiltinESMExports();
