import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { lineReads } from '../src/lines.ts';
import { preflight, type CodexBalance, type Preflight, type PreflightInput } from '../src/passes.ts';
import { resolveRuntimePrivacy } from '../src/runtime-privacy.ts';
import { Sha256 } from '../src/sha256.ts';
import type { Format } from '../src/domain.ts';
import { syntheticSecrets } from './helpers.ts';

const MiB = 1_048_576;
const fixture = (name: string): string[] => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url), 'utf8').trimEnd().split('\n');
const jsonl = (...records: unknown[]): string => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const codexEvent = (text: string) => ({ timestamp: '2026-01-01T00:01:00Z', type: 'event_msg', payload: { type: 'agent_message', message: text } });
const codexResponse = (text: string) => ({ timestamp: '2026-01-01T00:01:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
const subagentTitle = '[subagent worker task synthetic-task]\nTitle from the first user message\nsecond line';
// Prefix and delta of each fixture: identity, redaction, evidence, title and Codex duplicates span the checkpoint.
const cases: { name: string; format: Format; path: string; prefix: string; delta: string; resumed: boolean }[] = [
  { name: 'Pi: redacted lines, a new cwd and a session name in the addition', format: 'pi', path: 'main.jsonl', prefix: fixture('pi').slice(0, 4).join('\n') + '\n', resumed: true,
    delta: fixture('pi').slice(4).join('\n') + '\n' + jsonl({ type: 'message', id: 'n', parentId: 'bash', cwd: '/synthetic/other', message: { role: 'user', content: 'later', apiKey: 'SYNTHETIC_SECRET' } }, { type: 'session_info', name: 'named later' }) },
  { name: 'Pi subagent: the title is the first user message without its harness line', format: 'pi', path: 'subagents/root/sessions/worker/s.jsonl', resumed: true,
    prefix: jsonl({ type: 'session', version: 3, id: 'pi-child', cwd: '/synthetic/project' }, { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: subagentTitle } }),
    delta: jsonl({ type: 'message', id: 'u2', parentId: 'u', message: { role: 'user', content: 'another user message' } }) },
  { name: 'Claude: the agent identity appears only in the addition', format: 'claude', path: 'c.jsonl', resumed: true,
    prefix: jsonl({ type: 'summary', summary: 'synthetic summary', leafUuid: 'x' }, { type: 'user', uuid: 'u', parentUuid: null, sessionId: 'claude-late', message: { role: 'user', content: 'first' } }),
    delta: jsonl({ type: 'assistant', uuid: 'a', parentUuid: 'u', sessionId: 'claude-late', agentId: 'late-agent', message: { role: 'assistant', model: 'claude-synthetic', content: [{ type: 'text', text: 'reply' }] } }) },
  { name: 'Codex: event messages dropped by credits of the prefix and of the addition, a kept event kept', format: 'codex', path: 'x.jsonl', resumed: true,
    prefix: fixture('codex').slice(0, 9).join('\n') + '\n',
    delta: jsonl(codexEvent('function_call exec_command {"command":"synthetic-command"}'), codexResponse('fresh reply'), codexEvent('fresh reply'), codexEvent('event-only unique')) },
  { name: 'Codex: a response item matching a kept event of the prefix needs the full pass', format: 'codex', path: 'y.jsonl', resumed: false,
    prefix: fixture('codex').slice(0, 9).join('\n') + '\n', delta: jsonl(codexResponse('event-only unique')) },
];

test('Incremental pass 1 over prefix ‖ addition equals the full pass and parses only the addition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-passes-'));
  try {
    const policy = resolveRuntimePrivacy(loadConfig({ enabled: false }), syntheticSecrets).policy;
    for (const sample of cases) {
      const path = join(dir, sample.format, sample.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, sample.prefix);
      const file = { root: { id: sample.format, format: sample.format, path: join(dir, sample.format), layout: 'transcripts' as const, profile: null, origin: { kind: 'explicit' as const } }, path, relativePath: sample.path };
      const input = (start: PreflightInput['start'], prefixRecords: number | null): PreflightInput => ({ file, policy, exclusions: { roots: [], profiles: [], projects: [], sessions: [], paths: [] },
        maxFileBytes: MiB, scanBudget: MiB, recordCap: MiB, maxMessages: 1_000, prefixRecords, start });
      const first = preflight(input({ reason: 'no-checkpoint' }, null));
      assert.ok(first.end !== null && first.transcript !== null, sample.name);
      const balances = new Map<string, CodexBalance>((first.end.codex?.rows ?? []).map(([key, credits, kept]) => [key, { credits, kept }]));
      appendFileSync(path, sample.delta);
      lineReads.bytes = 0n;
      const resumed = preflight(input({ checkpoint: first.end.state, codex: key => balances.get(key) }, null));
      const parsed = lineReads.bytes;
      const full = preflight(input({ reason: 'no-checkpoint' }, first.transcript.recordCount));
      const delta = BigInt(Buffer.byteLength(sample.delta)); const size = BigInt(Buffer.byteLength(sample.prefix)) + delta;
      if (!sample.resumed) {
        assert.deepEqual([resumed.pass.kind, resumed.pass.reason, resumed.pass.parsedBytes], ['full', 'codex-dedup-changed', size], sample.name);
        continue;
      }
      assert.deepEqual(resumed.pass, { kind: 'incremental', reason: null, parsedBytes: delta, hashedBytes: size - delta }, sample.name);
      // Codex reads the addition twice: its response items first, then every record.
      assert.equal(parsed, (sample.format === 'codex' ? 2n : 1n) * delta, sample.name);
      const comparable = (result: Preflight) => ({ ...result, pass: null, end: result.end === null ? null : result.end.state });
      assert.deepEqual(comparable(resumed), comparable(full), sample.name);
      // The incremental Codex rows are the changes: applied to the prefix's rows they give the full pass's rows.
      for (const [key, credits, kept] of resumed.end?.codex?.rows ?? []) if (credits === 0 && kept === 0) balances.delete(key); else balances.set(key, { credits, kept });
      assert.deepEqual(balances, new Map((full.end?.codex?.rows ?? []).map(([key, credits, kept]) => [key, { credits, kept }])), sample.name);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('Resumable SHA-256 equals node:crypto on random inputs exported and resumed at random points', () => {
  for (let round = 0; round < 500; round++) {
    const input = randomBytes(Math.floor(Math.random() * 4_096));
    const cuts = Array.from({ length: Math.floor(Math.random() * 4) }, () => Math.floor(Math.random() * (input.length + 1))).sort((a, b) => a - b);
    let hash = new Sha256(); let from = 0;
    for (const cut of [...cuts, input.length]) {
      hash.update(input.subarray(from, cut)); from = cut;
      const state = hash.state();
      assert.ok(state.length >= 80 && state.length <= 206, state);
      hash = Sha256.resume(state);
    }
    assert.equal(hash.digest(), createHash('sha256').update(input).digest('hex'));
  }
});
