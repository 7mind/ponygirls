import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { Supervisor } from '../src/supervisor.ts';
import { InMemoryRunStore } from '../src/store.ts';
const WORKER = new URL('../src/worker.ts', import.meta.url).pathname;
const CHILD = new URL('./fixtures/r11-obs-double-fault-child.mjs', import.meta.url).pathname;
const mode = process.env.PI_CONTROLLER_R8_OBSERVER_MODE;
assert.ok(mode === 'current' || mode === 'actual-stale-generation');
const childProcess = createRequire(import.meta.url)('node:child_process');
const originalFork = childProcess.fork;
const agentDirs = [];
const exits = [];
const terminals = [];
const modelReports = [];
childProcess.fork = function (path, args, options) {
  if (path !== WORKER) return Reflect.apply(originalFork, this, [path, args, options]);
  assert.equal(options.env.NODE_OPTIONS, undefined);
  agentDirs.push(options.env.PI_SUBAGENTS_AGENT_DIR);
  const child = Reflect.apply(originalFork, this, [path, args, { ...options, env: { ...options.env, NODE_OPTIONS: `--import=${CHILD}`, PI_CONTROLLER_R8_OBSERVER_MODE: mode } }]);
  exits.push(new Promise((resolve) => child.once('exit', (code, signal) => resolve({ pid: child.pid, code, signal }))));
  return child;
};
syncBuiltinESMExports();
const originalAppend = InMemoryRunStore.prototype.append;
InMemoryRunStore.prototype.append = function (...args) {
  const result = Reflect.apply(originalAppend, this, args);
  if (args[0] === 'usage.reported' && args[1].external !== true) modelReports.push({ ...args[1] });
  if (args[0] === 'task.terminal') terminals.push({ ...args[1] });
  return result;
};
const originalShutdown = Supervisor.prototype.shutdown;
Supervisor.prototype.shutdown = async function (...args) {
  let primaryPresent = false;
  let primary;
  let result;
  try { result = await Reflect.apply(originalShutdown, this, args); }
  catch (error) { primaryPresent = true; primary = error; }
  let secondaryPresent = false;
  let secondary;
  try {
    const workerExits = await Promise.all(exits);
    assert.equal(workerExits.length, 1);
    console.log('CONTROLLER_R11_DOUBLE_OBSERVER_ACTUAL_WORKER_EXIT_JOINED ' + JSON.stringify(workerExits));
    assert.equal(agentDirs.length, 1);
    const checkpoint = JSON.parse(readFileSync(join(agentDirs[0], 'controller-observer-channel-r8-parent-checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.phase, 'actual-required-appends-with-invocation-and-prior-entry-identity');
    assert.equal(checkpoint.mode, mode);
    assert.equal(checkpoint.attempts.length, 4);
    assert.deepEqual(checkpoint.attempts.map((r) => [r.pathKind, r.record.kind]), [['usage','history'],['error','history'],['usage','prefix'],['error','prefix']]);
    assert.equal(terminals.length, 2);
    assert.equal(terminals[0].outcome, 'succeeded');
    for (const attempt of checkpoint.attempts) assert.equal(attempt.currentInvocation.taskRunId, terminals[1].taskRunId);
    const full = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unknown: false };
    for (const row of modelReports) {
      assert.ok(terminals.some((t) => t.taskRunId === row.taskRunId));
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) {
        assert.equal(typeof row[key], 'number');
        full[key] += row[key];
      }
      assert.equal(typeof row.unknown, 'boolean');
      full.unknown = full.unknown || row.unknown;
    }
    console.log('CONTROLLER_R11_DOUBLE_OBSERVER_ACTUAL_CHECKPOINT_TERMINALS_KNOWN_LEDGER ' + JSON.stringify({ checkpoint, terminals, modelReports, full }));
    assert.deepEqual(full, { input: 204, output: 74, cacheRead: 47, cacheWrite: 50, cost: 35, unknown: false });
    console.log('CONTROLLER_R11_DOUBLE_OBSERVER_KNOWN_FULL_USAGE_ONCE_PASS');
    // GREEN (fixed) expectations: the current operation MUST fail publicly
    // (all four mandatory appends genuinely throw), and the terminal MUST
    // name every primary/secondary cause — usage and checkpoint, history
    // and prefix — with explicit presence. Success here would be the stale-
    // ownership defect; first-only detail would be the drain defect.
    assert.equal(terminals[1].outcome, 'failed');
    assert.equal(typeof terminals[1].detail, 'string');
    assert.ok(
      terminals[1].detail.includes('CONTROLLER_R8_REQUIRED_SUMMARY_USAGE_APPEND_FAULT'),
      'terminal must preserve primary usage-append faults',
    );
    assert.ok(
      terminals[1].detail.includes('CONTROLLER_R8_REQUIRED_ERROR_CHECKPOINT_APPEND_FAULT'),
      'terminal must preserve secondary checkpoint-append faults',
    );
    assert.ok(terminals[1].detail.includes('turn 8'), 'terminal must preserve later-turn causes');
    if (mode === 'actual-stale-generation') {
      for (const attempt of checkpoint.attempts) {
        assert.equal(attempt.genuinePriorEntry.taskRunId, terminals[0].taskRunId);
        assert.equal(attempt.genuinePriorEntry.generation, 1);
      }
      console.log('CONTROLLER_R11_ACTUAL_STALE_PRIOR_GENERATION_OBSERVER_OWNER_GREEN_FIXED_PASS');
    } else {
      console.log('CONTROLLER_R11_CURRENT_OBSERVER_ALL_ERRORS_PRESERVED_GREEN_FIXED_PASS');
    }
  } catch (error) { secondaryPresent = true; secondary = error; }
  if (primaryPresent && secondaryPresent) throw new Error(`PRIMARY: ${String(primary)}; CHECKPOINT: ${String(secondary)}`);
  if (primaryPresent) throw primary;
  if (secondaryPresent) throw secondary;
  return result;
};
