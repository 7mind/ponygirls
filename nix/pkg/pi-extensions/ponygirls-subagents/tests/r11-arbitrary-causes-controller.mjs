import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
// Candidate-relative R11 arbitrary-cause controller: preloads the healthy
// split-compaction test with a child that throws null/undefined/false/""
// from mandatory summary appends. The fixed channel must fail the current
// task publicly with every cause preserved by explicit String() presence,
// retain known Usage once, and join the actual worker exit. Fault injection
// means the underlying healthy test cannot succeed (exit 1 by design); the
// FIXED proof is the terminal character, not the harness exit.
import { Supervisor } from '../src/supervisor.ts';
import { InMemoryRunStore } from '../src/store.ts';
const WORKER = new URL('../src/worker.ts', import.meta.url).pathname;
const CHILD = new URL('./fixtures/r11-arbitrary-fault-child.mjs', import.meta.url).pathname;
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
  const child = Reflect.apply(originalFork, this, [path, args, { ...options, env: { ...options.env, NODE_OPTIONS: `--import=${CHILD}` } }]);
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
    console.log('CONTROLLER_R11_ARBITRARY_ACTUAL_WORKER_EXIT_JOINED ' + JSON.stringify(workerExits));
    assert.equal(agentDirs.length, 1);
    const checkpoint = JSON.parse(readFileSync(join(agentDirs[0], 'controller-arbitrary-causes-r11-checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.phase, 'arbitrary-cause-appends');
    assert.deepEqual(checkpoint.attempts.map((r) => [r.pathKind, r.thrown]), [['usage', 'null'], ['error', 'undefined'], ['usage', 'false'], ['error', 'empty-string']]);
    assert.equal(terminals.length, 2);
    assert.equal(terminals[0].outcome, 'succeeded');
    assert.equal(terminals[1].outcome, 'failed');
    assert.equal(typeof terminals[1].detail, 'string');
    assert.ok(terminals[1].detail.includes('null'), 'null cause preserved, got: ' + terminals[1].detail.slice(0, 400));
    assert.ok(terminals[1].detail.includes('undefined'), 'undefined cause preserved, got: ' + terminals[1].detail.slice(0, 400));
    assert.ok(terminals[1].detail.includes('false'), 'false cause preserved, got: ' + terminals[1].detail.slice(0, 400));
    assert.ok(terminals[1].detail.includes('turn 8 (prefix):'), 'empty-string turn segment preserved, got: ' + terminals[1].detail.slice(0, 400));
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
    console.log('CONTROLLER_R11_ARBITRARY_ACTUAL_CHECKPOINT_TERMINALS_KNOWN_LEDGER ' + JSON.stringify({ checkpoint, terminals, modelReports, full }));
    assert.deepEqual(full, { input: 204, output: 74, cacheRead: 47, cacheWrite: 50, cost: 35, unknown: false });
    console.log('CONTROLLER_R11_ARBITRARY_ALL_CAUSES_PRESERVED_GREEN_FIXED_PASS');
  } catch (error) { secondaryPresent = true; secondary = error; }
  if (primaryPresent && secondaryPresent) throw new Error(`PRIMARY: ${String(primary)}; CHECKPOINT: ${String(secondary)}`);
  if (primaryPresent) throw primary;
  if (secondaryPresent) throw secondary;
  return result;
};
