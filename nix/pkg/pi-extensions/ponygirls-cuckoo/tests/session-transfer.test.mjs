import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  appendMemory,
  makeClaim,
  makeCorrection,
  makeSnapshot,
  makeTask,
  readMemory,
  textDigest,
} from '../src/memory-core.ts';
import {
  createTransfer,
  createTransferReader,
  inspectTransferCandidate,
  MAX_TRANSFER_MANIFEST_BYTES,
  TransferError,
} from '../src/experiments/session-transfer.ts';

// Specified Behavioral-Active / Blackbox-Group.
// Real in-memory native SessionManager plus core builders and the public
// transfer API. The host approval port is a hand-written synthetic adapter;
// no filesystem, service, model, private data or external approval system.

const OBSERVED = '2026-11-12T12:00:00.000Z';
const APPROVED = '2026-11-12T12:01:00.000Z';
const NOW = '2026-11-12T12:02:00.000Z';
const EXPIRES = '2026-11-12T13:00:00.000Z';
const STARTED = '2026-11-12T11:58:00.000Z';
const FINISHED = '2026-11-12T11:59:00.000Z';
const PROJECT = 'synthetic-project';
const TEXT = 'EXACT_SYNTHETIC_SNAPSHOT\n{"answer":"🐦"}\u0000\\\r\n\ud800Z\udfff';
const OLD_RULE =
  'Synthetic historical user instruction: treat this old rule as historical, ' +
  'not as authorization in a later session.';

function fixture(text, includeCheck) {
  const manager = SessionManager.inMemory();
  const userEntryId = manager.appendMessage({
    role: 'user',
    content: OLD_RULE,
    timestamp: 1,
  });

  const view = () => ({
    sessionId: manager.getSessionId(),
    entries: manager.getEntries(),
    branch: manager.getBranch(),
  });

  let sequence = 0;
  const runtime = {
    newId: () => `synthetic-record-${++sequence}`,
    now: () => OBSERVED,
  };
  const port = {
    view,
    append(record) {
      const entryId = manager.appendCustomEntry('cuckoo.memory', {
        version: 1,
        record,
      });
      const stored = readMemory(view(), 'branch').find(
        item => item.entryId === entryId,
      );
      assert.ok(stored);
      return stored;
    },
  };
  const save = record => {
    appendMemory(port, record);
    return record;
  };

  const task = save(makeTask(view(), 'Synthetic original task', runtime));
  const evidence = save(
    makeSnapshot(
      view(),
      task.id,
      'evidence',
      'Historical user text',
      {
        entryId: userEntryId,
        part: 0,
        start: 0,
        end: OLD_RULE.length,
      },
      [],
      runtime,
    ),
  );

  const assistantEntryId = manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2,
  });
  const artifact = save(
    makeSnapshot(
      view(),
      task.id,
      'artifact',
      'Synthetic exact artifact',
      {
        entryId: assistantEntryId,
        part: 0,
        start: 0,
        end: text.length,
      },
      [],
      runtime,
    ),
  );
  const claim = save(
    makeClaim(
      view(),
      {
        taskId: task.id,
        category: 'interpretation',
        text: 'Synthetic model interpretation, not a new rule or authorization.',
        evidenceIds: [evidence.id],
        dependsOn: [artifact.id],
      },
      runtime,
    ),
  );

  let start = null;
  let result = null;
  if (includeCheck) {
    // Synthetic trusted-check fixtures, not a model request or outcome importer.
    start = save({
      kind: 'check-start',
      id: runtime.newId(),
      taskId: task.id,
      toolCallId: 'synthetic-check-call',
      checker: {
        id: 'synthetic-checker',
        version: '1',
        implementationDigest: textDigest('synthetic checker implementation'),
        scope: 'Synthetic old exact-input check only',
      },
      artifact: { id: artifact.id, digest: artifact.digest },
      evidence: [{ id: evidence.id, digest: evidence.digest }],
      startedAt: STARTED,
    });
    result = save({
      kind: 'check-result',
      id: runtime.newId(),
      taskId: task.id,
      startId: start.id,
      outcome: 'pass',
      findings: [{
        code: 'synthetic-pass',
        message: 'Synthetic historical fixture result only.',
        evidenceIds: [evidence.id],
      }],
      errorCode: null,
      finishedAt: FINISHED,
    });
  }

  const exportSelected = recordIds =>
    createTransfer(
      view(),
      { tasks: [{ taskId: task.id, recordIds }] },
      { projectId: PROJECT, observedAt: OBSERVED },
    );
  const candidate = exportSelected(
    result === null ? [claim.id] : [claim.id, result.id],
  );
  return {
    manager,
    view,
    runtime,
    port,
    save,
    task,
    evidence,
    artifact,
    claim,
    start,
    result,
    text,
    candidate,
    exportSelected,
  };
}

function basic() {
  return fixture(TEXT, true);
}

test('operator preview validates exact canonical bytes without constructing an approval', () => {
  const f = basic(); const preview = inspectTransferCandidate(f.candidate.manifestJson);
  assert.equal(preview.manifestDigest, f.candidate.manifestDigest);
  assert.equal(preview.manifest.contentDigest, f.candidate.contentDigest);
  assert.equal(preview.manifest.records.find(item => item.record.id === f.artifact.id).record.text, TEXT);
  assert.equal(Object.isFrozen(preview), true); assert.equal(Object.isFrozen(preview.manifest.records), true);
  assert.throws(() => inspectTransferCandidate(`${f.candidate.manifestJson}\n`), /canonical/);
  assert.throws(() => inspectTransferCandidate(f.candidate.manifestJson.replace('EXACT_SYNTHETIC_SNAPSHOT', 'ALTERED_SYNTHETIC_TEXT')), /digest/i);
});

function nativeDestination(sessionId) {
  return {
    projectId: PROJECT,
    sessionId,
    branchId: 'synthetic-destination-branch',
    taskId: null,
  };
}

function hashManifest(json) {
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

function approvalKey(digest, destination) {
  return JSON.stringify([digest, destination]);
}

function hostHarness(initialDestination) {
  const approvals = new Map();
  const revoked = new Set();
  let currentDestination = structuredClone(initialDestination);
  let currentTime = NOW;

  const port = {
    getApproval(digest, destination) {
      return approvals.get(approvalKey(digest, destination)) ?? null;
    },
    isRevoked(revocationId) {
      return revoked.has(revocationId);
    },
  };
  const context = {
    approvals: port,
    destination: () => structuredClone(currentDestination),
    now: () => currentTime,
  };
  const reader = createTransferReader(context);

  return {
    reader,
    context,
    port,
    approvals,
    revoked,
    destination: () => structuredClone(currentDestination),
    setDestination(value) {
      currentDestination = structuredClone(value);
    },
    setTime(value) {
      currentTime = value;
    },
    approve(candidate) {
      const approval = {
        approvalId: `approval-${approvals.size + 1}`,
        revocationId: `revocation-${approvals.size + 1}`,
        manifestDigest: candidate.manifestDigest,
        projectId: PROJECT,
        destination: structuredClone(currentDestination),
        approvedAt: APPROVED,
        expiresAt: EXPIRES,
      };
      approvals.set(
        approvalKey(candidate.manifestDigest, currentDestination),
        approval,
      );
      return approval;
    },
    installForLookup(digest, approval) {
      approvals.set(
        approvalKey(digest, currentDestination),
        structuredClone(approval),
      );
    },
  };
}

function approvedFixture(f) {
  const destinationManager = SessionManager.inMemory();
  const host = hostHarness(nativeDestination(destinationManager.getSessionId()));
  const approval = host.approve(f.candidate);
  return { destinationManager, host, approval };
}

function pageAll(reader, manifestJson, recordId, limit) {
  let offset = 0;
  let combined = '';
  const pages = [];
  do {
    const page = reader.query(manifestJson, {
      action: 'text',
      recordId,
      offset,
      limit,
    });
    assert.equal(page.action, 'text');
    assert.equal(page.offset, offset);
    assert.equal(page.metadata.current, false);
    assert.equal(page.metadata.authority, 'none');
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 50000);
    combined += page.text;
    pages.push(page);
    offset = page.nextOffset;
  } while (offset !== null);
  return { combined, pages };
}

function reseal(object) {
  const { contentDigest: ignoredDigest, ...payload } = object;
  void ignoredDigest;
  object.contentDigest = textDigest(JSON.stringify(payload));
  return JSON.stringify(object);
}

function readList(host, candidate) {
  return host.reader.query(candidate.manifestJson, {
    action: 'list',
    limit: 20,
  });
}

test('approved exact snapshots round-trip in a new native session without importing or mutating either session', () => {
  const f = basic();
  const { destinationManager, host } = approvedFixture(f);
  assert.notEqual(destinationManager.getSessionId(), f.manager.getSessionId());

  const sourceBefore = structuredClone(f.manager.getEntries());
  const sourceLeaf = f.manager.getLeafId();
  const destinationBefore = structuredClone(destinationManager.getEntries());
  const destinationLeaf = destinationManager.getLeafId();

  const receipt = host.reader.checkApproval(f.candidate.manifestJson);
  assert.equal(receipt.manifestDigest, f.candidate.manifestDigest);
  assert.equal(receipt.destination.sessionId, destinationManager.getSessionId());

  const result = pageAll(
    host.reader,
    f.candidate.manifestJson,
    f.artifact.id,
    3,
  );
  assert.equal(result.combined, TEXT);
  assert.deepEqual(
    Buffer.from(result.combined, 'utf16le'),
    Buffer.from(TEXT, 'utf16le'),
  );
  assert.equal(
    result.pages[0].metadata.snapshot.digest,
    textDigest(TEXT),
  );
  assert.deepEqual(f.manager.getEntries(), sourceBefore);
  assert.equal(f.manager.getLeafId(), sourceLeaf);
  assert.deepEqual(destinationManager.getEntries(), destinationBefore);
  assert.equal(destinationManager.getLeafId(), destinationLeaf);
  assert.equal(destinationManager.getEntries().length, 0);

  const manifest = JSON.parse(f.candidate.manifestJson);
  assert.equal(manifest.origin.projectId, PROJECT);
  assert.equal(manifest.origin.sessionId, f.manager.getSessionId());
  assert.equal(manifest.origin.branchHeadId, sourceLeaf);
  assert.equal(manifest.observedAt, OBSERVED);
  const storedArtifact = manifest.records.find(
    item => item.record.id === f.artifact.id,
  );
  const originalStoredArtifact = readMemory(f.view(), 'branch').find(
    item => item.record.id === f.artifact.id,
  );
  assert.equal(storedArtifact.entryId, originalStoredArtifact.entryId);
  assert.equal(storedArtifact.timestamp, originalStoredArtifact.timestamp);
  assert.deepEqual(storedArtifact.record.source, f.artifact.source);
  assert.equal(storedArtifact.record.text, TEXT);
});

test('candidate, read metadata and exact public text are immutable copies', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  assert.ok(Object.isFrozen(f.candidate));
  const page = host.reader.query(f.candidate.manifestJson, {
    action: 'text',
    recordId: f.artifact.id,
    limit: 1,
  });
  assert.ok(Object.isFrozen(page));
  assert.ok(Object.isFrozen(page.metadata));
  assert.ok(Object.isFrozen(page.metadata.snapshot.source));
  assert.throws(() => { page.metadata.snapshot.source.role = 'user'; }, TypeError);
  assert.throws(() => { f.candidate.manifestJson = '{}'; }, TypeError);
  assert.equal(
    host.reader.query(f.candidate.manifestJson, {
      action: 'text',
      recordId: f.artifact.id,
      limit: 1,
    }).text,
    TEXT.slice(0, 1),
  );
});

test('task labels, original refs and complete check closure are exported; no unrelated record is added', () => {
  const f = basic();
  const candidate = f.exportSelected([f.result.id]);
  const manifest = JSON.parse(candidate.manifestJson);
  const ids = manifest.records.map(item => item.record.id);
  assert.deepEqual(
    new Set(ids),
    new Set([
      f.task.id,
      f.evidence.id,
      f.artifact.id,
      f.start.id,
      f.result.id,
    ]),
  );
  assert.ok(!ids.includes(f.claim.id));
  assert.equal(manifest.records[0].record.label, f.task.label);
  assert.equal(
    manifest.records.find(item => item.record.id === f.start.id)
      .record.artifact.digest,
    f.artifact.digest,
  );
});

test('correction closure retains targets, replacements and supporting evidence without creating current claims', () => {
  const f = basic();
  const replacement = f.save(
    makeClaim(
      f.view(),
      {
        taskId: f.task.id,
        category: 'interpretation',
        text: 'Synthetic replacement interpretation.',
        evidenceIds: [f.evidence.id],
        dependsOn: [f.artifact.id],
      },
      f.runtime,
    ),
  );
  const correction = f.save(
    makeCorrection(
      f.view(),
      {
        taskId: f.task.id,
        targetIds: [f.claim.id],
        replacementIds: [replacement.id],
        evidenceIds: [f.evidence.id],
        reason: 'Synthetic correction fixture.',
      },
      f.runtime,
    ),
  );
  const candidate = f.exportSelected([correction.id]);
  const manifest = JSON.parse(candidate.manifestJson);
  const ids = new Set(manifest.records.map(item => item.record.id));
  for (const id of [
    f.task.id,
    f.claim.id,
    replacement.id,
    correction.id,
    f.evidence.id,
    f.artifact.id,
  ]) assert.ok(ids.has(id));

  const host = hostHarness(nativeDestination('synthetic-new-session'));
  host.approve(candidate);
  const result = host.reader.query(candidate.manifestJson, {
    action: 'inspect',
    recordId: correction.id,
  });
  assert.deepEqual(result.body.targetIds, [f.claim.id]);
  assert.deepEqual(result.body.replacementIds, [replacement.id]);
  assert.equal(result.metadata.state, 'historical-external');
  assert.equal(result.metadata.current, false);
});

test('enumeration and inspection omit snapshot bodies; explicit paging retains exact text', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const list = readList(host, f.candidate);
  assert.equal(list.total, 6);
  assert.doesNotMatch(JSON.stringify(list), /EXACT_SYNTHETIC_SNAPSHOT/);
  for (const record of list.records) {
    assert.equal(record.state, 'historical-external');
    assert.equal(record.current, false);
    assert.equal(record.authority, 'none');
  }
  const inspection = host.reader.query(f.candidate.manifestJson, {
    action: 'inspect',
    recordId: f.artifact.id,
  });
  assert.equal(inspection.body.text, undefined);
  assert.equal(inspection.body.textOmitted, true);
  assert.deepEqual(
    inspection.body.exactText,
    { action: 'text', recordId: f.artifact.id },
  );
  assert.doesNotMatch(JSON.stringify(inspection), /EXACT_SYNTHETIC_SNAPSHOT/);
  assert.equal(inspection.metadata.snapshot.chars, TEXT.length);
  assert.equal(
    pageAll(host.reader, f.candidate.manifestJson, f.artifact.id, 1).combined,
    TEXT,
  );
});

test('old user rules and check passes stay historical with original times and exact input bindings', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const evidence = host.reader.query(f.candidate.manifestJson, {
    action: 'text',
    recordId: f.evidence.id,
  });
  assert.equal(evidence.text, OLD_RULE);
  assert.equal(evidence.metadata.snapshot.source.role, 'user');
  assert.equal(evidence.metadata.authority, 'none');
  assert.equal(evidence.metadata.current, false);
  assert.match(evidence.notice, /not current instructions, authorization/);

  const check = host.reader.query(f.candidate.manifestJson, {
    action: 'inspect',
    recordId: f.result.id,
  });
  assert.equal(check.body.outcome, 'pass');
  assert.equal(check.body.startId, f.start.id);
  assert.equal(check.body.finishedAt, FINISHED);
  assert.deepEqual(check.metadata.verification, {
    fresh: false,
    inputScope: 'original-exact-inputs-only',
    startedAt: STARTED,
    finishedAt: FINISHED,
    outcome: 'pass',
  });
  assert.equal(check.metadata.current, false);
  assert.equal(check.metadata.authority, 'none');
  assert.match(check.notice, /not.*fresh verification/);

  const start = host.reader.query(f.candidate.manifestJson, {
    action: 'inspect',
    recordId: f.start.id,
  });
  assert.deepEqual(start.body.artifact, {
    id: f.artifact.id,
    digest: f.artifact.digest,
  });
  assert.deepEqual(start.body.evidence, [{
    id: f.evidence.id,
    digest: f.evidence.digest,
  }]);
});

test('unapproved reads and a model-supplied approval boolean are denied', () => {
  const f = basic();
  const host = hostHarness(nativeDestination('synthetic-destination'));
  assert.throws(
    () => readList(host, f.candidate),
    { code: 'NO_APPROVAL' },
  );
  host.approve(f.candidate);
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'list',
      approved: true,
    }),
    { code: 'SCHEMA' },
  );
  assert.deepEqual(
    Object.keys(host.reader).sort(),
    ['checkApproval', 'query'],
  );
});

test('approval binds exact project, destination session, branch and task', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const original = host.destination();
  assert.equal(readList(host, f.candidate).total, 6);

  host.setDestination({ ...original, projectId: 'synthetic-other-project' });
  assert.throws(() => readList(host, f.candidate), { code: 'DENIED' });

  for (const change of [
    { sessionId: 'synthetic-other-session' },
    { branchId: 'synthetic-other-branch' },
    { taskId: 'synthetic-destination-task' },
  ]) {
    host.setDestination({ ...original, ...change });
    assert.throws(() => readList(host, f.candidate), { code: 'NO_APPROVAL' });
  }
  host.setDestination(original);
  assert.equal(readList(host, f.candidate).total, 6);
});

test('a registry response with a wrong digest, project or destination cannot authorize', () => {
  const f = basic();
  const { host, approval } = approvedFixture(f);
  const wrongDigest = `sha256:${'0'.repeat(64)}`;
  for (const patch of [
    { manifestDigest: wrongDigest },
    { projectId: 'synthetic-other-project' },
    { destination: { ...approval.destination, sessionId: 'wrong-session' } },
    { destination: { ...approval.destination, branchId: 'wrong-branch' } },
    { destination: { ...approval.destination, taskId: 'wrong-task' } },
  ]) {
    host.installForLookup(f.candidate.manifestDigest, {
      ...approval,
      ...patch,
    });
    assert.throws(() => readList(host, f.candidate), { code: 'DENIED' });
  }
});

test('expiry and revocation are checked on every operation, not just reader creation', () => {
  const f = basic();
  const { host, approval } = approvedFixture(f);
  assert.equal(readList(host, f.candidate).total, 6);

  host.setTime(EXPIRES);
  assert.throws(() => readList(host, f.candidate), { code: 'EXPIRED' });
  host.setTime(NOW);
  assert.equal(readList(host, f.candidate).total, 6);

  host.revoked.add(approval.revocationId);
  assert.throws(
    () => host.reader.checkApproval(f.candidate.manifestJson),
    { code: 'REVOKED' },
  );
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'text',
      recordId: f.artifact.id,
    }),
    { code: 'REVOKED' },
  );
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'inspect',
      recordId: f.claim.id,
    }),
    { code: 'REVOKED' },
  );
});

test('approval lookup failures and unknown revocation states fail closed', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const reader = createTransferReader({
    ...host.context,
    approvals: {
      getApproval() { throw new Error('Synthetic unavailable adapter'); },
      isRevoked() { return false; },
    },
  });
  assert.throws(
    () => reader.checkApproval(f.candidate.manifestJson),
    { code: 'APPROVAL_UNAVAILABLE' },
  );

  const unknownRevocation = createTransferReader({
    ...host.context,
    approvals: {
      getApproval: (...args) => host.port.getApproval(...args),
      isRevoked: () => undefined,
    },
  });
  assert.throws(
    () => unknownRevocation.checkApproval(f.candidate.manifestJson),
    { code: 'SCHEMA' },
  );

  const failedRevocation = createTransferReader({
    ...host.context,
    approvals: {
      getApproval: (...args) => host.port.getApproval(...args),
      isRevoked() { throw new Error('Synthetic unavailable adapter'); },
    },
  });
  assert.throws(
    () => failedRevocation.checkApproval(f.candidate.manifestJson),
    { code: 'APPROVAL_UNAVAILABLE' },
  );
});

test('changed public content requires a new exact approval, while old approved bytes remain unchanged', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const changed = JSON.parse(f.candidate.manifestJson);
  const artifact = changed.records.find(item => item.record.id === f.artifact.id)
    .record;
  artifact.text = `${artifact.text.slice(0, -1)}Q`;
  artifact.digest = textDigest(artifact.text);
  artifact.source.digest = artifact.digest;
  // The old check binds the old artifact digest. Update that binding in this
  // synthetic candidate too, so denial is authorization, not a malformed graph.
  changed.records.find(item => item.record.id === f.start.id)
    .record.artifact.digest = artifact.digest;
  const changedJson = reseal(changed);
  const changedCandidate = {
    manifestJson: changedJson,
    manifestDigest: hashManifest(changedJson),
  };
  assert.notEqual(
    changedCandidate.manifestDigest,
    f.candidate.manifestDigest,
  );
  assert.throws(
    () => host.reader.query(changedJson, { action: 'list' }),
    { code: 'NO_APPROVAL' },
  );

  host.approve(changedCandidate);
  assert.equal(
    pageAll(host.reader, changedJson, f.artifact.id, 7).combined,
    artifact.text,
  );
  assert.equal(
    pageAll(host.reader, f.candidate.manifestJson, f.artifact.id, 7).combined,
    TEXT,
  );
});

test('snapshot self-digest, source digest, check binding and payload digest mismatches reject', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const cases = [
    object => {
      object.records.find(item => item.record.id === f.artifact.id)
        .record.text += 'changed';
    },
    object => {
      object.records.find(item => item.record.id === f.artifact.id)
        .record.source.digest = textDigest('different synthetic text');
    },
    object => {
      object.records.find(item => item.record.id === f.start.id)
        .record.artifact.digest = textDigest('different synthetic artifact');
    },
  ];
  for (const alter of cases) {
    const object = JSON.parse(f.candidate.manifestJson);
    alter(object);
    assert.throws(
      () => host.reader.query(reseal(object), { action: 'list' }),
      { code: 'DIGEST' },
    );
  }

  const payloadChanged = JSON.parse(f.candidate.manifestJson);
  payloadChanged.observedAt = '2026-11-12T12:00:01.000Z';
  assert.throws(
    () => host.reader.query(JSON.stringify(payloadChanged), { action: 'list' }),
    { code: 'DIGEST' },
  );
});

test('same-looking original record IDs and task labels never merge across origins', () => {
  const a = basic();
  const b = basic();
  assert.equal(a.task.id, b.task.id);
  assert.equal(a.artifact.id, b.artifact.id);
  assert.equal(a.task.label, b.task.label);
  assert.notEqual(a.manager.getSessionId(), b.manager.getSessionId());

  const host = hostHarness(nativeDestination('synthetic-destination'));
  host.approve(a.candidate);
  host.approve(b.candidate);
  const left = host.reader.query(a.candidate.manifestJson, {
    action: 'inspect',
    recordId: a.artifact.id,
  });
  const right = host.reader.query(b.candidate.manifestJson, {
    action: 'inspect',
    recordId: b.artifact.id,
  });
  assert.equal(
    left.metadata.identity.recordId,
    right.metadata.identity.recordId,
  );
  assert.notEqual(
    left.metadata.identity.sessionId,
    right.metadata.identity.sessionId,
  );
  assert.notEqual(
    left.metadata.identity.manifestDigest,
    right.metadata.identity.manifestDigest,
  );
  assert.notDeepEqual(
    left.metadata.identity,
    right.metadata.identity,
  );
});

test('manifest identity also separates distinct exports from the same origin session', () => {
  const f = basic();
  const narrow = f.exportSelected([f.claim.id]);
  assert.equal(
    JSON.parse(narrow.manifestJson).origin.sessionId,
    JSON.parse(f.candidate.manifestJson).origin.sessionId,
  );
  assert.notEqual(narrow.manifestDigest, f.candidate.manifestDigest);

  const host = hostHarness(nativeDestination('synthetic-destination'));
  host.approve(narrow);
  host.approve(f.candidate);
  const left = host.reader.query(narrow.manifestJson, {
    action: 'inspect',
    recordId: f.claim.id,
  });
  const right = host.reader.query(f.candidate.manifestJson, {
    action: 'inspect',
    recordId: f.claim.id,
  });
  assert.notDeepEqual(left.metadata.identity, right.metadata.identity);
});

test('only explicit current-branch records can be selected; no other branch or whole-session discovery', () => {
  const f = basic();
  const root = f.manager.getEntries()[0].id;
  f.manager.branch(root);
  assert.throws(
    () => createTransfer(
      f.view(),
      { tasks: [{ taskId: f.task.id, recordIds: [f.artifact.id] }] },
      { projectId: PROJECT, observedAt: OBSERVED },
    ),
    { code: 'REFERENCE' },
  );
  const invalidScopeRequest = {
    tasks: [{ taskId: f.task.id, recordIds: [f.artifact.id] }],
    scope: 'session',
  };
  assert.throws(
    () => createTransfer(
      f.view(),
      invalidScopeRequest,
      { projectId: PROJECT, observedAt: OBSERVED },
    ),
    { code: 'SCHEMA' },
  );
});

test('missing task labels, missing required records, self loops, forward refs and duplicate IDs reject', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const changes = [
    object => {
      object.records = object.records.filter(
        item => item.record.id !== f.task.id,
      );
    },
    object => {
      object.records = object.records.filter(
        item => item.record.id !== f.artifact.id,
      );
    },
    object => {
      object.records.find(item => item.record.id === f.claim.id)
        .record.dependsOn = [f.claim.id];
    },
    object => {
      object.records.find(item => item.record.id === f.claim.id)
        .record.dependsOn = [f.result.id];
    },
    object => {
      object.records[1].record.id = object.records[0].record.id;
    },
    object => {
      object.records[1].entryId = object.records[0].entryId;
    },
  ];
  for (const change of changes) {
    const object = JSON.parse(f.candidate.manifestJson);
    change(object);
    assert.throws(
      () => host.reader.query(reseal(object), { action: 'list' }),
      { code: 'REFERENCE' },
    );
  }
});

test('cross-task references, partial selection and unrelated appended records reject', () => {
  const f = basic();
  const otherUser = f.manager.appendMessage({
    role: 'user',
    content: 'Synthetic unrelated second task.',
    timestamp: 3,
  });
  assert.ok(otherUser);
  const otherTask = f.save(
    makeTask(f.view(), 'Synthetic second task', f.runtime),
  );
  const otherClaim = f.save(
    makeClaim(
      f.view(),
      {
        taskId: otherTask.id,
        category: 'assumption',
        text: 'Synthetic unrelated second-task assumption.',
        evidenceIds: [],
        dependsOn: [],
      },
      f.runtime,
    ),
  );

  assert.throws(
    () => f.exportSelected([otherClaim.id]),
    { code: 'REFERENCE' },
  );
  assert.throws(
    () => createTransfer(
      f.view(),
      { tasks: [{ taskId: f.task.id, recordIds: [] }] },
      { projectId: PROJECT, observedAt: OBSERVED },
    ),
    { code: 'BOUNDS' },
  );

  const both = createTransfer(
    f.view(),
    {
      tasks: [
        { taskId: f.task.id, recordIds: [f.claim.id] },
        { taskId: otherTask.id, recordIds: [otherClaim.id] },
      ],
    },
    { projectId: PROJECT, observedAt: OBSERVED },
  );
  const host = hostHarness(nativeDestination('synthetic-destination'));
  const object = JSON.parse(both.manifestJson);
  object.records.find(item => item.record.id === otherClaim.id)
    .record.dependsOn = [f.artifact.id];
  assert.throws(
    () => host.reader.query(reseal(object), { action: 'list' }),
    { code: 'REFERENCE' },
  );

  const unrelated = JSON.parse(both.manifestJson);
  unrelated.selection = unrelated.selection.filter(
    item => item.taskId === f.task.id,
  );
  assert.throws(
    () => host.reader.query(reseal(unrelated), { action: 'list' }),
    { code: 'REFERENCE' },
  );
});

test('oversized required closure fails instead of truncating or silently losing refs', () => {
  const f = fixture('Synthetic small artifact.', false);
  let last = f.claim;
  for (let index = 0; index < 130; index++) {
    last = f.save(
      makeClaim(
        f.view(),
        {
          taskId: f.task.id,
          category: 'assumption',
          text: `Synthetic chain link ${index}.`,
          evidenceIds: [f.evidence.id],
          dependsOn: [last.id],
        },
        f.runtime,
      ),
    );
  }
  assert.throws(
    () => f.exportSelected([last.id]),
    { code: 'BOUNDS' },
  );
});

test('strict manifest schema rejects unknown fields, unknown versions, alternate JSON and arbitrary path-like input', () => {
  const f = basic();
  const { host } = approvedFixture(f);

  const version = JSON.parse(f.candidate.manifestJson);
  version.version = 2;
  assert.throws(
    () => host.reader.query(reseal(version), { action: 'list' }),
    { code: 'SCHEMA' },
  );

  const unknown = JSON.parse(f.candidate.manifestJson);
  unknown.records[0].record.fresh = true;
  assert.throws(
    () => host.reader.query(reseal(unknown), { action: 'list' }),
    { code: 'SCHEMA' },
  );

  const unknownKind = JSON.parse(f.candidate.manifestJson);
  unknownKind.records[0].record.kind = 'imported-active-rule';
  assert.throws(
    () => host.reader.query(reseal(unknownKind), { action: 'list' }),
    { code: 'SCHEMA' },
  );

  for (const alternate of [
    `${f.candidate.manifestJson}\n`,
    JSON.stringify(JSON.parse(f.candidate.manifestJson), null, 2),
    f.candidate.manifestJson.replace(
      '"version":1',
      '"version":1,"version":1',
    ),
    '/synthetic/not-a-loaded-session.json',
    'synthetic://not-a-loaded-source',
  ]) {
    assert.throws(
      () => host.reader.query(alternate, { action: 'list' }),
      { code: 'SCHEMA' },
    );
  }

  assert.throws(
    () => host.reader.query(
      ' '.repeat(MAX_TRANSFER_MANIFEST_BYTES + 1),
      { action: 'list' },
    ),
    { code: 'BOUNDS' },
  );
});

test('selection and nested reference bounds reject without partial results', () => {
  const f = basic();
  assert.throws(
    () => createTransfer(
      f.view(),
      {
        tasks: [{
          taskId: f.task.id,
          recordIds: Array.from({ length: 33 }, (_, index) => `record-${index}`),
        }],
      },
      { projectId: PROJECT, observedAt: OBSERVED },
    ),
    { code: 'BOUNDS' },
  );
  assert.throws(
    () => createTransfer(
      f.view(),
      {
        tasks: [
          { taskId: f.task.id, recordIds: [f.claim.id] },
          { taskId: f.task.id, recordIds: [f.result.id] },
        ],
      },
      { projectId: PROJECT, observedAt: OBSERVED },
    ),
    { code: 'REFERENCE' },
  );

  const host = hostHarness(nativeDestination('synthetic-destination'));
  const object = JSON.parse(f.candidate.manifestJson);
  object.records.find(item => item.record.id === f.claim.id)
    .record.dependsOn = Array.from(
      { length: 33 },
      (_, index) => `synthetic-ref-${index}`,
    );
  assert.throws(
    () => host.reader.query(reseal(object), { action: 'list' }),
    { code: 'BOUNDS' },
  );
});

test('exact UTF-16 paging preserves surrogate pairs, lone surrogates, control characters and end offsets', () => {
  const text = '🐦\ud800\u0000\\\n\r\udfffEND';
  const f = fixture(text, false);
  const { host } = approvedFixture(f);
  const { combined, pages } = pageAll(
    host.reader,
    f.candidate.manifestJson,
    f.artifact.id,
    1,
  );
  assert.equal(combined, text);
  assert.equal(pages[0].text, text.slice(0, 1));
  assert.equal(pages[1].text, text.slice(1, 2));
  assert.equal(pages[0].text.length, 1);
  assert.equal(pages[1].text.length, 1);
  assert.equal(textDigest(combined), textDigest(text));

  const end = host.reader.query(f.candidate.manifestJson, {
    action: 'text',
    recordId: f.artifact.id,
    offset: text.length,
    limit: 6000,
  });
  assert.equal(end.text, '');
  assert.equal(end.nextOffset, null);
  assert.equal(end.totalChars, text.length);
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'text',
      recordId: f.artifact.id,
      offset: text.length + 1,
    }),
    { code: 'BOUNDS' },
  );
});

test('maximum text pages stay byte-bounded even when JSON must escape every code unit', () => {
  const text = '\u0000\ud800\\\n'.repeat(20_000);
  const f = fixture(text, false);
  const { host } = approvedFixture(f);
  const { combined, pages } = pageAll(
    host.reader,
    f.candidate.manifestJson,
    f.artifact.id,
    6000,
  );
  assert.equal(combined, text);
  for (const page of pages) {
    assert.ok(page.text.length <= 6000);
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 50000);
  }
});

test('enumeration uses exclusive native entry cursors and exact task/kind filters', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  const first = host.reader.query(f.candidate.manifestJson, {
    action: 'list',
    limit: 2,
  });
  const second = host.reader.query(f.candidate.manifestJson, {
    action: 'list',
    before: first.nextBefore,
    limit: 2,
  });
  const third = host.reader.query(f.candidate.manifestJson, {
    action: 'list',
    before: second.nextBefore,
    limit: 2,
  });
  const all = [...first.records, ...second.records, ...third.records];
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map(item => item.identity.entryId)).size, 6);
  assert.equal(third.nextBefore, null);

  const tasks = host.reader.query(f.candidate.manifestJson, {
    action: 'list',
    kind: 'task',
  });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.records[0].taskLabel, f.task.label);

  const snapshots = host.reader.query(f.candidate.manifestJson, {
    action: 'list',
    taskId: f.task.id,
    kind: 'snapshot',
  });
  assert.equal(snapshots.total, 2);
  assert.ok(snapshots.records.every(item => item.kind === 'snapshot'));

  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'list',
      before: 'synthetic-missing-entry',
    }),
    { code: 'NOT_FOUND' },
  );
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'list',
      taskId: 'synthetic-missing-task',
    }),
    { code: 'NOT_FOUND' },
  );
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'list',
      kind: 'task',
      before: first.records[0].identity.entryId,
    }),
    { code: 'NOT_FOUND' },
  );
});

test('invalid request bounds and malformed action arguments reject explicitly', () => {
  const f = basic();
  const { host } = approvedFixture(f);
  for (const limit of [0, -1, 21, 1.5, NaN, Infinity, undefined]) {
    assert.throws(
      () => host.reader.query(f.candidate.manifestJson, {
        action: 'list',
        limit,
      }),
      { code: 'BOUNDS' },
    );
  }
  for (const limit of [0, -1, 6001, 1.5, NaN, Infinity, undefined]) {
    assert.throws(
      () => host.reader.query(f.candidate.manifestJson, {
        action: 'text',
        recordId: f.artifact.id,
        limit,
      }),
      { code: 'BOUNDS' },
    );
  }
  for (const offset of [-1, 1.5, NaN, Infinity, undefined]) {
    assert.throws(
      () => host.reader.query(f.candidate.manifestJson, {
        action: 'text',
        recordId: f.artifact.id,
        offset,
      }),
      { code: 'BOUNDS' },
    );
  }

  for (const request of [
    { action: 'inspect' },
    { action: 'list', recordId: f.artifact.id },
    { action: 'inspect', recordId: f.artifact.id, offset: 0 },
    { action: 'import', recordId: f.artifact.id },
    { action: 'list', status: 'active' },
    { action: 'list', sourceFilename: '/synthetic/not-read' },
  ]) {
    assert.throws(
      () => host.reader.query(f.candidate.manifestJson, request),
      TransferError,
    );
  }

  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'text',
      recordId: f.claim.id,
    }),
    { code: 'SCHEMA' },
  );
  assert.throws(
    () => host.reader.query(f.candidate.manifestJson, {
      action: 'inspect',
      recordId: 'synthetic-missing-record',
    }),
    { code: 'NOT_FOUND' },
  );
});

test('oversized structured inspection errors instead of truncating valid-looking findings', () => {
  const f = basic();
  const object = JSON.parse(f.candidate.manifestJson);
  object.records.find(item => item.record.id === f.result.id)
    .record.findings = Array.from({ length: 32 }, (_, index) => ({
      code: `synthetic-finding-${index}`,
      message: 'x'.repeat(4000),
      evidenceIds: [f.evidence.id],
    }));
  const manifestJson = reseal(object);
  const candidate = {
    manifestJson,
    manifestDigest: hashManifest(manifestJson),
  };
  const host = hostHarness(nativeDestination('synthetic-destination'));
  host.approve(candidate);
  assert.equal(readList(host, candidate).total, 6);
  assert.throws(
    () => host.reader.query(manifestJson, {
      action: 'inspect',
      recordId: f.result.id,
    }),
    { code: 'BOUNDS' },
  );
});

test('unknown native memory versions remain explicit export errors rather than empty memory', () => {
  const f = basic();
  f.manager.appendCustomEntry('cuckoo.memory', {
    version: 99,
    record: {
      kind: 'task',
      id: 'synthetic-unknown-version',
      taskId: 'synthetic-unknown-version',
      label: 'Synthetic malformed history',
      userEntryId: 'synthetic-no-source',
    },
  });
  assert.throws(() => f.exportSelected([f.claim.id]));
});

function driftRecord(object, id) {
  const stored = object.records.find(item => item.record.id === id);
  assert.ok(stored);
  return stored.record;
}

function driftApproved(f, object) {
  const manifestJson = reseal(object);
  const candidate = { manifestJson, manifestDigest: hashManifest(manifestJson) };
  const { host } = approvedFixture({ ...f, candidate });
  const approval = host.port.getApproval(candidate.manifestDigest, host.destination());
  assert.equal(approval.manifestDigest, hashManifest(manifestJson));
  return { host, candidate };
}

function driftCorrectionFixture() {
  const f = basic();
  const replacement = f.save(makeSnapshot(f.view(), f.task.id, 'artifact',
    'Synthetic replacement artifact', f.artifact.source.selector, [], f.runtime));
  const correction = f.save(makeCorrection(f.view(), {
    taskId: f.task.id, targetIds: [f.artifact.id], replacementIds: [replacement.id],
    evidenceIds: [f.evidence.id], reason: 'Synthetic correction for decoder parity.',
  }, f.runtime));
  return { ...f, replacement, correction, candidate: f.exportSelected([correction.id]) };
}

// Regression-origin Blackbox-Group: exact approval must not hide invalid record structure.
test('decoder parity: approved empty snapshot with zero-length selector rejects', () => {
  const f = fixture('Synthetic nonempty source.', false);
  const object = JSON.parse(f.candidate.manifestJson);
  const artifact = driftRecord(object, f.artifact.id);
  artifact.text = '';
  artifact.source.selector.end = artifact.source.selector.start;
  artifact.digest = textDigest('');
  artifact.source.digest = artifact.digest;
  const { host, candidate } = driftApproved(f, object);
  assert.throws(() => readList(host, candidate), { code: 'BOUNDS' });
});

const driftBasicCases = [
  ['claim evidence also listed as dependency', 'REFERENCE', (f, object) => {
    driftRecord(object, f.claim.id).dependsOn.push(f.evidence.id);
  }],
  ['check artifact also listed as evidence', 'REFERENCE', (f, object) => {
    const start = driftRecord(object, f.start.id); start.evidence.push({ ...start.artifact });
  }],
  ['whitespace-only task label', 'SCHEMA', (f, object) => { driftRecord(object, f.task.id).label = ' \t\n'; }],
  ['whitespace-only snapshot label', 'SCHEMA', (f, object) => { driftRecord(object, f.artifact.id).label = ' \t\n'; }],
  ['whitespace-only claim text', 'SCHEMA', (f, object) => { driftRecord(object, f.claim.id).text = ' \t\n'; }],
  ['whitespace-only checker version', 'SCHEMA', (f, object) => { driftRecord(object, f.start.id).checker.version = ' \t\n'; }],
  ['whitespace-only checker scope', 'SCHEMA', (f, object) => { driftRecord(object, f.start.id).checker.scope = ' \t\n'; }],
  ['whitespace-only checker digest', 'SCHEMA', (f, object) => { driftRecord(object, f.start.id).checker.implementationDigest = ' \t\n'; }],
  ['whitespace-only finding code', 'SCHEMA', (f, object) => { driftRecord(object, f.result.id).findings[0].code = ' \t\n'; }],
  ['whitespace-only finding message', 'SCHEMA', (f, object) => { driftRecord(object, f.result.id).findings[0].message = ' \t\n'; }],
  ['whitespace-only error code', 'SCHEMA', (f, object) => { driftRecord(object, f.result.id).errorCode = ' \t\n'; }],
];
for (const [name, code, alter] of driftBasicCases) {
  test(`decoder parity: exact approved manifest rejects ${name}`, () => {
    const f = basic(); const object = JSON.parse(f.candidate.manifestJson);
    alter(f, object);
    const { host, candidate } = driftApproved(f, object);
    assert.throws(() => readList(host, candidate), { code });
  });
}
const driftCorrectionCases = [
  ['target also used as evidence', 'REFERENCE', (f, record) => { record.evidenceIds.push(f.artifact.id); }],
  ['replacement also used as evidence', 'REFERENCE', (f, record) => { record.evidenceIds.push(f.replacement.id); }],
  ['target also used as replacement', 'REFERENCE', (f, record) => { record.replacementIds.push(f.artifact.id); }],
  ['whitespace-only correction reason', 'SCHEMA', (_f, record) => { record.reason = ' \t\n'; }],
];
for (const [name, code, alter] of driftCorrectionCases) {
  test(`decoder parity: exact approved correction rejects ${name}`, () => {
    const f = driftCorrectionFixture(); const object = JSON.parse(f.candidate.manifestJson);
    alter(f, driftRecord(object, f.correction.id));
    const { host, candidate } = driftApproved(f, object);
    assert.throws(() => readList(host, candidate), { code });
  });
}

test('decoder parity control: checker ID remains opaque nonempty text', () => {
  const f = basic(); const object = JSON.parse(f.candidate.manifestJson);
  driftRecord(object, f.start.id).checker.id = ' \t\n';
  const { host, candidate } = driftApproved(f, object);
  const result = host.reader.query(candidate.manifestJson, { action: 'inspect', recordId: f.start.id });
  assert.equal(result.body.checker.id, ' \t\n'); assert.equal(result.metadata.current, false);
});

test('decoder parity control: nonempty whitespace snapshot text stays exact', () => {
  const f = fixture(' \t\n', false); const { host } = approvedFixture(f);
  assert.equal(pageAll(host.reader, f.candidate.manifestJson, f.artifact.id, 1).combined, ' \t\n');
});
