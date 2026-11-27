// Rescore stored pilot runs. Usage: node analyze.mjs RESULTS_DIR/LABEL [...]
// Never reruns anything: it reads result.json of every session under each directory and prints one line per session,
// then per-cell totals. Checkpoint sessions are graded under both codings (see grade.mjs); totals name their coding.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_SCENARIOS } from './scenarios.mjs';
import { gradeCheckpoint, gradeTools } from './grade.mjs';

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const spread = map => [...map].sort().map(([key, value]) => `${key} ${value}`).join(', ');

for (const directory of process.argv.slice(2)) {
  const names = readdirSync(directory).filter(name => existsSync(join(directory, name, 'result.json'))).sort();
  const results = names.map(name => JSON.parse(readFileSync(join(directory, name, 'result.json'), 'utf8')));
  console.log(`\n# ${directory}: ${results.length} sessions, ${results.filter(item => item.status === 'completed').length} completed${results[0] === undefined ? '' : ` · ${results[0].model}/${results[0].thinking}`}`);
  const profiles = new Set(results.flatMap(item => item.profile === undefined ? [] : [`${item.profile.systemSha256.slice(0, 12)}/${item.profile.toolsSha256.slice(0, 12)}`]));
  if (profiles.size > 0) console.log(`model-facing profile (system text with the cwd normalised / tool definitions): ${[...profiles].join(' ; ')}${profiles.size === 1 ? '' : '  <-- NOT IDENTICAL ACROSS RUNS'}`);
  const efforts = new Set(results.flatMap(item => item.profile === undefined ? [] : [String(item.profile.effort)]));
  const foreign = results.filter(item => item.respondingModels !== undefined && item.respondingModels.some(model => model !== item.model));
  if (efforts.size > 0) console.log(`effort in the request: ${[...efforts].join(', ')} · sessions answered by another model: ${foreign.length}${foreign.length === 0 ? '' : ` (${foreign.map(item => `${item.id}: ${item.respondingModels.join('+')}`).join('; ')})  <-- REPORT APART`}`);
  for (const item of results.filter(entry => entry.status !== 'completed')) console.log(`NOT COMPLETED ${item.id}: ${item.status} ${JSON.stringify(item.errors).slice(0, 300)}`);
  const checkpoint = results.filter(item => item.kind === 'checkpoint'), tools = results.filter(item => item.kind === 'tools');
  if (checkpoint.length > 0) {
    for (const coding of ['v2', 'v1']) {
      const total = { rounds: 0, valid: 0, right: 0, wrong: 0, restatedAsNew: 0, unclear: 0, dropped: 0, revived: 0, inventedRules: 0 };
      const outcomes = { completed1: new Map(), completed2: new Map(), cancelled: new Map(), liftedRule: new Map(), newObjective1: new Map(), newObjective2: new Map() };
      for (const result of checkpoint) {
        const rounds = gradeCheckpoint(result, coding);
        rounds.forEach((round, index) => {
          total.rounds++;
          if (round.invalid !== undefined) { if (coding === 'v2') console.log(`${result.id} round ${index + 1}: INVALID ${round.invalid}`); return; }
          total.valid++;
          for (const key of ['wrong', 'restatedAsNew', 'unclear', 'dropped', 'revived', 'inventedRules']) total[key] += round[key].length;
          total.right += round.right;
          count(index === 0 ? outcomes.completed1 : outcomes.completed2, round.completed); count(outcomes.cancelled, round.cancelled); count(outcomes.liftedRule, round.liftedRule);
          count(index === 0 ? outcomes.newObjective1 : outcomes.newObjective2, /^AO\d+$/.test(round.newObjective) ? 'its ID' : round.newObjective);
          if (coding !== 'v2') return;
          console.log(`${result.id} round ${index + 1}: ${round.objectives} objectives, ${round.rules} rules · right ${round.right} · wrong ${round.wrong.length} · restated as new ${round.restatedAsNew.length} · dropped ${round.dropped.length} · unclear ${round.unclear.length} · completed ${round.completed} · cancelled ${round.cancelled} · lifted rule ${round.liftedRule} · new objective ${round.newObjective}`);
          for (const key of ['wrong', 'restatedAsNew', 'dropped', 'unclear', 'inventedRules']) if (round[key].length > 0) console.log(`   ${key}: ${JSON.stringify(round[key])}`);
        });
      }
      console.log(`TOTAL checkpoint, coding ${coding}: ${JSON.stringify(total)}`);
      console.log(`   round 1: completed ${spread(outcomes.completed1)} · new objective ${spread(outcomes.newObjective1)} | round 2: completed ${spread(outcomes.completed2)} · new objective ${spread(outcomes.newObjective2)} | both rounds: cancelled ${spread(outcomes.cancelled)} · lifted rule ${spread(outcomes.liftedRule)}`);
    }
  }
  for (const scenario of TOOL_SCENARIOS) {
    const sessions = tools.filter(item => item.scenario === scenario.id);
    if (sessions.length === 0) continue;
    const graded = sessions.map(result => ({ result, grade: gradeTools(result, scenario) }));
    for (const { result, grade } of graded) {
      console.log(`${result.id}: objectives ${JSON.stringify(grade.objectives)} · rules ${JSON.stringify(grade.rules)} · completions ${JSON.stringify(grade.completions)} · retirements ${JSON.stringify(grade.retirements)}`);
      console.log(`   calls ${JSON.stringify(grade.callsPerTurn)} · update ${grade.updateCalls} · recall ${grade.recallCalls} · extra requests ${grade.extraRequests} · refused ${grade.refused.length} · blocked built-in calls ${JSON.stringify(grade.blockedCalls)}`);
      console.log(`   over-recorded ${JSON.stringify(grade.overRecorded)} · one-turn request recorded ${JSON.stringify(grade.oneTurnRecorded)} · other entries ${JSON.stringify(grade.otherEntries ?? [])} · duplicates ${JSON.stringify(grade.duplicates)} · final ${JSON.stringify(grade.final)}`);
    }
    const n = graded.length; const sum = pick => graded.filter(pick).length;
    console.log(`TOTAL tools, scenario ${scenario.id}${scenario.heldOut ? ' (held out)' : ''}, n=${n}: every objective by its turn ${sum(item => item.grade.allObjectivesByTurn)} · every rule by its turn ${sum(item => item.grade.allRulesByTurn)}` +
      ` · no objective at all ${sum(item => Object.values(item.grade.objectives).every(value => value === 'never'))} · over-recorded ${sum(item => item.grade.overRecorded.length > 0)} · one-turn request recorded ${sum(item => item.grade.oneTurnRecorded.length > 0)}` +
      ` · duplicates ${sum(item => item.grade.duplicates.length > 0)} · refused calls ${sum(item => item.grade.refused.length > 0)} · blocked built-in calls ${sum(item => item.grade.blockedCalls.length > 0)}` +
      ` · final valid ${sum(item => item.grade.final !== null && item.grade.final.invalid === undefined)} · final repeats a completion ${sum(item => item.grade.final?.completedRepeated?.length > 0)} · final revives a retirement ${sum(item => item.grade.final?.retiredRevived?.length > 0)}` +
      ` · update calls ${graded.map(item => item.grade.updateCalls).join('/')} · extra requests ${graded.map(item => item.grade.extraRequests).join('/')}`);
  }
}
