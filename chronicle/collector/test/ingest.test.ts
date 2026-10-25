import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HttpIngester, endpointURL, UploadError, encodeSnapshot, sourceIdentity } from '../src/ingest.ts';
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
    const payload = encodeSnapshot(requestId, sourceIdentity('namespace', 'fixture', 'pi', transcript), 0, transcript, 's.jsonl');
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
