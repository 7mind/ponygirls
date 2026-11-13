import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { CuckooPreferences } from '../src/preferences.ts';
import { bindSettingsCallbacks } from '../src/settings-view.ts';

for (const change of ['abort', 'session', 'trust']) test(`final owner read cannot ${change} and still persist scoped settings`, () => {
  const manager = SessionManager.inMemory(); let sessionId = manager.getSessionId(), trusted = true;
  const abort = new AbortController(); let globalReads = 0, projectReads = 0, writes = 0;
  const targetChange = () => {
    if (change === 'abort') abort.abort();
    else if (change === 'session') sessionId = 'replacement';
    else trusted = false;
  };
  const global = { path: 'global-target', read() { if (++globalReads === 2 && change !== 'trust') targetChange(); return {}; }, write() { writes++; } };
  const project = { path: 'project-target', read() { if (++projectReads === 2 && change === 'trust') targetChange(); return {}; }, write() { writes++; } };
  const ctx = { cwd: '/synthetic', isProjectTrusted: () => trusted,
    sessionManager: { getSessionId: () => sessionId, getEntries: () => manager.getEntries() } };
  const settings = new CuckooPreferences({ appendEntry() { writes++; } }, global, () => project);
  const callbacks = bindSettingsCallbacks(settings, ctx, async () => undefined, () => {});
  const scope = change === 'trust' ? 'project' : 'global'; const target = callbacks.read().paths[scope];
  globalReads = 0; projectReads = 0;
  assert.throws(() => callbacks.apply(scope, [{ field: 'enabled', value: true }], abort.signal, target));
  assert.equal(writes, 0);
});
