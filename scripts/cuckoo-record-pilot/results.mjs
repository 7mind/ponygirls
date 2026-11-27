// Stored runs: a directory of sessions as the runner writes it (`<label>/<session>/result.json`), or the compact
// `results/<label>.jsonl` kept in the repository (one session per line, without the request payloads and the answers'
// full text; batch 2 is kept gzipped as `results/batch2/<label>.jsonl.gz`). All hold everything the grader reads.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export function loadResults(path) {
  if (statSync(path).isFile()) return (path.endsWith('.gz') ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8')).split('\n').filter(line => line !== '').map(line => JSON.parse(line));
  return readdirSync(path).filter(name => existsSync(join(path, name, 'result.json'))).sort().map(name => JSON.parse(readFileSync(join(path, name, 'result.json'), 'utf8')));
}
export const labelOf = path => basename(path).replace(/\.jsonl(?:\.gz)?$/, '');

/**
 * Sessions the subject itself answered, and those in which another model answered at least once (a server-side
 * fallback). The second kind is reported apart and not graded with its cell.
 */
export function bySubject(results) {
  const foreign = result => result.respondingModels !== undefined && result.respondingModels.some(model => model !== result.model);
  return { own: results.filter(result => !foreign(result)), foreign: results.filter(foreign) };
}

/** A session without what rescoring does not need: the seeded snapshot and the snapshots after each round. Answers are cut to their first 300 characters. */
export function compact(result) {
  const { seeded: _seeded, ...kept } = result;
  return { ...kept,
    rounds: result.rounds.map(({ after: _after, ...round }) => round),
    turns: result.turns.map(turn => ({ ...turn, answer: turn.answer === null ? null : turn.answer.slice(0, 300) })) };
}
