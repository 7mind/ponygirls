// Batch 2: the registered adoption rule (README, "Adoption rule" and amendment 5) applied to stored runs.
// Usage: node adoption.mjs DIR
// DIR holds the runs of both arms under the labels of the batch: <subject>-<A|B>-<cell>, each a results directory, a
// <label>.jsonl file or a <label>.jsonl.gz file. Prints every point of the rule with the counts it is read from, and the verdict.
// Counts are compared as the rule states them; the number of graded sessions of each arm is printed beside them, since
// a failed run is not replaced and unequal numbers make a count comparison unfair to the smaller arm.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RECORD_SCENARIOS } from './scenarios.mjs';
import { gradeCheckpoint, gradeRecord } from './grade.mjs';
import { bySubject, loadResults } from './results.mjs';

const [dir] = process.argv.slice(2);
if (dir === undefined) throw new Error('Usage: node adoption.mjs DIR');
const SUBJECT = 'sonnet', OTHERS = ['fable', 'haiku'];
/** The sessions of a label that the subject itself answered; a missing label is an error, not an empty cell. */
function load(label) {
  const path = [join(dir, label), join(dir, `${label}.jsonl`), join(dir, `${label}.jsonl.gz`)].find(candidate => existsSync(candidate));
  if (path === undefined) throw new Error(`No runs for ${label} under ${dir}`);
  const { own, foreign } = bySubject(loadResults(path));
  if (foreign.length > 0) console.log(`note: ${label}: ${foreign.length} session(s) answered by another model are left out`);
  return own;
}
/** Graded tool sessions of one subject and arm in `tools-builtins`, by scenario; failed runs are left out and counted. */
function tools(subject, arm) {
  const sessions = load(`${subject}-${arm}-tools-builtins`); const byScenario = new Map();
  for (const scenario of RECORD_SCENARIOS) {
    const mine = sessions.filter(item => item.scenario === scenario.id);
    byScenario.set(scenario.id, { scenario, failed: mine.filter(item => item.status === 'failed').length, grades: mine.filter(item => item.status !== 'failed').map(result => gradeRecord(result, scenario)) });
  }
  return byScenario;
}
const count = (cell, pick) => cell.grades.filter(pick).length;
const lines = []; const verdicts = [];
/** One comparison of the rule: `ok` is the registered condition on the two counts. */
function compare(point, where, what, a, b, ok, cells) {
  const pass = ok(a, b);
  lines.push(`${pass ? 'pass' : 'FAIL'}  ${point} ${where}: ${what}: A ${a} of ${cells[0]}, B ${b} of ${cells[1]}${cells[0] === cells[1] ? '' : '  (unequal numbers of graded sessions)'}`);
  return pass;
}
const point = (number, name, results) => { const pass = results.every(Boolean); verdicts.push([number, name, pass]); lines.push(`=> point ${number} (${name}): ${pass ? 'holds' : 'DOES NOT HOLD'}`, ''); };
const sizes = (a, b) => [a.grades.length, b.grades.length];

const A = tools(SUBJECT, 'A'), B = tools(SUBJECT, 'B');
const ofKind = (kinds, role) => RECORD_SCENARIOS.filter(scenario => kinds.includes(scenario.kind) && (role === undefined || scenario.role === role)).map(scenario => scenario.id);
for (const [arm, cells] of [['A', A], ['B', B]]) for (const [id, cell] of cells) if (cell.failed > 0) lines.push(`note: ${SUBJECT} arm ${arm} ${id}: ${cell.failed} failed run(s), not graded`);

// 1. Effect: an entry of its own for every stated objective by its turn, held-out work scenarios.
{
  const ids = ofKind(['work'], 'held-out'); const own = grade => grade.allOwnByTurn; const results = [];
  const a = ids.reduce((sum, id) => sum + count(A.get(id), own), 0), b = ids.reduce((sum, id) => sum + count(B.get(id), own), 0);
  const n = [ids.reduce((sum, id) => sum + A.get(id).grades.length, 0), ids.reduce((sum, id) => sum + B.get(id).grades.length, 0)];
  results.push(compare(1, `${ids.join('+')} together`, 'an entry of its own for every stated objective by its turn, B at least 8 more', a, b, (x, y) => y >= x + 8, n));
  for (const id of ids) results.push(compare(1, id, 'the same, B not lower by more than 2', count(A.get(id), own), count(B.get(id), own), (x, y) => y >= x - 2, sizes(A.get(id), B.get(id))));
  point(1, 'effect', results);
}
// 2. No surplus entries in control and single-deliverable scenarios; entries made of a question in work scenarios.
{
  const results = [];
  for (const id of ofKind(['control', 'single'])) results.push(compare(2, id, 'no surplus entries, B not lower by more than 2', count(A.get(id), grade => grade.noExtras), count(B.get(id), grade => grade.noExtras), (x, y) => y >= x - 2, sizes(A.get(id), B.get(id))));
  for (const id of ofKind(['work'])) results.push(compare(2, id, 'sessions with an entry made of a question, B at most 1 more', count(A.get(id), grade => grade.extras.questions.length > 0), count(B.get(id), grade => grade.extras.questions.length > 0), (x, y) => y <= x + 1, sizes(A.get(id), B.get(id))));
  point(2, 'no surplus', results);
}
// 3. Rules recorded by their turn, every scenario.
point(3, 'rules', RECORD_SCENARIOS.map(({ id }) => compare(3, id, 'every rule recorded by its turn, B not lower by more than 2', count(A.get(id), grade => grade.allRulesByTurn), count(B.get(id), grade => grade.allRulesByTurn), (x, y) => y >= x - 2, sizes(A.get(id), B.get(id)))));
// 4. Other subjects: record right and no surplus entries, every scenario.
{
  const results = [];
  for (const subject of OTHERS) {
    const a = tools(subject, 'A'), b = tools(subject, 'B');
    for (const [arm, cells] of [['A', a], ['B', b]]) for (const [id, cell] of cells) if (cell.failed > 0) lines.push(`note: ${subject} arm ${arm} ${id}: ${cell.failed} failed run(s), not graded`);
    for (const { id } of RECORD_SCENARIOS) {
      results.push(compare(4, `${subject} ${id}`, 'record right, B not lower by more than 1', count(a.get(id), grade => grade.recordRight), count(b.get(id), grade => grade.recordRight), (x, y) => y >= x - 1, sizes(a.get(id), b.get(id))));
      results.push(compare(4, `${subject} ${id}`, 'no surplus entries, B not lower by more than 1', count(a.get(id), grade => grade.noExtras), count(b.get(id), grade => grade.noExtras), (x, y) => y >= x - 1, sizes(a.get(id), b.get(id))));
    }
  }
  point(4, 'other subjects', results);
}
// 5. Checkpoints: replies that are invalid or have a wrong ID, an entry restated as new or a dropped entry (coding v2).
{
  const results = [];
  for (const subject of [SUBJECT, ...OTHERS]) {
    const defective = arm => { let replies = 0, bad = 0;
      for (const variant of ['visible', 'compacted']) for (const result of load(`${subject}-${arm}-checkpoint-${variant}`)) {
        if (result.status === 'failed') { lines.push(`note: ${subject} arm ${arm} checkpoint-${variant} ${result.id}: failed run, not graded`); continue; }
        for (const round of gradeCheckpoint(result, 'v2')) { replies++; if (round.invalid !== undefined || round.wrong.length + round.restatedAsNew.length + round.dropped.length > 0) bad++; }
      }
      return { replies, bad }; };
    const a = defective('A'), b = defective('B');
    results.push(compare(5, subject, 'checkpoint replies invalid or with a wrong ID, a restatement as new or a dropped entry, B at most 1 more', a.bad, b.bad, (x, y) => y <= x + 1, [a.replies, b.replies]));
  }
  point(5, 'checkpoints', results);
}
// 6. Surplus rules (amendment 5), every scenario.
point(6, 'surplus rules', RECORD_SCENARIOS.map(({ id }) => compare(6, id, 'no surplus rules, B not lower by more than 2', count(A.get(id), grade => grade.noSurplusRules), count(B.get(id), grade => grade.noSurplusRules), (x, y) => y >= x - 2, sizes(A.get(id), B.get(id)))));

console.log(lines.join('\n'));
console.log(`ADOPTION RULE: ${verdicts.every(([, , pass]) => pass) ? 'holds' : `does not hold (point${verdicts.filter(([, , pass]) => !pass).length === 1 ? '' : 's'} ${verdicts.filter(([, , pass]) => !pass).map(([number]) => number).join(', ')})`}`);
// What may be said afterwards: record right in at least 20 of 24 held-out work sessions, and point 2.
{
  const ids = ofKind(['work'], 'held-out');
  for (const [arm, cells] of [['A', A], ['B', B]]) {
    const right = ids.reduce((sum, id) => sum + count(cells.get(id), grade => grade.recordRight), 0), n = ids.reduce((sum, id) => sum + cells.get(id).grades.length, 0);
    console.log(`"Keeps the record as specified", ${SUBJECT} arm ${arm}: record right in ${right} of ${n} held-out work sessions (needs 20 of 24${arm === 'B' ? ' and point 2' : ''}): ${right >= 20 && n === 24 && (arm === 'A' || verdicts[1][2]) ? 'may be said' : 'may not be said'}`);
  }
}
