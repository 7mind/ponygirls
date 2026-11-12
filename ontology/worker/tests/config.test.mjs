import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeConfig, FileCredentials } from '../.cache/worker/src/config.js';
const value = () => ({ version: 1, captureAuthorization: 'current-session-from-attachment',
  http: { origin: 'http://127.0.0.1:12345', deadlineMs: 1000, maxRequestBytes: 8192, maxResponseBytes: 8192 },
  coordinator: { scope: 'scope', workContext: 'work', workerActorId: 'agent', collectorActorId: 'collector', collectorNamespace: 'namespace',
    boundaryDeadlineMs: 3000, pollEveryMs: 20, maxNewEntries: 100, maxTrackedEntries: 1000, maxCaptureTextBytes: 4096, maxCapsuleBytes: 8192 },
  workerTokenFile: '/nonexistent/agent-token', collectorTokenFile: '/nonexistent/collector-token' });
test('configuration is complete and structural validation never reads credentials', () => {
  assert.deepEqual(decodeConfig(JSON.stringify(value())), value());
});
test('configuration rejects duplicate keys, missing consent, implicit paths and incompatible bounds', () => {
  const mutations = [
    v => { delete v.captureAuthorization; },
    v => { v.extra = true; },
    v => { v.workerTokenFile = 'relative'; },
    v => { v.coordinator.maxTrackedEntries = 1; },
    v => { v.coordinator.pollEveryMs = v.coordinator.boundaryDeadlineMs; },
    v => { v.coordinator.maxCapsuleBytes = 999999; },
    v => { v.http.deadlineMs = 0.5; },
  ];
  for (const mutate of mutations) { const v = value(); mutate(v); assert.throws(() => decodeConfig(JSON.stringify(v))); }
  assert.throws(() => decodeConfig(JSON.stringify(value()).replace('"version":1', '"version":1,"version":1')));
});
test('FIFO credential acquisition rejects without a writer or blocked filesystem worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ontology-worker-fifo-'));
  try {
    const path = join(directory, 'token.fifo'); execFileSync('mkfifo', [path]);
    const module = new URL('../.cache/worker/src/config.js', import.meta.url).href;
    const code = `import { FileCredentials } from ${JSON.stringify(module)};
      try { await new FileCredentials(${JSON.stringify(path)}).token(AbortSignal.timeout(50)); process.exitCode = 2; }
      catch (error) { if (error.message !== 'credential-unavailable') process.exitCode = 3; }`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 1500, killSignal: 'SIGKILL' });
    assert.equal(child.status, 0, 'nonregular-file acquisition blocked until the test killed the isolated child');
  } finally { await rm(directory, { recursive: true }); }
});
test('credential file reads are bounded, current, strict and sanitized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ontology-worker-credentials-'));
  try {
    const path = join(directory, 'token'); const credentials = new FileCredentials(path);
    const token = 'a'.repeat(43);
    await writeFile(path, token + '\n', { mode: 0o600 });
    assert.equal(await credentials.token(new AbortController().signal), token);
    await writeFile(path, 'b'.repeat(43));
    assert.equal(await credentials.token(new AbortController().signal), 'b'.repeat(43));
    for (const invalid of [' leading-space-private', 'a'.repeat(300), token + '\n\n']) {
      await writeFile(path, invalid);
      await assert.rejects(credentials.token(new AbortController().signal), error => error.message === 'credential-unavailable');
    }
    await assert.rejects(new FileCredentials(directory).token(new AbortController().signal), /credential-unavailable/);
  } finally { await rm(directory, { recursive: true }); }
});
