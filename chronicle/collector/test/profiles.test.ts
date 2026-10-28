import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { discoverRoots, scanRoots } from '../src/discovery.ts';
import { Collector } from '../src/collector.ts';
import { MemorySpool } from '../src/spool.ts';
import { noGit, acceptingProgress, syntheticSecrets } from './helpers.ts';
import type { Ingester } from '../src/ingest.ts';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const pi = readFileSync(new URL('fixtures/pi.jsonl', import.meta.url), 'utf8');
function file(path: string, raw: string): void { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, raw); }
function config(homeDir: string, extra: Record<string, unknown>) {
  return loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(homeDir, 'token'), stateDir: join(homeDir, 'state'), homeDir, quietMs: 0, ...extra });
}
const decode = (payload: string) => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
class AcceptingIngester implements Ingester {
  readonly payloads: string[] = [];
  async send(payload: string): Promise<IngestReceipt> {
    this.payloads.push(payload); const request = decode(payload);
    return new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
  }
}

for (const platform of ['linux', 'darwin']) {
  test(`GoodCommunication specified: ${platform} named storage roots retain recorded claims for all harness layouts and Pi children`, () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-profiles-'));
    try {
      const named = join(home, '.config/yolo/Named_1.2');
      const claude = platform === 'darwin' ? 'claude' : 'claude/home';
      const codex = platform === 'darwin' ? 'codex' : 'codex/home';
      const agent = platform === 'darwin' ? 'pi' : 'pi/home/agent';
      for (const path of [`${claude}/projects/p/main.jsonl`, `${claude}/projects/p/main/subagents/agent-child.jsonl`, `${codex}/sessions/2026/main.jsonl`, `${codex}/archived_sessions/2026/main.jsonl`, `${agent}/sessions/p/main.jsonl`, `${agent}/subagents/root/sessions/child/session.jsonl`]) file(join(named, path), '{}\n');
      file(join(home, '.pi/agent/sessions/p/main.jsonl'), '{}\n');
      const c = config(home, {}); const scan = scanRoots(discoverRoots(c, platform), c);
      const sources = scan.files.filter(source => source.root.profile === 'Named_1.2');
      assert.equal(sources.length, 6);
      assert.ok(sources.every(source => source.root.id === 'yolo:Named_1.2'));
      assert.equal(sources.filter(source => source.root.layout === 'pi-subagents').length, 1);
      assert.equal(scan.files.find(source => source.root.id === 'native')!.root.profile, null);
    } finally { rmSync(home, { recursive: true }); }
  });
}

test('GoodCommunication specified: recorded profile roots do not alter tags, raw identity or acknowledged snapshots; explicit root claims are not discovery attestation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-profiles-')); const spool = new MemorySpool(); const ingester = new AcceptingIngester();
  try {
    file(join(home, '.config/yolo/named/pi/home/agent/sessions/p/main.jsonl'), pi);
    file(join(home, '.config/yolo/named/pi/home/agent/subagents/root/sessions/child/session.jsonl'), pi);
    file(join(home, '.pi/agent/sessions/p/main.jsonl'), pi);
    file(join(home, 'explicit/main.jsonl'), pi);
    const c = config(home, { roots: [{ id: 'yolo:ExplicitClaim', format: 'pi', path: join(home, 'explicit') }] });
    const explicit = discoverRoots(c, 'linux').find(root => root.id === 'yolo:ExplicitClaim')!;
    assert.equal(explicit.profile, null);
    const collector = new Collector(c, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
    assert.equal((await collector.runOnce(1)).uploaded, 4);
    const requests = ingester.payloads.map(decode);
    assert.deepEqual(new Set(requests.map(request => request.source.discoveryRootId)), new Set(['native', 'yolo:named', 'yolo:ExplicitClaim']));
    const named = requests.filter(request => request.source.discoveryRootId === 'yolo:named');
    assert.deepEqual(new Set(named.map(request => request.source.subagentId)), new Set([undefined, 'child']));
    for (const request of requests) {
      assert.ok(!request.metadata.tags.some(tag => tag.startsWith('yolo-profile:')));
      assert.equal(request.expectedRevision, 0);
    }
    assert.equal((await collector.runOnce(2)).unchanged, 4);
    assert.equal(ingester.payloads.length, 4);
    assert.deepEqual(spool.dropped(), []);
  } finally { spool.close(); rmSync(home, { recursive: true }); }
});
