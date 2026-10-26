import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HttpIngester, endpointURL, UploadError, encodeSnapshot, sourceIdentity, sourceKey } from '../src/ingest.ts';
import { loadConfig } from '../src/config.ts';
import { parseTranscript } from '../src/parsers.ts';
import { privacyPolicy } from '../src/privacy.ts';
import { IngestReceipt, IngestReceipt_JsonCodec } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { hash } from '../src/domain.ts';

async function harness(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-http-')); const tokenFile = join(directory, 'token'); writeFileSync(tokenFile, 'synthetic-token', { mode: 0o600 });
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address !== null && typeof address === 'object');
  const config = loadConfig({ enabled: true, endpoint: `http://127.0.0.1:${address.port}`, tokenFile, stateDir: join(directory, 'state'), uploadTimeoutMs: 100 });
  return { config, tokenFile, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); rmSync(directory, { recursive: true }); } };
}

test('GoodCommunication generated JSON boundary, UTF8/file digests and runtime token rotation', async () => {
  const requestId = randomUUID(); const received: string[] = []; const tokens: (string | undefined)[] = [];
  const h = await harness((req, res) => {
    tokens.push(req.headers.authorization); let body = ''; req.setEncoding('utf8'); req.on('data', (part: string) => { body += part; });
    req.on('end', () => { received.push(body); const receipt = new IngestReceipt(requestId, randomUUID(), 1, randomUUID()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(IngestReceipt_JsonCodec.instance.encode(BaboonCodecContext.Default, receipt))); });
  });
  try {
    const transcript = parseTranscript('pi', Buffer.from('{"type":"session","version":3,"id":"synthetic"}\n{"type":"message","id":"m","parentId":null,"message":{"role":"user","content":"你好 🦄"}}\n'), '/synthetic/s.jsonl', privacyPolicy({ fieldNames: [], textPatterns: [] }));
    const payload = encodeSnapshot(requestId, sourceIdentity('namespace', 'fixture', 'pi', transcript, '/synthetic/s.jsonl'), 0, transcript, 's.jsonl');
    const adapter = new HttpIngester(h.config);
    assert.equal((await adapter.send(payload)).requestId, requestId);
    writeFileSync(h.tokenFile, 'rotated-synthetic-token'); await adapter.send(payload);
    assert.deepEqual(received, [payload, payload]); assert.deepEqual(tokens, ['Bearer synthetic-token', 'Bearer rotated-synthetic-token']);
    const decoded = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
    assert.equal(decoded.digest, hash(transcript.raw)); assert.equal(decoded.files[0]!.sha256, decoded.digest);
    assert.equal(decoded.messages[0]!.text, '你好 🦄'); assert.equal(decoded.completion, 'Quiescent');
  } finally { await h.close(); }
});

for (const [status, code, retryable, conflict] of [[409, 'cas-conflict', false, true], [401, 'unauthorized', false, false], [429, 'http-429', true, false], [503, 'http-503', true, false], [302, 'protocol-rejected', false, false]] as const) {
  test(`GoodCommunication HTTP ${status} has observable safe ${code} policy`, async () => {
    const h = await harness((_req, res) => { res.writeHead(status, { Location: 'http://example.invalid/forbidden' }); res.end('SYNTHETIC_PRIVATE_ERROR'); });
    try { await assert.rejects(new HttpIngester(h.config).send('{}'), e => e instanceof UploadError && e.code === code && e.retryable === retryable && e.conflict === conflict && !e.message.includes('PRIVATE')); }
    finally { await h.close(); }
  });
}

test('GoodCommunication blackholed upload and oversized/malformed acknowledgements are bounded', async () => {
  for (const variant of ['blackhole', 'oversized', 'malformed']) {
    const h = await harness((_req, res) => {
      if (variant === 'blackhole') return;
      res.setHeader('Content-Type', 'application/json'); res.end(variant === 'oversized' ? 'x'.repeat(65_537) : '{"requestId":"not-uuid"}');
    });
    try { await assert.rejects(new HttpIngester(h.config).send('{}'), e => e instanceof UploadError && e.code === (variant === 'blackhole' ? 'network-failed' : variant === 'oversized' ? 'receipt-too-large' : 'invalid-receipt')); }
    finally { await h.close(); }
  }
});

test('BA URL policy rejects credential/query endpoints and plaintext outside loopback without explicit trust', () => {
  assert.throws(() => endpointURL('http://example.invalid', false), /insecure-endpoint/);
  assert.throws(() => endpointURL('https://user:password@example.invalid', false), /endpoint-credentials-forbidden/);
  assert.throws(() => endpointURL('https://example.invalid/?token=secret', false), /endpoint-credentials-forbidden/);
  assert.equal(endpointURL('http://example.invalid', true).pathname, '/api/ingest');
  assert.equal(endpointURL('https://example.invalid', false).pathname, '/api/ingest');
});

test('BA Pi restoration namespace scopes stable episodes without inventing producer or agent IDs', () => {
  const transcript = parseTranscript('pi', Buffer.from('{"type":"session","version":3,"id":"origin"}\n'), '/synthetic/subagents/root/sessions/agent/canonical.jsonl', privacyPolicy({ fieldNames: [], textPatterns: [] }));
  const identity = (format: 'pi' | 'claude' | 'codex', path: string) => sourceIdentity('namespace', 'native', format, transcript, path);
  const canonical = identity('pi', '/original/2026-01-01_origin.jsonl');
  assert.equal(sourceKey(canonical), hash(JSON.stringify(['namespace', 'native', 'Pi', 'origin', 'agent'])));
  assert.deepEqual(identity('pi', '/moved/another.jsonl'), canonical);
  const restored = identity('pi', '/original/restored-12345678-abcdef01.jsonl');
  assert.equal(restored.collectorNamespace, `namespace/pi-restored/${hash('restored-12345678-abcdef01')}`);
  assert.equal(restored.producerSessionId, 'origin'); assert.equal(restored.subagentId, 'agent');
  assert.notEqual(sourceKey(restored), sourceKey(canonical));
  assert.deepEqual(identity('pi', '/copied/restored-12345678-abcdef01.jsonl'), restored);
  assert.deepEqual(identity('pi', 'C:\\copied\\restored-12345678-abcdef01.jsonl'), restored);
  assert.equal(sourceIdentity('namespace', 'native', 'pi', { ...transcript, subagentId: null }, '/original/restored-12345678-abcdef01.jsonl').subagentId, undefined);
  assert.notEqual(sourceKey(identity('pi', '/original/restored-12345678-abcdef02.jsonl')), sourceKey(restored));
  assert.notEqual(sourceKey(sourceIdentity('namespace', 'native', 'pi', { ...transcript, subagentId: 'other-agent' }, '/original/restored-12345678-abcdef01.jsonl')), sourceKey(restored));
  for (const path of ['/original/not-restored-12345678-abcdef01.jsonl', '/original/restored-invalid.jsonl', '/original/restored-1234567-abcdef01.jsonl', '/original/restored-12345678-ABCDEF01.jsonl', '/restored-12345678-abcdef01.jsonl/canonical.jsonl']) assert.deepEqual(identity('pi', path), canonical);
  for (const format of ['claude', 'codex'] as const) assert.equal(identity(format, '/original/restored-12345678-abcdef01.jsonl').collectorNamespace, 'namespace');
});
