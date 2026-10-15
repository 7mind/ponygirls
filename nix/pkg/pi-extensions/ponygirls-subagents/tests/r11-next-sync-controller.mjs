// Candidate-relative INTEGRATION variant (supersedes the RED next-sync
// control): asserts the JOINED public failure for a synchronously throwing
// ORIGINAL next() — failed terminal naming the iteration cause, unknown
// usage, no external interrupt required, worker exit joined. RED body
// retained frozen in MAIN D (provider-public-original-next-sync-throw-*
// and the authorized patch inputs); this file carries the accepted proof.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { Supervisor } from '../src/supervisor.ts';
import { defaultSupervisorPolicy } from '../src/policy.ts';
import { WorkerHandle } from '../src/worker-launch.ts';
import { bindChannel } from '../src/protocol.ts';
import { DummyWorkspaceManager } from '../src/workspace.ts';
import { DummyToolExecutor } from '../src/sandbox.ts';
import { InMemoryRunStore } from '../src/store.ts';
const D = tmpdir();
const SDK = process.env["PI_SUBAGENTS_SDK_ROOT"];
if (typeof SDK !== "string" || SDK.length === 0) { console.error("CONTROLLER_SETUP_OR_CLEANUP: PI_SUBAGENTS_SDK_ROOT must be set (no fallback)"); process.exit(2); }
const WORKER = new URL('../src/worker.ts', import.meta.url).pathname;
const CHILD = new URL('./fixtures/r11-pub-next-sync-child.mjs', import.meta.url).pathname;
const mode = process.argv[2];
assert.equal(mode, 'iterator-next-sync-throw');
const childProcess = createRequire(import.meta.url)('node:child_process');
const originalFork = childProcess.fork;
let childPid;
childProcess.fork = function (path, args, options) {
  if (path !== WORKER) return Reflect.apply(originalFork, this, [path, args, options]);
  assert.equal(options.env.NODE_OPTIONS, undefined, 'CONTROLLER_SETUP: no unrelated preload');
  const child = Reflect.apply(originalFork, this, [path, args, { ...options, env: { ...options.env, NODE_OPTIONS: `--import=${CHILD}`, PI_CONTROLLER_PUBLIC_ORIGINAL_STREAM_FAULT: mode } }]);
  assert.equal(childPid, undefined, 'CONTROLLER_SETUP: one actual SDK worker required');
  childPid = child.pid;
  return child;
};
syncBuiltinESMExports();
const dir = mkdtempSync(join(D, 'public-original-r8-parent-'));
const sessionsDir = join(dir, 'sessions');
const hostAgentDir = join(dir, 'host-agent');
mkdirSync(sessionsDir); mkdirSync(hostAgentDir);
const rootId = 'controller-public-original-fault';
const store = new InMemoryRunStore(rootId);
const policy = defaultSupervisorPolicy();
policy.allowedModels = [{ provider: 'p', id: 'm' }];
const admissions = [];
let worker;
let agentDir;
const sup = new Supervisor({
  rootId, rootDir: join(dir, 'root'), store, policy,
  governor: () => ({ model: { provider: 'p', id: 'm', thinkingLevel: 'off' }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
  schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
  executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() }, workspace: new DummyWorkspaceManager(),
  workerFactory: (o) => {
    agentDir = join(dir, 'worker-home', o.agentId);
    worker = new WorkerHandle({ workerPath: WORKER, rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK, deterministic: true, agentDir, sessionsDir, hostAgentDir, script: [{ text: 'unchanged ordinary script' }], extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: 'provider-entries.jsonl' } }, bindChannel(o.rootEpoch, o.agentId, o.instanceId));
    const setHandler = worker.setProviderAdmissionRequestHandler.bind(worker);
    worker.setProviderAdmissionRequestHandler = (handler) => setHandler(async (payload, envelope) => {
      const response = await handler(payload, envelope);
      admissions.push({ taskRunId: envelope.taskRunId, generation: envelope.executionGeneration, actorId: envelope.actorId, response });
      return response;
    });
    return worker;
  },
});
const TIMEOUT_MS = 15000;
const POLL_MS = 20;
const records = () => store.readSince(0, 100000).records;
let primaryPresent = false;
let primary;
let cleanupPresent = false;
let cleanup;
let observed;
let expectedFailurePreserved = true;
try {
  const g = await sup.spawn('governor', { taskName: 'public-original-boundary', message: 'go', profile: 'reader', isolation: 'none' }, 'controller-original-fault');
  const checkpointPath = join(agentDir, 'controller-public-original-stream-fault-r8-parent-checkpoint.json');
  const terminal = () => records().find((r) => r.kind === 'task.terminal' && r.body.taskRunId === g.taskRunId);
  const deadline = Date.now() + TIMEOUT_MS;
  let witness;
  while (Date.now() < deadline) {
    if (existsSync(checkpointPath)) {
      witness = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (witness.resultEntered > 0 && terminal() !== undefined) break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  assert.notEqual(witness, undefined, 'CONTROLLER_SETUP: actual original invocation checkpoint required');
  assert.equal(witness.pid, childPid);
  assert.equal(witness.mode, mode);
  assert.equal(witness.phase, 'actual-original-public-StreamFn-invocation');
  assert.ok(witness.resultEntered > 0);
  assert.equal(admissions.length, 1, 'CONTROLLER_SETUP: one genuine guard admission before actual ORIGINAL required');
  assert.equal(admissions[0].response.ok, true);
  assert.equal(admissions[0].taskRunId, g.taskRunId);
  assert.ok(Number.isInteger(admissions[0].generation));
  assert.equal(readFileSync(join(agentDir, 'provider-entries.jsonl'), 'utf8'), '', 'fault before lower provider creation has actual initialized zero ENTRY');
  if (mode !== 'iterator-next-sync-throw') {
    const t = terminal();
    assert.notEqual(t, undefined, 'matching failed terminal required');
    assert.equal(t.body.outcome, 'failed');
    const reports = records().filter((r) => r.kind === 'usage.reported' && r.body.agentId === g.agentId && r.body.external !== true);
    assert.ok(reports.length > 0, 'actual captured generation ledger report required');
    assert.ok(reports.some((r) => r.body.unknown === true), 'actual result-rejection must expose unknown');
    assert.equal(typeof t.body.detail, 'string');
    expectedFailurePreserved = t.body.detail.includes(mode === 'result-reject' ? 'WORKER_ORIGINAL_FAULT_PUBLIC_RESULT_REJECTION' : 'STREAM_ENDED_WITHOUT_MESSAGE');
    if (mode !== 'result-reject') {
      assert.equal(witness.iterationEnded, true);
      assert.equal(witness.resultSettled, false, 'raw native result remains pending while facade publicly rejects');
      assert.equal(witness.abortObserved, false, 'public completion precedes any owned abort');
    }
    observed = { taskRunId: g.taskRunId, witness, admissions, terminal: t.body, reports: reports.map((r) => r.body), externalInterruptUsed: false };
    console.log('CONTROLLER_R8_ACTUAL_ORIGINAL_PUBLIC_OUTCOME_UNKNOWN_BEFORE_INTERRUPT_OBSERVED ' + JSON.stringify(observed));
    if (expectedFailurePreserved) console.log('CONTROLLER_R8_ACTUAL_ORIGINAL_PUBLIC_ERROR_UNKNOWN_BEFORE_INTERRUPT_PASS');
  } else {
    assert.equal(witness.iteratorFactoryThrew, false, 'iterator construction succeeded');
    assert.equal(witness.iteratorNextThrew, true, 'actual next() threw synchronously');
    assert.equal(witness.resultSettled, false);
    assert.equal(witness.abortObserved, false);
    const t = terminal();
    assert.notEqual(t, undefined);
    assert.equal(t.body.outcome, 'failed');
    assert.ok(t.body.detail.includes('CONTROLLER_R10_ORIGINAL_ITERATOR_NEXT_SYNCHRONOUS_THROW'));
    const reports = records().filter((r) => r.kind === 'usage.reported' && r.body.taskRunId === g.taskRunId && r.body.external !== true);
    assert.ok(reports.some((r) => r.body.unknown === true));
    console.log('INTEGRATION_R11_ACTUAL_NEXT_SYNC_FAILED_UNKNOWN_ORIGINAL_CAUSE_NO_EXTERNAL_INTERRUPT_PASS ' + JSON.stringify({taskRunId:g.taskRunId,witness,terminal:t.body,reports:reports.map(r=>r.body)}));
  }
} catch (error) { primaryPresent = true; primary = error; }
try { await sup.shutdown(); }
catch (error) { cleanupPresent = true; cleanup = error; }
try {
  assert.notEqual(worker, undefined, 'CONTROLLER_SETUP: actual owned SDK worker required for exit join');
  const exitDeadline = Date.now() + TIMEOUT_MS;
  while (worker.exit === null && Date.now() < exitDeadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  assert.notEqual(worker.exit, null, 'actual owned SDK worker exit joined');
  console.log('CONTROLLER_R8_PUBLIC_ORIGINAL_FAULT_ACTUAL_WORKER_EXIT_JOINED ' + JSON.stringify(worker.exit));
} catch (error) { cleanup = cleanupPresent ? new Error(`${String(cleanup)}; worker-exit: ${String(error)}`) : error; cleanupPresent = true; }
try { rmSync(dir, { recursive: true, force: true }); }
catch (error) { cleanup = cleanupPresent ? new Error(`${String(cleanup)}; ${String(error)}`) : error; cleanupPresent = true; }
if (primaryPresent || cleanupPresent) {
  console.error(`CONTROLLER_SETUP_OR_CLEANUP: primaryPresent=${primaryPresent} primary=${String(primary)} cleanupPresent=${cleanupPresent} cleanup=${String(cleanup)}`);
  process.exitCode = 2;

} else if (!expectedFailurePreserved) {
  console.error('CONTROLLER_R8_ORIGINAL_PUBLIC_RESULT_REJECTION_REPLACED_BY_FACADE_EOF_REPRO_CONFIRMED ' + JSON.stringify(observed));
  process.exitCode = 1;
}
