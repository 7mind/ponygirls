import { acceptingProgress, syntheticSecrets } from './helpers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalGitMetadata, type GitMetadata } from '../src/git.ts';
import { sanitizeRemote } from '../src/privacy.ts';
import { Collector } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { MemorySpool } from '../src/spool.ts';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest, IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

for (const adapter of ['dummy', 'local-git']) {
  test(`git port contract ${adapter}: credential-stripped current remote, missing checkout remains absent`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronicle-git-'));
    try {
      const remote = 'https://SYNTHETIC_CREDENTIAL@example.invalid/repo.git?token=SYNTHETIC_TOKEN';
      let git: GitMetadata;
      if (adapter === 'local-git') {
        const env = { PATH: process.env['PATH'] ?? '', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
        execFileSync('git', ['init', '--quiet', '--template=', dir], { env });
        execFileSync('git', ['-C', dir, 'config', '--local', 'remote.origin.url', remote], { env });
        git = new LocalGitMetadata('git', 1000, 65536);
      } else git = { async read(cwd) { return { remote: cwd === dir ? sanitizeRemote(remote) : null, diagnostic: null }; } };
      assert.equal((await git.read(dir)).remote, 'https://example.invalid/repo.git');
      assert.equal((await git.read(join(dir, 'missing-checkout'))).remote, null);
    } finally { rmSync(dir, { recursive: true }); }
  });
}

test('GoodCommunication git process timeout/output cap are bounded using synthetic executable fixture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-git-limit-'));
  try {
    writeFileSync(join(dir, 'config'), 'setTimeout(() => {}, 60000);');
    assert.equal((await new LocalGitMetadata(process.execPath, 50, 32).read(dir)).diagnostic, 'git-metadata-timeout');
    writeFileSync(join(dir, 'config'), "process.stdout.write('x'.repeat(1000));");
    assert.equal((await new LocalGitMetadata(process.execPath, 1000, 32).read(dir)).diagnostic, 'git-metadata-too-large');
  } finally { rmSync(dir, { recursive: true }); }
});

test('BG git enrichment is cached per cwd per scan, labeled current, and obeys redaction before spool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-git-enrich-')); const spool = new MemorySpool(); let calls = 0; const requests: IngestRequest[] = [];
  try {
    const sources = join(dir, 'sessions'); mkdirSync(sources);
    for (const id of ['one', 'two']) writeFileSync(join(sources, id + '.jsonl'), JSON.stringify({ type: 'session', version: 3, id, cwd: '/synthetic/cwd' }) + '\n');
    const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'token'), stateDir: join(dir, 'state'), discoverNative: false, discoverYolo: false, roots: [{ id: 'fixture', format: 'pi', path: sources }], quietMs: 0 });
    const collector = new Collector(config, spool, { async send(payload) { const request = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown); requests.push(request); return new IngestReceipt(request.requestId, randomUUID(), 1, randomUUID()); } }, () => 0, { async read() { calls++; return { remote: 'https://SYNTHETIC_SECRET@example.invalid/repo.git', diagnostic: null }; } }, acceptingProgress, syntheticSecrets);
    assert.equal((await collector.runOnce(1)).uploaded, 2); assert.equal(calls, 1);
    assert.ok(requests.every(request => request.metadata.gitRemote === 'https://example.invalid/repo.git'));
    assert.ok(requests.every(request => request.metadata.tags.includes('collector-observed-current-git-remote')));
    assert.ok(requests.every(request => request.metadata.gitCommit === undefined && request.metadata.gitBranch === undefined));
    await collector.runOnce(2); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(requests), /SYNTHETIC_SECRET/);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});
