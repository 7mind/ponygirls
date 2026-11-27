// Per-cell totals of stored runs as Markdown tables. Usage: node summarize.mjs NAME=PATH[,PATH] [...]
// NAME is a column heading; several paths under one name are added up (a registered cell and its labelled top-up).
// Checkpoint numbers use coding v2; the v1 differences are printed underneath.
import { TOOL_SCENARIOS } from './scenarios.mjs';
import { gradeCheckpoint, gradeTools } from './grade.mjs';
import { loadResults } from './results.mjs';

const columns = process.argv.slice(2).map(argument => { const [name, paths] = argument.split('='); return { name, results: paths.split(',').flatMap(loadResults) }; });
const of = (count, total) => `${count} of ${total}`;
const table = (rows, heads) => [`| | ${heads.join(' | ')} |`, `|---|${heads.map(() => '---').join('|')}|`, ...rows.map(([label, ...cells]) => `| ${label} | ${cells.join(' | ')} |`)].join('\n');

function checkpointCells(results, variant) {
  const sessions = results.filter(item => item.kind === 'checkpoint' && item.variant === variant);
  if (sessions.length === 0) return null;
  const tally = coding => {
    const t = { replies: 0, valid: 0, right: 0, wrong: 0, restated: 0, dropped: 0, unclear: 0, invented: 0, complete1: 0, leftOut2: 0, cancelledOut: 0, null1: 0, id2: 0, lifted: new Map() };
    for (const result of sessions) gradeCheckpoint(result, coding).forEach((round, index) => {
      t.replies++; if (round.invalid !== undefined) return; t.valid++;
      t.right += round.right; t.wrong += round.wrong.length; t.restated += round.restatedAsNew.length; t.dropped += round.dropped.length; t.unclear += round.unclear.length; t.invented += round.inventedRules.length;
      if (index === 0) { if (round.completed === 'Complete') t.complete1++; if (round.newObjective === 'null') t.null1++; }
      else { if (round.completed === 'left out') t.leftOut2++; if (/^AO\d+$/.test(round.newObjective)) t.id2++; }
      if (round.cancelled === 'left out') t.cancelledOut++;
      t.lifted.set(round.liftedRule, (t.lifted.get(round.liftedRule) ?? 0) + 1);
    });
    return t;
  };
  const v2 = tally('v2'), v1 = tally('v1'), n = sessions.length;
  return { n, v1, cells: [String(n), of(v2.valid, v2.replies), of(v2.right, v2.right + v2.wrong), String(v2.restated), String(v2.dropped), String(v2.unclear), of(v2.complete1, n), of(v2.leftOut2, n), of(v2.cancelledOut, v2.replies),
    of(v2.null1, n), of(v2.id2, n), [...v2.lifted].sort().map(([key, value]) => `${key} ${value}`).join('; '), String(v2.invented)] };
}
const CHECKPOINT_ROWS = ['Sessions (two inquiries each)', 'Replies valid', 'ID references naming the entry they were given to', 'Entries restated as new', 'Entries dropped that nothing closed', 'Items the grader could not place',
  'Completed objective reported `Complete` at the first inquiry', 'and left out at the second', 'Cancelled objective left out (replies)', 'New objective given `null` at the first inquiry', 'and named by its new ID at the second',
  'Rule the user lifted (replies)', 'Rules the user never gave'];

function toolCells(results, toolset, scenario) {
  const sessions = results.filter(item => item.kind === 'tools' && item.toolset === toolset && item.scenario === scenario.id);
  if (sessions.length === 0) return null;
  const graded = sessions.map(result => gradeTools(result, scenario)); const n = graded.length; const count = pick => graded.filter(pick).length;
  const range = values => { const low = Math.min(...values), high = Math.max(...values); return low === high ? String(low) : `${low} to ${high}`; };
  const sound = grade => grade.final !== null && grade.final.invalid === undefined && grade.final.completedRepeated.length === 0 && grade.final.retiredRevived.length === 0;
  const mergedObjectives = grade => grade.merged.some(text => text.includes('objectives'));
  return [String(n), of(count(grade => grade.allObjectivesByTurn), n), of(count(grade => grade.allObjectivesByTurn && mergedObjectives(grade)), n), of(count(grade => grade.allRulesByTurn), n), of(count(grade => Object.values(grade.objectives).every(value => value === 'never')), n),
    of(count(grade => grade.allObjectivesByTurn && grade.allRulesByTurn && grade.refused.length === 0 && sound(grade)), n),
    of(count(grade => grade.final !== null && grade.final.invalid === undefined), n), of(count(grade => grade.final?.completedRepeated?.length > 0), n), of(count(grade => grade.final?.retiredRevived?.length > 0), n),
    of(count(grade => grade.overRecorded.length > 0), n), of(count(grade => grade.oneTurnRecorded.length > 0), n), of(count(grade => grade.duplicates.length > 0), n), of(count(grade => grade.refused.length > 0), n),
    of(count(grade => grade.blockedCalls.length > 0), n), range(graded.map(grade => grade.updateCalls)), range(graded.map(grade => grade.extraRequests))];
}
const TOOL_ROWS = ['Sessions (four user turns, then one inquiry)', 'Every stated objective recorded by its turn', 'of these, as one entry for several objectives (amendment 2)', 'Every rule the user gave recorded by its turn', 'No objective recorded at all',
  '**Kept the record current** (registered rule)', 'Final checkpoint valid', 'Final checkpoint repeats a completion made with the tool', 'Final checkpoint revives a retirement',
  'An arithmetic question recorded as an objective', 'A request answered in its own turn recorded as an objective', 'Duplicate entries', 'Sessions with a refused call', 'Sessions in which a built-in tool was called (blocked)',
  '`cuckoo_update` calls per session', 'Provider requests beyond one per turn'];

for (const variant of ['visible', 'compacted']) {
  const cells = columns.map(column => checkpointCells(column.results, variant));
  if (cells.every(cell => cell === null)) continue;
  const shown = columns.filter((_, index) => cells[index] !== null), data = cells.filter(cell => cell !== null);
  console.log(`\n### checkpoint-${variant} (coding v2)\n`);
  console.log(table(CHECKPOINT_ROWS.map((label, row) => [label, ...data.map(cell => cell.cells[row])]), shown.map(column => column.name)));
  console.log(`\nUnder coding v1: ${shown.map((column, index) => `${column.name}: wrong ${data[index].v1.wrong}, restated as new ${data[index].v1.restated}, lifted rule ${[...data[index].v1.lifted].sort().map(([key, value]) => `${key} ${value}`).join('; ')}`).join(' · ')}`);
}
for (const toolset of ['cuckoo', 'builtins']) for (const scenario of TOOL_SCENARIOS) {
  const cells = columns.map(column => toolCells(column.results, toolset, scenario));
  if (cells.every(cell => cell === null)) continue;
  const shown = columns.filter((_, index) => cells[index] !== null), data = cells.filter(cell => cell !== null);
  console.log(`\n### tools-${toolset === 'cuckoo' ? 'only' : 'builtins'}, scenario ${scenario.id}${scenario.heldOut ? ' (held out)' : ''}\n`);
  console.log(table(TOOL_ROWS.map((label, row) => [label, ...data.map(cell => cell[row])]), shown.map(column => column.name)));
}
