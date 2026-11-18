import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { COMMENT_TYPE, COMMENTS_TYPE, MAX_COMMENT_CHARS, commentDelivery, commentNodes, commentRecord, commentText, savedComments, undeliveredComments } from '../src/comments.ts';
import { REPORT_TYPE, answeredCheckpoint, checkpoint, checkpoints, historyText, reportText } from '../src/report.ts';
import { checkpointBlocks, checkpointDetail, historyContent, reportContent } from '../src/presentation.ts';
import { recallRounds } from '../src/recall.ts';

const theme = { fg: (_token, text) => text, bold: text => text, bg: (_token, text) => text };
const asked = [{ id: 'q-verify', question: 'What did you verify?', scope: 'global' }];
const raw = JSON.stringify({
  objectives: [{ objective: 'Ship the panel', progress: 'Selection works', issues: ['Editor untested'], eta: 'Unknown: tests pending' }, { objective: 'Write docs', progress: 'Not started', issues: [], eta: 'Unknown' }],
  rules: [{ rule: 'Show mockups first', source: 'user', scope: 'This UI change' }, { rule: 'Keep cadence', source: 'assistant', scope: 'This change' }],
  answers: [{ id: 'q-verify', answer: 'Only the decoder tests.' }],
});
const value = answeredCheckpoint('req-1', raw, asked);
const draft = (target, text) => ({ requestId: 'req-1', target, subject: commentNodes(value).find(node => node.ref.kind === target.kind && node.ref.index === target.index).subject, text });
const save = (manager, id, target, text, at) => manager.appendCustomEntry(COMMENT_TYPE, commentRecord(draft(target, text), id, at));
const deliver = (manager, comments) => { const message = commentDelivery(comments, new Set(['req-1'])); return manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details); };

// Specified Behavioral-Active / Blackbox-Atomic and Blackbox-Group over the real in-memory session tree.
test('every rule, objective and standing-question answer is a commentable node with a self-contained subject', () => {
  const nodes = commentNodes(value);
  assert.deepEqual(nodes.map(node => node.ref), [{ kind: 'rule', index: 0 }, { kind: 'rule', index: 1 }, { kind: 'objective', index: 0 }, { kind: 'objective', index: 1 }, { kind: 'answer', index: 0 }]);
  assert.equal(nodes[0].subject, 'Rule (user): Show mockups first (scope: This UI change)');
  assert.equal(nodes[2].subject, 'Objective 1: Ship the panel');
  assert.equal(nodes[4].subject, 'Standing question q-verify: What did you verify? Answer: Only the decoder tests.');
  assert.deepEqual(commentNodes(checkpoint('invalid', 'not JSON')), []);
  assert.deepEqual(commentNodes(checkpoint('empty', '{"objectives":[],"rules":[]}')), []);
  const legacy = checkpoints([{ type: 'custom', customType: REPORT_TYPE, id: 'v1', parentId: null, timestamp: 't', data: { version: 1, requestId: 'v1', raw: '{"objectives":[{"objective":"Old","progress":"Seen"}]}', error: null } }])[0];
  assert.deepEqual(commentNodes(legacy).map(node => node.ref), [{ kind: 'objective', index: 0 }]);
  const long = checkpoint('long', JSON.stringify({ objectives: [{ objective: `Long\n${'x'.repeat(2000)}`, progress: 'p', issues: [], eta: 'e' }], rules: [] }));
  assert.ok(commentNodes(long)[0].subject.length < 500); assert.doesNotMatch(commentNodes(long)[0].subject, /\n/);
  // The block projection and the node list agree, so a panel cursor index names the same node in both.
  assert.deepEqual(checkpointBlocks(theme, value, 100, []).flatMap(block => block.node === null ? [] : [block.node]), nodes.map(node => node.ref));
});

test('comment text is plain multi-line text within a bound; empty and oversized comments are rejected', () => {
  assert.equal(commentText('  First line\r\nsecond\tline\x1b[31m\x07\u202e  '), 'First line\nsecond    line[31m');
  assert.equal(commentText('x'.repeat(MAX_COMMENT_CHARS)).length, MAX_COMMENT_CHARS);
  for (const invalid of ['', '  \n\t ', '\x1b\x07', 'x'.repeat(MAX_COMMENT_CHARS + 1)]) assert.throws(() => commentText(invalid), /comment/);
  for (const target of [{ kind: 'issue', index: 0 }, { kind: 'rule', index: -1 }, { kind: 'rule', index: 1.5 }, { kind: 'rule' }, { kind: 'rule', index: 0, extra: true }]) {
    assert.throws(() => commentRecord({ requestId: 'r', target, subject: 's', text: 't' }, 'id', 'now'), /comment/);
  }
});

test('comments persist as their own history entries and survive a session reopen from the same entries', () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(REPORT_TYPE, structuredClone(value));
  save(manager, 'c-1', { kind: 'objective', index: 0 }, 'Test the editor first.\nThen the mouse.', '2026-11-17T21:00:00.000Z');
  save(manager, 'c-2', { kind: 'rule', index: 1 }, 'I did not ask for this.', '2026-11-17T21:00:00.000Z');
  save(manager, 'c-3', { kind: 'answer', index: 0 }, 'Verify the renderer too.', '2026-11-17T21:01:00.000Z');
  const saved = savedComments(manager.getEntries());
  assert.deepEqual(saved.map(item => [item.commentId, item.target.kind, item.target.index]), [['c-1', 'objective', 0], ['c-2', 'rule', 1], ['c-3', 'answer', 0]]);
  assert.equal(saved[0].subject, 'Objective 1: Ship the panel'); assert.equal(saved[0].text, 'Test the editor first.\nThen the mouse.');
  assert.deepEqual(savedComments(structuredClone(manager.getEntries())), saved);
  for (const text of [reportText(checkpoints(manager.getBranch()), saved), historyText(manager.getEntries(), manager.getBranch()),
    reportContent(checkpoints(manager.getBranch()), '', saved).plain, historyContent(manager.getEntries(), manager.getBranch()).plain,
    checkpointDetail(theme, value, 120, saved), historyContent(manager.getEntries(), manager.getBranch()).render(theme, 120)]) {
    assert.match(text, /Comment:?\s*[([]2026-11-17T21:00:00\.000Z[)\]]:? Test the editor first\./);
    assert.ok(text.includes('Then the mouse.')); assert.ok(text.includes('I did not ask for this.')); assert.ok(text.includes('Verify the renderer too.'));
    assert.ok(text.indexOf('Ship the panel') < text.indexOf('Test the editor first.'), 'comment follows its objective');
    assert.ok(text.indexOf('Test the editor first.') < text.indexOf('Write docs'), 'comment precedes the next objective');
    assert.ok(text.indexOf('Keep cadence') < text.indexOf('I did not ask for this.'));
    assert.ok(text.indexOf('Only the decoder tests.') < text.indexOf('Verify the renderer too.'));
  }
  assert.doesNotMatch(reportText(checkpoints(manager.getBranch()), []), /Comment/);
  manager.appendCustomEntry(COMMENT_TYPE, { version: 1, commentId: 'bad', requestId: 'req-1', target: { kind: 'rule', index: 0 }, subject: 's', text: '', createdAt: 'now' });
  assert.throws(() => savedComments(manager.getEntries()), /Invalid saved Cuckoo comment/);
});

test('delivery is derived from the branch: undelivered until a delivery message on that branch lists the comment', () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendCustomEntry(REPORT_TYPE, structuredClone(value));
  assert.deepEqual(undeliveredComments(manager.getBranch()), []);
  save(manager, 'c-1', { kind: 'objective', index: 0 }, 'First', 't1');
  save(manager, 'c-2', { kind: 'rule', index: 0 }, 'Second', 't1');
  assert.deepEqual(undeliveredComments(manager.getBranch()).map(item => item.commentId), ['c-1', 'c-2']);
  deliver(manager, undeliveredComments(manager.getBranch()).slice(0, 1));
  assert.deepEqual(undeliveredComments(manager.getBranch()).map(item => item.commentId), ['c-2']);
  save(manager, 'c-3', { kind: 'answer', index: 0 }, 'Third', 't2');
  const beforeDelivery = manager.getLeafId();
  deliver(manager, undeliveredComments(manager.getBranch()));
  assert.deepEqual(undeliveredComments(manager.getBranch()), []);
  // A branch that does not contain the delivery message has not told its model yet.
  manager.branch(beforeDelivery);
  assert.deepEqual(undeliveredComments(manager.getBranch()).map(item => item.commentId), ['c-2', 'c-3']);
  // A branch without the comment entries has nothing to deliver, though the session still records them.
  manager.branch(root);
  assert.deepEqual(undeliveredComments(manager.getBranch()), []);
  assert.equal(savedComments(manager.getEntries()).length, 3);
  manager.appendCustomMessageEntry(COMMENTS_TYPE, 'malformed', true, { version: 1 });
  assert.throws(() => undeliveredComments(manager.getBranch()), /comment/i);
});

test('the delivery message quotes each commented item, groups by checkpoint and is not phrased as an inquiry', () => {
  const manager = SessionManager.inMemory();
  save(manager, 'c-1', { kind: 'objective', index: 0 }, 'Test the editor first.\nThen the mouse.', 't');
  save(manager, 'c-2', { kind: 'rule', index: 1 }, 'I did not ask for this.', 't');
  manager.appendCustomEntry(COMMENT_TYPE, commentRecord({ requestId: 'req-2', target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Other', text: 'Different checkpoint.' }, 'c-3', 't'));
  const message = commentDelivery(savedComments(manager.getEntries()), new Set(['req-1', 'req-2']));
  assert.equal(message.customType, COMMENTS_TYPE); assert.equal(message.display, true);
  assert.deepEqual(message.details, { version: 1, commentIds: ['c-1', 'c-2', 'c-3'] });
  assert.match(message.content, /Checkpoint req-1\n1\. On Objective 1: Ship the panel\n   User comment: Test the editor first\.\n   Then the mouse\.\n2\. On Rule \(assistant\): Keep cadence \(scope: This change\)\n   User comment: I did not ask for this\./);
  assert.match(message.content, /Checkpoint req-2\n1\. On Objective 1: Other\n   User comment: Different checkpoint\./);
  assert.match(message.content, /user feedback/); assert.match(message.content, /not a Cuckoo inquiry/);
  assert.doesNotMatch(message.content, /JSON only|Restate me your objectives/);
  assert.throws(() => commentDelivery([], new Set()), /1 to 1000/);
});

test('recall returns the comments attached to a round within the requested scope', () => {
  const manager = SessionManager.inMemory();
  const round = manager.appendCustomEntry(REPORT_TYPE, structuredClone(value));
  const base = manager.getLeafId();
  save(manager, 'c-1', { kind: 'objective', index: 0 }, 'On the current branch', 't1');
  const read = scope => JSON.parse(recallRounds(manager.getEntries(), manager.getBranch(), { action: 'read', scope, entryId: round, offset: 0, limit: 8000 }).text);
  const list = scope => recallRounds(manager.getEntries(), manager.getBranch(), { action: 'list', scope, before: undefined, limit: 10 }).rounds[0];
  assert.deepEqual(read('branch').comments, [{ target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Ship the panel', text: 'On the current branch', createdAt: 't1' }]);
  assert.deepEqual(read('branch').questions, asked);
  assert.equal(read('branch').report.answers[0].answer, 'Only the decoder tests.');
  assert.equal(list('branch').commentCount, 1); assert.equal(list('branch').answerCount, 1);
  manager.branch(base);
  save(manager, 'c-2', { kind: 'rule', index: 0 }, 'On another branch', 't2');
  assert.deepEqual(read('branch').comments.map(item => item.text), ['On another branch']);
  assert.deepEqual(read('session').comments.map(item => item.text), ['On the current branch', 'On another branch']);
  assert.equal(list('session').commentCount, 2);
  const plain = recallRounds([{ type: 'custom', customType: REPORT_TYPE, id: 'p', parentId: null, timestamp: 't', data: checkpoint('plain', '{"objectives":[],"rules":[]}') }], [], { action: 'list', scope: 'session', before: undefined, limit: 10 }).rounds[0];
  assert.equal(plain.answerCount, null); assert.equal(plain.commentCount, 0);
});

test('quoted report text carries no terminal controls into the comment subject, the saved record or the delivery message', () => {
  const hostile = checkpoint('hostile', JSON.stringify({ objectives: [{ objective: 'Goal\u001b]52;c;eA==\u0007 \u202eevil', progress: 'p', issues: [], eta: 'e' }], rules: [{ rule: 'Rule\u009b31m', source: 'user', scope: 'Scope\u0000\r' }] }));
  const nodes = commentNodes(hostile);
  for (const node of nodes) assert.doesNotMatch(node.subject, /[\u0000-\u001f\u007f-\u009f\u202e]/, JSON.stringify(node.subject));
  assert.equal(nodes[1].subject, 'Objective 1: Goal]52;c;eA== evil');
  const record = commentRecord({ requestId: 'hostile', target: nodes[1].ref, subject: 'Stored\u001b[2J subject', text: 'Fine' }, 'c-1', 'now');
  assert.equal(record.subject, 'Stored[2J subject', 'the persisted form is sanitized even if a caller passes raw text');
  assert.doesNotMatch(commentDelivery([record], new Set(['hostile'])).content, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
});

test('a comment on a checkpoint that is not on the current branch is labelled as such for the model', () => {
  const manager = SessionManager.inMemory();
  save(manager, 'c-1', { kind: 'objective', index: 0 }, 'About this branch', 't');
  manager.appendCustomEntry(COMMENT_TYPE, commentRecord({ requestId: 'req-elsewhere', target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Other', text: 'About another branch' }, 'c-2', 't'));
  const message = commentDelivery(savedComments(manager.getEntries()), new Set(['req-1']));
  assert.match(message.content, /Checkpoint req-1\n1\. On Objective 1: Ship the panel/);
  assert.match(message.content, /Checkpoint req-elsewhere \(saved on another branch of this session; cuckoo_recall reads it only with scope "session"\)\n1\. On Objective 1: Other/);
  assert.doesNotMatch(message.content, /your Cuckoo checkpoint/);
});
