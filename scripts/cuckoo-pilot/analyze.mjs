import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CASES, prompts } from './corpus.mjs';
import { grade } from './grade.mjs';

const directory = process.argv[2];
if (directory === undefined) throw new Error('Usage: node analyze.mjs RESULTS_DIR');
const protocol = JSON.parse(readFileSync(join(directory, 'protocol.json'), 'utf8'));
const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const plannedIds = protocol.plan.flatMap(pair => pair.arms.map(enabled => `${pair.task}-${pair.length}-${enabled ? 'on' : 'off'}`));
const results = plannedIds.flatMap(id => existsSync(join(directory, id, 'result.json')) ? [JSON.parse(readFileSync(join(directory, id, 'result.json'), 'utf8'))] : []); const faults = [];
for (const [path, expected] of Object.entries(protocol.sourceHashes)) if (hash(readFileSync(resolve(import.meta.dirname, '../..', path))) !== expected) faults.push(`source-hash-mismatch:${path}`);
if (new Set(results.map(run => run.id)).size !== results.length) faults.push('duplicate-run-id');
const missing = plannedIds.filter(id => !results.some(run => run.id === id));
const extra = summary.results.filter(run => !plannedIds.includes(run.id)).map(run => run.id);
if (missing.length || extra.length) faults.push('incomplete-or-extra-runs');
for (const run of results) {
  const task = CASES.find(task => task.id === run.task);
  if (task === undefined) { faults.push(`${run.id}:unknown-task`); continue; }
  if (JSON.stringify(run.promptHashes) !== JSON.stringify(prompts(task, run.length).map(hash))) faults.push(`${run.id}:prompt-hash-mismatch`);
  if (run.status !== 'completed') { faults.push(`${run.id}:execution-failed`); continue; }
  const final = run.responses.findLast(response => response.phase === 3 && !response.checkpoint);
  const checked = grade(task, final.text);
  if (JSON.stringify(checked) !== JSON.stringify(run.grade)) faults.push(`${run.id}:grade-mismatch`);
  if (run.phases.some(phase => phase.contextWindow !== protocol.model.contextWindow)) faults.push(`${run.id}:capacity-mismatch`);
  if (!run.enabled && run.reports.length !== 0) faults.push(`${run.id}:control-contaminated`);
  if (run.length === 'short' && run.reports.length !== 0) faults.push(`${run.id}:short-control-triggered`);
  if (run.enabled && run.length === 'long' && !run.phases.some(phase => phase.phase < 3 && phase.checkpointCount > 0)) faults.push(`${run.id}:no-prefinal-treatment`);
  if (run.reports.some(report => report.error !== null)) faults.push(`${run.id}:invalid-checkpoint`);
}
const totals = (runs, primaryOnly) => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }; let responses = 0; let unknownUsageResponses = 0;
  for (const run of runs) for (const response of run.responses) {
    if (primaryOnly && response.phase > 3) continue;
    responses++; if (!response.usageKnown || response.usage === null) unknownUsageResponses++;
    if (response.usage !== null) for (const field of Object.keys(usage)) usage[field] += response.usage[field];
  }
  return { ...usage, accountedTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite, modelResponses: responses, unknownUsageResponses };
};
const arms = [];
for (const length of ['short', 'long']) for (const enabled of [false, true]) {
  const runs = results.filter(run => run.length === length && run.enabled === enabled);
  const components = {};
  for (const run of runs) for (const [key, passed] of Object.entries(run.grade === undefined ? {} : run.grade.checks)) {
    if (components[key] === undefined) components[key] = { passed: 0, total: 0 };
    components[key].total++; components[key].passed += Number(passed);
  }
  arms.push({ length, enabled, planned: protocol.plan.filter(pair => pair.length === length).length, runs: runs.length, completed: runs.filter(run => run.status === 'completed').length,
    perfect: runs.filter(run => run.grade?.perfect).length, passed: runs.reduce((n, run) => n + (run.grade === undefined ? 0 : run.grade.passed), 0), checks: runs.length * 6,
    checkpoints: runs.reduce((n, run) => n + run.reports.length, 0), elapsedMs: runs.reduce((n, run) => n + run.elapsedMs, 0), primaryUsage: totals(runs, true), entireUsage: totals(runs, false), components });
}
const pairs = protocol.plan.map(pair => {
  const off = results.find(run => run.id === `${pair.task}-${pair.length}-off`); const on = results.find(run => run.id === `${pair.task}-${pair.length}-on`);
  return { task: pair.task, heldOut: pair.heldOut, length: pair.length, offPerfect: off?.grade?.perfect ?? null, onPerfect: on?.grade?.perfect ?? null,
    offScore: off?.grade?.passed ?? null, onScore: on?.grade?.passed ?? null, offViolations: off?.grade === undefined ? null : Object.entries(off.grade.checks).filter(([, pass]) => !pass).map(([key]) => key), onViolations: on?.grade === undefined ? null : Object.entries(on.grade.checks).filter(([, pass]) => !pass).map(([key]) => key),
    onCheckpoints: on?.reports.length ?? null, offRecall: off?.recall ?? null, onRecall: on?.recall ?? null };
});
const analysis = { protocolCommit: protocol.sourceCommit, faults, missing, extra, validCompletedPilot: faults.length === 0 && results.length === plannedIds.length, arms, pairs };
writeFileSync(join(directory, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.log(JSON.stringify(analysis, null, 2));
process.exitCode = faults.length === 0 ? 0 : 1;
