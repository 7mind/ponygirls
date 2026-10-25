import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript } from '../src/parsers.ts';
import { privacyPolicy } from '../src/privacy.ts';

const policy = privacyPolicy({ fieldNames: ['apiKey'], textPatterns: ['SYNTHETIC_SECRET'] });
const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url));

test('BA Pi preserves all branches, compaction originals, tree edges, tool arguments and Unicode', () => {
  const parsed = parseTranscript('pi', fixture('pi'), 'session.jsonl', policy);
  assert.equal(parsed.producerId, 'pi-synthetic');
  assert.equal(parsed.parentId, '/synthetic/parent.jsonl');
  assert.equal(parsed.records.length, 9);
  assert.equal(parsed.records[3]!.parentId, 'u');
  assert.match(parsed.messages.map(m => m.text).join('\n'), /你好 🦄/u);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /synthetic-command/);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /tool output/);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /left branch/);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /summary/);
  assert.equal(parsed.metadata.model, 'synthetic-model');
  assert.equal(parsed.records[2]!.value['futureField'], 'preserved');
});

test('BA exact permitted JSONL bytes are unchanged; binary and configured fields are stripped before output', () => {
  const original = Buffer.from('{ "type":"session", "version":3,"id":"s","cwd":"/synthetic"}\n{"type":"message","id":"u","parentId":null,"message":{"role":"user","content":"hi"}}\n');
  assert.equal(parseTranscript('pi', original, 's.jsonl', policy).raw, original.toString());
  const parsed = parseTranscript('pi', fixture('pi'), 's.jsonl', policy);
  assert.equal(parsed.redacted, true);
  assert.doesNotMatch(JSON.stringify(parsed), /BINARY_PAYLOAD|SYNTHETIC_SECRET/);
  assert.match(parsed.raw, /\[REDACTED/);
});

test('BA Claude same-session subagents have distinct producer identities, tools and all branches retained', () => {
  const parent = parseTranscript('claude', fixture('claude'), 'parent.jsonl', policy);
  const child = parseTranscript('claude', fixture('claude-subagent'), 'parent/subagents/agent-worker.jsonl', policy);
  assert.equal(parent.producerId, child.producerId);
  assert.equal(parent.subagentId, null);
  assert.equal(child.subagentId, 'worker');
  assert.match(parent.messages.map(m => m.text).join('\n'), /tool_use.*synthetic-command/);
  assert.match(parent.messages.map(m => m.text).join('\n'), /tool result/);
  assert.equal(parent.records[2]!.parentId, 'cu');
  assert.match(parent.raw, /unknownFuture/);
});

test('BA Codex response messages are canonical and mirrored event messages are not duplicated', () => {
  const parsed = parseTranscript('codex', fixture('codex'), 'rollout-synthetic.jsonl', policy);
  assert.equal(parsed.producerId, 'codex-thread');
  assert.equal(parsed.parentId, 'codex-parent');
  assert.equal(parsed.messages.filter(m => m.text.includes('你好 🦄')).length, 1);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /synthetic-command/);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /tool output/);
  assert.match(parsed.messages.map(m => m.text).join('\n'), /event-only unique/);
  assert.equal(parsed.metadata.gitRemote, 'https://example.invalid/repo.git');
  assert.equal(parsed.metadata.model, 'codex-synthetic-model');
  assert.equal(parsed.records.length, 10);
  assert.doesNotMatch(parsed.raw, /credential|token=|BINARY_PAYLOAD/);
});

test('BA malformed/unsupported/partial JSONL has stable safe diagnostic codes without excerpts', () => {
  assert.throws(() => parseTranscript('pi', Buffer.from('{"type":"session"'), 'x.jsonl', policy), /partial-line/);
  assert.throws(() => parseTranscript('pi', Buffer.from('{secret}\n'), 'x.jsonl', policy), e => e instanceof Error && e.message === 'invalid-json');
  assert.throws(() => parseTranscript('pi', Buffer.from('{"type":"session","version":99,"id":"s"}\n'), 'x.jsonl', policy), /unsupported-version/);
  assert.throws(() => parseTranscript('pi', Buffer.from('{"type":"not-session"}\n'), 'x.jsonl', policy), /missing-session-identity/);
});

test('BA Codex paginated completed items normalize tools/args/messages without treating turns as session-end', () => {
  const parsed = parseTranscript('codex', fixture('codex-paginated'), 'rollout-paginated.jsonl', policy);
  assert.equal(parsed.messages.length, 5);
  assert.equal(parsed.messages[0]!.id, 'user-item');
  const combined = parsed.messages.map(m => m.text).join('\n');
  assert.match(combined, /你好 🦄/u); assert.match(combined, /synthetic-command/);
  assert.match(combined, /synthetic command output/); assert.match(combined, /argument text/);
  assert.match(combined, /MCP tool output/); assert.match(combined, /reasoning summary/);
  assert.equal(parsed.messages.filter(m => m.text === 'final answer').length, 1);
  assert.match(parsed.raw, /external-prefix-reference/);
});
