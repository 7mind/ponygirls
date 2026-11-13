import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createMemoryTool } from '../src/memory-tools.ts';
import {
  createBuiltinCheckerRegistry,
  readTrustedModuleDigest,
  TrustedCheckerRegistry,
} from '../src/memory-checks.ts';
import { readMemory, textDigest } from '../src/memory-core.ts';

// Behavioral-Active / Blackbox-Group.
// Origin: specified model-facing boundary contract.
// Real native in-memory sessions, actual factory/NativeMemoryPort/core/reader,
// and actual bounded checker workers. No live model transport or utility claim.
// Only owned static checker/bootstrap modules are read; no filesystem writes,
// directory discovery, network, subprocess commands or external services.

const ADAPTER_URL = new URL('./fixtures/memory-check-adapters.mjs', import.meta.url);
const USER_TEXT = '{"minimum":2}';
const OPTIONS = Object.freeze({ timeout: 10000 });

function fixture(registry) {
  const manager = SessionManager.inMemory();
  let sequence = 0;
  let calls = 0;
  let appends = 0;
  let epoch = 0;
  let gate = () => false;
  const ctx = { sessionManager: manager, signal: undefined };
  const runtime = {
    newId: () => `tool-record-${++sequence}`,
    now: () => new Date(1700000000000 + sequence).toISOString(),
  };
  const pi = {
    appendEntry(type, data) {
      appends++;
      manager.appendCustomEntry(type, structuredClone(data));
    },
  };
  const tool = createMemoryTool({
    pi,
    runtime,
    registry,
    isInquiryActive: context => {
      assert.equal(context, ctx);
      return gate();
    },
    assertActionAllowed() {},
    scopeSignal: () => undefined,
    scopeKey: context => {
      assert.equal(context, ctx);
      return `tools-test/${manager.getSessionId()}/${epoch}`;
    },
  });
  const view = () => ({
    sessionId: manager.getSessionId(),
    entries: manager.getEntries(),
    branch: manager.getBranch(),
  });
  return {
    manager,
    ctx,
    tool,
    appends: () => appends,
    records: () => readMemory(view(), 'branch'),
    setGate(value) { gate = value; },
    navigate(id) {
      epoch++;
      manager.branch(id);
    },
    user(text) {
      return manager.appendMessage({ role: 'user', content: text, timestamp: 1 });
    },
    assistant(text) {
      return manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: 2,
      });
    },
    async call(input, signal) {
      const result = await tool.execute(
        `tool-call-${++calls}`, input, signal, undefined, ctx,
      );
      assert.notEqual(result.isError, true);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      assert.ok(Buffer.byteLength(result.content[0].text, 'utf8') <= 50000);
      assert.deepEqual(JSON.parse(result.content[0].text), result.details);
      return result.details;
    },
  };
}

function registryFor(exportName) {
  return new TrustedCheckerRegistry([{
    id: `test-${exportName}`,
    version: '1',
    scope: `Synthetic ${exportName} adapter only, not whole-task correctness.`,
    moduleURL: ADAPTER_URL,
    moduleDigest: readTrustedModuleDigest(ADAPTER_URL),
    exportName,
    evidence: { min: 0, max: 0, roles: [] },
  }]);
}

async function seed(f, artifactText) {
  const userEntryId = f.user(USER_TEXT);
  const task = await f.call({ action: 'task', label: 'Synthetic task' });
  const taskId = task.record.id;
  const evidence = await f.call({
    action: 'snapshot',
    taskId,
    purpose: 'evidence',
    label: 'Explicit synthetic minimum',
    selector: { entryId: userEntryId, part: 0, start: 0, end: USER_TEXT.length },
    dependsOn: [],
  });
  const assistantEntryId = f.assistant(artifactText);
  const artifact = await f.call({
    action: 'snapshot',
    taskId,
    purpose: 'artifact',
    label: 'Synthetic artifact',
    selector: {
      entryId: assistantEntryId, part: 0, start: 0, end: artifactText.length,
    },
    dependsOn: [],
  });
  return { userEntryId, taskId, task, evidence, artifact, assistantEntryId };
}

async function rejected(f, input, signal) {
  const before = f.appends();
  let details;
  await assert.rejects(
    () => f.call(input, signal),
    error => {
      assert.ok(error instanceof Error);
      details = JSON.parse(error.message);
      assert.equal(details.error, 'CUCKOO_MEMORY_ERROR');
      assert.equal(details.appendMayHaveCommitted, false);
      assert.deepEqual(details.observedAppends, []);
      assert.ok(Buffer.byteLength(error.message, 'utf8') < 50000);
      return true;
    },
  );
  assert.equal(f.appends(), before);
  return details;
}

function receipt(value, action) {
  assert.equal(value.kind, 'write-receipt');
  assert.equal(value.action, action);
  assert.equal(value.recorded, true);
  assert.equal(typeof value.record.id, 'string');
  assert.equal(typeof value.record.entryId, 'string');
  assert.equal(typeof value.record.taskId, 'string');
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 6000);
  assert.ok(!Object.hasOwn(value, 'body'));
  assert.ok(!Object.hasOwn(value, 'text'));
  assert.ok(!Object.hasOwn(value, 'verified'));
}

async function reconstruct(f, request, limit) {
  let offset = 0;
  let text = '';
  for (let count = 0; count < 256; count++) {
    const page = await f.call({ ...request, offset, limit });
    assert.equal(page.offset, offset);
    assert.equal(typeof page.total, 'number');
    // Exercise the actual model-facing JSON representation at surrogate edges.
    text += JSON.parse(JSON.stringify(page.text));
    if (page.nextOffset === null) {
      assert.equal(text.length, page.total);
      return text;
    }
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.fail('Text paging did not terminate within its bounded fixture');
}

test('complete factory drives native writes, reads, correction and a real syntax check', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const s = await seed(f, '{"count":3}');
  receipt(s.task, 'task');
  receipt(s.evidence, 'snapshot');
  receipt(s.artifact, 'snapshot');

  const claim = await f.call({
    action: 'claim',
    taskId: s.taskId,
    category: 'interpretation',
    text: 'Synthetic interpretation, not an authorization.',
    evidenceIds: [s.evidence.record.id],
    dependsOn: [s.artifact.record.id],
  });
  receipt(claim, 'claim');
  const replacement = await f.call({
    action: 'claim',
    taskId: s.taskId,
    category: 'observation',
    text: 'Replacement synthetic observation.',
    evidenceIds: [s.evidence.record.id],
    dependsOn: [],
  });
  const correction = await f.call({
    action: 'correct',
    taskId: s.taskId,
    targetIds: [claim.record.id],
    replacementIds: [replacement.record.id],
    evidenceIds: [s.evidence.record.id],
    reason: 'Synthetic revision with explicit supporting evidence.',
  });
  receipt(correction, 'correct');

  const check = await f.call({
    action: 'check',
    taskId: s.taskId,
    artifactId: s.artifact.record.id,
    checkerId: 'json-syntax',
    evidenceIds: [],
  });
  assert.equal(check.kind, 'check-receipt');
  assert.equal(check.lifecycle, 'finished');
  assert.equal(check.status, 'recorded');
  assert.equal(check.outcome, 'pass');
  assert.ok(check.start.id && check.start.entryId);
  assert.ok(check.terminal.id && check.terminal.entryId);
  assert.ok(!Object.hasOwn(check, 'verified'));
  assert.ok(!JSON.stringify(check).includes('{"count":3}'));

  const metadata = await f.call({ action: 'metadata' });
  assert.equal(metadata.kind, 'metadata');
  assert.equal(metadata.version, 1);
  assert.equal(metadata.limits.chars.default, 4000);
  const tasks = await f.call({ action: 'list-records', recordKind: 'task' });
  assert.deepEqual(tasks.records.map(item => item.id), [s.taskId]);
  const old = await f.call({ action: 'inspect', id: claim.record.id });
  assert.equal(old.status, 'superseded');
  assert.equal(old.text, 'Synthetic interpretation, not an authorization.');
  const revised = await f.call({ action: 'inspect', id: correction.record.id });
  assert.deepEqual(revised.targetIds, [claim.record.id]);
  assert.deepEqual(revised.replacementIds, [replacement.record.id]);
  assert.equal(revised.reason, 'Synthetic revision with explicit supporting evidence.');

  const start = await f.call({ action: 'inspect', id: check.start.id });
  assert.equal(start.recordKind, 'check-start');
  assert.match(start.checker.scope, /syntax/i);
  assert.deepEqual(start.artifact, {
    id: s.artifact.record.id,
    digest: textDigest('{"count":3}'),
  });
  const terminal = await f.call({ action: 'inspect', id: check.terminal.id });
  assert.equal(terminal.startId, check.start.id);
  assert.equal(terminal.outcome, 'pass');

  const sources = await f.call({ action: 'list-sources' });
  assert.ok(sources.sources.some(item => item.entryId === s.userEntryId));
  const selected = {
    entryId: s.assistantEntryId, part: 0, start: 0, end: '{"count":3}'.length,
  };
  assert.equal(
    await reconstruct(f, { action: 'source-text', selector: selected }, 3),
    '{"count":3}',
  );
  const snapshot = await f.call({ action: 'inspect', id: s.artifact.record.id });
  assert.equal(snapshot.textOmitted, true);
  assert.equal(snapshot.textAction.action, 'snapshot-text');
  assert.ok(!Object.hasOwn(snapshot, 'text'));
  assert.equal(
    await reconstruct(f, {
      action: snapshot.textAction.action,
      id: snapshot.textAction.id,
      scope: snapshot.textAction.scope,
    }, 3),
    '{"count":3}',
  );

  const persisted = f.manager.getEntry(s.artifact.record.entryId);
  assert.equal(persisted.customType, 'cuckoo.memory');
  assert.equal(persisted.data.record.text, '{"count":3}');
  assert.equal(persisted.data.record.digest, textDigest('{"count":3}'));
  assert.equal(f.records().length, 8);
});

test('public schema has a flat provider-compatible root object and plain action enum', OPTIONS, () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const schema = f.tool.parameters;
  assert.equal(f.tool.name, 'cuckoo_memory');
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['action']);
  for (const key of ['oneOf', 'anyOf', 'allOf']) assert.equal(schema[key], undefined);
  assert.equal(schema.properties.action.type, 'string');
  assert.deepEqual([...schema.properties.action.enum].sort(), [
    'task', 'snapshot', 'claim', 'correct', 'check', 'checkers',
    'metadata', 'list-records', 'inspect', 'snapshot-text',
    'list-sources', 'source-text',
  ].sort());
  assert.equal(schema.properties.selector.type, 'object');
  assert.equal(schema.properties.selector.additionalProperties, false);
  for (const field of [
    'author', 'digest', 'outcome', 'code', 'approved', 'approval', 'goal',
    'moduleURL', 'record', 'runtime', 'scopeKey',
  ]) assert.equal(schema.properties[field], undefined);
  assert.equal(f.tool.executionMode, 'sequential');
  assert.equal(f.tool.annotations.readOnlyHint, false);
  assert.equal(f.tool.annotations.openWorldHint, false);
  assert.match(f.tool.description, /not a goal/);
  assert.match(f.tool.description, /syntax pass is not task correctness/i);
});

test('large snapshot writes produce small receipts without post-commit body serialization', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const text = '\u0000\ud800\\\n'.repeat(25000);
  assert.equal(text.length, 100000);
  const s = await seed(f, text);
  receipt(s.artifact, 'snapshot');
  assert.ok(JSON.stringify(s.artifact).length < 6000);
  const stored = f.manager.getEntry(s.artifact.record.entryId).data.record;
  assert.equal(stored.text, text);
  assert.equal(stored.digest, textDigest(text));
  const inspected = await f.call({ action: 'inspect', id: s.artifact.record.id });
  assert.equal(inspected.textLength, text.length);
  assert.equal(inspected.textOmitted, true);
  assert.ok(!Object.hasOwn(inspected, 'text'));
  assert.equal(
    await reconstruct(f, { action: 'snapshot-text', id: s.artifact.record.id }, 6000),
    text,
  );
});

test('all forged write/check fields reject before any append', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const s = await seed(f, '{}');
  const task = { action: 'task', label: 'No forged fields' };
  for (const patch of [
    { id: 'forged' }, { digest: textDigest('fake') }, { author: 'user' },
    { status: 'active' }, { outcome: 'pass' }, { code: 'return true' },
    { extra: true }, { approved: true }, { approval: {} }, { goal: 'new goal' },
    { record: {} }, { toolCallId: 'forged-call' }, { runtime: {} },
  ]) await rejected(f, { ...task, ...patch });

  const snap = {
    action: 'snapshot', taskId: s.taskId, purpose: 'artifact', label: 'No raw text',
    selector: { entryId: s.assistantEntryId, part: 0, start: 0, end: 2 },
    dependsOn: [],
  };
  for (const patch of [
    { text: 'supplied body' }, { source: {} }, { digest: textDigest('{}') },
    { author: 'model' }, { scope: 'session' }, { id: 'chosen-id' },
  ]) await rejected(f, { ...snap, ...patch });

  const check = {
    action: 'check', taskId: s.taskId, artifactId: s.artifact.record.id,
    checkerId: 'json-syntax', evidenceIds: [],
  };
  for (const patch of [
    { outcome: 'pass' }, { code: 'model supplied executable' },
    { moduleURL: ADAPTER_URL.href }, { path: '/synthetic/not-read' },
    { checker: {} }, { approved: true }, { status: 'verified' },
    { scopeKey: 'forged-scope' },
  ]) await rejected(f, { ...check, ...patch });

  await rejected(f, { action: 'goal', label: 'Not a memory task' });
  await rejected(f, { action: 'approve', approved: true });
  await rejected(f, { action: 'check-start', taskId: s.taskId });
  await rejected(f, { action: 'check-result', outcome: 'pass' });
});

test('explicit same-task earlier references are required; withdrawal is a correction', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const a = await seed(f, '{}');
  const first = await f.call({
    action: 'claim', taskId: a.taskId, category: 'assumption', text: 'Old assumption',
    evidenceIds: [a.evidence.record.id], dependsOn: [],
  });
  f.user('A distinct synthetic task');
  const other = await f.call({ action: 'task', label: 'Other task' });
  const entryId = f.assistant('other');
  const otherSnapshot = await f.call({
    action: 'snapshot', taskId: other.record.id, purpose: 'artifact', label: 'Other',
    selector: { entryId, part: 0, start: 0, end: 5 }, dependsOn: [],
  });
  await rejected(f, {
    action: 'claim', category: 'observation', text: 'Missing explicit task',
    evidenceIds: [], dependsOn: [],
  });
  await rejected(f, {
    action: 'claim', taskId: a.taskId, category: 'observation', text: 'Cross task',
    evidenceIds: [otherSnapshot.record.id], dependsOn: [],
  });
  await rejected(f, {
    action: 'claim', taskId: a.taskId, category: 'observation', text: 'Dangling',
    evidenceIds: [], dependsOn: ['not-yet-a-record'],
  });
  await rejected(f, {
    action: 'claim', taskId: a.taskId, category: 'observation', text: 'Duplicate',
    evidenceIds: [a.evidence.record.id], dependsOn: [a.evidence.record.id],
  });
  await rejected(f, {
    action: 'correct', taskId: other.record.id, targetIds: [first.record.id],
    replacementIds: [], evidenceIds: [otherSnapshot.record.id], reason: 'Cross task',
  });
  const withdrawal = await f.call({
    action: 'correct', taskId: a.taskId, targetIds: [first.record.id],
    replacementIds: [], evidenceIds: [a.evidence.record.id], reason: 'Withdraw',
  });
  receipt(withdrawal, 'correct');
  const old = await f.call({ action: 'inspect', id: first.record.id });
  assert.equal(old.status, 'superseded');
  await rejected(f, {
    action: 'correct', taskId: a.taskId, targetIds: [first.record.id],
    replacementIds: [], evidenceIds: [a.evidence.record.id], reason: 'Repeat',
  });
});

test('current/alternative branches remain scoped; filters and exclusive cursors survive dispatch', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const s = await seed(f, 'alternative');
  f.navigate(s.task.record.entryId);
  const entryId = f.assistant('current');
  const current = await f.call({
    action: 'snapshot', taskId: s.taskId, purpose: 'artifact', label: 'Current',
    selector: { entryId, part: 0, start: 0, end: 7 }, dependsOn: [],
  });
  await rejected(f, { action: 'inspect', id: s.artifact.record.id });
  await rejected(f, { action: 'snapshot-text', id: s.artifact.record.id });
  const historical = await f.call({
    action: 'inspect', id: s.artifact.record.id, scope: 'session',
  });
  assert.equal(historical.branch, 'other');
  assert.equal(historical.status, null);
  assert.equal(
    await reconstruct(f, {
      action: 'snapshot-text', id: s.artifact.record.id, scope: 'session',
    }, 4),
    'alternative',
  );
  const branch = await f.call({
    action: 'list-records', taskId: s.taskId, recordKind: 'snapshot',
  });
  assert.deepEqual(branch.records.map(item => item.id), [current.record.id]);
  const session = await f.call({
    action: 'list-records', scope: 'session', taskId: s.taskId, recordKind: 'snapshot',
  });
  assert.ok(session.records.some(item => item.id === s.artifact.record.id
    && item.branch === 'other' && item.status === null));
  const active = await f.call({
    action: 'list-records', scope: 'session', taskId: s.taskId, status: 'active',
  });
  assert.ok(active.records.every(item => item.branch === 'current'));
  const first = await f.call({ action: 'list-records', limit: 1 });
  assert.ok(first.nextCursor);
  const second = await f.call({
    action: 'list-records', cursor: first.nextCursor, limit: 1,
  });
  assert.notEqual(first.records[0].entryId, second.records[0].entryId);
  await rejected(f, {
    action: 'list-records', cursor: s.artifact.record.entryId,
  });
  await rejected(f, {
    action: 'claim', taskId: s.taskId, category: 'observation', text: 'Cross branch',
    evidenceIds: [s.artifact.record.id], dependsOn: [],
  });
  const sources = await f.call({ action: 'list-sources', scope: 'session' });
  assert.ok(sources.sources.some(item =>
    item.entryId === s.assistantEntryId && item.branch === 'other'));
});

test('exact text pages preserve code units, controls and lone surrogates through JSON', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const text = 'x🐦\ud800\u0000\\\n\r\udfffé';
  const s = await seed(f, text);
  const request = { action: 'snapshot-text', id: s.artifact.record.id };
  assert.equal(await reconstruct(f, request, 1), text);
  const split = await f.call({ ...request, offset: 2, limit: 1 });
  assert.equal(split.text, text.slice(2, 3));
  assert.equal(split.offset, 2);
  assert.equal(split.total, text.length);
  const end = await f.call({ ...request, offset: text.length });
  assert.equal(end.text, '');
  assert.equal(end.nextOffset, null);
  assert.equal(
    await reconstruct(f, {
      action: 'source-text',
      selector: { entryId: s.assistantEntryId, part: 0, start: 0, end: text.length },
    }, 1),
    text,
  );
  await rejected(f, { ...request, offset: text.length + 1 });
});

test('malformed payloads, irrelevant read fields and bounds fail as SDK exceptions', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const s = await seed(f, '{}');
  for (const input of [
    null, undefined, [], 'metadata', {}, { action: 'unknown' },
    { action: 'task' }, { action: 'task', label: null },
    { action: 'task', label: ' ' },
    { action: 'metadata', limit: 1 },
    { action: 'checkers', approved: true },
    { action: 'inspect', id: s.taskId, offset: 0 },
    { action: 'list-records', scope: 'all' },
    { action: 'list-records', status: 'verified' },
    { action: 'list-records', taskId: 'x'.repeat(129) },
    { action: 'list-records', limit: 21 },
    { action: 'list-records', limit: '1' },
    { action: 'list-records', limit: undefined },
    { action: 'list-sources', cursor: 'missing' },
    { action: 'snapshot-text', id: s.artifact.record.id, limit: 6001 },
    { action: 'snapshot-text', id: s.artifact.record.id, offset: NaN },
    { action: 'snapshot-text', id: s.taskId },
    { action: 'source-text', selector: null },
    { action: 'source-text', selector: {
      entryId: s.assistantEntryId, part: 0, start: 0, end: 2, hidden: true,
    } },
    { action: 'source-text', selector: {
      entryId: s.assistantEntryId, part: 0, start: 2, end: 0,
    } },
    { action: 'check', taskId: s.taskId, artifactId: s.artifact.record.id,
      checkerId: 'not-registered', evidenceIds: [] },
  ]) await rejected(f, input);

  const getter = Object.defineProperty({ action: 'task' }, 'label', {
    enumerable: true,
    get() { assert.fail('Model argument getter must not run'); },
  });
  await rejected(f, getter);
  const sparse = new Array(1);
  await rejected(f, {
    action: 'claim', taskId: s.taskId, category: 'observation', text: 'Sparse',
    evidenceIds: sparse, dependsOn: [],
  });
});

test('inquiry gate is FIRST for every route: true, throwing and nonboolean fail closed', OPTIONS, async () => {
  for (const mode of [true, undefined, null, 0, 'false', 'throw']) {
    for (const input of [
      { action: 'metadata' }, { action: 'checkers' },
      { action: 'task', label: 'Blocked' },
      { action: 'check', taskId: 't', artifactId: 'a', checkerId: 'c', evidenceIds: [] },
      null,
    ]) {
      const accesses = [];
      const poison = new Proxy({}, {
        get() { accesses.push('dependency'); throw new Error('Dependency accessed'); },
      });
      const ctx = Object.defineProperty({}, 'sessionManager', {
        get() { accesses.push('manager'); throw new Error('Manager accessed'); },
      });
      const tool = createMemoryTool({
        pi: poison,
        runtime: poison,
        registry: poison,
        scopeKey() { accesses.push('scope'); throw new Error('Scope accessed'); },
        scopeSignal() { accesses.push('signal'); throw new Error('Signal accessed'); },
        assertActionAllowed() { accesses.push('action'); throw new Error('Action accessed'); },
        isInquiryActive(context) {
          assert.equal(context, ctx);
          accesses.push('gate');
          if (mode === 'throw') throw new Error('Trusted gate refused');
          return mode;
        },
      });
      await assert.rejects(
        () => tool.execute('blocked', input, undefined, undefined, ctx),
        error => {
          const details = JSON.parse(error.message);
          assert.equal(details.appendMayHaveCommitted, false);
          assert.deepEqual(details.observedAppends, []);
          assert.match(details.message, /inquiry|gate refused/i);
          return true;
        },
      );
      assert.deepEqual(accesses, ['gate']);
    }
  }
});

test('untrusted error text is JSON-escaped and bounded, never a raw stack or prose splice', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const short = 'untrusted\n"quoted"\\\u0000\ud800🐦\udfff';
  f.setGate(() => { throw new Error(short); });
  const first = await rejected(f, { action: 'metadata' });
  assert.equal(first.message, short);
  assert.equal(first.messageTruncated, false);

  const huge = '\u0000\ud800"\\\n'.repeat(10000);
  f.setGate(() => { throw new Error(huge); });
  let encoded;
  await assert.rejects(
    () => f.call({ action: 'metadata' }),
    error => {
      encoded = error.message;
      const details = JSON.parse(encoded);
      assert.equal(details.message, huge.slice(0, 1024));
      assert.equal(details.messageTruncated, true);
      assert.ok(!Object.hasOwn(details, 'stack'));
      return true;
    },
  );
  assert.ok(encoded.includes('\\u0000'));
  assert.ok(encoded.includes('\\ud800'));
  assert.ok(!encoded.includes('\n'));
  assert.ok(Buffer.byteLength(encoded, 'utf8') < 10000);
  assert.equal(f.appends(), 0);
});

test('only trusted registry identities/scopes are exposed; checker lists are bounded', OPTIONS, async () => {
  const registry = registryFor('delayedPass');
  const f = fixture(registry);
  const listed = await f.call({ action: 'checkers', limit: 1 });
  assert.deepEqual(listed.checkers, registry.list());
  assert.equal(listed.total, 1);
  assert.equal(listed.nextCursor, null);
  assert.match(listed.checkers[0].identity.implementationDigest, /^sha256-checker-v1:/);
  for (const key of ['moduleURL', 'moduleHref', 'moduleDigest', 'exportName', 'code']) {
    assert.ok(!JSON.stringify(listed).includes(`"${key}"`));
  }
  assert.ok(!JSON.stringify(listed).includes(ADAPTER_URL.href));
  await rejected(f, { action: 'checkers', cursor: 'unknown' });

  const moduleDigest = readTrustedModuleDigest(ADAPTER_URL);
  const large = new TrustedCheckerRegistry(Array.from({ length: 3 }, (_, index) => ({
    id: `large-${index}`,
    version: '1',
    scope: '\u0000'.repeat(4000),
    moduleURL: ADAPTER_URL,
    moduleDigest,
    exportName: 'delayedPass',
    evidence: { min: 0, max: 0, roles: [] },
  })));
  const g = fixture(large);
  const error = await rejected(g, { action: 'checkers' });
  assert.match(error.message, /50000|byte|limit/i);
  const small = await g.call({ action: 'checkers', limit: 1 });
  assert.equal(small.checkers.length, 1);
  assert.equal(small.nextCursor, 'large-0');
  const next = await g.call({
    action: 'checkers', limit: 1, cursor: small.nextCursor,
  });
  assert.equal(next.checkers[0].identity.id, 'large-1');
});

test('a real syntax failure remains a scoped observation, not automatic artifact invalidation', OPTIONS, async () => {
  const f = fixture(createBuiltinCheckerRegistry());
  const s = await seed(f, '{bad JSON');
  const result = await f.call({
    action: 'check', taskId: s.taskId, artifactId: s.artifact.record.id,
    checkerId: 'json-syntax', evidenceIds: [],
  });
  assert.equal(result.lifecycle, 'finished');
  assert.equal(result.outcome, 'fail');
  assert.equal(result.status, 'recorded');
  assert.ok(!Object.hasOwn(result, 'verified'));
  const artifact = await f.call({ action: 'inspect', id: s.artifact.record.id });
  assert.equal(artifact.status, 'active');
  const terminal = await f.call({ action: 'inspect', id: result.terminal.id });
  assert.equal(terminal.outcome, 'fail');
  assert.ok(terminal.findings.length > 0);
});

test('pre-aborted requests append nothing; an actual running check records cancellation', OPTIONS, async () => {
  const f = fixture(registryFor('delayedPass'));
  const s = await seed(f, '{}');
  const request = {
    action: 'check', taskId: s.taskId, artifactId: s.artifact.record.id,
    checkerId: 'test-delayedPass', evidenceIds: [],
  };
  const stopped = new AbortController();
  stopped.abort();
  const error = await rejected(f, request, stopped.signal);
  assert.match(error.message, /cancelled before dispatch/);

  const controller = new AbortController();
  const pending = f.call(request, controller.signal);
  controller.abort();
  const result = await pending;
  assert.equal(result.lifecycle, 'finished');
  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.status, 'recorded');
  const terminal = await f.call({ action: 'inspect', id: result.terminal.id });
  assert.equal(terminal.startId, result.start.id);
  assert.equal(terminal.outcome, 'cancelled');
  assert.equal(f.records().filter(item => item.record.kind === 'check-result').length, 1);
});

test('native navigation during an actual checker fences terminal append and labels unresolved', OPTIONS, async () => {
  const f = fixture(registryFor('delayedPass'));
  const s = await seed(f, '{}');
  const pending = f.call({
    action: 'check', taskId: s.taskId, artifactId: s.artifact.record.id,
    checkerId: 'test-delayedPass', evidenceIds: [],
  });
  // run() appends its start and constructs the actual worker synchronously
  // before execute() first yields. Navigation is therefore deterministic.
  f.navigate(s.userEntryId);
  const result = await pending;
  assert.equal(result.kind, 'check-receipt');
  assert.equal(result.status, 'scope-changed');
  assert.equal(result.lifecycle, 'unresolved');
  assert.equal(result.terminal, null);
  assert.equal(result.outcome, null);
  assert.equal(result.errorCode, null);
  const nativeMemory = f.manager.getEntries().filter(entry =>
    entry.type === 'custom' && entry.customType === 'cuckoo.memory');
  assert.equal(nativeMemory.filter(entry => entry.data.record.kind === 'check-start').length, 1);
  assert.equal(nativeMemory.filter(entry => entry.data.record.kind === 'check-result').length, 0);
  await rejected(f, { action: 'inspect', id: result.start.id });
  const historical = await f.call({
    action: 'inspect', id: result.start.id, scope: 'session',
  });
  assert.equal(historical.branch, 'other');
  assert.equal(historical.status, null);
  assert.deepEqual(historical.artifact, {
    id: s.artifact.record.id, digest: textDigest('{}'),
  });
});
