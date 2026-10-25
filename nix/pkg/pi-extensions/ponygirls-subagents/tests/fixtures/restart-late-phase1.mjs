import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// WF3 restart-boundary phase 1 (distinct OS process): runs a real worker
// with a delayed genuine outcome + facade-local completion, faults the late
// usage.reported commit (STORE_FAILED, never healed in this process), then
// exits WITHOUT same-instance recovery. The durable outbox (not memory)
// must carry the obligation across the restart boundary.
const SRC = new URL('../../src/', import.meta.url).pathname;

const storeDir = process.argv[2];
const markerDir = process.argv[3];
assert.ok(typeof storeDir === 'string' && storeDir.length > 0, 'SETUP: storeDir argv required');
assert.ok(typeof markerDir === 'string' && markerDir.length > 0, 'SETUP: markerDir argv required');
const sdkRoot = process.env.PI_SUBAGENTS_SDK_ROOT;
assert.ok(typeof sdkRoot === 'string' && sdkRoot.length > 0, 'SETUP: PI_SUBAGENTS_SDK_ROOT env required');

const { Supervisor } = await import(`${SRC}supervisor.ts`);
const { FileRunStore } = await import(`${SRC}store.ts`);
const { defaultSupervisorPolicy } = await import(`${SRC}policy.ts`);
const { DummyToolExecutor, HostToolExecutor } = await import(`${SRC}sandbox.ts`);
const { DummyWorkspaceManager } = await import(`${SRC}workspace.ts`);
const { WorkerHandle } = await import(`${SRC}worker-launch.ts`);
const { bindChannel } = await import(`${SRC}protocol.ts`);

const SCRIPT = [{ text: 'genuine-provider-text', usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 }, delayMs: 2500 }];
const localMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'facade-local-text' }],
  api: 'openai-responses',
  provider: 'test',
  model: 'deterministic',
  usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: 1,
};

const base = new FileRunStore(storeDir, 'root-latereboot');
// Faultable journal: EVERY late usage.reported commit fails (never heals
// here); the durable outbox kind passes through untouched. An optional
// teardown fault (RESTART_LATE_FAIL_TEARDOWN=1) fails store.close() once,
// proving teardown failures stay loud instead of hiding behind success.
let teardownFaultArmed = process.env.RESTART_LATE_FAIL_TEARDOWN === '1';
const store = new Proxy(base, {
  get(tgt, prop) {
    if (prop === 'append') {
      return (kind, body) => {
        if (kind === 'usage.reported' && body?.late === true) {
          throw Object.assign(new Error('STORE_FAILED: injected crash on late usage commit'), { code: 'STORE_FAILED' });
        }
        return tgt.append(kind, body);
      };
    }
    if (prop === 'close') {
      return () => {
        if (teardownFaultArmed) {
          teardownFaultArmed = false;
          throw Object.assign(new Error('STORE_FAILED: injected crash on store close (teardown)'), { code: 'STORE_FAILED' });
        }
        return tgt.close();
      };
    }
    const v = Reflect.get(tgt, prop, tgt);
    return typeof v === 'function' ? v.bind(tgt) : v;
  },
});

const policy = defaultSupervisorPolicy();
policy.allowedModels = [{ provider: 'p', id: 'm' }];
policy.allowedTools = [];
const sessionsDir = join(markerDir, 'sessions');
mkdirSync(sessionsDir, { recursive: true });
const handles = [];
const sup = new Supervisor({
  rootId: 'root-latereboot',
  rootDir: join(markerDir, 'root1'),
  store,
  policy,
  governor: () => ({ model: { provider: 'p', id: 'm', thinkingLevel: 'off' }, cwd: markerDir, instructions: { contextFiles: [], skills: [] } }),
  schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxOpenAgents: 8, maxDepth: 1 },
  executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
  workspace: new DummyWorkspaceManager(),
  workerFactory: (o) => {
    const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
    const hostAgentDir = join(markerDir, 'host-agent');
    mkdirSync(hostAgentDir, { recursive: true });
    const agentDir = join(markerDir, 'worker-home', o.agentId);
    mkdirSync(agentDir, { recursive: true });
    const handle = new WorkerHandle({
      workerPath: join(SRC, 'worker.ts'),
      rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
      agentDir, sessionsDir, hostAgentDir,
      script: SCRIPT,
      extraEnv: { PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage) },
    }, binding);
    handles.push(handle);
    return handle;
  },
  governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
});

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const readRecords = () => base.readSince(0, Number.MAX_SAFE_INTEGER).records;
try {
  const g = await sup.spawn('governor', { taskName: 'late', message: 'go', profile: 'writer', isolation: 'none' }, 'latereboot-1');
  // Wait for the turn terminal (local completion settles fast).
  const tTerm = Date.now();
  let term = null;
  while (Date.now() - tTerm < 60000) {
    term = readRecords().find((r) => r.kind === 'task.terminal' && r.body?.taskRunId === g.taskRunId);
    if (term !== undefined) break;
    await tick(100);
  }
  assert.ok(term !== undefined, 'SETUP: turn terminal missing');
  assert.equal(term.body?.outcome, 'succeeded', 'SETUP: turn must settle locally');
  // Wait for the failed late commit (memory obligation + hold, pre-exit).
  const tHold = Date.now();
  while (sup.needsRecovery !== true && Date.now() - tHold < 30000) await tick(50);
  assert.equal(sup.needsRecovery, true, 'SETUP: failed late commit must hold health pre-exit');
  const pendingKeys = [...sup.pendingLateBilling.keys()];
  assert.equal(pendingKeys.length, 1, 'SETUP: exactly one retained late obligation pre-exit');
  const lateNow = readRecords().filter((r) => r.kind === 'usage.reported' && r.body?.late === true);
  assert.equal(lateNow.length, 0, 'SETUP: failed commit left no durable late receipt');
  writeFileSync(join(markerDir, 'late-reboot-ready'), JSON.stringify({
    agentId: g.agentId, taskRunId: g.taskRunId, generation: g.generation,
    usage: { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
    pendingKeys,
  }));
  console.log('LATE_REBOOT_PHASE1_HOLD_OK ' + JSON.stringify({ pendingKeys }));
} finally {
  // Owned teardown: failures are recorded with their causes (never
  // swallowed by empty catches), every spawned worker exit is actually
  // joined (not fire-and-forget killed), and any teardown failure exits
  // nonzero so it cannot hide behind phase-1 success.
  const teardownFailures = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sup.shutdown();
  } catch (e) {
    teardownFailures.push(`shutdown: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const h of handles) {
    try {
      h.kill();
    } catch (e) {
      teardownFailures.push(`kill: ${e instanceof Error ? e.message : String(e)}`);
    }
    const tExit = Date.now();
    while (h.exit === null && Date.now() - tExit < 15000) await sleep(50);
    if (h.exit === null) {
      teardownFailures.push('worker-exit-join: exit null after 15s');
    } else {
      console.log('LATE_REBOOT_WORKER_EXIT_JOINED ' + JSON.stringify(h.exit));
    }
  }
  if (teardownFailures.length > 0) {
    console.error('LATE_REBOOT_TEARDOWN_FAILURES: ' + teardownFailures.join(' ; '));
    process.exitCode = 1;
  }
}
