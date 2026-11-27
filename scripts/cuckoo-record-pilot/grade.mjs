// Mechanical grading of pilot runs. Subjects are recognised by the key patterns of scenarios.mjs; whatever matches no
// key or several is listed as unclear and has to be read. Nothing here judges the quality of the wording.
//
// Two codings of a checkpoint reply:
//   v1  as first written, before any run was read;
//   v2  after reading batch 1: a lifted rule kept under its ID with the opposite meaning is "changed", not "revived";
//       a new rule that replaces the lifted one is a new rule, not a restatement; an ID given at the first checkpoint
//       to a new rule is recognised at the second one by the text it was given to.
import { CHECKPOINT_SCENARIO, RECORD } from './scenarios.mjs';

export const COMPLETE = /^\s*complete\s*(?:$|[.;:,!(\u2013\u2014-])/i;
/** Wording of a rule that says the opposite of "ask before running the linter". */
const PERMITS = /without asking|no need to ask|need not ask|may run|can be run|no longer need/i;
export const OBJECTIVE_IDS = RECORD.objectives.map((_, index) => `AO${index + 1}`);
export const RULE_IDS = RECORD.rules.map((_, index) => `AR${index + 1}`);
const subjects = (entries, text) => entries.flatMap((entry, index) => entry.key.test(text) ? [index] : []);
const sameStart = text => other => other.slice(0, 30).toLowerCase() === text.slice(0, 30).toLowerCase();

/**
 * One reply of a checkpoint session. `known` maps the IDs Cuckoo gave at earlier rounds of the session to a predicate
 * that recognises the text they were given to.
 */
export function gradeReply(reply, round, known, coding) {
  const out = { objectives: reply.objectives.length, rules: reply.rules.length, right: 0, wrong: [], restatedAsNew: [], unclear: [], dropped: [], revived: [],
    completed: null, cancelled: null, liftedRule: null, newObjective: 'missing', inventedRules: [] };
  const completedId = OBJECTIVE_IDS[CHECKPOINT_SCENARIO.completedObjective], cancelledId = OBJECTIVE_IDS[CHECKPOINT_SCENARIO.cancelledObjective], liftedId = RULE_IDS[CHECKPOINT_SCENARIO.revokedRule];
  let replacedLifted = false;
  const check = (items, entries, ids, textOf, kind) => {
    const listed = new Set();
    for (const item of items) {
      const text = textOf(item);
      if (item.id !== null) listed.add(item.id);
      const index = ids.indexOf(item.id);
      if (item.id !== null && index === -1) {
        const later = known.get(item.id);
        if (later !== undefined && later(text)) { out.right++; if (kind === 'objective' && CHECKPOINT_SCENARIO.newObjective.test(text)) out.newObjective = item.id; }
        else out.wrong.push(`${item.id}: ${text.slice(0, 60)}`);
        continue;
      }
      const matches = subjects(entries, text);
      if (item.id === null) {
        if (coding === 'v2' && kind === 'rule' && matches.length === 1 && matches[0] === CHECKPOINT_SCENARIO.revokedRule && PERMITS.test(text)) replacedLifted = true;
        else if (matches.length === 1) out.restatedAsNew.push(`${ids[matches[0]]}: ${text.slice(0, 60)}`);
        else if (kind === 'objective' && CHECKPOINT_SCENARIO.newObjective.test(text)) out.newObjective = round === 1 ? 'null' : 'null again';
        else if (matches.length === 0 && kind === 'rule') out.inventedRules.push(text.slice(0, 80));
        else out.unclear.push(`null: ${text.slice(0, 60)}`);
        continue;
      }
      if (matches.includes(index)) out.right++;
      else if (matches.length === 0) out.unclear.push(`${item.id}, subject not recognised: ${text.slice(0, 60)}`);
      else out.wrong.push(`${item.id} given to the subject of ${matches.map(match => ids[match]).join('/')}: ${text.slice(0, 60)}`);
    }
    return listed;
  };
  const listedObjectives = check(reply.objectives, RECORD.objectives, OBJECTIVE_IDS, item => item.objective, 'objective');
  const listedRules = check(reply.rules, RECORD.rules, RULE_IDS, item => item.rule, 'rule');
  const done = reply.objectives.find(item => item.id === completedId);
  out.completed = done === undefined ? 'left out' : COMPLETE.test(done.eta) ? 'Complete' : 'listed as unfinished';
  out.cancelled = listedObjectives.has(cancelledId) ? 'revived' : 'left out';
  if (listedObjectives.has(cancelledId)) out.revived.push(cancelledId);
  const kept = reply.rules.find(item => item.id === liftedId);
  if (kept === undefined) out.liftedRule = replacedLifted ? 'replaced by a new rule' : 'left out';
  else if (coding === 'v2' && PERMITS.test(kept.rule)) out.liftedRule = 'kept under its id, new meaning';
  else { out.liftedRule = 'kept, old meaning'; out.revived.push(liftedId); }
  for (const id of OBJECTIVE_IDS) if (id !== completedId && id !== cancelledId && !listedObjectives.has(id)) out.dropped.push(id);
  for (const id of RULE_IDS) if (id !== liftedId && !listedRules.has(id)) out.dropped.push(id);
  return out;
}

/** Every round of a checkpoint session; an invalid reply is `{ invalid: reason }`. */
export function gradeCheckpoint(result, coding) {
  const known = new Map();
  return result.rounds.map((round, index) => {
    if (round.error !== null) return { invalid: round.error.slice(0, 200) };
    const reply = JSON.parse(round.raw);
    const graded = gradeReply(reply, index + 1, known, coding);
    // What Cuckoo numbered in this round is recognised later by the text it was given to (v1: new objectives only).
    const fresh = (items, textOf) => items.filter(item => item.id === null).map(textOf);
    fresh(reply.objectives, item => item.objective).forEach((text, order) => known.set(round.assigned.objectives[order], coding === 'v2' ? sameStart(text) : other => CHECKPOINT_SCENARIO.newObjective.test(other)));
    if (coding === 'v2') fresh(reply.rules, item => item.rule).forEach((text, order) => known.set(round.assigned.rules[order], sameStart(text)));
    return graded;
  });
}

/** One tool session against what its scenario expects. Turn indexes are 0-based. */
export function gradeTools(result, scenario) {
  const objectivesOf = (snapshot, key) => snapshot.objectives.filter(item => key.test(item.objective));
  const rulesOf = (snapshot, key) => snapshot.rules.filter(item => key.test(`${item.rule} ${item.scope}`));
  const after = index => result.turns[index] === undefined ? null : result.turns[index].after;
  const last = after(result.turns.length - 1);
  const firstTurn = present => { const index = result.turns.findIndex(turn => present(turn.after)); return index === -1 ? null : index; };
  const updates = result.turns.map(turn => turn.calls.filter(call => call.name === 'cuckoo_update'));
  const out = {
    callsPerTurn: updates.map(list => list.map(call => `${call.arguments.action}${call.arguments.id === undefined ? '' : ` ${call.arguments.id}`}${call.result !== null && call.result.isError ? ' (REFUSED)' : ''}`)),
    updateCalls: updates.flat().length, refused: updates.flat().filter(call => call.result !== null && call.result.isError).map(call => call.result.text.slice(0, 120)),
    recallCalls: result.turns.flatMap(turn => turn.calls).filter(call => call.name === 'cuckoo_recall').length,
    blockedCalls: (result.blockedCalls ?? []).map(call => call.name), extraRequests: result.requests - (result.turns.length + 1),
    objectives: {}, rules: {}, completions: {}, retirements: {}, overRecorded: [], oneTurnRecorded: [], duplicates: [], merged: [], final: null,
  };
  for (const name of scenario.expect.added) {
    const turn = firstTurn(snapshot => objectivesOf(snapshot, scenario.objectives[name]).length > 0);
    out.objectives[name] = turn === null ? 'never' : turn <= scenario.expect.addedBy ? 'by its turn' : `late (turn ${turn + 1})`;
  }
  for (const name of scenario.expect.rules) {
    const turn = firstTurn(snapshot => rulesOf(snapshot, scenario.rules[name]).length > 0);
    const source = turn === null ? '' : `, source ${rulesOf(after(turn), scenario.rules[name])[0].source}`;
    out.rules[name] = turn === null ? 'never' : `${turn <= scenario.expect.rulesBy ? 'by its turn' : `late (turn ${turn + 1})`}${source}`;
  }
  const statusAt = (name, turn) => { const found = after(turn) === null ? [] : objectivesOf(after(turn), scenario.objectives[name]); return found.length === 0 ? 'no entry' : found.map(item => item.status).join('/'); };
  for (const [name, turn] of scenario.expect.complete) out.completions[name] = `${statusAt(name, turn)} by its turn, ${statusAt(name, result.turns.length - 1)} at the end`;
  for (const [name, turn] of scenario.expect.retired) out.retirements[name] = `${statusAt(name, turn)} by its turn, ${statusAt(name, result.turns.length - 1)} at the end`;
  if (last !== null) {
    const expected = Object.values(scenario.objectives);
    const others = last.objectives.filter(item => !expected.some(key => key.test(item.objective)));
    out.overRecorded = others.filter(item => scenario.overRecording !== null && scenario.overRecording.test(item.objective)).map(item => `${item.id} ${item.status}: ${item.objective.slice(0, 50)}`);
    out.oneTurnRecorded = others.filter(item => scenario.oneTurnRequest !== null && scenario.oneTurnRequest.test(item.objective)).map(item => `${item.id} ${item.status}: ${item.objective.slice(0, 50)}`);
    out.otherEntries = others.filter(item => !(scenario.overRecording !== null && scenario.overRecording.test(item.objective)) && !(scenario.oneTurnRequest !== null && scenario.oneTurnRequest.test(item.objective))).map(item => `${item.id}: ${item.objective.slice(0, 50)}`);
    for (const [name, key] of Object.entries(scenario.objectives)) { const found = objectivesOf(last, key); if (found.length > 1) out.duplicates.push(`${name}: ${found.map(item => item.id).join(',')}`); }
    for (const [name, key] of Object.entries(scenario.rules)) { const found = rulesOf(last, key); if (found.length > 1) out.duplicates.push(`${name}: ${found.map(item => item.id).join(',')}`); }
    // Amendment 2: one entry that carries several of the stated objectives (or rules). Such an entry satisfies
    // "recorded by its turn" for each of them, so it is reported beside that reading, not instead of it.
    for (const item of last.objectives) { const names = Object.entries(scenario.objectives).filter(([, key]) => key.test(item.objective)).map(([name]) => name); if (names.length > 1) out.merged.push(`${item.id}: objectives ${names.join('+')}`); }
    for (const item of last.rules) { const names = Object.entries(scenario.rules).filter(([, key]) => key.test(`${item.rule} ${item.scope}`)).map(([name]) => name); if (names.length > 1) out.merged.push(`${item.id}: rules ${names.join('+')}`); }
  }
  out.allObjectivesByTurn = Object.values(out.objectives).every(value => value === 'by its turn');
  out.allRulesByTurn = Object.values(out.rules).every(value => value.startsWith('by its turn'));
  const round = result.rounds[0];
  if (round !== undefined && last !== null) {
    if (round.error !== null) out.final = { invalid: round.error.slice(0, 200) };
    else {
      const reply = JSON.parse(round.raw);
      const before = new Map([...last.objectives, ...last.rules].map(item => [item.id, item]));
      const listed = new Set([...reply.objectives, ...reply.rules].flatMap(item => item.id === null ? [] : [item.id]));
      out.final = {
        // A completion or retirement made with the tool must not come back at the checkpoint.
        completedRepeated: reply.objectives.filter(item => item.id !== null && before.get(item.id)?.status === 'complete').map(item => item.id),
        retiredRevived: [...reply.objectives, ...reply.rules].filter(item => item.id !== null && before.get(item.id)?.status === 'retired').map(item => item.id),
        activeDropped: [...before.values()].filter(item => item.status === 'active' && !listed.has(item.id)).map(item => item.id),
        newAtCheckpoint: [...reply.objectives.filter(item => item.id === null).map(item => `objective: ${item.objective.slice(0, 50)}`), ...reply.rules.filter(item => item.id === null).map(item => `rule: ${item.rule.slice(0, 50)}`)],
      };
    }
  }
  return out;
}

/**
 * Batch 2: one tool session against a scenario of `RECORD_SCENARIOS`. Unlike `gradeTools`, a stated objective counts
 * as recorded only by an entry of its own: one whose text matches its key and the key of no other stated objective.
 * Turn indexes are 0-based; every reading is taken from the record as it stood after a turn.
 */
export function gradeRecord(result, scenario) {
  const stated = Object.entries(scenario.objectives);
  const keysOf = item => stated.filter(([, objective]) => objective.key.test(item.objective)).map(([name]) => name);
  const ownOf = (snapshot, name) => snapshot.objectives.filter(item => { const keys = keysOf(item); return keys.length === 1 && keys[0] === name; });
  const rulesOf = (snapshot, key) => snapshot.rules.filter(item => key.test(`${item.rule} ${item.scope}`));
  const after = index => result.turns[index] === undefined ? null : result.turns[index].after;
  const end = after(result.turns.length - 1);
  const firstTurn = present => { const index = result.turns.findIndex(turn => present(turn.after)); return index === -1 ? null : index; };
  const when = (turn, at) => turn === null ? 'never' : turn <= at ? 'by its turn' : `late (turn ${turn + 1})`;
  const updates = result.turns.map(turn => turn.calls.filter(call => call.name === 'cuckoo_update'));
  const title = item => `${item.id} ${item.status}: ${item.objective.slice(0, 70)}`;
  const out = {
    kind: scenario.kind,
    callsPerTurn: updates.map(list => list.map(call => `${call.arguments.action}${call.arguments.id === undefined ? '' : ` ${call.arguments.id}`}${call.result !== null && call.result.isError ? ' (REFUSED)' : ''}`)),
    updateCalls: updates.flat().length, refused: updates.flat().filter(call => call.result !== null && call.result.isError).map(call => call.result.text.slice(0, 120)),
    recallCalls: result.turns.flatMap(turn => turn.calls).filter(call => call.name === 'cuckoo_recall').length,
    blockedCalls: (result.blockedCalls ?? []).map(call => call.name), extraRequests: result.requests - (result.turns.length + 1),
    own: {}, any: {}, fates: {}, rules: {}, merged: [], duplicates: [], extras: { questions: [], oneTurn: [], other: [] }, entries: end === null ? 0 : end.objectives.length, final: null,
  };
  for (const [name, objective] of stated) {
    out.own[name] = when(firstTurn(snapshot => ownOf(snapshot, name).length > 0), objective.at);
    out.any[name] = when(firstTurn(snapshot => snapshot.objectives.some(item => objective.key.test(item.objective))), objective.at);
    // What became of it, read from its own entry: after the turn that settles it, and at the end.
    const [fate, turn] = objective.fate; const wanted = fate === 'open' ? 'active' : fate;
    const statusAt = snapshot => { const found = snapshot === null ? [] : ownOf(snapshot, name); return found.length === 0 ? 'no own entry' : found.map(item => item.status).join('/'); };
    const atEnd = statusAt(end), inTurn = fate === 'open' ? atEnd : statusAt(after(turn));
    out.fates[name] = atEnd === wanted && inTurn === wanted ? 'right' : atEnd === wanted ? `${wanted} at the end, ${inTurn} in its turn` : `${atEnd} at the end, wanted ${wanted}`;
  }
  for (const [name, rule] of Object.entries(scenario.rules)) {
    const turn = firstTurn(snapshot => rulesOf(snapshot, rule.key).length > 0);
    out.rules[name] = `${when(turn, rule.at)}${turn === null ? '' : `, source ${rulesOf(after(turn), rule.key)[0].source}`}`;
  }
  if (end !== null) {
    for (const item of end.objectives) {
      const keys = keysOf(item);
      if (keys.length > 1) out.merged.push(`${title(item)} [${keys.join('+')}]`);
      else if (keys.length === 0) out.extras[scenario.questions !== null && scenario.questions.test(item.objective) ? 'questions' : scenario.oneTurn !== null && scenario.oneTurn.test(item.objective) ? 'oneTurn' : 'other'].push(title(item));
    }
    for (const [name] of stated) { const found = ownOf(end, name); if (found.length > 1) out.duplicates.push(`${name}: ${found.map(title).join(' | ')}`); }
    for (const [name, rule] of Object.entries(scenario.rules)) { const found = rulesOf(end, rule.key); if (found.length > 1) out.duplicates.push(`rule ${name}: ${found.map(item => item.id).join(',')}`); }
  }
  const round = result.rounds[0];
  if (round !== undefined && end !== null) {
    if (round.error !== null) out.final = { invalid: round.error.slice(0, 200) };
    else {
      const reply = JSON.parse(round.raw);
      const before = new Map([...end.objectives, ...end.rules].map(item => [item.id, item]));
      const listed = new Set([...reply.objectives, ...reply.rules].flatMap(item => item.id === null ? [] : [item.id]));
      out.final = {
        completedRepeated: reply.objectives.filter(item => item.id !== null && before.get(item.id)?.status === 'complete').map(item => item.id),
        retiredRevived: [...reply.objectives, ...reply.rules].filter(item => item.id !== null && before.get(item.id)?.status === 'retired').map(item => item.id),
        activeDropped: [...before.values()].filter(item => item.status === 'active' && !listed.has(item.id)).map(item => item.id),
        newAtCheckpoint: [...reply.objectives.filter(item => item.id === null).map(item => `objective: ${item.objective.slice(0, 50)}`), ...reply.rules.filter(item => item.id === null).map(item => `rule: ${item.rule.slice(0, 50)}`)],
      };
    }
  }
  out.allOwnByTurn = Object.values(out.own).every(value => value === 'by its turn');
  out.allAnyByTurn = Object.values(out.any).every(value => value === 'by its turn');
  out.allFatesRight = Object.values(out.fates).every(value => value === 'right');
  out.allRulesByTurn = Object.values(out.rules).every(value => value.startsWith('by its turn'));
  out.finalSound = out.final !== null && out.final.invalid === undefined && out.final.completedRepeated.length === 0 && out.final.retiredRevived.length === 0;
  // Entries the record should not hold: made out of a question, a one-turn request or a step, or a second entry for one objective.
  out.noExtras = out.extras.questions.length + out.extras.oneTurn.length + out.extras.other.length + out.duplicates.length === 0;
  out.recordRight = out.allOwnByTurn && out.allFatesRight && out.allRulesByTurn && out.refused.length === 0 && out.finalSound;
  return out;
}
