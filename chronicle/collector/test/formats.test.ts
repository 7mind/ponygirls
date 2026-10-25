import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Collector } from '../src/collector.ts';
import { noGit } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { MemorySpool } from '../src/spool.ts';
import { IngestRequest, IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url));

test('BG all three formats plus Claude/Pi subagents flow through discovery/privacy/spool/generated boundary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-formats-')); const spool = new MemorySpool(); const requests: IngestRequest[] = [];
  try {
    const write = (relative: string, name: string): void => { const path = join(directory, relative); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, fixture(name)); };
    write('.pi/agent/sessions/project/main.jsonl', 'pi');
    write('.pi/agent/subagents/parent/sessions/worker/child.jsonl', 'pi');
    write('.claude/projects/project/main.jsonl', 'claude');
    write('.claude/projects/project/main/subagents/agent-worker.jsonl', 'claude-subagent');
    write('.codex/archived_sessions/2026/rollout.jsonl', 'codex');
    const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(directory, 'token'), stateDir: join(directory, 'state'), homeDir: directory, quietMs: 0 });
    const collector = new Collector(config, spool, { async send(payload: string) { const request = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown); requests.push(request); return new IngestReceipt(request.requestId, randomUUID(), 1, randomUUID()); } }, () => 0, noGit);
    assert.equal((await collector.runOnce(1)).uploaded, 5);
    assert.equal(requests.filter(r => r.source.format === 'Pi').length, 2);
    assert.equal(requests.filter(r => r.source.subagentId === 'worker').length, 2);
    assert.ok(requests.every(r => r.completion === 'Quiescent' && r.metadata.endedAt === undefined));
    assert.ok(requests.every(r => r.source.discoveryRootId === 'native'));
    assert.ok(requests.some(r => r.files[0]!.path === 'project/main/subagents/agent-worker.jsonl'));
    assert.doesNotMatch(JSON.stringify(requests), /BINARY_PAYLOAD|credential@example/);
  } finally { spool.close(); rmSync(directory, { recursive: true }); }
});

test('BG excluding a Pi root session also excludes its subordinate transcript directory before parsing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-excluded-parent-')); const spool = new MemorySpool();
  try {
    const path = join(directory, '.pi/agent/subagents/excluded-root/sessions/worker/child.jsonl'); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, fixture('pi'));
    const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(directory, 'token'), stateDir: join(directory, 'state'), homeDir: directory, quietMs: 0, exclusions: { sessions: ['excluded-root'] } });
    const collector = new Collector(config, spool, { async send() { throw new Error('excluded child must not upload'); } }, () => 0, noGit);
    const result = await collector.runOnce(1);
    assert.equal(result.excluded, 1); assert.equal(result.scanned, 0); assert.equal(result.uploadFailures, 0);
  } finally { spool.close(); rmSync(directory, { recursive: true }); }
});
