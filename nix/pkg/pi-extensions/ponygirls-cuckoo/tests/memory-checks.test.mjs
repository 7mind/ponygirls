import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  appendMemory,
  makeSnapshot,
  makeTask,
  readMemory,
  textDigest,
} from '../src/memory-core.ts';
import {
  createBuiltinCheckerRegistry,
  DEFAULT_CHECK_LIMITS,
  MemoryCheckRunner,
  parseCheckRequest,
  readCheck,
  readTrustedModuleDigest,
  TrustedCheckerRegistry,
} from '../src/memory-checks.ts';

const ADAPTER_URL = new URL('./fixtures/memory-check-adapters.mjs', import.meta.url);
const NO_EVIDENCE = Object.freeze({ min: 0, max: 0, roles: [] });
const USER_EVIDENCE = Object.freeze({ min: 1, max: 1, roles: ['user'] });

/*
 * Specified Behavioral-Active / Blackbox-Group.
 *
 * The same public runner cases execute against a hand-written native-shaped
 * MemoryPort and an actual SessionManager native-log adapter. Both use real
 * workers. These are not mocked checker outcomes or fake worker messages.
 */
function storage(kind) {
  let manager = kind === 'native' ? SessionManager.inMemory() : null;
  let entries = [];
  let branch = [];
  let session = 'manual-session-0';
  let nativeSequence = 0;
  let epoch = 0;
  const trace = [];

  const view = () => manager === null
    ? { sessionId: session, entries: [...entries], branch: [...branch] }
    : {
      sessionId: manager.getSessionId(),
      entries: manager.getEntries(),
      branch: manager.getBranch(),
    };

  const appendEntry = (type, fields) => {
    nativeSequence++;
    const entry = {
      id: `entry-${nativeSequence}`,
      parentId: branch.at(-1)?.id ?? null,
      timestamp: new Date(1700000000000 + nativeSequence).toISOString(),
      type,
      ...fields,
    };
    entries.push(entry);
    branch.push(entry);
    return entry.id;
  };

  const port = {
    view,
    append(record) {
      trace.push(record.kind);
      const saved = structuredClone(record);
      let entryId;
      let timestamp;
      if (manager === null) {
        entryId = appendEntry('custom', {
          customType: 'cuckoo.memory',
          data: { version: 1, record: saved },
        });
        timestamp = entries.at(-1).timestamp;
      } else {
        entryId = manager.appendCustomEntry('cuckoo.memory', {
          version: 1,
          record: saved,
        });
        timestamp = manager.getEntry(entryId).timestamp;
      }
      return { entryId, timestamp, branch: 'current', record: saved };
    },
  };

  return {
    port,
    trace,
    scopeKey: () => `test-instance/${view().sessionId}/${epoch}`,
    message(role, text) {
      const message = {
        role,
        content: [{ type: 'text', text }],
        timestamp: 1700000000000 + nativeSequence,
      };
      return manager === null
        ? appendEntry('message', { message })
        : manager.appendMessage(message);
    },
    navigate(entryId) {
      epoch++;
      if (manager !== null) {
        manager.branch(entryId);
      } else {
        const index = entries.findIndex(entry => entry.id === entryId);
        assert.notEqual(index, -1);
        const selected = [];
        let cursor = entries[index];
        while (cursor !== undefined) {
          selected.unshift(cursor);
          cursor = entries.find(entry => entry.id === cursor.parentId);
        }
        branch = selected;
      }
    },
    replaceSession() {
      epoch++;
      if (manager !== null) {
        manager = SessionManager.inMemory();
      } else {
        session = `manual-session-${epoch}`;
        entries = [];
        branch = [];
      }
    },
    corruptSnapshot(id) {
      assert.equal(manager, null, 'corruption negative control uses the hand-written port');
      const entry = entries.find(entry =>
        entry.type === 'custom' && entry.data?.record?.id === id);
      assert.ok(entry);
      entry.data.record.digest = textDigest('different bytes');
    },
  };
}

function fixture(kind) {
  const store = storage(kind);
  let sequence = 0;
  let clock = 0;
  const runtime = {
    newId: () => `memory-${++sequence}`,
    now: () => new Date(1710000000000 + clock++).toISOString(),
  };
  const userText = '{"minimum":2}';
  const userEntryId = store.message('user', userText);
  const task = appendMemory(store.port, makeTask(store.port.view(), 'count task', runtime)).record;
  const evidence = appendMemory(store.port, makeSnapshot(
    store.port.view(),
    task.id,
    'evidence',
    'explicit minimum',
    { entryId: userEntryId, part: 0, start: 0, end: userText.length },
    [],
    runtime,
  )).record;
  const artifactText = '{"count":3,"name":"WRONG_NAME"}';
  const artifactEntryId = store.message('assistant', artifactText);
  const artifact = appendMemory(store.port, makeSnapshot(
    store.port.view(),
    task.id,
    'artifact',
    'candidate artifact',
    { entryId: artifactEntryId, part: 0, start: 0, end: artifactText.length },
    [],
    runtime,
  )).record;

  return {
    store,
    runtime,
    task,
    evidence,
    artifact,
    userEntryId,
    request(checkerId, evidenceIds) {
      return { taskId: task.id, artifactId: artifact.id, checkerId, evidenceIds };
    },
    context(signal) {
      return { toolCallId: `call-${++sequence}`, signal, scopeKey: store.scopeKey };
    },
    addSnapshot(text, purpose, taskId, role) {
      const entryId = store.message(role, text);
      return appendMemory(store.port, makeSnapshot(
        store.port.view(),
        taskId,
        purpose,
        'additional snapshot',
        { entryId, part: 0, start: 0, end: text.length },
        [],
        runtime,
      )).record;
    },
  };
}

function registry(exportName, evidence) {
  return new TrustedCheckerRegistry([{
    id: 'fixture-check',
    version: '1',
    scope: exportName === 'domainCount'
      ? 'Only numeric count >= the explicit user-evidence minimum; name and whole-task correctness excluded.'
      : `Static test adapter: ${exportName}.`,
    moduleURL: ADAPTER_URL,
    moduleDigest: readTrustedModuleDigest(ADAPTER_URL),
    exportName,
    evidence,
  }]);
}

function runner(f, selectedRegistry, overrides) {
  return new MemoryCheckRunner(
    f.store.port,
    f.runtime,
    selectedRegistry,
    { ...DEFAULT_CHECK_LIMITS, timeoutMs: 3000, ...overrides },
  );
}

function terminal(result) {
  assert.equal(result.status, 'recorded');
  assert.ok(result.terminal);
  assert.equal(result.start.record.kind, 'check-start');
  assert.equal(result.terminal.record.kind, 'check-result');
  assert.equal(result.terminal.record.startId, result.start.record.id);
  return result.terminal.record;
}

function checkRecords(f) {
  return readMemory(f.store.port.view(), 'branch')
    .filter(item => item.record.kind === 'check-start' || item.record.kind === 'check-result');
}

for (const kind of ['manual', 'native']) {
  test(`${kind}: JSON syntax is an explicit real worker run with exact original bindings`, async () => {
    const f = fixture(kind);
    const selectedRegistry = createBuiltinCheckerRegistry();
    const before = structuredClone(f.store.port.view());
    assert.equal(checkRecords(f).length, 0);
    assert.equal(selectedRegistry.list()[0].identity.id, 'json-syntax');
    assert.match(selectedRegistry.list()[0].identity.scope, /syntax only/i);
    assert.deepEqual(f.store.port.view(), before, 'registry construction is inert');

    const result = await runner(f, selectedRegistry, {}).run(
      f.request('json-syntax', []),
      f.context(undefined),
    );
    assert.equal(terminal(result).outcome, 'pass');
    assert.deepEqual(result.start.record.artifact, {
      id: f.artifact.id,
      digest: f.artifact.digest,
    });
    assert.deepEqual(result.start.record.evidence, []);
    assert.match(result.start.record.checker.implementationDigest, /^sha256-checker-v1:[0-9a-f]{64}$/);
    assert.deepEqual(f.store.trace.slice(-2), ['check-start', 'check-result']);
    assert.deepEqual(checkRecords(f).map(item => item.record.kind), ['check-start', 'check-result']);

    const inspected = readCheck(f.store.port.view(), result.start.record.id);
    assert.equal(inspected.lifecycle, 'finished');
    assert.equal(inspected.start.record.startedAt, result.start.record.startedAt);
    assert.equal(inspected.terminal.record.finishedAt, result.terminal.record.finishedAt);
    assert.equal(inspected.terminal.timestamp, result.terminal.timestamp);
    assert.deepEqual(inspected.start.record.artifact, result.start.record.artifact);
    assert.equal(checkRecords(f).length, 2, 'reading never reruns or appends');
  });

  test(`${kind}: a scoped domain pass is not overall semantic correctness`, async () => {
    const f = fixture(kind);
    const result = await runner(f, registry('domainCount', USER_EVIDENCE), {}).run(
      f.request('fixture-check', [f.evidence.id]),
      f.context(undefined),
    );
    assert.equal(terminal(result).outcome, 'pass');
    assert.equal(JSON.parse(f.artifact.text).name, 'WRONG_NAME');
    assert.match(result.start.record.checker.scope, /whole-task correctness excluded/);
    assert.deepEqual(result.start.record.evidence, [{
      id: f.evidence.id,
      digest: f.evidence.digest,
    }]);

    const wrongCount = f.addSnapshot(
      '{"count":0,"name":"RIGHT_NAME"}',
      'artifact',
      f.task.id,
      'assistant',
    );
    const failure = await runner(f, registry('domainCount', USER_EVIDENCE), {}).run(
      { ...f.request('fixture-check', [f.evidence.id]), artifactId: wrongCount.id },
      f.context(undefined),
    );
    assert.equal(terminal(failure).outcome, 'fail');
    assert.deepEqual(failure.terminal.record.findings[0].evidenceIds, [f.evidence.id]);
    assert.equal(readCheck(f.store.port.view(), result.start.record.id).terminal.record.outcome, 'pass');
    assert.equal(readCheck(f.store.port.view(), result.start.record.id).start.record.artifact.digest, f.artifact.digest);
    assert.notEqual(wrongCount.digest, f.artifact.digest);
  });

  test(`${kind}: syntax failure never inherits a prior digest's pass`, async () => {
    const f = fixture(kind);
    const r = runner(f, createBuiltinCheckerRegistry(), {});
    const good = await r.run(f.request('json-syntax', []), f.context(undefined));
    const broken = f.addSnapshot('{"broken":', 'artifact', f.task.id, 'assistant');
    const bad = await r.run(
      { ...f.request('json-syntax', []), artifactId: broken.id },
      f.context(undefined),
    );
    assert.equal(terminal(good).outcome, 'pass');
    assert.equal(terminal(bad).outcome, 'fail');
    assert.equal(bad.terminal.record.findings[0].code, 'JSON_SYNTAX_INVALID');
    assert.equal(good.start.record.artifact.digest, textDigest(f.artifact.text));
    assert.equal(bad.start.record.artifact.digest, textDigest(broken.text));
    assert.notEqual(good.start.record.artifact.digest, bad.start.record.artifact.digest);
  });

  test(`${kind}: finite deadline terminates a synchronous infinite loop`, { timeout: 5000 }, async () => {
    const f = fixture(kind);
    const start = Date.now();
    const result = await runner(f, registry('infinite', NO_EVIDENCE), { timeoutMs: 150 }).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    assert.equal(terminal(result).outcome, 'timeout');
    assert.equal(result.terminal.record.errorCode, 'CHECK_DEADLINE');
    assert.ok(Date.now() - start < 4000, 'run resolves only after worker termination');
    assert.deepEqual(checkRecords(f).map(item => item.record.kind), ['check-start', 'check-result']);
  });

  test(`${kind}: abort cannot be overwritten by late adapter completion`, async () => {
    const f = fixture(kind);
    const controller = new AbortController();
    const promise = runner(f, registry('delayedPass', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(controller.signal),
    );
    assert.equal(checkRecords(f)[0].record.kind, 'check-start', 'start is persisted synchronously');
    controller.abort();
    const result = await promise;
    assert.equal(terminal(result).outcome, 'cancelled');
    assert.equal(result.terminal.record.errorCode, 'CHECK_ABORTED');
    const historical = structuredClone(readCheck(f.store.port.view(), result.start.record.id));
    await sleep(350);
    assert.deepEqual(readCheck(f.store.port.view(), result.start.record.id), historical);
    assert.equal(checkRecords(f).length, 2);
  });

  test(`${kind}: an already-aborted request records one start and one cancellation`, async () => {
    const f = fixture(kind);
    const controller = new AbortController();
    controller.abort();
    const result = await runner(f, registry('infinite', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(controller.signal),
    );
    assert.equal(terminal(result).outcome, 'cancelled');
    assert.equal(checkRecords(f).length, 2);
  });

  test(`${kind}: actual error, malformed output, forbidden outcomes, refs and overflow are bounded`, async () => {
    const cases = [
      ['throwing', 'CHECK_ADAPTER_ERROR', {}],
      ['malformed', 'CHECK_INVALID_OUTPUT', {}],
      ['forgedOutcome', 'CHECK_INVALID_OUTPUT', {}],
      ['badEvidenceReference', 'CHECK_INVALID_OUTPUT', {}],
      ['overflow', 'CHECK_OUTPUT_LIMIT', { maxOutputBytes: 1024 }],
      ['stdoutOverflow', 'CHECK_OUTPUT_LIMIT', { maxOutputBytes: 1024 }],
      ['exitWithoutResult', 'CHECK_WORKER_EXIT', {}],
    ];
    for (const [adapter, errorCode, bounds] of cases) {
      const f = fixture(kind);
      const result = await runner(f, registry(adapter, NO_EVIDENCE), bounds).run(
        f.request('fixture-check', []),
        f.context(undefined),
      );
      assert.equal(terminal(result).outcome, 'error', adapter);
      assert.equal(result.terminal.record.errorCode, errorCode, adapter);
      assert.deepEqual(result.terminal.record.findings, []);
      assert.equal(checkRecords(f).length, 2);
    }
  });

  test(`${kind}: adapter inconclusive is distinct from pass/fail/error`, async () => {
    const f = fixture(kind);
    const result = await runner(f, registry('inconclusive', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    assert.equal(terminal(result).outcome, 'inconclusive');
    assert.equal(result.terminal.record.errorCode, null);
  });

  test(`${kind}: worker input is frozen and unnecessary environment is not inherited`, async () => {
    const f = fixture(kind);
    const result = await runner(f, registry('immutableAndEmptyEnvironment', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    assert.equal(terminal(result).outcome, 'pass');
  });

  test(`${kind}: model extras, forged results, code, paths and expected answers reject before start`, async () => {
    const f = fixture(kind);
    const r = runner(f, createBuiltinCheckerRegistry(), {});
    for (const [key, value] of [
      ['outcome', 'pass'],
      ['findings', []],
      ['modulePath', '/untrusted/check.mjs'],
      ['moduleURL', 'data:text/javascript,forged'],
      ['code', 'return true'],
      ['command', 'arbitrary-command'],
      ['expectedAnswer', 'model supplied reference'],
      ['implementationDigest', 'forged'],
      ['scope', 'whole task'],
      ['version', 'forged'],
      ['scopeKey', 'forged epoch'],
      ['artifactDigest', f.artifact.digest],
    ]) {
      await assert.rejects(r.run(
        { ...f.request('json-syntax', []), [key]: value },
        f.context(undefined),
      ), /request/);
    }
    assert.equal(checkRecords(f).length, 0);
  });

  test(`${kind}: missing, duplicated, wrong-role and cross-task evidence reject before start`, async () => {
    const f = fixture(kind);
    const r = runner(f, registry('domainCount', USER_EVIDENCE), {});
    await assert.rejects(
      r.run(f.request('fixture-check', []), f.context(undefined)),
      /evidence count/,
    );
    await assert.rejects(
      r.run(f.request('fixture-check', [f.evidence.id, f.evidence.id]), f.context(undefined)),
      /duplicate/,
    );
    await assert.rejects(
      r.run(f.request('fixture-check', ['missing']), f.context(undefined)),
      /snapshot not found/,
    );

    // Evidence may be either snapshot purpose; the registry still decides
    // source-role admissibility, not a model-supplied expected-reference label.
    const assistantEvidence = f.addSnapshot('{"minimum":2}', 'evidence', f.task.id, 'assistant');
    await assert.rejects(
      r.run(f.request('fixture-check', [assistantEvidence.id]), f.context(undefined)),
      /evidence role/,
    );

    f.store.message('user', 'A separate task');
    const otherTask = appendMemory(
      f.store.port,
      makeTask(f.store.port.view(), 'another task', f.runtime),
    ).record;
    const otherEvidence = f.addSnapshot('{"minimum":2}', 'evidence', otherTask.id, 'user');
    await assert.rejects(
      r.run(f.request('fixture-check', [otherEvidence.id]), f.context(undefined)),
      /task mismatch/,
    );
    await assert.rejects(
      r.run(
        { ...f.request('fixture-check', [f.evidence.id]), taskId: otherTask.id },
        f.context(undefined),
      ),
      /task mismatch/,
    );
    await assert.rejects(
      r.run(
        { ...f.request('fixture-check', [f.evidence.id]), artifactId: f.evidence.id },
        f.context(undefined),
      ),
      /artifact purpose/,
    );
    assert.equal(checkRecords(f).length, 0);
  });

  test(`${kind}: input byte limits reject before persisting a start`, async () => {
    const f = fixture(kind);
    const large = f.addSnapshot('x'.repeat(8000), 'artifact', f.task.id, 'assistant');
    await assert.rejects(
      runner(f, createBuiltinCheckerRegistry(), { maxInputBytes: 512 }).run(
        { ...f.request('json-syntax', []), artifactId: large.id },
        f.context(undefined),
      ),
      /input byte limit/,
    );
    assert.equal(checkRecords(f).length, 0);
  });

  test(`${kind}: ordinary native appends preserve the source scope and terminal ordering`, async () => {
    const f = fixture(kind);
    const promise = runner(f, registry('delayedPass', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    const start = checkRecords(f)[0];
    f.store.message('assistant', 'An ordinary visible append, not navigation.');
    const result = await promise;
    assert.equal(terminal(result).outcome, 'pass');
    const ids = f.store.port.view().branch.map(entry => entry.id);
    assert.ok(ids.indexOf(start.entryId) < ids.indexOf(result.terminal.entryId));
    assert.equal(checkRecords(f).length, 2);
  });

  test(`${kind}: navigation before the start fences terminal persistence`, async () => {
    const f = fixture(kind);
    const original = f.store.port.view();
    const promise = runner(f, registry('delayedPass', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    const start = checkRecords(f)[0];
    f.store.navigate(f.userEntryId);
    const result = await promise;
    assert.equal(result.status, 'scope-changed');
    assert.equal(result.terminal, null);
    assert.equal(checkRecords(f).length, 0);
    const historicalStart = f.store.port.view().entries.find(entry => entry.id === start.entryId);
    assert.ok(historicalStart, 'the original start remains immutable session history');
    assert.ok(original.branch.length > f.store.port.view().branch.length);
  });

  test(`${kind}: trusted navigation epoch fences even a branch still containing start`, async () => {
    const f = fixture(kind);
    const promise = runner(f, registry('delayedPass', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    const start = checkRecords(f)[0];
    f.store.message('assistant', 'Descendant before a tree navigation.');
    f.store.navigate(start.entryId);
    const result = await promise;
    assert.equal(result.status, 'scope-changed');
    assert.equal(result.terminal, null);
    assert.equal(readCheck(f.store.port.view(), start.record.id).lifecycle, 'unresolved');

    // A new runner must neither resume nor presume success for an orphan start.
    runner(f, registry('delayedPass', NO_EVIDENCE), {});
    const before = structuredClone(f.store.port.view());
    const read = readCheck(f.store.port.view(), start.record.id);
    assert.equal(read.lifecycle, 'unresolved');
    assert.equal(read.terminal, null);
    await sleep(300);
    assert.deepEqual(f.store.port.view(), before);
  });

  test(`${kind}: session replacement cannot receive another session's terminal`, async () => {
    const f = fixture(kind);
    const promise = runner(f, registry('delayedPass', NO_EVIDENCE), {}).run(
      f.request('fixture-check', []),
      f.context(undefined),
    );
    f.store.replaceSession();
    const result = await promise;
    assert.equal(result.status, 'scope-changed');
    assert.equal(result.terminal, null);
    assert.equal(checkRecords(f).length, 0);
  });
}

test('manual: tampered snapshot digest rejects rather than checking substituted text', async () => {
  const f = fixture('manual');
  f.store.corruptSnapshot(f.artifact.id);
  await assert.rejects(
    runner(f, createBuiltinCheckerRegistry(), {}).run(
      f.request('json-syntax', []),
      f.context(undefined),
    ),
    /digest|snapshot/i,
  );
  assert.equal(f.store.trace.filter(kind => kind === 'check-start').length, 0);
});

test('owner-pinned module change rejects before a start and never imports changed code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-check-'));
  try {
    const modulePath = join(directory, 'memory-check-module.mjs');
    await copyFile(ADAPTER_URL, modulePath);
    const moduleURL = pathToFileURL(modulePath);
    const pinned = readTrustedModuleDigest(moduleURL);
    const selected = new TrustedCheckerRegistry([{
      id: 'pinned',
      version: '1',
      scope: 'Static pinned fixture only.',
      moduleURL,
      moduleDigest: pinned,
      exportName: 'inconclusive',
      evidence: NO_EVIDENCE,
    }]);
    await writeFile(modulePath, 'export function inconclusive(){return {outcome:"pass",findings:[]};}\n');
    const f = fixture('manual');
    await assert.rejects(
      runner(f, selected, {}).run(f.request('pinned', []), f.context(undefined)),
      /identity changed/,
    );
    assert.equal(checkRecords(f).length, 0);

    assert.throws(() => new TrustedCheckerRegistry([{
      id: 'pinned',
      version: '1',
      scope: 'Static pinned fixture only.',
      moduleURL,
      moduleDigest: pinned,
      exportName: 'inconclusive',
      evidence: NO_EVIDENCE,
    }]), /identity mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('implementation identity binds export selection as well as exact module bytes', () => {
  const digest = readTrustedModuleDigest(ADAPTER_URL);
  const make = exportName => new TrustedCheckerRegistry([{
    id: 'same-checker',
    version: '1',
    scope: 'Same declared scope.',
    moduleURL: ADAPTER_URL,
    moduleDigest: digest,
    exportName,
    evidence: NO_EVIDENCE,
  }]);
  assert.notEqual(
    make('inconclusive').list()[0].identity.implementationDigest,
    make('throwing').list()[0].identity.implementationDigest,
  );
});

test('implementation identity binds the actual Node and V8 runtime', () => {
  const exportName = 'inconclusive';
  const expected = `sha256-checker-v1:${createHash('sha256').update(JSON.stringify({
    moduleDigest: readTrustedModuleDigest(ADAPTER_URL),
    exportName,
    bootstrapDigest: readTrustedModuleDigest(new URL('../src/memory-check-worker.mjs', import.meta.url)),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
  })).digest('hex')}`;
  assert.equal(registry(exportName, NO_EVIDENCE).list()[0].identity.implementationDigest, expected);
});

for (const adapter of ['blankCode', 'blankMessage']) {
  test(`${adapter}: invalid findings produce a terminal error, not an orphan start`, async () => {
    for (const kind of ['manual', 'native']) {
      const f = fixture(kind);
      const result = await runner(f, registry(adapter, NO_EVIDENCE), {}).run(
        f.request('fixture-check', []), f.context(undefined),
      );
      assert.equal(terminal(result).outcome, 'error');
      assert.equal(result.terminal.record.errorCode, 'CHECK_INVALID_OUTPUT');
      assert.equal(readCheck(f.store.port.view(), result.start.record.id).lifecycle, 'finished');
      assert.equal(checkRecords(f).length, 2);
    }
  });
}

test('request parser rejects non-JSON shapes, accessors, oversized ids and refs', () => {
  const valid = { taskId: 'task', artifactId: 'artifact', checkerId: 'checker', evidenceIds: [] };
  assert.deepEqual(parseCheckRequest(valid), valid);
  for (const bad of [
    null,
    [],
    { ...valid, evidenceIds: 'not-array' },
    { ...valid, taskId: '' },
    { ...valid, checkerId: 'x'.repeat(129) },
    { ...valid, evidenceIds: Array.from({ length: 33 }, (_, index) => `id-${index}`) },
    { ...valid, evidenceIds: ['same', 'same'] },
    Object.assign(Object.create({ inherited: true }), valid),
  ]) {
    assert.throws(() => parseCheckRequest(bad));
  }
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'artifactId', {
    enumerable: true,
    get() { assert.fail('request getter must not run'); },
  });
  assert.throws(() => parseCheckRequest(accessor));
});

test('limits must have a finite positive bounded deadline', () => {
  const f = fixture('manual');
  const selected = createBuiltinCheckerRegistry();
  for (const timeoutMs of [0, -1, Infinity, NaN, 30001, 1.5]) {
    assert.throws(() => runner(f, selected, { timeoutMs }), /deadline/);
  }
  for (const maxOutputBytes of [0, 50001, Infinity]) {
    assert.throws(() => runner(f, selected, { maxOutputBytes }), /output byte limit/);
  }
  assert.equal(checkRecords(f).length, 0);
});
