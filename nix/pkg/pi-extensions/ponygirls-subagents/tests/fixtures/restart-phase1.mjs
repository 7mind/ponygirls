import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;
const TESTS = new URL('../', import.meta.url).pathname;
const CG = 'mcp__codegraph__codegraph_explore';

const storeDir = process.argv[2];
const markerDir = process.argv[3];
assert.ok(typeof storeDir === 'string' && storeDir.length > 0, 'SETUP: storeDir argv required');
assert.ok(typeof markerDir === 'string' && markerDir.length > 0, 'SETUP: markerDir argv required');

const { Supervisor } = await import(`${SRC}supervisor.ts`);
const { FileRunStore } = await import(`${SRC}store.ts`);
const { defaultSupervisorPolicy } = await import(`${SRC}policy.ts`);
const { DummyToolExecutor } = await import(`${SRC}sandbox.ts`);
const { DummyWorkspaceManager } = await import(`${SRC}workspace.ts`);
const { CtlWorker } = await import(`${TESTS}ctl-worker.ts`);

const countFile = join(markerDir, 'effect-count');
const CG_HANDLE = {
  name: CG,
  description: 'd',
  parameters: { type: 'object' },
  execute: async () => {
    appendFileSync(countFile, 'x');
    return {
      content: [{ type: 'text', text: 'x' }],
      details: {},
      usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
  },
};

const base = new FileRunStore(storeDir, 'root-restart');
const st = { armed: true, firedOp: null, count: 0 };
const store = new Proxy(base, {
  get(tgt, prop) {
    if (prop === 'append') {
      return (kind, body) => {
        if (st.armed && kind === 'usage.reported' && body && body.external === true) {
          st.armed = false;
          st.firedOp = body.operationId;
          st.count += 1;
          throw Object.assign(new Error('STORE_FAILED: injected preappend crash'), { code: 'STORE_FAILED' });
        }
        return tgt.append(kind, body);
      };
    }
    const v = Reflect.get(tgt, prop, tgt);
    return typeof v === 'function' ? v.bind(tgt) : v;
  },
});

const policy = defaultSupervisorPolicy();
policy.allowedModels = [{ provider: 'p', id: 'm' }];
policy.allowedTools = [CG];
const holders = [];
const sup = new Supervisor({
  rootId: 'root-restart',
  rootDir: join(markerDir, 'root'),
  store,
  policy,
  governor: () => ({ model: { provider: 'p', id: 'm', thinkingLevel: 'off' }, cwd: markerDir, instructions: { contextFiles: [], skills: [] } }),
  schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
  executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
  workspace: new DummyWorkspaceManager(),
  workerFactory: (o) => {
    const w = new CtlWorker(o.agentId);
    holders.push(w);
    return w;
  },
  governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
});

const holder = await sup.spawn('governor', { taskName: 'holder', message: 'hold', profile: 'writer', isolation: 'none' }, 'restart-h');
const w = holders.find((x) => x.agentId === holder.agentId);
assert.ok(w, 'SETUP: holder worker missing');
const res = await w.call(CG, { q: 'x' });
assert.equal(res.isError, false, 'SETUP: holder CG admitted');
assert.ok(st.firedOp !== null, 'SETUP: billing fault never fired');
assert.equal(st.count, 1, 'SETUP: exactly one firing');
assert.equal(sup.needsRecovery, true, 'SETUP: hold established');
writeFileSync(join(markerDir, 'phase1-hold'), JSON.stringify({ op: st.firedOp, count: st.count }));
process.exit(0);
