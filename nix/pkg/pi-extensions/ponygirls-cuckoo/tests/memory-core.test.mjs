import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  textDigest,
  readMemory,
  listSources,
  readPublicSource,
  resolveSource,
  validateAppend,
  appendMemory,
  makeTask,
  makeSnapshot,
  makeClaim,
  makeCorrection,
} from '../src/memory-core.ts';

const TIME = '2026-11-12T20:33:00.000Z';

// Specified Behavioral-Active / Blackbox-Atomic or Blackbox-Group.
// The same public port contract runs against a handwritten tree dummy and
// Pi 1.5.2's actual in-memory SessionManager. No network or filesystem access.

function dummyManager() {
  let entries = [];
  let leaf = null;
  let sequence = 0;

  function add(fields) {
    sequence++;
    const entry = {
      ...fields,
      id: `native-${sequence}`,
      parentId: leaf,
      timestamp: TIME,
    };
    entries.push(entry);
    leaf = entry.id;
    return entry.id;
  }

  return {
    appendMessage(message) {
      return add({ type: 'message', message });
    },
    appendCustomEntry(customType, data) {
      return add({ type: 'custom', customType, data });
    },
    getSessionId() {
      return 'dummy-session';
    },
    getEntries() {
      return [...entries];
    },
    getEntry(entryId) {
      return entries.find(entry => entry.id === entryId);
    },
    getLeafId() {
      return leaf;
    },
    getBranch() {
      const branch = [];
      let entryId = leaf;
      while (entryId !== null) {
        const entry = entries.find(item => item.id === entryId);
        assert.ok(entry, 'dummy tree must not contain dangling native parents');
        branch.push(entry);
        entryId = entry.parentId;
      }
      return branch.reverse();
    },
    branch(entryId) {
      assert.ok(entries.some(entry => entry.id === entryId));
      leaf = entryId;
    },
  };
}

function fixture(mode) {
  const manager = mode === 'native'
    ? SessionManager.inMemory()
    : dummyManager();
  let sequence = 0;
  const runtime = {
    newId() {
      sequence++;
      return `memory-${sequence}`;
    },
    now() {
      return TIME;
    },
  };
  function view() {
    return {
      sessionId: manager.getSessionId(),
      entries: manager.getEntries(),
      branch: manager.getBranch(),
    };
  }
  const port = {
    view,
    append(record) {
      const entryId = manager.appendCustomEntry('cuckoo.memory', {
        version: 1,
        record,
      });
      const entry = manager.getEntry(entryId);
      assert.ok(entry);
      return {
        entryId,
        timestamp: entry.timestamp,
        branch: 'current',
        record,
      };
    },
  };
  function user(text) {
    return manager.appendMessage({
      role: 'user',
      content: text,
      timestamp: 1,
    });
  }
  function assistant(text) {
    return manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
      timestamp: 1,
    });
  }
  function tool(toolName, text) {
    return manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'fixture-tool-call',
      toolName,
      content: [{ type: 'text', text }],
      details: { private: 'PRIVATE_TOOL_DETAILS' },
      isError: false,
      timestamp: 1,
    });
  }
  function save(record) {
    return appendMemory(port, record);
  }
  function unsafe(record) {
    return manager.appendCustomEntry('cuckoo.memory', {
      version: 1,
      record,
    });
  }
  return {
    manager,
    runtime,
    view,
    port,
    user,
    assistant,
    tool,
    save,
    unsafe,
  };
}

function selection(entryId, part, start, end) {
  return { entryId, part, start, end };
}

function seed(f) {
  const userId = f.user('Work on the selected task');
  const task = makeTask(f.view(), 'Task label', f.runtime);
  const stored = f.save(task);
  return { userId, task, stored };
}

function evidence(f, taskId, text) {
  const entryId = f.user(text);
  const record = makeSnapshot(
    f.view(),
    taskId,
    'evidence',
    'Selected evidence',
    selection(entryId, 0, 0, text.length),
    [],
    f.runtime,
  );
  f.save(record);
  return record;
}

function artifact(f, taskId, text, dependsOn) {
  const entryId = f.assistant(text);
  const record = makeSnapshot(
    f.view(),
    taskId,
    'artifact',
    'Selected artifact',
    selection(entryId, 0, 0, text.length),
    dependsOn,
    f.runtime,
  );
  f.save(record);
  return record;
}

function claim(f, taskId, text, evidenceIds, dependsOn) {
  const record = makeClaim(f.view(), {
    taskId,
    category: 'observation',
    text,
    evidenceIds,
    dependsOn,
  }, f.runtime);
  f.save(record);
  return record;
}

function checkStart(f, taskId, artifactRecord, selectedEvidence) {
  return {
    kind: 'check-start',
    id: f.runtime.newId(),
    taskId,
    toolCallId: 'trusted-check-call',
    checker: {
      id: 'json-syntax',
      version: '1',
      implementationDigest: `sha256:${'a'.repeat(64)}`,
      scope: 'JSON syntax of the exact selected artifact text only',
    },
    artifact: {
      id: artifactRecord.id,
      digest: artifactRecord.digest,
    },
    evidence: selectedEvidence.map(record => ({
      id: record.id,
      digest: record.digest,
    })),
    startedAt: TIME,
  };
}

function checkResult(f, start, outcome, findings) {
  return {
    kind: 'check-result',
    id: f.runtime.newId(),
    taskId: start.taskId,
    startId: start.id,
    outcome,
    findings,
    errorCode: null,
    finishedAt: TIME,
  };
}

function cloneView(view) {
  return {
    sessionId: view.sessionId,
    entries: structuredClone(view.entries),
    branch: structuredClone(view.branch),
  };
}

function replaceNative(view, entryId, change) {
  const result = cloneView(view);
  for (const collection of [result.entries, result.branch]) {
    const entry = collection.find(item => item.id === entryId);
    assert.ok(entry);
    change(entry);
  }
  return result;
}

function removeNative(view, entryId) {
  const result = cloneView(view);
  for (const key of ['entries', 'branch']) {
    const removed = result[key].find(entry => entry.id === entryId);
    assert.ok(removed);
    result[key] = result[key]
      .filter(entry => entry.id !== entryId)
      .map(entry => entry.parentId === entryId
        ? { ...entry, parentId: removed.parentId }
        : entry);
  }
  return result;
}

test('text identity hashes exact UTF-16LE code units, including lone surrogates', () => {
  const texts = [
    '',
    'ordinary text',
    '\u0000\\\n',
    '🐦',
    '\ud800',
    '\udc00',
    'A\ud800B',
    '\ufffd',
    '\u00e9',
    'e\u0301',
  ];
  for (const text of texts) {
    const expected = createHash('sha256')
      .update(Buffer.from(text, 'utf16le'))
      .digest('hex');
    assert.equal(textDigest(text), `sha256-utf16le:${expected}`);
  }
  assert.notEqual(textDigest('\ud800'), textDigest('\ufffd'));
  assert.notEqual(textDigest('\ud800'), textDigest('\udc00'));
  assert.notEqual(textDigest('\u00e9'), textDigest('e\u0301'));
  assert.throws(() => textDigest(undefined), /string/i);
});

for (const mode of ['dummy', 'native']) {
  test(`${mode}: builders and port persist exact frozen v1 records without mutating sources`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const text = 'A🐦B\ud800e\u0301';
    const entryId = f.assistant(text);
    const selector = selection(entryId, 0, 2, 3);
    const before = structuredClone(f.view());
    const record = makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'Exact low-surrogate selection',
      selector,
      [],
      f.runtime,
    );
    assert.equal(record.text, text.slice(2, 3));
    assert.equal(record.text.length, 1);
    assert.equal(record.digest, textDigest(text.slice(2, 3)));
    assert.equal(record.source.digest, record.digest);
    assert.deepEqual(f.view(), before);
    assert.ok(Object.isFrozen(record));
    assert.ok(Object.isFrozen(record.source));
    assert.ok(Object.isFrozen(record.source.selector));
    assert.ok(Object.isFrozen(record.dependsOn));
    assert.throws(() => { record.text = 'replacement'; }, TypeError);
    assert.throws(() => { record.source.selector.start = 0; }, TypeError);

    selector.start = 0;
    assert.equal(record.source.selector.start, 2);
    const stored = f.save(record);
    assert.equal(stored.record.id, record.id);
    assert.equal(stored.entryId, f.manager.getLeafId());
    assert.equal(stored.branch, 'current');
    assert.deepEqual(f.manager.getEntry(stored.entryId).data, {
      version: 1,
      record,
    });
    assert.deepEqual(readMemory(f.view(), 'branch').map(item => item.record.id), [
      task.id,
      record.id,
    ]);
    assert.equal(resolveSource(f.view(), record.source, 'branch').status, 'available');
  });

  test(`${mode}: tasks bind the latest native current-branch user entry`, () => {
    const f = fixture(mode);
    assert.throws(
      () => makeTask(f.view(), 'No native user', f.runtime),
      /native user/i,
    );
    const first = f.user('First user entry');
    f.assistant('Assistant text is not a task anchor');
    const second = f.user('Latest user entry');
    f.tool('read', 'Tool text is not a task anchor');
    const task = makeTask(f.view(), 'Retrieval label only', f.runtime);
    assert.equal(task.userEntryId, second);
    assert.notEqual(task.userEntryId, first);
    assert.equal(task.taskId, task.id);

    assert.throws(() => validateAppend(f.view(), {
      ...task,
      userEntryId: first,
    }), /latest preceding native user/i);
    assert.throws(() => validateAppend(f.view(), {
      ...task,
      taskId: 'different-task',
    }), /taskId must equal/i);

    const before = structuredClone(f.view());
    f.save(task);
    assert.deepEqual(
      f.view().entries.slice(0, before.entries.length),
      before.entries,
    );
  });

  test(`${mode}: source discovery exposes only selected native public text`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const userId = f.manager.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'Visible user text' },
        { type: 'image', data: 'PRIVATE_IMAGE', mimeType: 'image/png' },
      ],
      timestamp: 1,
    });
    const assistantId = f.manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'PRIVATE_THINKING' },
        { type: 'toolCall', id: 'call', name: 'read', arguments: { private: 'PRIVATE_ARGUMENTS' } },
        { type: 'text', text: 'Visible assistant text' },
      ],
      timestamp: 1,
    });
    const toolId = f.tool('read', 'Visible tool text');
    const captured = f.assistant('CAPTURED_CUCKOO_RESPONSE');
    f.manager.appendCustomEntry('cuckoo.report', {
      version: 4,
      requestId: 'checkpoint',
      raw: 'PRIVATE_REPORT_RAW',
      report: null,
      error: 'fixture',
      messageEntryId: captured,
      content: [{ type: 'thinking', thinking: 'PRIVATE_REPORT_CONTENT' }],
    });

    const hidden = [
      f.manager.appendMessage({
        role: 'system',
        content: 'PRIVATE_SYSTEM',
        timestamp: 1,
      }),
      f.manager.appendMessage({
        role: 'developer',
        content: 'PRIVATE_DEVELOPER',
        timestamp: 1,
      }),
      f.manager.appendMessage({
        role: 'custom',
        customType: 'private-custom-message',
        content: 'PRIVATE_CUSTOM_MESSAGE',
        display: true,
        timestamp: 1,
      }),
      f.manager.appendCustomEntry('private-data', {
        text: 'PRIVATE_CUSTOM_DATA',
      }),
      f.tool('cuckoo_recall', 'PRIVATE_RECALL_ECHO'),
      f.tool('cuckoo_memory', 'PRIVATE_MEMORY_ECHO'),
      f.tool('cuckoo_memory_read', 'PRIVATE_MEMORY_READ_ECHO'),
      f.tool('cuckoo_check', 'PRIVATE_CHECK_ECHO'),
      captured,
    ];

    const before = structuredClone(f.view());
    const summaries = listSources(f.view(), 'branch');
    const ids = summaries.map(item => item.entryId);
    assert.ok(ids.includes(userId));
    assert.ok(ids.includes(assistantId));
    assert.ok(ids.includes(toolId));
    for (const entryId of hidden) assert.ok(!ids.includes(entryId));
    assert.deepEqual(
      summaries.find(item => item.entryId === assistantId).parts,
      [{ part: 2, chars: 'Visible assistant text'.length }],
    );
    assert.deepEqual(
      summaries.find(item => item.entryId === userId).parts,
      [{ part: 0, chars: 'Visible user text'.length }],
    );
    assert.doesNotMatch(JSON.stringify(summaries), /PRIVATE_|CAPTURED_CUCKOO/);

    const selected = readPublicSource(
      f.view(),
      selection(assistantId, 2, 0, 'Visible assistant text'.length),
      'branch',
    );
    assert.equal(selected.text, 'Visible assistant text');
    assert.equal(selected.source.role, 'assistant');
    assert.equal(selected.source.toolName, null);
    assert.equal(selected.source.timestamp, f.manager.getEntry(assistantId).timestamp);
    assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_/);

    for (const part of [0, 1]) {
      assert.throws(() => readPublicSource(
        f.view(),
        selection(assistantId, part, 0, 1),
        'branch',
      ), /public native text block/i);
    }
    for (const entryId of hidden) {
      assert.throws(() => readPublicSource(
        f.view(),
        selection(entryId, 0, 0, 1),
        'branch',
      ), /eligible public native text source/i);
    }
    const userEvidence = makeSnapshot(
      f.view(),
      task.id,
      'evidence',
      'Native stored user role, not approval',
      selection(userId, 0, 0, 7),
      [],
      f.runtime,
    );
    assert.equal(userEvidence.source.role, 'user');
    assert.deepEqual(Object.keys(userEvidence.source).sort(), [
      'digest', 'role', 'selector', 'timestamp', 'toolName',
    ]);
    assert.throws(() => makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'User text is not an artifact',
      selection(userId, 0, 0, 7),
      [],
      f.runtime,
    ), /assistant or tool text/i);
    assert.deepEqual(f.view(), before);
  });

  test(`${mode}: source selectors use exact text-block indices and UTF-16 bounds`, () => {
    const f = fixture(mode);
    seed(f);
    const entryId = f.user('A🐦B\ud800');
    assert.equal(
      readPublicSource(f.view(), selection(entryId, 0, 2, 3), 'branch').text,
      '\udc26',
    );
    for (const selector of [
      selection(entryId, -1, 0, 1),
      selection(entryId, 0, -1, 1),
      selection(entryId, 0, 0, 0),
      selection(entryId, 0, 2, 1),
      selection(entryId, 0, 0, 100001),
      selection(entryId, 0, 0.5, 1),
      selection(entryId, 0, 0, Infinity),
      selection(entryId, 0, 0, 6),
      { ...selection(entryId, 0, 0, 1), path: '/private/path' },
    ]) {
      assert.throws(() => readPublicSource(f.view(), selector, 'branch'));
    }
    assert.throws(
      () => readPublicSource(f.view(), selection(entryId, 1, 0, 1), 'branch'),
      /public native text block/i,
    );
    assert.throws(() => listSources(f.view(), 'global'), /scope/i);
  });

  test(`${mode}: forged snapshot bytes and provenance cannot be appended`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const entryId = f.assistant('actual artifact');
    const snapshot = makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'Artifact',
      selection(entryId, 0, 0, 6),
      [],
      f.runtime,
    );
    const forgedText = 'forged';
    const forgeries = [
      {
        ...snapshot,
        text: forgedText,
        digest: textDigest(forgedText),
        source: { ...snapshot.source, digest: textDigest(forgedText) },
      },
      {
        ...snapshot,
        source: { ...snapshot.source, role: 'user' },
      },
      {
        ...snapshot,
        source: { ...snapshot.source, toolName: 'read' },
      },
      {
        ...snapshot,
        source: {
          ...snapshot.source,
          timestamp: '2026-11-13T20:33:00.000Z',
        },
      },
      {
        ...snapshot,
        source: {
          ...snapshot.source,
          selector: { ...snapshot.source.selector, start: 1, end: 7 },
        },
      },
      { ...snapshot, digest: textDigest('different') },
      { ...snapshot, fileDigest: 'not part of a text snapshot' },
    ];
    const before = structuredClone(f.view());
    for (const forged of forgeries) {
      assert.throws(() => validateAppend(f.view(), forged));
    }
    assert.deepEqual(f.view(), before);
    assert.equal(snapshot.text, 'actual');
    f.save(snapshot);
  });

  test(`${mode}: historical changed sources preserve snapshots but cannot seed fresh evidence`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const snapshot = artifact(f, task.id, 'original artifact', []);
    const originalView = f.view();
    const changed = replaceNative(
      originalView,
      snapshot.source.selector.entryId,
      entry => { entry.message.content[0].text = 'modified artifact'; },
    );
    const stored = readMemory(changed, 'branch')
      .find(item => item.record.id === snapshot.id);
    assert.equal(stored.record.text, 'original artifact');
    assert.equal(stored.record.digest, textDigest('original artifact'));
    assert.equal(resolveSource(changed, snapshot.source, 'branch').status, 'changed');

    assert.throws(() => validateAppend(changed, {
      ...snapshot,
      id: 'new-from-stale-source',
    }), /source is changed/i);

    const selected = readPublicSource(
      changed,
      snapshot.source.selector,
      'branch',
    );
    assert.equal(selected.text, 'modified artifact');
    assert.notEqual(selected.source.digest, snapshot.digest);
    assert.equal(
      readMemory(originalView, 'branch')
        .find(item => item.record.id === snapshot.id).record.text,
      'original artifact',
    );

    const timestampChanged = replaceNative(
      originalView,
      snapshot.source.selector.entryId,
      entry => { entry.timestamp = '2026-11-13T20:33:00.000Z'; },
    );
    assert.equal(
      resolveSource(timestampChanged, snapshot.source, 'branch').status,
      'changed',
    );
    assert.equal(
      readMemory(timestampChanged, 'branch')
        .find(item => item.record.id === snapshot.id).record.text,
      'original artifact',
    );
  });

  test(`${mode}: historical absent sources remain exact snapshots with explicit unavailability`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const snapshot = artifact(f, task.id, 'retained historical selection', []);
    const absent = removeNative(f.view(), snapshot.source.selector.entryId);
    assert.equal(resolveSource(absent, snapshot.source, 'branch').status, 'unavailable');
    const historical = readMemory(absent, 'branch')
      .find(item => item.record.id === snapshot.id);
    assert.equal(historical.record.text, snapshot.text);
    assert.equal(historical.record.digest, snapshot.digest);
    assert.throws(() => validateAppend(absent, {
      ...snapshot,
      id: 'fresh-from-absent-source',
    }), /source is unavailable/i);
  });

  test(`${mode}: branch objects take precedence over stale session representations`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const snapshot = artifact(f, task.id, 'original', []);
    const view = cloneView(f.view());
    const current = view.branch.find(
      entry => entry.id === snapshot.source.selector.entryId,
    );
    current.message.content[0].text = 'changed!';
    assert.equal(
      view.entries.find(entry => entry.id === current.id).message.content[0].text,
      'original',
    );
    assert.equal(resolveSource(view, snapshot.source, 'branch').status, 'changed');
    assert.equal(resolveSource(view, snapshot.source, 'session').status, 'changed');
    assert.equal(
      readPublicSource(view, snapshot.source.selector, 'session').text,
      'changed!',
    );
    assert.equal(
      readMemory(view, 'session').find(item => item.record.id === snapshot.id).record.text,
      'original',
    );
  });

  test(`${mode}: capture markers exclude responses across branches and change availability explicitly`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const snapshot = artifact(f, task.id, 'later recognized response', []);
    f.manager.appendCustomEntry('cuckoo.report', {
      version: 4,
      requestId: 'captured-later',
      raw: 'not read',
      error: null,
      messageEntryId: snapshot.source.selector.entryId,
    });
    assert.equal(
      resolveSource(f.view(), snapshot.source, 'branch').status,
      'out-of-scope',
    );
    assert.equal(
      readMemory(f.view(), 'branch').find(item => item.record.id === snapshot.id).record.text,
      snapshot.text,
    );
    assert.throws(() => validateAppend(f.view(), {
      ...snapshot,
      id: 'recaptured-response',
    }), /out-of-scope/i);
  });

  test(`${mode}: task/ref restrictions reject cross-task, dangling, duplicate and self references`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const selectedEvidence = evidence(f, task.id, 'Evidence text');
    const first = claim(f, task.id, 'First claim', [selectedEvidence.id], []);
    const second = claim(f, task.id, 'Second claim', [], [first.id]);
    const withTaskDependency = makeClaim(f.view(), {
      taskId: task.id,
      category: 'assumption',
      text: 'Task dependency is explicit, not a truth assertion',
      evidenceIds: [],
      dependsOn: [task.id],
    }, f.runtime);
    f.save(withTaskDependency);

    for (const input of [
      {
        taskId: task.id,
        category: 'observation',
        text: 'Dangling',
        evidenceIds: ['missing'],
        dependsOn: [],
      },
      {
        taskId: task.id,
        category: 'observation',
        text: 'Wrong evidence kind',
        evidenceIds: [first.id],
        dependsOn: [],
      },
      {
        taskId: task.id,
        category: 'observation',
        text: 'Duplicate evidence',
        evidenceIds: [selectedEvidence.id, selectedEvidence.id],
        dependsOn: [],
      },
      {
        taskId: task.id,
        category: 'observation',
        text: 'Duplicate reference across fields',
        evidenceIds: [selectedEvidence.id],
        dependsOn: [selectedEvidence.id],
      },
      {
        taskId: 'not-a-task',
        category: 'observation',
        text: 'Missing explicit task',
        evidenceIds: [],
        dependsOn: [],
      },
      {
        taskId: task.id,
        category: 'observation',
        text: 'Injected authority',
        evidenceIds: [],
        dependsOn: [],
        author: 'human',
      },
    ]) {
      assert.throws(() => makeClaim(f.view(), input, f.runtime));
    }

    assert.throws(() => validateAppend(f.view(), {
      kind: 'claim',
      id: 'self',
      taskId: task.id,
      author: 'model',
      category: 'observation',
      text: 'Self reference',
      evidenceIds: [],
      dependsOn: ['self'],
    }), /self reference/i);

    f.user('A different task');
    const another = makeTask(f.view(), 'Another task', f.runtime);
    f.save(another);
    assert.throws(() => makeClaim(f.view(), {
      taskId: another.id,
      category: 'observation',
      text: 'Cross-task dependency',
      evidenceIds: [],
      dependsOn: [second.id],
    }, f.runtime), /cross-task/i);
    assert.throws(() => validateAppend(f.view(), {
      ...first,
      id: 'cross-task-evidence',
      taskId: another.id,
    }), /cross-task/i);

    const nextArtifact = artifact(f, task.id, 'later artifact', [second.id]);
    assert.deepEqual(nextArtifact.dependsOn, [second.id]);
    assert.throws(() => makeSnapshot(
      f.view(),
      task.id,
      'evidence',
      'Evidence cannot derive',
      selectedEvidence.source.selector,
      [first.id],
      f.runtime,
    ), /cannot have derived dependencies/i);

    const sourceId = f.assistant('artifact text');
    assert.throws(() => makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'Artifact cannot depend on task records',
      selection(sourceId, 0, 0, 13),
      [task.id],
      f.runtime,
    ), /snapshot, claim or check-result/i);
  });

  test(`${mode}: corrections are explicit, chronological, supported and non-resurrecting`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const selectedEvidence = evidence(f, task.id, 'Correction support');
    const old = claim(f, task.id, 'Earlier model claim', [selectedEvidence.id], []);
    const replacement = claim(f, task.id, 'Replacement model claim', [], [old.id]);
    const earlierArtifact = artifact(f, task.id, 'old artifact', []);
    const laterArtifact = artifact(f, task.id, 'new artifact', [replacement.id]);
    const correction = makeCorrection(f.view(), {
      taskId: task.id,
      targetIds: [old.id, earlierArtifact.id],
      replacementIds: [replacement.id, laterArtifact.id],
      evidenceIds: [selectedEvidence.id],
      reason: 'Model-authored correction with selected support',
    }, f.runtime);
    f.save(correction);

    assert.deepEqual(
      readMemory(f.view(), 'branch').filter(item => item.record.kind === 'correction')
        .map(item => item.record.targetIds),
      [[old.id, earlierArtifact.id]],
    );

    const invalidInputs = [
      {
        taskId: task.id,
        targetIds: [old.id],
        replacementIds: [],
        evidenceIds: [selectedEvidence.id],
        reason: 'Already superseded',
      },
      {
        taskId: task.id,
        targetIds: [replacement.id],
        replacementIds: [old.id],
        evidenceIds: [selectedEvidence.id],
        reason: 'Cannot resurrect a superseded replacement',
      },
      {
        taskId: task.id,
        targetIds: [selectedEvidence.id],
        replacementIds: [],
        evidenceIds: [laterArtifact.id],
        reason: 'Evidence snapshots cannot be targets',
      },
      {
        taskId: task.id,
        targetIds: [replacement.id],
        replacementIds: [replacement.id],
        evidenceIds: [selectedEvidence.id],
        reason: 'Target and replacement cannot overlap',
      },
      {
        taskId: task.id,
        targetIds: [replacement.id, replacement.id],
        replacementIds: [],
        evidenceIds: [selectedEvidence.id],
        reason: 'Duplicate targets',
      },
      {
        taskId: task.id,
        targetIds: [],
        replacementIds: [],
        evidenceIds: [selectedEvidence.id],
        reason: 'No target',
      },
      {
        taskId: task.id,
        targetIds: [replacement.id],
        replacementIds: [],
        evidenceIds: [],
        reason: 'No support',
      },
      {
        taskId: task.id,
        targetIds: [replacement.id],
        replacementIds: [task.id],
        evidenceIds: [selectedEvidence.id],
        reason: 'Task is not a replacement',
      },
    ];
    for (const input of invalidInputs) {
      assert.throws(() => makeCorrection(f.view(), input, f.runtime));
    }

    const withdrawal = makeCorrection(f.view(), {
      taskId: task.id,
      targetIds: [replacement.id],
      replacementIds: [],
      evidenceIds: [selectedEvidence.id],
      reason: 'Withdrawal without replacement is explicit',
    }, f.runtime);
    f.save(withdrawal);
    assert.equal(withdrawal.replacementIds.length, 0);

    const afterCorrection = claim(
      f,
      task.id,
      'A claim may declare a correction dependency',
      [],
      [correction.id],
    );
    assert.deepEqual(afterCorrection.dependsOn, [correction.id]);

    const sameLabelArtifact = artifact(f, task.id, 'new artifact', []);
    assert.equal(sameLabelArtifact.label, laterArtifact.label);
    assert.equal(sameLabelArtifact.digest, laterArtifact.digest);
    assert.equal(
      readMemory(f.view(), 'branch').filter(item => item.record.kind === 'correction').length,
      2,
      'Label/digest recency must not create implicit corrections',
    );
  });

  test(`${mode}: trusted check bindings and terminal records are strict`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const selectedEvidence = evidence(f, task.id, 'Expected shape prose');
    const artifactRecord = artifact(f, task.id, '{"ok":true}', []);
    const alternateArtifact = artifact(f, task.id, '{"other":true}', []);
    const start = checkStart(
      f,
      task.id,
      artifactRecord,
      [selectedEvidence, alternateArtifact],
    );

    assert.doesNotThrow(() => validateAppend(f.view(), start));
    const badDigest = {
      ...start,
      id: 'wrong-artifact-digest',
      artifact: {
        id: artifactRecord.id,
        digest: textDigest('different text'),
      },
    };
    assert.throws(() => validateAppend(f.view(), badDigest), /artifact digest/i);
    assert.throws(() => validateAppend(f.view(), {
      ...start,
      id: 'wrong-evidence-digest',
      evidence: [{
        id: selectedEvidence.id,
        digest: textDigest('different evidence'),
      }],
    }), /evidence binding/i);
    assert.throws(() => validateAppend(f.view(), {
      ...start,
      id: 'wrong-artifact-purpose',
      artifact: {
        id: selectedEvidence.id,
        digest: selectedEvidence.digest,
      },
      evidence: [],
    }), /artifact snapshot/i);
    assert.throws(() => validateAppend(f.view(), {
      ...start,
      id: 'duplicate-bound-input',
      evidence: [{
        id: artifactRecord.id,
        digest: artifactRecord.digest,
      }],
    }), /duplicate/i);
    assert.throws(() => validateAppend(f.view(), {
      ...start,
      id: 'extra-checker-command',
      checker: { ...start.checker, command: 'not allowed' },
    }), /exactly/i);
    assert.throws(() => validateAppend(f.view(), {
      ...start,
      id: 'invalid-start-time',
      startedAt: 'not a timestamp',
    }), /timestamp/i);

    f.save(start);
    const result = checkResult(f, start, 'fail', [{
      code: 'shape',
      message: 'A bounded result, not whole-task correctness',
      evidenceIds: [selectedEvidence.id, alternateArtifact.id],
    }]);
    assert.doesNotThrow(() => validateAppend(f.view(), result));
    assert.throws(() => validateAppend(f.view(), {
      ...result,
      id: 'artifact-not-explicit-evidence',
      findings: [{
        code: 'artifact',
        message: 'Artifact is separately bound, not selected evidence',
        evidenceIds: [artifactRecord.id],
      }],
    }), /not bound/i);
    assert.throws(() => validateAppend(f.view(), {
      ...result,
      id: 'wrong-start-kind',
      startId: artifactRecord.id,
    }), /earlier check-start/i);
    assert.throws(() => validateAppend(f.view(), {
      ...result,
      id: 'dangling-start',
      startId: 'missing-start',
    }), /earlier current-branch/i);
    assert.throws(() => validateAppend(f.view(), {
      ...result,
      id: 'unknown-outcome',
      outcome: 'verified',
    }), /outcome/i);
    assert.throws(() => validateAppend(f.view(), {
      ...result,
      id: 'duplicate-finding-evidence',
      findings: [{
        code: 'duplicate',
        message: 'Duplicate',
        evidenceIds: [selectedEvidence.id, selectedEvidence.id],
      }],
    }), /duplicate/i);
    f.save(result);

    assert.throws(() => validateAppend(
      f.view(),
      checkResult(f, start, 'pass', []),
    ), /already has a terminal/i);

    const dependent = claim(
      f,
      task.id,
      'Check result remains a recorded outcome, not proof of this claim',
      [result.id],
      [],
    );
    assert.deepEqual(dependent.evidenceIds, [result.id]);

    const pending = checkStart(f, task.id, artifactRecord, []);
    f.save(pending);
    const records = readMemory(f.view(), 'branch').map(item => item.record);
    assert.ok(records.some(record => record.id === pending.id && record.kind === 'check-start'));
    assert.ok(!records.some(
      record => record.kind === 'check-result' && record.startId === pending.id,
    ));
  });

  test(`${mode}: branches remain alternative histories, never a merged reference graph`, () => {
    const f = fixture(mode);
    const { task, stored: root } = seed(f);
    const otherArtifact = artifact(f, task.id, 'other branch artifact', []);
    const otherClaim = claim(f, task.id, 'other branch claim', [], [otherArtifact.id]);
    f.manager.branch(root.entryId);
    const currentArtifact = artifact(f, task.id, 'current branch artifact', []);
    const branch = readMemory(f.view(), 'branch');
    const session = readMemory(f.view(), 'session');
    assert.ok(!branch.some(item => item.record.id === otherClaim.id));
    assert.equal(session.find(item => item.record.id === otherClaim.id).branch, 'other');
    assert.equal(session.find(item => item.record.id === currentArtifact.id).branch, 'current');
    assert.equal(resolveSource(f.view(), otherArtifact.source, 'branch').status, 'out-of-scope');
    assert.equal(resolveSource(f.view(), otherArtifact.source, 'session').status, 'available');

    assert.throws(() => makeClaim(f.view(), {
      taskId: task.id,
      category: 'observation',
      text: 'Cannot silently join another branch',
      evidenceIds: [],
      dependsOn: [otherClaim.id],
    }, f.runtime), /earlier current-branch/i);
    assert.throws(() => validateAppend(f.view(), {
      ...otherClaim,
      dependsOn: [],
    }), /duplicate memory ID/i);

    const forgedId = f.unsafe({
      kind: 'claim',
      id: 'persisted-cross-branch-reference',
      taskId: task.id,
      author: 'model',
      category: 'observation',
      text: 'This reference exists only in the other history',
      evidenceIds: [],
      dependsOn: [otherClaim.id],
    });
    for (const scope of ['branch', 'session']) {
      assert.throws(
        () => readMemory(f.view(), scope),
        error => error.message.includes(forgedId) &&
          /earlier current-branch/i.test(error.message),
      );
    }
  });

  test(`${mode}: other-branch loading is structural, not an alternative-status projection`, () => {
    const f = fixture(mode);
    const { task, stored: root } = seed(f);
    const other = f.unsafe({
      kind: 'claim',
      id: 'other-branch-structurally-valid',
      taskId: task.id,
      author: 'model',
      category: 'assumption',
      text: 'An alternative history is not projected as current',
      evidenceIds: [],
      dependsOn: ['not-in-this-history'],
    });
    f.manager.branch(root.entryId);
    assert.equal(readMemory(f.view(), 'branch').length, 1);
    const historical = readMemory(f.view(), 'session').find(item => item.entryId === other);
    assert.equal(historical.branch, 'other');

    const malformed = f.manager.appendCustomEntry('cuckoo.memory', {
      version: 99,
      record: task,
    });
    f.manager.branch(root.entryId);
    assert.throws(
      () => readMemory(f.view(), 'session'),
      error => error.message.includes(malformed) && /version/i.test(error.message),
    );
    assert.equal(readMemory(f.view(), 'branch').length, 1);
  });

  test(`${mode}: persisted malformed envelopes fail explicitly with native entry IDs`, () => {
    const cases = [
      task => ({ version: 99, record: task }),
      task => ({ version: '1', record: task }),
      task => ({ version: 1, record: task, extra: true }),
      task => ({ version: 1, record: { ...task, kind: 'future-record' } }),
      task => ({ version: 1, record: { ...task, author: 'model' } }),
      task => ({ version: 1, record: { ...task, label: '' } }),
      task => ({ version: 1, record: { ...task, label: 'x'.repeat(257) } }),
      task => ({ version: 1, record: { ...task, id: 'x'.repeat(129) } }),
      task => ({ version: 1, record: { ...task, taskId: 'not-self' } }),
      task => ({ version: 1, record: { ...task, userEntryId: 'not-a-native-user' } }),
      () => null,
      () => [],
    ];
    for (const envelope of cases) {
      const f = fixture(mode);
      f.user('User task');
      const task = makeTask(f.view(), 'Valid task', f.runtime);
      const entryId = f.manager.appendCustomEntry('cuckoo.memory', envelope(task));
      assert.throws(
        () => readMemory(f.view(), 'branch'),
        error => error.message.includes(entryId),
      );
      assert.throws(
        () => readMemory(f.view(), 'session'),
        error => error.message.includes(entryId),
      );
    }
  });

  test(`${mode}: persisted snapshot corruption is not hidden by historical-source tolerance`, () => {
    const corruptions = [
      record => ({ ...record, digest: textDigest('wrong') }),
      record => ({
        ...record,
        source: { ...record.source, digest: textDigest('wrong') },
      }),
      record => ({ ...record, text: `${record.text}!` }),
      record => ({
        ...record,
        source: {
          ...record.source,
          selector: { ...record.source.selector, end: record.source.selector.end + 1 },
        },
      }),
      record => ({ ...record, dependsOn: ['missing', 'missing'] }),
      record => ({ ...record, source: { ...record.source, toolName: 'injected' } }),
    ];
    for (const corrupt of corruptions) {
      const f = fixture(mode);
      const { task } = seed(f);
      const entryId = f.assistant('artifact');
      const snapshot = makeSnapshot(
        f.view(),
        task.id,
        'artifact',
        'Artifact',
        selection(entryId, 0, 0, 8),
        [],
        f.runtime,
      );
      const badEntry = f.unsafe(corrupt(snapshot));
      assert.throws(
        () => readMemory(f.view(), 'branch'),
        error => error.message.includes(badEntry),
      );
    }
  });

  test(`${mode}: persisted duplicate/dangling records and second check terminals are rejected`, () => {
    {
      const f = fixture(mode);
      const { task } = seed(f);
      const duplicate = f.unsafe(task);
      assert.throws(
        () => readMemory(f.view(), 'branch'),
        error => error.message.includes(duplicate) && /duplicate/i.test(error.message),
      );
    }
    {
      const f = fixture(mode);
      const { task } = seed(f);
      const dangling = f.unsafe({
        kind: 'claim',
        id: 'dangling-persisted',
        taskId: task.id,
        author: 'model',
        category: 'assumption',
        text: 'Dangling',
        evidenceIds: [],
        dependsOn: ['later-or-missing'],
      });
      assert.throws(
        () => readMemory(f.view(), 'branch'),
        error => error.message.includes(dangling) &&
          /earlier current-branch/i.test(error.message),
      );
    }
    {
      const f = fixture(mode);
      const { task } = seed(f);
      const selectedEvidence = evidence(f, task.id, 'support');
      const artifactRecord = artifact(f, task.id, '{}', []);
      const start = checkStart(f, task.id, artifactRecord, [selectedEvidence]);
      f.save(start);
      f.save(checkResult(f, start, 'timeout', []));
      const duplicate = f.unsafe(checkResult(f, start, 'pass', []));
      assert.throws(
        () => readMemory(f.view(), 'branch'),
        error => error.message.includes(duplicate) && /terminal/i.test(error.message),
      );
    }
  });

  test(`${mode}: exact limits and dense reference arrays are enforced`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    const boundary = makeClaim(f.view(), {
      taskId: task.id,
      category: 'decision',
      text: 'x'.repeat(4000),
      evidenceIds: [],
      dependsOn: [],
    }, f.runtime);
    assert.equal(boundary.text.length, 4000);
    assert.throws(() => makeClaim(f.view(), {
      taskId: task.id,
      category: 'decision',
      text: 'x'.repeat(4001),
      evidenceIds: [],
      dependsOn: [],
    }, f.runtime), /4000/i);
    assert.throws(() => makeClaim(f.view(), {
      taskId: task.id,
      category: 'decision',
      text: 'Bounds',
      evidenceIds: [],
      dependsOn: Array.from({ length: 33 }, (_item, index) => `reference-${index}`),
    }, f.runtime), /32/i);

    const sparse = new Array(1);
    assert.throws(() => makeClaim(f.view(), {
      taskId: task.id,
      category: 'decision',
      text: 'Sparse',
      evidenceIds: sparse,
      dependsOn: [],
    }, f.runtime), /dense|holes/i);

    const entryId = f.assistant('x'.repeat(100000));
    const snapshot = makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'x'.repeat(256),
      selection(entryId, 0, 0, 100000),
      [],
      f.runtime,
    );
    assert.equal(snapshot.text.length, 100000);
    assert.throws(() => makeSnapshot(
      f.view(),
      task.id,
      'artifact',
      'Too large',
      selection(entryId, 0, 0, 100001),
      [],
      f.runtime,
    ), /100000/i);
  });

  test(`${mode}: appendMemory validates before calling the port`, () => {
    const f = fixture(mode);
    const { task } = seed(f);
    let calls = 0;
    const port = {
      view: f.view,
      append() {
        calls++;
        assert.fail('An invalid record must never reach append');
      },
    };
    assert.throws(() => appendMemory(port, {
      kind: 'claim',
      id: 'invalid',
      taskId: task.id,
      author: 'model',
      category: 'observation',
      text: 'Missing dependency',
      evidenceIds: [],
      dependsOn: ['missing'],
    }));
    assert.equal(calls, 0);
  });

  test(`${mode}: appendMemory rejects fabricated or inconsistent port results`, () => {
    for (const corruption of [
      result => ({ ...result, entryId: 'fabricated-native-id' }),
      result => ({ ...result, timestamp: '2026-11-13T20:33:00.000Z' }),
      result => ({ ...result, branch: 'other' }),
      result => ({ ...result, record: { ...result.record, label: 'Changed by port' } }),
      result => ({ ...result, extra: true }),
    ]) {
      const f = fixture(mode);
      f.user('Task');
      const task = makeTask(f.view(), 'Original label', f.runtime);
      const port = {
        view: f.view,
        append(record) {
          return corruption(f.port.append(record));
        },
      };
      assert.throws(() => appendMemory(port, task), /port|exactly/i);
    }

    {
      const f = fixture(mode);
      f.user('Task');
      const task = makeTask(f.view(), 'Task', f.runtime);
      const port = {
        view: f.view,
        append(record) {
          return {
            entryId: 'not-appended',
            timestamp: TIME,
            branch: 'current',
            record,
          };
        },
      };
      assert.throws(() => appendMemory(port, task), /did not append a native entry/i);
    }

    {
      const f = fixture(mode);
      f.user('Task');
      const task = makeTask(f.view(), 'Task', f.runtime);
      const port = {
        view: f.view,
        append(record) {
          const result = f.port.append(record);
          f.manager.appendCustomEntry('unrelated-extra-entry', {});
          return result;
        },
      };
      const stored = appendMemory(port, task);
      assert.notEqual(stored.entryId, f.manager.getLeafId());
      assert.deepEqual(readMemory(f.view(), 'branch').map(item => item.record.id), [task.id]);
    }

    {
      const f = fixture(mode);
      f.user('Task');
      const task = makeTask(f.view(), 'Original task', f.runtime);
      const port = {
        view: f.view,
        append(record) {
          const changed = { ...record, label: 'Persisted different task' };
          const result = f.port.append(changed);
          return { ...result, record };
        },
      };
      assert.throws(() => appendMemory(port, task), /inconsistent/i);
    }
  });

  test(`${mode}: invalid native branch paths cannot silently merge histories`, () => {
    const f = fixture(mode);
    const { task, stored } = seed(f);
    const other = artifact(f, task.id, 'other branch', []);
    const otherLeaf = f.manager.getLeafId();
    f.manager.branch(stored.entryId);
    artifact(f, task.id, 'current branch', []);
    const malformed = cloneView(f.view());
    malformed.branch.push(
      structuredClone(f.manager.getEntry(otherLeaf)),
    );
    assert.throws(() => readMemory(malformed, 'branch'), /native branch path/i);

    const duplicate = cloneView(f.view());
    duplicate.entries.push(duplicate.entries[0]);
    assert.throws(() => readMemory(duplicate, 'session'), /duplicate native entry/i);
    assert.equal(resolveSource(f.view(), other.source, 'branch').status, 'out-of-scope');
  });
}

test('native: a fork exposes only its copied native path and retains valid memory anchors', () => {
  const f = fixture('native');
  const { task, stored: root } = seed(f);
  const excluded = artifact(f, task.id, 'excluded parent branch', []);
  f.manager.branch(root.entryId);
  const included = artifact(f, task.id, 'copied current branch', []);
  const leaf = f.manager.getLeafId();
  const oldSessionId = f.manager.getSessionId();

  f.manager.createBranchedSession(leaf);
  assert.notEqual(f.manager.getSessionId(), oldSessionId);
  const records = readMemory(f.view(), 'session');
  assert.deepEqual(records.map(item => item.record.id), [task.id, included.id]);
  assert.ok(records.every(item => item.branch === 'current'));
  assert.equal(resolveSource(f.view(), included.source, 'branch').status, 'available');
  assert.equal(resolveSource(f.view(), excluded.source, 'session').status, 'unavailable');
});

test('native: compaction does not turn its summary or custom data into source evidence', () => {
  const f = fixture('native');
  const { task } = seed(f);
  const snapshot = artifact(f, task.id, 'original artifact text', []);
  const kept = f.user('Continue the same work');
  f.manager.appendCompaction('PRIVATE_COMPACTION_SUMMARY', kept, 10000);

  assert.equal(
    readMemory(f.view(), 'branch').find(item => item.record.id === snapshot.id).record.text,
    'original artifact text',
  );
  assert.doesNotMatch(JSON.stringify(listSources(f.view(), 'session')), /PRIVATE_COMPACTION/);
  assert.equal(resolveSource(f.view(), snapshot.source, 'branch').status, 'available');
});
