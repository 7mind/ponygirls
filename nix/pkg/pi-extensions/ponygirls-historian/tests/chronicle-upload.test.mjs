import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { JournalStore } from '../src/store.ts';
import { evidenceFromEntry } from '../src/evidence.ts';
import { resolveChronicleBinding, encodeSummary, deliverChronicle as deliverAuthorizedChronicle, HttpChronicleTransport } from '../src/chronicle-upload.ts';
const deliverChronicle = (store, binding, transport, signal) => deliverAuthorizedChronicle(store, binding, transport, signal, (_binding, admit) => { admit(); return true; });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-http-'));
  const tokenFile = join(directory, 'token'); writeFileSync(tokenFile, 'synthetic-token-'.repeat(4), { mode: 0o600 });
  const settings = { enabled: true, endpoint: 'http://127.0.0.1:1/api/ingest', tokenFile, collectorNamespace: 'synthetic-historian' };
  const store = new JournalStore(':memory:', '/repo/.git');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  function commit(binding, id) {
    const e = evidenceFromEntry('native', 'root', { type: 'message', id, parentId: null, timestamp: '2026-11-16T12:00:00Z', message: { role: 'user', content: 'PRIVATE_RAW_BODY', timestamp: 1 } });
    store.capture('root', true, [], [e], []);
    return store.commit(store.batch('root'), [{ episodeId: null, expectedRevision: 0, title: 'Synthetic summary', kind: 'discovery', status: 'inconclusive', claims: [{ section: 'learning', basis: 'hypothesis', text: 'Only a hypothesis 🌸', evidence: [e.ref] }] }], { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null, chronicle: binding });
  }
  return { directory, settings, store, commit };
}
async function server(t, handler) {
  const value = createServer(handler); value.listen(0, '127.0.0.1'); await once(value, 'listening');
  t.after(() => new Promise(resolve => { value.closeAllConnections(); value.close(resolve); }));
  return `http://127.0.0.1:${value.address().port}/api/ingest`;
}
const ack = payload => ({ requestId: payload.requestId, sessionId: '00000000-0000-4000-8000-000000000001', revision: payload.expectedRevision + 1, jobId: '00000000-0000-4000-8000-000000000002' });

for (const real of [false, true]) test(`summary delivery contract (${real ? 'loopback HTTP' : 'handwritten transport'}): exact replay after lost ACK`, async t => {
  const { settings, store, commit } = fixture(t); const observed = []; let lose = true;
  const handle = payload => { observed.push(payload); if (lose) { lose = false; return null; } return ack(JSON.parse(payload)); };
  let transport;
  if (real) {
    settings.endpoint = await server(t, async (req, res) => {
      assert.equal(req.url, '/api/ingest'); assert.equal(req.headers.authorization, `Bearer ${'synthetic-token-'.repeat(4)}`);
      let body = ''; for await (const chunk of req) body += chunk;
      const receipt = handle(body); if (receipt === null) req.socket.destroy(); else res.end(JSON.stringify(receipt));
    });
    transport = new HttpChronicleTransport(1000);
  } else transport = { async send(_binding, payload) { const receipt = handle(payload); if (receipt === null) throw new Error('PRIVATE_TRANSPORT_ERROR'); return receipt; } };
  const binding = resolveChronicleBinding(settings); commit(binding, 'first');
  const first = store.nextChronicle(binding); const wire = JSON.parse(encodeSummary(first));
  assert.equal(wire.source.format, 'Historian'); assert.equal(wire.source.producerSessionId, first.document.episode.episodeId);
  assert.equal(wire.source.discoveryRootId, first.document.journalId);
  assert.equal(wire.metadata.workdir, null); assert.equal(wire.metadata.gitBranch, null);
  assert.equal(wire.messages[0].role, 'historian'); assert.match(wire.messages[0].text, /learning \(hypothesis\)/);
  assert.doesNotMatch(wire.files[0].content, /PRIVATE_RAW_BODY|tokenFile|tokenHash/);
  assert.equal((await deliverChronicle(store, binding, transport, new AbortController().signal)).error, 'network-failed');
  assert.equal(store.chronicleStatus(binding).pending, 1);
  assert.equal((await deliverChronicle(store, binding, transport, new AbortController().signal)).state, 'acknowledged');
  assert.equal(observed[0], observed[1]); assert.equal(store.chronicleStatus(binding).acknowledged, 1);
});

test('denied admission preserves the exact pending state without spending a delivery attempt', async t => {
  const { settings, store, commit } = fixture(t); const binding = resolveChronicleBinding(settings);
  commit(binding, 'paused'); const before = store.nextChronicle(binding);
  const result = await deliverAuthorizedChronicle(store, binding, { async send() { assert.fail('denied admission must not invoke transport'); } }, new AbortController().signal, () => false);
  assert.equal(result.state, 'paused'); assert.deepEqual(store.nextChronicle(binding), before);
});

test('credential rotation starts an isolated wire source stream instead of resetting CAS on the old source', t => {
  const { settings, store, commit } = fixture(t);
  const firstBinding = resolveChronicleBinding(settings), [revision] = commit(firstBinding, 'first');
  const first = store.nextChronicle(firstBinding), original = JSON.parse(encodeSummary(first));
  store.prepareChronicle(first.requestId, JSON.stringify(original), 0); store.ackChronicle(first.requestId, ack(original));
  const nextBinding = { ...firstBinding, tokenHash: 'b'.repeat(64) };
  const e = evidenceFromEntry('native', 'root', { type: 'message', id: 'updated', parentId: null, timestamp: '2026-11-16T12:01:00Z', message: { role: 'user', content: 'SYNTHETIC_UPDATE', timestamp: 1 } });
  store.capture('root', true, [], [e], []);
  store.commit(store.batch('root'), [{ episodeId: revision.episodeId, expectedRevision: 1, title: revision.title, kind: revision.kind, status: revision.status,
    claims: [{ section: 'observation', basis: 'reported', text: 'Updated summary', evidence: [e.ref] }] }], { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null, chronicle: nextBinding });
  const next = store.nextChronicle(nextBinding), wire = JSON.parse(encodeSummary(next));
  assert.equal(next.expectedRevision, 0);
  assert.notDeepEqual(wire.source, original.source, 'unknown credential-owner continuity cannot reuse the old wire source with a reset CAS');
  assert.ok(wire.source.collectorNamespace.length <= 256);
});

test('permanent encoding failure stops only its source and does not starve another episode', async t => {
  const { settings, store, commit } = fixture(t); const binding = resolveChronicleBinding(settings);
  const gaps = Array.from({ length: 100 }, (_, i) => `${i}:${'x'.repeat(90000)}`);
  store.capture('root', true, [], [], gaps); commit(binding, 'oversized');
  store.capture('other', true, [], [], []);
  const e = evidenceFromEntry('other-native', 'root', { type: 'message', id: 'small', parentId: null, timestamp: '2026-11-16T12:00:00Z', message: { role: 'user', content: 'small', timestamp: 1 } });
  store.capture('other', true, [], [e], []);
  store.commit(store.batch('other'), [{ episodeId: null, expectedRevision: 0, title: 'Small summary', kind: 'discovery', status: 'ongoing', claims: [{ section: 'observation', basis: 'reported', text: 'Small claim', evidence: [e.ref] }] }], { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null, chronicle: binding });
  let sends = 0; const transport = { async send(_binding, payload) { sends++; return ack(JSON.parse(payload)); } };
  const failed = await deliverChronicle(store, binding, transport, new AbortController().signal);
  assert.equal(failed.error, 'payload-too-large'); assert.equal(store.chronicleStatus(binding).stopped, 1);
  assert.equal((await deliverChronicle(store, binding, transport, new AbortController().signal)).state, 'acknowledged');
  assert.equal(sends, 1);
});

test('private token validation rejects unsafe files, and token rotation cannot reroute a pending payload', async t => {
  const { settings, store, commit } = fixture(t); let requests = 0;
  settings.endpoint = await server(t, (_req, res) => { requests++; res.end('{}'); });
  const binding = resolveChronicleBinding(settings); commit(binding, 'first');
  chmodSync(settings.tokenFile, 0o644); assert.throws(() => resolveChronicleBinding(settings), /token-file-unavailable/);
  chmodSync(settings.tokenFile, 0o600); writeFileSync(settings.tokenFile, 'different-token-'.repeat(4));
  const result = await deliverChronicle(store, binding, new HttpChronicleTransport(100), new AbortController().signal);
  assert.equal(result.error, 'credential-changed'); assert.equal(requests, 0);
  assert.equal(store.chronicleStatus(binding).pending, 1);
});

for (const failure of ['redirect', 'oversize', 'wrong-request', 'wrong-revision', 'wrong-id', 'conflict', 'deadline']) test(`HTTP delivery fails closed: ${failure}`, async t => {
  const { settings, store, commit } = fixture(t); let redirected = 0;
  const other = await server(t, (_req, res) => { redirected++; res.end('{}'); });
  settings.endpoint = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const receipt = ack(JSON.parse(body));
    if (failure === 'redirect') { res.writeHead(307, { location: other }); res.end(); }
    else if (failure === 'oversize') res.end('x'.repeat(65537));
    else if (failure === 'deadline') { res.writeHead(200); res.flushHeaders(); }
    else if (failure === 'conflict') { res.writeHead(409); res.end('PRIVATE_SERVER_BODY'); }
    else res.end(JSON.stringify({ ...receipt, ...(failure === 'wrong-request' ? { requestId: receipt.jobId } : failure === 'wrong-revision' ? { revision: 77 } : { sessionId: 'invalid' }) }));
  });
  const binding = resolveChronicleBinding(settings); commit(binding, 'first');
  const result = await deliverChronicle(store, binding, new HttpChronicleTransport(failure === 'deadline' ? 50 : 1000), new AbortController().signal);
  assert.equal(result.state, 'failed'); assert.equal(store.chronicleStatus(binding).pending, 1);
  assert.equal(store.chronicleStatus(binding).acknowledged, 0); assert.equal(redirected, 0);
  assert.equal(store.chronicleStatus(binding).stopped, failure === 'deadline' ? 0 : 1, 'nonretryable outcomes require an explicit retry');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
