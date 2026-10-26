import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseTranscript } from '../src/parsers.ts';
import { resolveRuntimePrivacy, FileSecretReader, type SecretReader } from '../src/runtime-privacy.ts';
import { loadConfig } from '../src/config.ts';
import { Collector } from '../src/collector.ts';
import { SqliteSpool, MemorySpool } from '../src/spool.ts';
import { UploadError } from '../src/ingest.ts';
import { CollectorError } from '../src/domain.ts';
import { acceptingProgress, noGit } from './helpers.ts';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';

class DummySecretReader implements SecretReader {
  readonly values = new Map<string, string>();
  read(path: string): string {
    const value = this.values.get(path);
    if (value === undefined) throw new CollectorError('privacy-secret-unavailable');
    return value;
  }
}
function fixture(adapter: string) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-runtime-privacy-'));
  mkdirSync(join(dir, 'sessions'));
  const dummy = new DummySecretReader();
  const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'bearer'), stateDir: join(dir, 'state'), discoverNative: false, discoverYolo: false, quietMs: 0, roots: [{ id: 'fixture', format: 'pi', path: join(dir, 'sessions') }], redactions: { secretFiles: [join(dir, 'secret')] } });
  const reader: SecretReader = adapter === 'dummy' ? dummy : new FileSecretReader();
  const put = (path: string, value: string | undefined) => {
    if (value === undefined) { dummy.values.delete(path); rmSync(path, { force: true }); }
    else { dummy.values.set(path, value); writeFileSync(path, value, { mode: 0o600 }); }
  };
  put(config.tokenFile, 'synthetic-ingest-bearer\n'); put(config.redactions.secretFiles[0]!, 'synthetic-credential-plain-stdout\n');
  return { dir, config, reader, put, close: () => rmSync(dir, { recursive: true }) };
}
function transcript(text: string): Buffer {
  return Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'synthetic' }) + '\n' + JSON.stringify({ type: 'message', id: 'tool', message: { role: 'toolResult', content: [{ type: 'text', text }] } }) + '\n');
}
for (const adapter of ['dummy', 'file']) {
  // Regression: known current credentials printed as ordinary tool stdout bypass field-name rules.
  test(`runtime privacy contract ${adapter}: credentials absent from raw and normalized plain/escaped stdout`, () => {
    const f = fixture(adapter);
    try {
      const secret = 'synthetic-credential-plain-stdout';
      const escapedSecret = 'synthetic-"quoted\\credential\nsecond-line';
      f.put(f.config.redactions.secretFiles[0]!, escapedSecret + '\n');
      const second = join(f.dir, 'second'); f.put(second, secret + '\n'); f.config.redactions.secretFiles.push(second);
      const resolved = resolveRuntimePrivacy(f.config, f.reader);
      const escaped = JSON.stringify(escapedSecret).slice(1, -1);
      const bytes = transcript(`ordinary stdout: ${secret}; ${escapedSecret}; escaped=${escaped}; bearer=synthetic-ingest-bearer`);
      const parsed = parseTranscript('pi', bytes, '/synthetic/sessions/s.jsonl', resolved.policy);
      for (const value of [secret, escapedSecret, escaped, 'synthetic-ingest-bearer']) {
        assert.ok(!parsed.raw.includes(value));
        assert.ok(parsed.messages.every(message => !message.text.includes(value)));
      }
      assert.ok(parsed.redacted); assert.ok(parsed.messages.some(message => message.text.includes('[REDACTED]')));
      assert.ok(!JSON.stringify(resolved).includes(secret));
      const identity = resolved.identity;
      f.put(second, 'rotated-synthetic-value\n');
      assert.notEqual(resolveRuntimePrivacy(f.config, f.reader).identity, identity);
    } finally { f.close(); }
  });
  test(`runtime privacy contract ${adapter}: normalized concatenation cannot reconstruct a known literal`, () => {
    const f = fixture(adapter);
    try {
      const secret = 'synthetic-first\nsynthetic-second'; f.put(f.config.redactions.secretFiles[0]!, secret);
      const bytes = Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'synthetic' }) + '\n' + JSON.stringify({ type: 'message', id: 'tool', message: { role: 'toolResult', content: [{ type: 'text', text: 'synthetic-first' }, { type: 'text', text: 'synthetic-second' }] } }) + '\n');
      const parsed = parseTranscript('pi', bytes, '/synthetic/sessions/s.jsonl', resolveRuntimePrivacy(f.config, f.reader).policy);
      assert.ok(parsed.messages.every(message => !message.text.includes(secret)));
    } finally { f.close(); }
  });
  test(`runtime privacy contract ${adapter}: rotation across restart drops/tombstones old pending payloads`, async () => {
    const f = fixture(adapter); let spool = new SqliteSpool(f.config.stateDir); let sends = 0;
    try {
      writeFileSync(join(f.dir, 'sessions/s.jsonl'), transcript('stdout synthetic-credential-plain-stdout'));
      const ingester = { send: async () => { sends++; throw new UploadError('network-failed', true, false); } };
      await new Collector(f.config, spool, ingester, () => 0, noGit, acceptingProgress, f.reader).runOnce(100);
      const entry = spool.queue()[0]!;
      assert.ok(!entry.payload.includes('synthetic-credential-plain-stdout'));
      assert.ok(!JSON.stringify(spool.reporting()).includes('synthetic-credential'));
      spool.close(); spool = new SqliteSpool(f.config.stateDir);
      f.put(f.config.redactions.secretFiles[0]!, 'rotated-synthetic-value\n');
      await new Collector(f.config, spool, ingester, () => 0, noGit, acceptingProgress, f.reader).runOnce(200);
      assert.equal(sends, 1); assert.equal(spool.queue().length, 0);
      assert.equal(spool.head(entry.sourceKey).tombstone, true);
      assert.equal(spool.dropped()[0]!.reason, 'privacy-or-destination-changed');
    } finally { spool.close(); f.close(); }
  });
  for (const failure of ['missing', 'empty', 'oversized'] as const) {
    test(`runtime privacy contract ${adapter}: ${failure} fails closed before scanning or ingesting old pending`, async () => {
      const f = fixture(adapter); const spool = new MemorySpool(); let sends = 0;
      try {
        writeFileSync(join(f.dir, 'sessions/s.jsonl'), transcript('stdout synthetic-credential-plain-stdout'));
        const collector = new Collector(f.config, spool, { send: async () => { sends++; throw new UploadError('network-failed', true, false); } }, () => 0, noGit, acceptingProgress, f.reader);
        await collector.runOnce(100); assert.equal(sends, 1);
        const entry = spool.queue()[0]!;
        f.put(f.config.redactions.secretFiles[0]!, failure === 'missing' ? undefined : failure === 'empty' ? '\n' : 'x'.repeat(8193));
        const failed = await collector.runOnce(200);
        assert.equal(failed.discovered, 0); assert.equal(failed.scanned, 0); assert.equal(failed.quarantined, 1);
        assert.equal(sends, 1); assert.equal(failed.pending, 1); assert.deepEqual(spool.queue()[0], entry);
        assert.ok(spool.diagnostics().some(d => d.code === 'privacy-secret-unavailable'));
        assert.ok(!JSON.stringify(collector.status()).includes(f.config.redactions.secretFiles[0]!));
      } finally { spool.close(); f.close(); }
    });
  }
  test(`runtime privacy contract ${adapter}: own bearer always required and rotation invalidates queued policy`, async () => {
    const f = fixture(adapter); const spool = new MemorySpool(); let sends = 0;
    try {
      writeFileSync(join(f.dir, 'sessions/s.jsonl'), transcript('stdout synthetic-ingest-bearer'));
      const collector = new Collector(f.config, spool, { send: async () => { sends++; throw new UploadError('network-failed', true, false); } }, () => 0, noGit, acceptingProgress, f.reader);
      await collector.runOnce(100); const entry = spool.queue()[0]!;
      assert.ok(!entry.payload.includes('synthetic-ingest-bearer'));
      f.put(f.config.tokenFile, undefined); assert.equal((await collector.runOnce(200)).discovered, 0); assert.equal(sends, 1);
      f.put(f.config.tokenFile, 'rotated-bearer'); await collector.runOnce(300);
      assert.equal(sends, 1); assert.equal(spool.head(entry.sourceKey).tombstone, true);
    } finally { spool.close(); f.close(); }
  });
  test(`runtime privacy contract ${adapter}: successful end-to-end payload uses resolved policy`, async () => {
    const f = fixture(adapter); const spool = new MemorySpool();
    try {
      writeFileSync(join(f.dir, 'sessions/s.jsonl'), transcript('stdout synthetic-credential-plain-stdout'));
      const collector = new Collector(f.config, spool, { send: async payload => {
        assert.ok(!payload.includes('synthetic-credential-plain-stdout'));
        const request = JSON.parse(payload) as { requestId: string; expectedRevision: number; messages: { text: string }[] };
        assert.ok(request.messages.every(message => !message.text.includes('synthetic-credential-plain-stdout')));
        return new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
      } }, () => 0, noGit, acceptingProgress, f.reader);
      assert.equal((await collector.runOnce(100)).uploaded, 1);
    } finally { spool.close(); f.close(); }
  });
}
test('GoodCommunication secret reader rejects invalid UTF8, public modes, nonfiles, and store credentials; runtime symlinks work', () => {
  const f = fixture('file');
  try {
    const path = join(f.dir, 'bad');
    writeFileSync(path, Buffer.from([0xff]), { mode: 0o600 }); assert.throws(() => f.reader.read(path), /privacy-secret-unavailable/);
    const publicPath = join(f.dir, 'public'); writeFileSync(publicPath, 'synthetic', { mode: 0o644 }); assert.throws(() => f.reader.read(publicPath), /privacy-secret-unavailable/);
    assert.throws(() => f.reader.read(f.dir), /privacy-secret-unavailable/);
    assert.throws(() => f.reader.read('/nix/store'), /privacy-secret-unavailable/);
    const alias = join(f.dir, 'alias'); symlinkSync(f.config.tokenFile, alias);
    assert.equal(f.reader.read(alias), 'synthetic-ingest-bearer\n');
  } finally { f.close(); }
});
test('BA configuration validates runtime path metadata without opening secret files', () => {
  assert.doesNotThrow(() => loadConfig({ enabled: false, redactions: { secretFiles: ['/synthetic/nonexistent'] } }));
  assert.throws(() => loadConfig({ enabled: false, redactions: { secretFiles: ['relative'] } }), /invalid-config/);
});
