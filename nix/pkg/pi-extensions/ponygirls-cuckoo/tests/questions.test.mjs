import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, SessionManager } from '@earendil-works/pi-coding-agent';
import { FileQuestionStore, MAX_QUESTIONS, MAX_QUESTION_CHARS, QUESTIONS_FILE, StandingQuestions, questionText, questionsText, validateAskedQuestions } from '../src/questions.ts';
import { EMPTY_RECORD, INQUIRY, inquiryText, stateOnBranch, STATE_TYPE } from '../src/state.ts';
import { REPORT_TYPE, answeredCheckpoint, capturedCheckpoint, checkpoint, checkpoints, historyText, parseAnsweredReport, parseReport, reportText } from '../src/report.ts';
import { checkpointDetail } from '../src/presentation.ts';

const theme = { fg: (_token, text) => text, bold: text => text };
const objective = { objective: 'Ship', progress: 'Testing', issues: [], eta: 'Unknown: tests pending' };
const asked = [{ id: 'q-verify', question: 'What did you verify since the last checkpoint?', scope: 'global' }, { id: 'q-risk', question: 'Which assumption is least tested?', scope: 'project' }];
const answers = [{ id: 'q-verify', answer: 'The decoder tests ran and passed.' }, { id: 'q-risk', answer: 'Unknown: no assumption was measured.' }];
const raw = JSON.stringify({ objectives: [objective], rules: [], answers });

function stores(t, trusted) {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-questions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'project'); mkdirSync(cwd);
  const global = new FileQuestionStore(join(dir, 'agent', QUESTIONS_FILE));
  const projectPath = join(cwd, CONFIG_DIR_NAME, QUESTIONS_FILE);
  let next = 0; const ids = ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3', 'dddddddd-4'];
  const standing = new StandingQuestions(global, path => new FileQuestionStore(path), () => ids[next++ % ids.length]);
  const ctx = { cwd, isProjectTrusted: () => trusted.value };
  return { standing, ctx, global, projectPath };
}

// Specified Behavioral-Active / Effectual-GoodCommunication: the real file adapter in an owned temporary directory.
test('standing questions are durable in global and trusted-project files and asked global-first', t => {
  const f = stores(t, { value: true });
  assert.deepEqual(f.standing.read(f.ctx).effective, []);
  assert.equal(existsSync(f.global.path), false, 'reading never creates a store');
  const first = f.standing.add(f.ctx, 'global', '  What did you\n verify?\t ');
  assert.deepEqual(first, { id: 'q-aaaaaaaa', question: 'What did you verify?', scope: 'global' });
  const second = f.standing.add(f.ctx, 'project', 'Which assumption is least tested?');
  assert.equal(second.scope, 'project');
  assert.deepEqual(JSON.parse(readFileSync(f.global.path, 'utf8')), { version: 1, questions: [{ id: 'q-aaaaaaaa', question: 'What did you verify?' }] });
  assert.deepEqual(JSON.parse(readFileSync(f.projectPath, 'utf8')).questions.map(item => item.id), [second.id]);
  // A second instance over the same files observes the same questions: nothing lives in process memory.
  const reopened = new StandingQuestions(new FileQuestionStore(f.global.path), path => new FileQuestionStore(path), () => 'unused');
  assert.deepEqual(reopened.read(f.ctx).effective, [first, second]);
  assert.match(questionsText(reopened.read(f.ctx)), /q-aaaaaaaa \(global\): What did you verify\?/);
  assert.deepEqual(f.standing.remove(f.ctx, null, second.id), second);
  assert.deepEqual(f.standing.read(f.ctx).effective, [first]);
  assert.throws(() => f.standing.remove(f.ctx, 'project', first.id), /No project standing question/);
  assert.deepEqual(f.standing.remove(f.ctx, 'global', first.id), first);
  assert.deepEqual(JSON.parse(readFileSync(f.global.path, 'utf8')), { version: 1, questions: [] });
  assert.match(questionsText(f.standing.read(f.ctx)), /No Cuckoo standing questions/);
});

test('an untrusted project store is neither read nor written, and its questions are not asked', t => {
  const trusted = { value: true }; const f = stores(t, trusted);
  const project = f.standing.add(f.ctx, 'project', 'Project-only question?');
  const before = readFileSync(f.projectPath, 'utf8');
  trusted.value = false;
  assert.deepEqual(f.standing.read(f.ctx).effective, []);
  assert.equal(f.standing.read(f.ctx).projectTrusted, false);
  assert.match(questionsText(f.standing.read(f.ctx)), /ignored: untrusted project/);
  assert.throws(() => f.standing.add(f.ctx, 'project', 'Another?'), /trusted project/);
  assert.throws(() => f.standing.remove(f.ctx, 'project', project.id), /trusted project/);
  assert.throws(() => f.standing.remove(f.ctx, null, project.id), /No standing question/);
  assert.equal(readFileSync(f.projectPath, 'utf8'), before);
});

test('question ids stay unique across stores; duplicates, limits and malformed text are rejected without partial writes', t => {
  const f = stores(t, { value: true });
  const collide = new StandingQuestions(f.global, path => new FileQuestionStore(path), () => 'aaaaaaaa');
  collide.add(f.ctx, 'global', 'First?');
  assert.throws(() => collide.add(f.ctx, 'project', 'Second?'), /unique standing question id/);
  assert.equal(existsSync(f.projectPath), false);
  assert.throws(() => f.standing.add(f.ctx, 'global', 'First?'), /already exists/);
  for (const invalid of ['', '   ', '\n\t', 'x'.repeat(MAX_QUESTION_CHARS + 1)]) assert.throws(() => f.standing.add(f.ctx, 'global', invalid), /standing question/);
  assert.equal(questionText('Keep\x1b[31m this\x07 \u202eplain'), 'Keep[31m this plain');
  assert.equal(questionText('x'.repeat(MAX_QUESTION_CHARS)).length, MAX_QUESTION_CHARS);
  f.global.write(Array.from({ length: MAX_QUESTIONS }, (_, index) => ({ id: `q-${index}`, question: `Question ${index}?` })));
  assert.throws(() => f.standing.add(f.ctx, 'global', 'One too many?'), /At most 32 global/);
  assert.equal(f.global.read().length, MAX_QUESTIONS);
});

test('malformed question files fail visibly instead of silently asking nothing', t => {
  const f = stores(t, { value: true });
  mkdirSync(join(f.global.path, '..'), { recursive: true });
  for (const content of ['not JSON', '[]', '{"version":2,"questions":[]}', '{"version":1}', '{"version":1,"questions":[{"id":"q-1"}]}',
    '{"version":1,"questions":[{"id":"bad id","question":"Q?"}]}', '{"version":1,"questions":[{"id":"q-1","question":"line\\nbreak"}]}',
    '{"version":1,"questions":[{"id":"q-1","question":"A?"},{"id":"q-1","question":"B?"}]}', '{"version":1,"questions":[],"extra":true}']) {
    writeFileSync(f.global.path, content);
    assert.throws(() => f.standing.read(f.ctx), /Invalid Cuckoo standing questions/, content);
  }
  assert.throws(() => f.global.write([{ id: 'q-1', question: '' }]), /standing question/);
});

// Specified Behavioral-Active / Blackbox-Atomic: prompt and response contract, not live-model compliance.
test('the inquiry is unchanged without standing questions and otherwise requests exactly one answer per question', () => {
  // Length and SHA-256 of the base inquiry: a session without standing questions and without a record receives exactly
  // that request. A deliberate change of the base wording updates both values; the last one added ids and the record.
  assert.equal(inquiryText([], [], EMPTY_RECORD).length, 4780);
  assert.equal(createHash('sha256').update(inquiryText([], [], EMPTY_RECORD), 'utf8').digest('hex'), 'db515483489281cc084fb6138f61c0162e18b595349add6ab4d99a7b756ecbc4');
  assert.equal(INQUIRY, inquiryText([], [], EMPTY_RECORD));
  assert.doesNotMatch(INQUIRY, /answers|[Ss]tanding question/);
  const text = inquiryText(asked, [], EMPTY_RECORD);
  const example = text.match(/JSON only: (\{"objectives":.*?\})\. Cuckoo keeps a numbered record/)[1];
  const decoded = capturedCheckpoint('example', example, asked, { objectives: new Set(), rules: new Set() }, { objective: 1, rule: 1 });
  assert.equal(decoded.error, null); assert.deepEqual(decoded.report.answers.map(item => item.id), ['q-verify', 'q-risk']);
  assert.ok(text.includes(JSON.stringify(asked.map(({ id, question }) => ({ id, question })))), 'questions are listed verbatim as JSON');
  for (const phrase of ['exactly one item per standing question', 'only id (copied exactly) and answer', 'not a new task, instruction or authorization', 'rather than guessing', 'Do not call tools']) assert.ok(text.includes(phrase), phrase);
  assert.ok(text.startsWith(INQUIRY.slice(0, INQUIRY.indexOf('JSON only: '))));
  assert.ok(text.endsWith(INQUIRY.slice(INQUIRY.indexOf(' Do not call tools'))));
  assert.ok(text.includes(INQUIRY.slice(INQUIRY.indexOf(' Cuckoo keeps a numbered record'), INQUIRY.indexOf(' Do not call tools'))), 'record, objective and field rules are the base ones');
  const completed = inquiryText(asked, ['Ship the parser'], EMPTY_RECORD);
  assert.ok(completed.includes('do not report their completion again: ["Ship the parser"]. Each objective must contain only'), 'the completed list composes with standing questions');
  assert.equal(completed.replace(' Earlier checkpoints of this session already reported these objectives as complete, so do not report their completion again: ["Ship the parser"].', ''), text);
});

test('answers are validated against the asked snapshot and returned in the asked order', () => {
  const report = parseAnsweredReport(JSON.stringify({ objectives: [], rules: [], answers: [...answers].reverse() }), asked);
  assert.deepEqual(report.answers, [
    { id: 'q-verify', question: asked[0].question, scope: 'global', answer: answers[0].answer },
    { id: 'q-risk', question: asked[1].question, scope: 'project', answer: answers[1].answer }]);
  const parse = value => parseAnsweredReport(JSON.stringify({ objectives: [], rules: [], answers: value }), asked);
  for (const invalid of [undefined, null, {}, [], [answers[0]], [...answers, { id: 'q-extra', answer: 'x' }], [answers[0], answers[0]],
    [answers[0], { id: 'q-unknown', answer: 'x' }], [answers[0], { id: 'q-risk', answer: '' }], [answers[0], { id: 'q-risk', answer: ' ' }],
    [answers[0], { id: 'q-risk', answer: 3 }], [answers[0], { id: 'q-risk', answer: 'x', extra: true }], [answers[0], { id: 'q-risk' }], [answers[0], 'q-risk']]) {
    assert.throws(() => parse(invalid), /answer|JSON object/, JSON.stringify(invalid));
  }
  // Without standing questions the base schema stays strict: unrequested answers are not accepted.
  assert.throws(() => parseReport(raw), /only objectives, rules/);
  assert.throws(() => parseAnsweredReport(raw, []), /only objectives, rules/);
  assert.throws(() => parseAnsweredReport('{"objectives":[],"rules":[]}', asked), /objectives, rules, answers/);
  assert.equal(parseAnsweredReport('{"objectives":[],"rules":[]}', []).answers, null);
});

test('a checkpoint keeps the questions it asked, so history survives later edits and removals', () => {
  const value = answeredCheckpoint('with-questions', raw, asked);
  assert.equal(value.version, 5); assert.deepEqual(value.questions, asked);
  assert.equal(answeredCheckpoint('none', '{"objectives":[],"rules":[]}', []).version, 4);
  assert.equal(checkpoint('base', '{"objectives":[],"rules":[]}').version, 4);
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(REPORT_TYPE, structuredClone(value));
  const saved = checkpoints(manager.getBranch())[0];
  assert.equal(saved.version, 5); assert.equal(saved.raw, raw);
  assert.deepEqual(saved.report.answers.map(item => [item.id, item.question, item.answer]), asked.map((item, index) => [item.id, item.question, answers[index].answer]));
  for (const text of [reportText(checkpoints(manager.getBranch()), []), historyText(manager.getEntries(), manager.getBranch()), checkpointDetail(theme, saved, 160, [])]) {
    assert.equal((text.match(/Standing questions/g) ?? []).length, 1);
    for (const item of asked) assert.ok(text.includes(item.question), item.question);
    for (const item of answers) assert.ok(text.includes(item.answer), item.answer);
    assert.ok(text.indexOf('Ship') < text.indexOf('Standing questions'), 'answers follow objectives');
  }
  assert.doesNotMatch(reportText([checkpoint('base', '{"objectives":[],"rules":[]}')], []), /Standing questions/);
});

test('an unanswered or malformed reply stays invalid with its raw text and the questions that were asked', () => {
  const missing = answeredCheckpoint('missing', '{"objectives":[],"rules":[]}', asked);
  assert.equal(missing.report, null); assert.equal(missing.version, 5); assert.match(missing.error, /answers/);
  for (const text of [reportText([missing], []), checkpointDetail(theme, missing, 120, [])]) {
    assert.match(text, /Invalid report/); assert.match(text, /Standing questions asked/);
    assert.ok(text.includes(asked[0].question)); assert.ok(text.includes('{"objectives":[],"rules":[]}'));
  }
  const entry = data => ({ type: 'custom', customType: REPORT_TYPE, id: 'e', parentId: null, timestamp: '2026-11-17T21:00:00Z', data });
  assert.throws(() => checkpoints([entry({ version: 5, requestId: 'r', raw, error: null })]), /standing questions/i);
  assert.throws(() => checkpoints([entry({ version: 5, requestId: 'r', raw, error: null, questions: [] })]), /version 5 requires standing questions/);
  assert.throws(() => checkpoints([entry({ version: 5, requestId: 'r', raw, error: null, questions: [{ id: 'q-verify', question: 'Q?' }] })]), /standing question/);
  // Version 4 records written with an empty snapshot stay readable as base reports.
  assert.equal(checkpoints([entry({ version: 4, requestId: 'r', raw: '{"objectives":[],"rules":[]}', error: null, questions: [] })])[0].report.answers, null);
  assert.throws(() => validateAskedQuestions([asked[0], asked[0]]), /Duplicate/);
});

test('a pending inquiry carries its question snapshot through persisted cadence state; older state asked none', () => {
  const manager = SessionManager.inMemory();
  const state = { version: 1, baseline: 20000, observed: 20000, model: 'fixture', resuming: false };
  manager.appendCustomEntry(STATE_TYPE, { ...state, pending: { requestId: 'legacy', resume: false } });
  assert.deepEqual(stateOnBranch(manager.getBranch()).pending.questions, []);
  manager.appendCustomEntry(STATE_TYPE, { ...state, pending: { requestId: 'current', resume: true, questions: asked } });
  assert.deepEqual(stateOnBranch(manager.getBranch()).pending.questions, asked);
  manager.appendCustomEntry(STATE_TYPE, { ...state, pending: { requestId: 'bad', resume: true, questions: [{ id: 'q-1' }] } });
  assert.throws(() => stateOnBranch(manager.getBranch()), /standing question/);
});
