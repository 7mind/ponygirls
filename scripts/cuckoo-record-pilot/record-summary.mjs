// Batch 2: tool sessions graded by `gradeRecord`, as Markdown tables or one line per session.
// Usage: node record-summary.mjs [--sessions|--matrix] NAME=PATH[,PATH] [...]
// NAME is a column heading; PATH is a results directory or a results/*.jsonl file. One table per tool set and scenario,
// one column per NAME. Sessions another model answered are left out and listed. With --sessions: what every session
// recorded, for reading by hand. With --matrix: one table per main reading, a row per scenario, for the README.
// Stored runs of batch 1 can be given too: `build` and `report` have the same turns.
import { RECORD_SCENARIOS } from './scenarios.mjs';
import { gradeRecord } from './grade.mjs';
import { bySubject, loadResults } from './results.mjs';

const args = process.argv.slice(2); const perSession = args[0] === '--sessions', matrix = args[0] === '--matrix'; if (perSession || matrix) args.shift();
const columns = args.map(argument => { const cut = argument.indexOf('='); const { own, foreign } = bySubject(argument.slice(cut + 1).split(',').flatMap(loadResults)); return { name: argument.slice(0, cut), results: own.filter(item => item.kind === 'tools'), foreign }; });
const of = (count, total) => `${count} of ${total}`;
const median = values => { const sorted = [...values].sort((x, y) => x - y); return sorted[Math.floor((sorted.length - 1) / 2)]; };
const spread = values => { const low = Math.min(...values), high = Math.max(...values); return low === high ? String(low) : `${low} to ${high} (median ${median(values)})`; };
const toolsetName = toolset => toolset === 'cuckoo' ? 'tools-only' : 'tools-builtins';

/** The graded sessions of one column for one tool set and scenario; a session that did not complete is counted apart. */
function cell(column, toolset, scenario) {
  const sessions = column.results.filter(item => item.toolset === toolset && item.scenario === scenario.id);
  const failed = sessions.filter(item => item.status === 'failed'); // the runner refused it or the provider failed: not a subject outcome
  return { sessions, failed, graded: sessions.filter(item => item.status !== 'failed').map(result => ({ result, grade: gradeRecord(result, scenario) })) };
}

const ROWS = [
  ['Sessions graded (failed runs apart)', (g, c) => `${g.length}${c.failed.length === 0 ? '' : ` (+${c.failed.length} failed)`}`],
  ['**Record right** (registered rule)', g => of(g.filter(x => x.grade.recordRight).length, g.length)],
  ['An entry of its own for every stated objective, by its turn', g => of(g.filter(x => x.grade.allOwnByTurn).length, g.length), 'work'],
  ['Every stated objective named in some entry by its turn (reading of batch 1)', g => of(g.filter(x => x.grade.allAnyByTurn).length, g.length), 'work'],
  ['Sessions with an entry that holds several objectives', g => of(g.filter(x => x.grade.merged.length > 0).length, g.length), 'work'],
  ['No objective entry at all', g => of(g.filter(x => x.grade.entries === 0).length, g.length)],
  ['Every objective closed the way it ended, in its turn', g => of(g.filter(x => x.grade.allFatesRight).length, g.length), 'work'],
  ['Sessions that closed an objective before the turn that settles it (amendment 6, not judged)', g => of(g.filter(x => x.grade.closedEarly.length > 0).length, g.length), 'work'],
  ['Cancelled objective retired at the end', (g, c, scenario) => { const names = Object.entries(scenario.objectives).filter(([, o]) => o.fate[0] === 'retired').map(([name]) => name);
    return names.length === 0 ? 'n/a' : of(g.filter(x => names.every(name => x.grade.fates[name] === 'right' || x.grade.fates[name].startsWith('retired at the end'))).length, g.length); }, 'work'],
  ['Every rule recorded by its turn', g => of(g.filter(x => x.grade.allRulesByTurn).length, g.length)],
  ['Final checkpoint sound', g => of(g.filter(x => x.grade.finalSound).length, g.length)],
  ['Final checkpoint repeats a completion made with the tool', g => of(g.filter(x => x.grade.final?.completedRepeated?.length > 0).length, g.length)],
  ['**No surplus entries** (registered rule)', g => of(g.filter(x => x.grade.noExtras).length, g.length)],
  ['Sessions with an entry made of a question', g => of(g.filter(x => x.grade.extras.questions.length > 0).length, g.length)],
  ['of a request its own reply answers', g => of(g.filter(x => x.grade.extras.oneTurn.length > 0).length, g.length)],
  ['other surplus entries (read by hand)', g => of(g.filter(x => x.grade.extras.other.length > 0).length, g.length)],
  ['a second entry for one objective or rule', g => of(g.filter(x => x.grade.duplicates.length > 0).length, g.length)],
  ['**No surplus rules** (amendment 5)', g => of(g.filter(x => x.grade.noSurplusRules).length, g.length)],
  ['Sessions with a convention of the model\'s own as a rule (read by hand)', g => of(g.filter(x => x.grade.extraRules.assistant.length > 0).length, g.length)],
  ['Sessions with a refused call', g => of(g.filter(x => x.grade.refused.length > 0).length, g.length)],
  ['Sessions in which a built-in tool was called (blocked)', g => of(g.filter(x => x.grade.blockedCalls.length > 0).length, g.length)],
  ['`cuckoo_update` calls per session', g => g.length === 0 ? 'n/a' : spread(g.map(x => x.grade.updateCalls))],
  ['Provider requests beyond one per turn', g => g.length === 0 ? 'n/a' : spread(g.map(x => x.grade.extraRequests))],
];

// What each column's sessions were sent, by tool set: the hashes are equal within an arm and cell and differ between arms.
for (const column of columns) for (const toolset of ['builtins', 'cuckoo']) {
  const sessions = column.results.filter(item => item.toolset === toolset && item.profile !== undefined); if (sessions.length === 0) continue;
  const profiles = new Map(); for (const item of sessions) { const key = `${item.profile.requestModel} effort ${item.profile.effort} system ${item.profile.systemSha256.slice(0, 12)} tools ${item.profile.toolsSha256.slice(0, 12)}`; profiles.set(key, (profiles.get(key) ?? 0) + 1); }
  console.log(`Sent, ${column.name}, ${toolsetName(toolset)}: ${[...profiles].map(([key, n]) => `${key} (${n} sessions)`).join(' | ')}${profiles.size === 1 ? '' : '  <-- MORE THAN ONE PROFILE'}`);
}
console.log(`Sessions answered by another model, left out: ${columns.map(column => `${column.name}: ${column.foreign.length === 0 ? 'none' : column.foreign.map(item => `${item.cell} ${item.id}`).join(', ')}`).join(' · ')}`);
/** The readings of the matrix form: [heading, reading of the graded sessions of a cell, scenario kinds it applies to]. */
const MATRIX = [
  ['*Record right* (registered reading)', g => of(g.filter(x => x.grade.recordRight).length, g.length), null],
  ['An entry of its own for every stated objective, by its turn (point 1 of the rule)', g => of(g.filter(x => x.grade.allOwnByTurn).length, g.length), ['work', 'single']],
  ['No objective entry at all', g => of(g.filter(x => x.grade.entries === 0).length, g.length), ['work', 'single']],
  ['Every objective closed the way it ended, in its turn', g => of(g.filter(x => x.grade.allFatesRight).length, g.length), ['work', 'single']],
  ['Every rule recorded by its turn', g => of(g.filter(x => x.grade.allRulesByTurn).length, g.length), null],
  ['*No surplus entries* (registered reading)', g => of(g.filter(x => x.grade.noExtras).length, g.length), null],
  ['*No surplus rules* (amendment 5)', g => of(g.filter(x => x.grade.noSurplusRules).length, g.length), null],
  ['Final checkpoint sound', g => of(g.filter(x => x.grade.finalSound).length, g.length), null],
  ['`cuckoo_update` calls per session', g => spread(g.map(x => x.grade.updateCalls)), null],
  ['Provider requests beyond one per turn', g => spread(g.map(x => x.grade.extraRequests)), null],
];
if (matrix) {
  for (const toolset of ['builtins', 'cuckoo']) {
    const shown = columns.filter(column => column.results.some(item => item.toolset === toolset)); if (shown.length === 0) continue;
    for (const [heading, value, kinds] of MATRIX) {
      const scenarios = RECORD_SCENARIOS.filter(scenario => kinds === null || kinds.includes(scenario.kind));
      console.log(`\n**${toolsetName(toolset)}: ${heading}**\n`);
      console.log([`| Scenario | ${shown.map(column => column.name).join(' | ')} |`, `|---|${shown.map(() => '---').join('|')}|`,
        ...scenarios.map(scenario => `| \`${scenario.id}\` (${scenario.role}, ${scenario.kind}) | ${shown.map(column => { const data = cell(column, toolset, scenario); return data.graded.length === 0 ? 'n/a' : `${value(data.graded)}${data.failed.length === 0 ? '' : ` (+${data.failed.length} failed)`}`; }).join(' | ')} |`)].join('\n'));
    }
  }
  process.exit(0);
}
for (const toolset of ['builtins', 'cuckoo']) for (const scenario of RECORD_SCENARIOS) {
  const cells = columns.map(column => cell(column, toolset, scenario));
  if (cells.every(item => item.sessions.length === 0)) continue;
  const shown = columns.filter((_, index) => cells[index].sessions.length > 0), data = cells.filter(item => item.sessions.length > 0);
  console.log(`\n### ${toolsetName(toolset)}, scenario ${scenario.id} (${scenario.role}, ${scenario.kind})\n`);
  if (perSession) {
    data.forEach((item, index) => { for (const failed of item.failed) console.log(`${shown[index].name} ${failed.id}: FAILED ${JSON.stringify(failed.errors).slice(0, 200)}`);
      for (const { result, grade } of item.graded) console.log(`${shown[index].name} ${result.id}: ${grade.recordRight ? 'right' : 'NOT right'}${grade.noExtras ? '' : ', SURPLUS'} · calls ${JSON.stringify(grade.callsPerTurn)} · own ${JSON.stringify(grade.own)} · fates ${JSON.stringify(grade.fates)} · rules ${JSON.stringify(grade.rules)}` +
        `${grade.merged.length === 0 ? '' : ` · merged ${JSON.stringify(grade.merged)}`}${grade.noExtras ? '' : ` · extras ${JSON.stringify(grade.extras)} duplicates ${JSON.stringify(grade.duplicates)}`}${grade.refused.length === 0 ? '' : ` · refused ${JSON.stringify(grade.refused)}`}` +
        `${grade.blockedCalls.length === 0 ? '' : ` · blocked ${grade.blockedCalls.join(',')}`}${grade.extraRules.user.length + grade.extraRules.assistant.length === 0 ? '' : ` · extra rules ${JSON.stringify(grade.extraRules)}`}${grade.closedEarly.length === 0 ? '' : ` · closed early ${JSON.stringify(grade.closedEarly)}`} · final ${JSON.stringify(grade.final)}`); });
    continue;
  }
  const rows = ROWS.filter(([, , only]) => only === undefined || scenario.kind === only || (only === 'work' && scenario.kind === 'single'));
  console.log([`| | ${shown.map(column => column.name).join(' | ')} |`, `|---|${shown.map(() => '---').join('|')}|`,
    ...rows.map(([label, value]) => `| ${label} | ${data.map(item => value(item.graded, item, scenario)).join(' | ')} |`)].join('\n'));
}
