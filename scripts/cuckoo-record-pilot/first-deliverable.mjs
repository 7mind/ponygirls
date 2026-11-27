// Usage: node first-deliverable.mjs NAME=PATH [...]
// For the scenarios of batch 2 whose first message asks only to sketch or to start one deliverable: in how many
// sessions that deliverable has an entry of its own after the first message (and is already complete then), gets one
// later, or never gets one. PATH is a results directory or a kept .jsonl / .jsonl.gz file.
import { loadResults } from './results.mjs';
import { RECORD_SCENARIOS } from './scenarios.mjs';

/** Scenario id -> the deliverable its first message asks to sketch or to start. */
const STARTED = { h1: 'welcome', h2: 'speech', h3: 'label', single: 'plan' };
const columns = process.argv.slice(2).map(argument => { const at = argument.indexOf('='); return { name: argument.slice(0, at), results: loadResults(argument.slice(at + 1)) }; });
if (columns.length === 0) throw new Error('Usage: node first-deliverable.mjs NAME=PATH [...]');
const ids = Object.keys(STARTED);
console.log(`| | ${ids.map(id => `\`${id}\` ${STARTED[id]}`).join(' | ')} |\n|---|${ids.map(() => '---').join('|')}|`);
for (const column of columns) {
  const cells = ids.map(id => {
    const scenario = RECORD_SCENARIOS.find(item => item.id === id); const keys = Object.values(scenario.objectives);
    const own = entry => scenario.objectives[STARTED[id]].key.test(entry.objective) && keys.filter(item => item.key.test(entry.objective)).length === 1;
    const tally = { sessions: 0, first: 0, atOnce: 0, later: 0, never: 0 };
    for (const result of column.results) {
      if (result.kind !== 'tools' || result.scenario !== id || result.status === 'failed') continue;
      tally.sessions++;
      const turn = result.turns.findIndex(item => item.after.objectives.some(own));
      if (turn === 0) { tally.first++; if (result.turns[0].after.objectives.some(entry => own(entry) && entry.status === 'complete')) tally.atOnce++; }
      else if (turn > 0) tally.later++; else tally.never++;
    }
    return tally.sessions === 0 ? 'n/a' : `${tally.first} of ${tally.sessions}${tally.atOnce === 0 ? '' : ` (${tally.atOnce} at once)`}; later ${tally.later}, never ${tally.never}`;
  });
  console.log(`| ${column.name} | ${cells.join(' | ')} |`);
}
