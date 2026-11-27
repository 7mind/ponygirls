import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINT_SCENARIO, RECORD, RECORD_SCENARIOS, TOOL_SCENARIOS } from './scenarios.mjs';
import { OBJECTIVE_IDS, RULE_IDS, gradeCheckpoint, gradeRecord, gradeTools } from './grade.mjs';
import { bySubject } from './results.mjs';

// Scripted cases for every category the pilot reports, undesired ones included, under both codings.
const objective = (id, title, eta = 'Unknown') => ({ id, objective: title, progress: 'p', issues: [], eta });
const rule = (id, text) => ({ id, rule: text, source: 'user', scope: 'This session' });
const { completedObjective, cancelledObjective, revokedRule } = CHECKPOINT_SCENARIO;
/** The reply an attentive subject gives at the first checkpoint; `change` edits it. */
function firstReply(change = reply => reply) {
  const objectives = RECORD.objectives.flatMap((item, index) => index === cancelledObjective ? [] : [objective(OBJECTIVE_IDS[index], item.title, index === completedObjective ? 'Complete' : 'Unknown')]);
  const rules = RECORD.rules.flatMap((item, index) => index === revokedRule ? [] : [rule(RULE_IDS[index], item.text)]);
  return change({ objectives: [...objectives, objective(null, 'Add a dark-mode toggle to the settings page')], rules });
}
const session = (...replies) => ({ rounds: replies.map(reply => typeof reply === 'string' ? { raw: '', error: reply, assigned: null } :
  { raw: JSON.stringify(reply), error: null, assigned: { objectives: reply.objectives.filter(item => item.id === null).map((_, index) => `AO${9 + index}`), rules: reply.rules.filter(item => item.id === null).map((_, index) => `AR${26 + index}`) } }) });
const both = (result, check) => { for (const coding of ['v1', 'v2']) check(gradeCheckpoint(result, coding), coding); };
const without = (items, id) => items.filter(item => item.id !== id);

test('the desired first reply: every ID right, the completion stated once, cancelled and lifted entries left out', () => {
  both(session(firstReply()), ([round]) => {
    assert.equal(round.right, 31); // 6 persisting objectives, the completed one, 24 rules
    assert.deepEqual([round.wrong, round.restatedAsNew, round.unclear, round.dropped, round.revived, round.inventedRules], [[], [], [], [], [], []]);
    assert.deepEqual([round.completed, round.cancelled, round.liftedRule, round.newObjective], ['Complete', 'left out', 'left out', 'null']);
  });
});

test('undesired replies are named: a swapped ID, a restatement as new, a dropped entry, a revived one, an unfinished completion', () => {
  const swapped = firstReply(reply => { [reply.objectives[0].objective, reply.objectives[1].objective] = [reply.objectives[1].objective, reply.objectives[0].objective]; return reply; });
  both(session(swapped), ([round]) => { assert.equal(round.wrong.length, 2); assert.match(round.wrong[0], /^AO1 given to the subject of AO2/); assert.equal(round.right, 29); });
  const asNew = firstReply(reply => { reply.objectives[1].id = null; reply.rules[2].id = null; return reply; });
  both(session(asNew), ([round]) => { assert.deepEqual(round.restatedAsNew.map(text => text.split(':')[0]), ['AO2', 'AR3']); assert.deepEqual(round.dropped, ['AO2', 'AR3']); });
  const dropped = firstReply(reply => ({ objectives: without(reply.objectives, 'AO6'), rules: without(reply.rules, 'AR3') }));
  both(session(dropped), ([round]) => { assert.deepEqual(round.dropped, ['AO6', 'AR3']); assert.equal(round.right, 29); });
  const revived = firstReply(reply => { reply.objectives.push(objective('AO5', 'Build a Windows installer')); return reply; });
  both(session(revived), ([round]) => { assert.equal(round.cancelled, 'revived'); assert.deepEqual(round.revived, ['AO5']); });
  const unfinished = firstReply(reply => { reply.objectives.find(item => item.id === 'AO3').eta = 'Complete by Friday'; return reply; });
  both(session(unfinished), ([round]) => assert.equal(round.completed, 'listed as unfinished'));
  const silent = firstReply(reply => ({ ...reply, objectives: without(reply.objectives, 'AO3') }));
  both(session(silent), ([round]) => assert.equal(round.completed, 'left out'));
  const forgotten = firstReply(reply => ({ ...reply, objectives: reply.objectives.filter(item => item.id !== null) }));
  both(session(forgotten), ([round]) => assert.equal(round.newObjective, 'missing'));
  const unrecognised = firstReply(reply => { reply.objectives[0].objective = 'Something else entirely'; reply.objectives.push(objective(null, 'A second thing nobody asked for')); return reply; });
  both(session(unrecognised), ([round]) => assert.deepEqual(round.unclear, ['AO1, subject not recognised: Something else entirely', 'null: A second thing nobody asked for']));
});

test('the lifted rule: the codings differ on a rule kept with the opposite meaning and on its replacement', () => {
  const old = firstReply(reply => { reply.rules.push(rule('AR7', 'Ask before running the linter, because it rewrites files.')); return reply; });
  both(session(old), ([round]) => { assert.equal(round.liftedRule, 'kept, old meaning'); assert.deepEqual(round.revived, ['AR7']); });
  const changed = firstReply(reply => { reply.rules.push(rule('AR7', 'Run the linter without asking; it only reports now.')); return reply; });
  assert.equal(gradeCheckpoint(session(changed), 'v2')[0].liftedRule, 'kept under its id, new meaning'); assert.deepEqual(gradeCheckpoint(session(changed), 'v2')[0].revived, []);
  assert.equal(gradeCheckpoint(session(changed), 'v1')[0].liftedRule, 'kept, old meaning'); assert.deepEqual(gradeCheckpoint(session(changed), 'v1')[0].revived, ['AR7']);
  const replaced = firstReply(reply => { reply.rules.push(rule(null, 'The linter may run without asking.')); return reply; });
  assert.equal(gradeCheckpoint(session(replaced), 'v2')[0].liftedRule, 'replaced by a new rule'); assert.deepEqual(gradeCheckpoint(session(replaced), 'v2')[0].restatedAsNew, []);
  assert.deepEqual(gradeCheckpoint(session(replaced), 'v1')[0].restatedAsNew.map(text => text.split(':')[0]), ['AR7']);
  const invented = firstReply(reply => { reply.rules.push(rule(null, 'Do not ship anything on Fridays.')); return reply; });
  both(session(invented), ([round]) => assert.deepEqual(round.inventedRules, ['Do not ship anything on Fridays.']));
});

test('the second reply: IDs given at the first checkpoint are right only for the text they were given to', () => {
  const first = firstReply(reply => { reply.rules.push(rule(null, 'The linter may run without asking.')); return reply; });
  const second = change => change({ objectives: [...without(without(first.objectives, 'AO3'), null), objective('AO9', 'Add a dark-mode toggle to the settings page')], rules: [...without(first.rules, null), rule('AR26', 'The linter may run without asking.')] });
  const good = session(first, second(reply => reply));
  assert.deepEqual([gradeCheckpoint(good, 'v2')[1].newObjective, gradeCheckpoint(good, 'v2')[1].wrong, gradeCheckpoint(good, 'v2')[1].completed], ['AO9', [], 'left out']);
  assert.equal(gradeCheckpoint(good, 'v2')[1].right, 32); // 6 objectives, the new one, 24 rules, the new rule
  assert.deepEqual(gradeCheckpoint(good, 'v1')[1].wrong, ['AR26: The linter may run without asking.'], 'v1 knew only new objectives');
  const again = session(first, second(reply => { reply.objectives.at(-1).id = null; return reply; }));
  both(again, rounds => assert.equal(rounds[1].newObjective, 'null again'));
  const stolen = session(first, second(reply => { reply.objectives.at(-1).objective = 'Reduce the cold-start time of the CLI, again'; return reply; }));
  both(stolen, rounds => assert.equal(rounds[1].wrong[0], 'AO9: Reduce the cold-start time of the CLI, again'));
  assert.equal(gradeCheckpoint(stolen, 'v2')[1].wrong.length, 1); assert.equal(gradeCheckpoint(stolen, 'v2')[1].newObjective, 'missing');
  const repeated = session(first, second(reply => { reply.objectives.push(objective('AO3', 'Fuzz the config parser and fix what it finds', 'Complete')); return reply; }));
  both(repeated, rounds => assert.equal(rounds[1].completed, 'Complete'));
  both(session('Error: Unknown objective id AO9'), ([round]) => assert.deepEqual(round, { invalid: 'Error: Unknown objective id AO9' }));
});

const [build] = TOOL_SCENARIOS;
const entry = (id, title, status = 'active') => ({ id, status, objective: title, progress: null, issues: null, eta: null, reason: null });
const sessionRule = (id, text, source = 'user') => ({ id, status: 'active', rule: text, source, scope: 'This session', reason: null });
const call = (args, error = null) => ({ id: 'c', name: 'cuckoo_update', arguments: args, result: error === null ? { isError: false, text: '{}' } : { isError: true, text: error } });
function toolSession(turns, final, extra = {}) {
  return { requests: turns.length + 1 + turns.reduce((sum, turn) => sum + (turn.calls.length > 0 ? 1 : 0), 0), blockedCalls: [], ...extra,
    turns: turns.map(turn => ({ user: 'u', answer: 'a', stopReason: 'stop', edits: turn.calls.length, ...turn })),
    rounds: [typeof final === 'string' ? { raw: '', error: final, assigned: null } : { raw: JSON.stringify(final), error: null, assigned: { objectives: [], rules: [] } }] };
}
const a = entry('AO1', 'Outline for migrating the build to Bazel'), b = entry('AO2', 'Onboarding note for new contributors'), c = entry('AO3', 'CI checklist');
const r1 = sessionRule('AR1', 'Keep every answer under 120 words'), r2 = sessionRule('AR2', 'Never use tables');

test('a tool session that records everything in its turn, and a final checkpoint consistent with it', () => {
  const done = status => item => ({ ...item, status });
  const graded = gradeTools(toolSession([
    { calls: [call({ action: 'add_objective' }), call({ action: 'add_objective' }), call({ action: 'add_objective' })], after: { objectives: [a, b, c], rules: [] } },
    { calls: [call({ action: 'add_rule' }), call({ action: 'add_rule' })], after: { objectives: [a, b, c], rules: [r1, r2] } },
    { calls: [call({ action: 'complete', id: 'AO1' })], after: { objectives: [done('complete')(a), b, c], rules: [r1, r2] } },
    { calls: [call({ action: 'complete', id: 'AO2' }), call({ action: 'retire', id: 'AO3' })], after: { objectives: [done('complete')(a), done('complete')(b), done('retired')(c)], rules: [r1, r2] } },
  ], { objectives: [], rules: [{ id: 'AR1', rule: r1.rule, source: 'user', scope: 's' }, { id: 'AR2', rule: r2.rule, source: 'user', scope: 's' }] }), build);
  assert.deepEqual(graded.objectives, { a: 'by its turn', b: 'by its turn', c: 'by its turn' }); assert.equal(graded.allObjectivesByTurn, true);
  assert.deepEqual(graded.rules, { length: 'by its turn, source user', tables: 'by its turn, source user' }); assert.equal(graded.allRulesByTurn, true);
  assert.deepEqual(graded.completions, { a: 'complete by its turn, complete at the end', b: 'complete by its turn, complete at the end' });
  assert.deepEqual(graded.retirements, { c: 'retired by its turn, retired at the end' });
  assert.deepEqual([graded.updateCalls, graded.extraRequests, graded.refused, graded.blockedCalls, graded.overRecorded, graded.oneTurnRecorded, graded.duplicates, graded.merged], [8, 4, [], [], [], [], [], []]);
  assert.deepEqual(graded.final, { completedRepeated: [], retiredRevived: [], activeDropped: [], newAtCheckpoint: [] });
});

test('undesired tool sessions are named: nothing recorded, late and duplicate entries, a recorded question, refused and blocked calls, a checkpoint that undoes edits', () => {
  const silent = gradeTools(toolSession([{ calls: [], after: { objectives: [], rules: [] } }, { calls: [], after: { objectives: [], rules: [] } }, { calls: [], after: { objectives: [], rules: [] } }, { calls: [], after: { objectives: [], rules: [] } }],
    { objectives: [{ id: null, objective: 'CI checklist', progress: 'p', issues: [], eta: 'Unknown' }], rules: [] }), build);
  assert.deepEqual(silent.objectives, { a: 'never', b: 'never', c: 'never' }); assert.equal(silent.allObjectivesByTurn, false); assert.equal(silent.allRulesByTurn, false);
  assert.deepEqual(silent.completions, { a: 'no entry by its turn, no entry at the end', b: 'no entry by its turn, no entry at the end' });
  assert.deepEqual(silent.final.newAtCheckpoint, ['objective: CI checklist']); assert.equal(silent.extraRequests, 0);
  const question = entry('AO4', 'Compute 17 times 23'), twin = entry('AO5', 'Bazel migration outline, second entry');
  const messy = gradeTools(toolSession([
    { calls: [call({ action: 'add_objective' })], after: { objectives: [a], rules: [] } },
    { calls: [call({ action: 'add_rule' })], after: { objectives: [a], rules: [{ ...r1, source: 'assistant' }] } },
    { calls: [call({ action: 'add_objective' }), call({ action: 'retire', id: 'AO9' }, 'AO9 is not in the record of this branch')], after: { objectives: [a, b], rules: [{ ...r1, source: 'assistant' }] } },
    { calls: [call({ action: 'add_objective' }), call({ action: 'add_objective' }), { id: 'x', name: 'cuckoo_recall', arguments: { action: 'current' }, result: { isError: false, text: '{}' } }], after: { objectives: [{ ...a, status: 'complete' }, b, question, twin], rules: [{ ...r1, source: 'assistant' }] } },
  ], { objectives: [{ id: 'AO1', objective: a.objective, progress: 'p', issues: [], eta: 'Complete' }], rules: [] }, { blockedCalls: [{ name: 'bash', input: {} }] }), build);
  assert.deepEqual(messy.objectives, { a: 'by its turn', b: 'late (turn 3)', c: 'never' });
  assert.deepEqual(messy.rules, { length: 'by its turn, source assistant', tables: 'never' });
  assert.deepEqual(messy.overRecorded, ['AO4 active: Compute 17 times 23']); assert.deepEqual(messy.duplicates, ['a: AO1,AO5']);
  assert.deepEqual([messy.refused.length, messy.recallCalls, messy.blockedCalls], [1, 1, ['bash']]);
  assert.deepEqual(messy.callsPerTurn[2], ['add_objective', 'retire AO9 (REFUSED)']);
  assert.deepEqual(messy.final, { completedRepeated: ['AO1'], retiredRevived: [], activeDropped: ['AO2', 'AO4', 'AO5', 'AR1'], newAtCheckpoint: [] });
  assert.deepEqual(gradeTools(toolSession([{ calls: [], after: { objectives: [], rules: [] } }], 'Error: Expected rules'), build).final, { invalid: 'Error: Expected rules' });
  // Amendment 2: three requested items kept as one entry, and two rules as one.
  const whole = entry('AO1', 'Deliver three items: (a) a Bazel migration outline, (b) an onboarding note, (c) a CI checklist');
  const bothRules = sessionRule('AR1', 'Answers under 120 words and no tables');
  const merged = gradeTools(toolSession([{ calls: [call({ action: 'add_objective' })], after: { objectives: [whole], rules: [] } }, { calls: [call({ action: 'add_rule' })], after: { objectives: [whole], rules: [bothRules] } },
    { calls: [], after: { objectives: [whole], rules: [bothRules] } }, { calls: [call({ action: 'complete', id: 'AO1' })], after: { objectives: [{ ...whole, status: 'complete' }], rules: [bothRules] } }], { objectives: [], rules: [{ id: 'AR1', rule: bothRules.rule, source: 'user', scope: 's' }] }), build);
  assert.deepEqual(merged.merged, ['AO1: objectives a+b+c', 'AR1: rules length+tables']);
  assert.equal(merged.allObjectivesByTurn, true, 'the merged entry still satisfies the first reading'); assert.deepEqual(merged.duplicates, []);
  assert.deepEqual(merged.retirements, { c: 'complete by its turn, complete at the end' }, 'the cancelled item ends inside a completed entry, not retired');
  assert.deepEqual(merged.completions, { a: 'active by its turn, complete at the end', b: 'complete by its turn, complete at the end' });
  const title = gradeTools(toolSession([{ calls: [], after: { objectives: [entry('AO1', 'Propose a title for the report')], rules: [] } }], { objectives: [], rules: [] }), TOOL_SCENARIOS[1]);
  assert.deepEqual(title.oneTurnRecorded, ['AO1 active: Propose a title for the report']); assert.deepEqual(title.overRecorded, []);
});

test('a session another model answered is set apart; one without reply metadata is the subject\'s', () => {
  const session = (id, respondingModels) => ({ id, model: 'subject', ...(respondingModels === undefined ? {} : { respondingModels }) });
  const { own, foreign } = bySubject([session('a', ['subject']), session('b', ['subject', 'fallback']), session('c', ['fallback']), session('d', undefined), session('e', [])]);
  assert.deepEqual(own.map(item => item.id), ['a', 'd', 'e']); assert.deepEqual(foreign.map(item => item.id), ['b', 'c']);
});

// ── Batch 2: `gradeRecord`, where only an entry of its own records an objective ──
const scenarioOf = id => RECORD_SCENARIOS.find(item => item.id === id);
const as = status => item => ({ ...item, status });
const bothRules = [r1, r2];
const soundFinal = { objectives: [], rules: [{ id: 'AR1', rule: r1.rule, source: 'user', scope: 's' }, { id: 'AR2', rule: r2.rule, source: 'user', scope: 's' }] };
/** The build scenario with the objective entries each turn leaves behind; rules are recorded in their turn. */
const buildSession = (perTurn, final = soundFinal, calls = []) => toolSession(perTurn.map((objectives, index) => ({ calls: index === 0 ? calls : [], after: { objectives, rules: index >= 1 ? bothRules : [] } })), final);

test('batch 2, the desired session: an entry of its own for every objective, closed the way it ended', () => {
  const graded = gradeRecord(buildSession([[a, b, c], [a, b, c], [as('complete')(a), b, c], [as('complete')(a), as('complete')(b), as('retired')(c)]]), scenarioOf('build'));
  assert.deepEqual(graded.own, { a: 'by its turn', b: 'by its turn', c: 'by its turn' }); assert.deepEqual(graded.any, graded.own);
  assert.deepEqual(graded.fates, { a: 'right', b: 'right', c: 'right' });
  assert.deepEqual(graded.rules, { length: 'by its turn, source user', tables: 'by its turn, source user' });
  assert.deepEqual([graded.merged, graded.duplicates, graded.extras, graded.entries], [[], [], { questions: [], oneTurn: [], other: [] }, 3]);
  assert.deepEqual([graded.allOwnByTurn, graded.allAnyByTurn, graded.allFatesRight, graded.allRulesByTurn, graded.finalSound, graded.noExtras, graded.recordRight], [true, true, true, true, true, true, true]);
});

test('batch 2, one entry for the whole request records no objective, although it names them all', () => {
  const whole = entry('AO1', 'Deliver three items: (a) a Bazel migration outline, (b) an onboarding note, (c) a CI checklist');
  const graded = gradeRecord(buildSession([[whole], [whole], [whole], [as('complete')(whole)]]), scenarioOf('build'));
  assert.deepEqual(graded.own, { a: 'never', b: 'never', c: 'never' });
  assert.deepEqual(graded.any, { a: 'by its turn', b: 'by its turn', c: 'by its turn' }, 'the reading of batch 1 is kept beside it');
  assert.deepEqual(graded.fates, { a: 'no own entry at the end, wanted complete', b: 'no own entry at the end, wanted complete', c: 'no own entry at the end, wanted retired' });
  assert.equal(graded.merged.length, 1); assert.match(graded.merged[0], /^AO1 complete: Deliver three items.* \[a\+b\+c\]$/);
  assert.deepEqual([graded.allOwnByTurn, graded.allAnyByTurn, graded.allFatesRight, graded.noExtras, graded.recordRight], [false, true, false, true, false]);
});

test('batch 2, late entries and wrong endings are named', () => {
  const late = gradeRecord(buildSession([[a], [a, b, c], [as('complete')(a), b, c], [as('complete')(a), as('complete')(b), as('retired')(c)]]), scenarioOf('build'));
  assert.deepEqual(late.own, { a: 'by its turn', b: 'late (turn 2)', c: 'late (turn 2)' }); assert.equal(late.allFatesRight, true); assert.equal(late.recordRight, false);
  // The cancelled objective completed instead of retired; one completion made a turn late; one left open.
  const endings = gradeRecord(buildSession([[a, b, c], [a, b, c], [a, b, c], [as('complete')(a), b, as('complete')(c)]]), scenarioOf('build'));
  assert.deepEqual(endings.fates, { a: 'complete at the end, active in its turn', b: 'active at the end, wanted complete', c: 'complete at the end, wanted retired' });
  assert.deepEqual([endings.allOwnByTurn, endings.allFatesRight, endings.recordRight], [true, false, false]);
  const open = { ...scenarioOf('build'), objectives: { ...scenarioOf('build').objectives, c: { key: /checklist/i, at: 0, fate: ['open'] } } };
  assert.equal(gradeRecord(buildSession([[a, b, c], [a, b, c], [as('complete')(a), b, c], [as('complete')(a), as('complete')(b), c]]), open).fates.c, 'right');
  assert.equal(gradeRecord(buildSession([[a, b, c], [a, b, c], [as('complete')(a), b, c], [as('complete')(a), as('complete')(b), as('retired')(c)]]), open).fates.c, 'retired at the end, wanted active');
});

test('batch 2, entries the record should not hold: a question, a one-turn request, a step, a second entry', () => {
  const sum = entry('AO4', 'Compute 17 times 23'), other = entry('AO5', 'Tidy up the notes'), again = entry('AO6', 'Bazel migration outline, second draft');
  const done = [as('complete')(a), as('complete')(b), as('retired')(c)];
  const graded = gradeRecord(buildSession([[a, b, c], [a, b, c], [as('complete')(a), b, c], [...done, sum, other]]), scenarioOf('build'));
  assert.deepEqual(graded.extras, { questions: ['AO4 active: Compute 17 times 23'], oneTurn: [], other: ['AO5 active: Tidy up the notes'] });
  assert.deepEqual([graded.entries, graded.duplicates, graded.noExtras, graded.allOwnByTurn, graded.recordRight], [5, [], false, true, true], 'surplus entries are a reading of their own, beside the record being right');
  // A second entry for one objective: surplus as well, and the objective's ending can no longer be read.
  const twice = gradeRecord(buildSession([[a, b, c], [a, b, c], [as('complete')(a), b, c], [...done, again]]), scenarioOf('build'));
  assert.equal(twice.duplicates.length, 1); assert.match(twice.duplicates[0], /^a: AO1 complete: .* \| AO6 active: /);
  assert.deepEqual([twice.fates.a, twice.noExtras, twice.recordRight], ['complete/active at the end, wanted complete', false, false]);
  const summary = entry('AO1', 'Rewrite the executive summary'), check = entry('AO2', 'Fact-check the risk section'), named = entry('AO3', 'Propose a title for the report');
  const spelling = [sessionRule('AR1', 'Use British spelling')];
  const report = gradeRecord(toolSession([{ calls: [], after: { objectives: [summary, check], rules: [] } }, { calls: [], after: { objectives: [summary, check], rules: spelling } },
    { calls: [], after: { objectives: [as('complete')(summary), check], rules: spelling } }, { calls: [], after: { objectives: [as('complete')(summary), as('retired')(check), named], rules: spelling } }],
    { objectives: [{ id: 'AO3', objective: named.objective, progress: 'p', issues: [], eta: 'Unknown' }], rules: [{ id: 'AR1', rule: 'Use British spelling', source: 'user', scope: 's' }] }), scenarioOf('report'));
  assert.deepEqual(report.extras, { questions: [], oneTurn: ['AO3 active: Propose a title for the report'], other: [] }); assert.deepEqual([report.recordRight, report.noExtras], [true, false]);
});

test('batch 2, the control and the single deliverable', () => {
  const prose = [sessionRule('AR1', 'Answer in plain prose, no bullet lists')]; const proseFinal = { objectives: [], rules: [{ id: 'AR1', rule: prose[0].rule, source: 'user', scope: 's' }] };
  const chat = objectives => toolSession([{ calls: [], after: { objectives: [], rules: [] } }, { calls: [], after: { objectives, rules: [] } }, { calls: [], after: { objectives, rules: prose } }, { calls: [], after: { objectives, rules: prose } }], proseFinal);
  const quiet = gradeRecord(chat([]), scenarioOf('chat'));
  assert.deepEqual([quiet.entries, quiet.noExtras, quiet.allOwnByTurn, quiet.allFatesRight, quiet.recordRight], [0, true, true, true, true]);
  const noisy = gradeRecord(chat([entry('AO1', 'Explain mutex versus semaphore'), entry('AO2', 'Suggest a name for the photo tool')]), scenarioOf('chat'));
  assert.deepEqual(noisy.extras, { questions: ['AO1 active: Explain mutex versus semaphore'], oneTurn: ['AO2 active: Suggest a name for the photo tool'], other: [] }); assert.equal(noisy.noExtras, false);
  const versions = [sessionRule('AR1', 'Give version numbers exactly')]; const versionsFinal = { objectives: [], rules: [{ id: 'AR1', rule: versions[0].rule, source: 'user', scope: 's' }] };
  const plan = entry('AO1', 'Plan the move of the Postgres 13 cluster to 16');
  const single = extra => toolSession([{ calls: [], after: { objectives: [plan, ...extra], rules: [] } }, { calls: [], after: { objectives: [plan, ...extra], rules: versions } },
    { calls: [], after: { objectives: [plan, ...extra], rules: versions } }, { calls: [], after: { objectives: [as('complete')(plan), ...extra], rules: versions } }], versionsFinal);
  const one = gradeRecord(single([]), scenarioOf('single'));
  assert.deepEqual([one.own, one.fates, one.noExtras, one.recordRight], [{ plan: 'by its turn' }, { plan: 'right' }, true, true]);
  const split = gradeRecord(single([entry('AO2', 'List the three main risks'), entry('AO3', 'Cutover sequence for the Postgres upgrade')]), scenarioOf('single'));
  assert.deepEqual(split.extras.other, ['AO2 active: List the three main risks']); assert.equal(split.duplicates.length, 1); assert.equal(split.noExtras, false);
  assert.equal(split.fates.plan, 'complete/active at the end, wanted complete', 'a second entry for the same deliverable leaves its ending unclear');
});

test('batch 2, a refused call or an unsound final checkpoint makes the record not right', () => {
  const turns = [[a, b, c], [a, b, c], [as('complete')(a), b, c], [as('complete')(a), as('complete')(b), as('retired')(c)]];
  assert.equal(gradeRecord(buildSession(turns, soundFinal, [call({ action: 'retire', id: 'AO9' }, 'AO9 is not in the record')]), scenarioOf('build')).recordRight, false);
  const repeated = gradeRecord(buildSession(turns, { ...soundFinal, objectives: [{ id: 'AO1', objective: a.objective, progress: 'p', issues: [], eta: 'Complete' }] }), scenarioOf('build'));
  assert.deepEqual([repeated.final.completedRepeated, repeated.finalSound, repeated.recordRight], [['AO1'], false, false]);
  const revived = gradeRecord(buildSession(turns, { ...soundFinal, objectives: [{ id: 'AO3', objective: c.objective, progress: 'p', issues: [], eta: 'Unknown' }] }), scenarioOf('build'));
  assert.deepEqual([revived.final.retiredRevived, revived.recordRight], [['AO3'], false]);
  const invalid = gradeRecord(buildSession(turns, 'Error: Unknown objective id AO9'), scenarioOf('build'));
  assert.deepEqual([invalid.final, invalid.finalSound, invalid.recordRight], [{ invalid: 'Error: Unknown objective id AO9' }, false, false]);
});
