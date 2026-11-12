import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../.cache/worker/src/extension.js';

function host(path) {
  const handlers = new Map(); const statuses = [];
  const api = {
    registerFlag() {}, getFlag: () => path,
    on(name, handler) { const values = handlers.get(name) ?? []; handlers.set(name, [...values, handler]); },
  };
  const entries = [];
  const ctx = { hasUI: true, signal: new AbortController().signal,
    ui: { setStatus: (key, value) => statuses.push({ key, value }) },
    sessionManager: { getSessionId: () => 'synthetic-session', getBranch: () => entries,
      getLeafId: () => entries.length === 0 ? null : entries.at(-1).id },
  };
  extension(api);
  return { ctx, entries, statuses, handlers,
    async emit(name, event) { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); },
    async context(messages) {
      let current = messages;
      for (const handler of handlers.get('context_with_system') ?? []) {
        const result = await handler({ messages: current }, ctx);
        if (result !== undefined && result.messages !== undefined) current = result.messages;
      }
      return current;
    },
  };
}
test('headless configuration failure is disclosed outside model context without private paths', () => {
  const module = new URL('../.cache/worker/src/extension.js', import.meta.url).href;
  const code = `import extension from ${JSON.stringify(module)};
    const handlers = new Map();
    extension({ registerFlag() {}, getFlag: () => '/private-fixture-path/not-present.json', on(name, fn) { handlers.set(name, fn); } });
    await handlers.get('session_start')({}, { hasUI: false });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /configuration-unavailable/);
  assert(!result.stderr.includes('private-fixture-path'));
  assert.equal(result.stdout, '');
});
test('unconfigured extension performs no capture and preserves exact context objects', async () => {
  const h = host(undefined); await h.emit('session_start', { reason: 'startup' });
  const messages = [{ role: 'system', content: 'initial', toolsAdded: [] }, { role: 'user', content: 'question' },
    { role: 'system', content: '', sections: { later: 'patch' }, toolsRemoved: ['write'] }];
  assert.equal(await h.context(messages), messages);
  assert.equal(h.handlers.has('context'), false, 'ordinary context hook can collapse system patches');
  assert.equal(h.statuses.length, 0);
  await h.emit('session_shutdown', { reason: 'quit' });
});
test('unavailable alignment returns ordinary full context unchanged and emits no captured content', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method });
    response.writeHead(503, { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' });
    response.end('{"code":"unavailable","message":"fixture unavailable"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(join(tmpdir(), 'ontology-worker-extension-'));
  let h;
  try {
    const token = join(directory, 'token'); await writeFile(token, 'a'.repeat(43), { mode: 0o600 });
    const config = { version: 1, captureAuthorization: 'current-session-from-attachment',
      http: { origin: `http://127.0.0.1:${server.address().port}`, deadlineMs: 1000, maxRequestBytes: 8192, maxResponseBytes: 8192 },
      coordinator: { scope: 'scope', workContext: 'work', workerActorId: 'agent', collectorActorId: 'collector', collectorNamespace: 'namespace',
        boundaryDeadlineMs: 3000, pollEveryMs: 20, maxNewEntries: 100, maxTrackedEntries: 1000, maxCaptureTextBytes: 4096, maxCapsuleBytes: 8192 },
      workerTokenFile: token, collectorTokenFile: token };
    const path = join(directory, 'config.json'); await writeFile(path, JSON.stringify(config));
    h = host(path); await h.emit('session_start', { reason: 'startup' });
    h.entries.push({ type: 'message', id: 'new-user', parentId: null, message: { role: 'user', content: 'synthetic input' } });
    const messages = [{ role: 'system', content: 'initial', toolsAdded: [] }, { role: 'user', content: 'synthetic input' },
      { role: 'system', content: '', sections: { later: 'patch' } }, { role: 'custom', customType: 'unrelated', content: 'unrelated advice' }];
    const snapshot = structuredClone(messages);
    const result = await h.context(messages);
    assert.equal(result, messages);
    assert.deepEqual(result, snapshot);
    assert.deepEqual(requests, [{ path: '/api/v1/whoami', method: 'GET' }]);
    assert(h.statuses.at(-1).value.includes('ordinary context retained'));
    await h.emit('session_shutdown', { reason: 'reload' });
    assert.equal(h.statuses.at(-1).value, undefined, 'shutdown retained an active sidecar status');
  } finally {
    if (h !== undefined) await h.emit('session_shutdown', { reason: 'quit' });
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true });
  }
});
