import { join } from 'node:path';
import { Supervisor } from '../../src/supervisor.ts';
import { GitWorkspaceManager } from '../../src/workspace.ts';
import { FileRunStore } from '../../src/store.ts';
import { HostToolExecutor } from '../../src/sandbox.ts';
import { defaultSupervisorPolicy } from '../../src/policy.ts';
import { DISCOVERY_OFF } from '../../../context-rules/rules.ts';
import { CtlWorker } from '../ctl-worker.ts';
import { testGovernor } from '../fake-worker.ts';
const [root, mode] = process.argv.slice(2);
const dir = join(root, 'state');
let blocked = false;
class StopAfterAllocation extends GitWorkspaceManager {
  allocateWriter(...args) {
    const allocation = super.allocateWriter(...args);
    if (blocked && mode.startsWith('allocated')) {
      process.send({ cwd: allocation.worktreePath });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    return allocation;
  }
}
class Pause extends HostToolExecutor {
  async exec(spec) {
    if (!blocked) return super.exec(spec);
    process.send({ cwd: spec.cwd });
    return new Promise(() => {});
  }
}
const host = new Pause();
const sup = new Supervisor({ rootId: 'state', rootDir: dir, workspace: new StopAfterAllocation(), store: new FileRunStore(dir, 'state'), policy: { ...defaultSupervisorPolicy(), worktreeRoot: join(root, 'pool') }, governor: () => ({ ...testGovernor(), cwd: join(root, 'repo') }), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: true }, mainFiles: [] }), executors: { host, sandbox: host }, workerFactory: o => new CtlWorker(o.agentId) });
await sup.spawn('governor', { profile: 'writer', taskName: 'published', message: 'Work.' }, 'published');
blocked = true;
process.on('message', () => {});
await sup.spawn('governor', { profile: 'writer', taskName: 'pending', message: 'Work.', ...(mode === 'prepared' ? { workspacePath: join(root, 'prepared') } : {}) }, 'pending');
