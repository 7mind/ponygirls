import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistorianController } from '../src/controller.ts';
import { HistorianWorker } from '../src/worker.ts';
import { PreferenceStore, DEFAULT_FOCUS } from '../src/preferences.ts';
import { ChroniclePreferences } from '../src/chronicle-preferences.ts';
import { JournalStore } from '../src/store.ts';
import extension from '../index.ts';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-controller-upload-'));
  const preferences = new PreferenceStore(join(directory, 'historian.json'));
  const model = { provider: 'fixture', id: 'scripted', thinking: 'off' };
  preferences.write({ enabled: true, model, approvedModel: model, focus: DEFAULT_FOCUS });
  const entries = [], received = [], notices = [];
  const ctx = { cwd: directory, isProjectTrusted: () => false, sessionManager: { getSessionId: () => 'root', getEntries: () => entries }, modelRegistry: {}, ui: { notify(value) { notices.push(value); } } };
  const pi = { events: { emit() {} }, appendEntry() {} };
  const controller = new HistorianController(pi, preferences, ctx, () => {});
  const server = createServer(async (req, res) => {
    let payload = ''; for await (const chunk of req) payload += chunk;
    const parsed = JSON.parse(payload); received.push(parsed);
    res.end(JSON.stringify({ requestId: parsed.requestId, revision: parsed.expectedRevision + 1, sessionId: '00000000-0000-4000-8000-000000000001', jobId: '00000000-0000-4000-8000-000000000002' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await controller.dispose(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); rmSync(directory, { recursive: true, force: true }); });
  const token = join(directory, 'token'); writeFileSync(token, 'synthetic-secret-'.repeat(4), { mode: 0o600 });
  await controller.configureChronicle(`http://127.0.0.1:${server.address().port}`, token, null);
  t.mock.method(HistorianWorker.prototype, 'run', async (batch, recent) => ({
    proposals: [{ episodeId: recent.length === 0 ? null : recent[0].episodeId, expectedRevision: recent.length === 0 ? 0 : recent[0].revision,
      title: 'Synthetic discovery', kind: 'discovery', status: 'ongoing', claims: [{ section: 'observation', basis: 'reported', text: `Summary revision ${recent.length === 0 ? 1 : recent[0].revision + 1}`, evidence: [batch.evidence[0].ref] }] }],
    metrics: { responseChars: 200, usage: null }, meta: { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null },
  }));
  async function publish(id) {
    entries.push({ type: 'message', id, parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_SESSION_BODY', timestamp: 1 } });
    await controller.reconcile(); await new Promise(resolve => setImmediate(resolve));
    assert.match(controller.status(), /pending events: 0/);
  }
  return { controller, preferences, token, received, publish, directory, notices };
}
async function eventually(check) {
  const deadline = performance.now() + 3000;
  while (!check()) { if (performance.now() > deadline) assert.fail('Observable upload postcondition did not complete'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('controller uploads only commits made while explicitly enabled; first remote CAS does not equal local revision', async t => {
  const { controller, received, publish } = await fixture(t);
  await publish('old'); assert.match(controller.journal(), /Summary revision 1/);
  await controller.enableChronicle(true, null); await controller.reconcile();
  assert.equal(received.length, 0, 'enable must not enumerate old revisions');
  await publish('new'); await controller.reconcile();
  await eventually(() => controller.chronicleStatus().includes('acknowledged: 1'));
  assert.equal(received.length, 1); assert.equal(received[0].expectedRevision, 0);
  assert.equal(JSON.parse(received[0].files[0].content).episode.revision, 2);
  assert.doesNotMatch(JSON.stringify(received), /PRIVATE_SESSION_BODY|synthetic-secret/);
  await controller.enableChronicle(false, null); await publish('off'); await controller.reconcile();
  assert.equal(received.length, 1); assert.match(controller.journal(), /Summary revision 3/);
  assert.match(controller.chronicleStatus(), /acknowledged: 1/, 'OFF must not erase the observable receipt count for the configured binding');
});

test('credential disappearance does not prevent new canonical summaries or lose their durable upload eligibility', async t => {
  const { controller, token, publish, received } = await fixture(t);
  await controller.enableChronicle(true, null); unlinkSync(token);
  await publish('first'); await controller.reconcile();
  await eventually(() => controller.chronicleStatus().includes('token-file-unavailable'));
  await publish('second');
  assert.match(controller.journal(), /Summary revision 2/);
  assert.match(controller.chronicleStatus(), /pending: 2/);
  assert.equal(received.length, 0); assert.match(controller.status(), /Error: none/);
});

test('stale destination approval cannot enable a replacement configuration', async t => {
  const { controller, token } = await fixture(t);
  const displayed = controller.chronicleConfiguration();
  await controller.configureChronicle('https://replacement.example', token, null);
  await assert.rejects(() => controller.enableChronicle(true, displayed), /settings changed/);
  assert.equal(controller.chronicleConfiguration().enabled, false);
});

test('OFF between reconciliation and delivery prevents a new upload admission', async t => {
  const { controller, publish, received, directory } = await fixture(t);
  await controller.enableChronicle(true, null); await publish('queued');
  assert.equal(received.length, 0);
  const preferences = new ChroniclePreferences(join(directory, 'historian-chronicle.json'));
  const next = JournalStore.prototype.nextChronicle; let changed = false;
  t.mock.method(JournalStore.prototype, 'nextChronicle', function (...args) {
    const pending = next.apply(this, args);
    if (pending !== null && !changed) { changed = true; preferences.update(current => ({ ...current, enabled: false })); }
    return pending;
  });
  await controller.reconcile();
  await eventually(() => controller.chronicleStatus().includes('Chronicle delivery: idle'));
  assert.equal(changed, true); assert.equal(received.length, 0, 'OFF completed before admission, so no HTTP request may start');
  assert.match(controller.chronicleStatus(), /pending: 1/);
});

test('invalid upload settings deny export without discarding local summaries or consuming model retries', async t => {
  const { controller, publish, directory, received } = await fixture(t);
  writeFileSync(join(directory, 'historian-chronicle.json'), '{');
  await publish('local-with-invalid-upload');
  assert.match(controller.journal(), /Summary revision 1/);
  assert.match(controller.status(), /failed attempts: 0\/3/);
  assert.match(controller.chronicleStatus(), /unavailable/); assert.equal(received.length, 0);
});

test('empty local publication does not report a nonexistent summary when upload settings are invalid', async t => {
  const { controller, publish, directory, notices } = await fixture(t);
  t.mock.method(HistorianWorker.prototype, 'run', async () => ({ proposals: [], metrics: { responseChars: 2, usage: null }, meta: { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null } }));
  writeFileSync(join(directory, 'historian-chronicle.json'), '{');
  await publish('mechanical');
  assert.doesNotMatch(controller.journal(), /Summary revision/);
  assert.doesNotMatch(notices.join('\n'), /summar(?:y|ies) saved locally|revisions? (?:was|were) not queued/);
});

test('a failed Chronicle settings read retires its dialog operation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'historian-dialog-upload-'));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = directory;
  const handlers = new Map(), notices = []; let command;
  const pi = { registerCommand(_name, spec) { command = spec; }, on(name, handler) { handlers.set(name, handler); }, events: { emit() {} }, appendEntry() {} };
  extension(pi);
  const ctx = { cwd: directory, mode: 'tui', hasUI: true, isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => 'dialog-root', getEntries: () => [] }, modelRegistry: {}, ui: { notify(value) { notices.push(value); }, setWidget() {} } };
  t.after(async () => { await handlers.get('session_shutdown')(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(directory, { recursive: true, force: true }); });
  await handlers.get('session_start')({}, ctx);
  writeFileSync(join(directory, 'historian-chronicle.json'), '{');
  await command.handler('chronicle settings', ctx);
  await command.handler('project on', ctx);
  assert.doesNotMatch(notices.at(-1), /already open/, 'no approval pane exists after the failed settings read');
});

test('ordinary Historian capture ON does not enable Chronicle upload or read an unconfigured token', async t => {
  const { controller, publish, token, received } = await fixture(t);
  unlinkSync(token); await publish('local'); await controller.reconcile();
  assert.equal(controller.chronicleConfiguration().enabled, false);
  assert.match(controller.chronicleStatus(), /Chronicle upload: OFF/);
  assert.equal(received.length, 0); assert.match(controller.journal(), /Summary revision 1/);
});
