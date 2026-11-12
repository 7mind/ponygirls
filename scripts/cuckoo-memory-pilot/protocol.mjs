import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEVELOPMENT_IDS, HELD_OUT_IDS, getCase } from './cases.mjs';
import { hash } from './memory.mjs';
import { MODEL_SELECTION, readProviderConfig } from './runtime.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CONCURRENCY = 4;
export const BATCH_DEADLINE_MS = 3600000;
export const JOB_TIMEOUT_MS = 1000000;
const RANDOMIZATION_KEY = 'cuckoo-memory-20261112-v1';
const SDK_VERSION = '1.5.2';

export function sourceHashes() {
  const pilotFiles = readdirSync(import.meta.dirname).filter(name => name.endsWith('.mjs') || name.endsWith('.sh') || name === 'README.md').sort().map(name => `scripts/cuckoo-memory-pilot/${name}`);
  const extensionFiles = ['index.ts', ...readdirSync(join(ROOT, 'nix/pkg/pi-extensions/ponygirls-cuckoo/src')).filter(name => name.endsWith('.ts')).sort().map(name => `src/${name}`)].map(name => `nix/pkg/pi-extensions/ponygirls-cuckoo/${name}`);
  return Object.fromEntries([...pilotFiles, ...extensionFiles].map(path => [path, hash(readFileSync(join(ROOT, path)))]));
}

export function makeJobs(phase, repetitions) {
  const cases = phase === 'development' ? DEVELOPMENT_IDS : HELD_OUT_IDS;
  const jobs = [];
  for (let modelIndex = 0; modelIndex < MODEL_SELECTION.length; modelIndex++) for (const caseId of cases) for (let repetition = 1; repetition <= repetitions; repetition++) for (const writing of ['current', 'delta']) {
    const selection = MODEL_SELECTION[modelIndex]; const id = `${phase}-m${modelIndex}-${caseId}-r${repetition}-${writing}`;
    const recall = [{ id: 'ordinary-reduced', selective: false, reduced: true }, { id: 'selective-reduced', selective: true, reduced: true }];
    if (parseInt(hash(`${RANDOMIZATION_KEY}:${id}`).slice(0, 2), 16) % 2 === 1) recall.reverse();
    const continuations = [...recall, ...(phase === 'development' ? [{ id: 'ordinary-full-context', selective: false, reduced: false }] : [])];
    jobs.push({ id, phase, provider: selection.provider, model: selection.id, thinking: selection.thinking, caseId, repetition, writing, caseInputHash: hash(getCase(caseId)), continuations });
  }
  return jobs.sort((a, b) => hash(`${RANDOMIZATION_KEY}:order:${a.id}`).localeCompare(hash(`${RANDOMIZATION_KEY}:order:${b.id}`)));
}

export function createProtocol(sdkRoot, extension, providerConfigPath) {
  readProviderConfig(providerConfigPath);
  const sdk = realpathSync(sdkRoot); const sdkPackage = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
  if (sdkPackage.version !== SDK_VERSION) throw new Error('Pilot requires pinned Pi 1.5.2');
  return { version: 1, createdAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), sourceHashes: sourceHashes(),
    sdkRoot: sdk, sdkVersion: sdkPackage.version, nodeVersion: process.version, providerConfigHash: hash(readFileSync(providerConfigPath)), extension: realpathSync(extension), extensionHash: hash(readFileSync(extension)),
    models: MODEL_SELECTION, concurrency: CONCURRENCY, batchDeadlineMs: BATCH_DEADLINE_MS, jobTimeoutMs: JOB_TIMEOUT_MS,
    claimScope: 'Relative comparison of Cuckoo writing/retrieval strategies; not absolute benefit over no memory, natural cadence, or general coding performance.',
    unit: 'Final artifact from a native continuation; retrieval siblings share a frozen prefix. Repetitions are not provider RNG seeds. Task/parameter checks are not independent samples.',
    contextReduction: 'Deterministic native compaction retaining a neutral anchor; all source records and saved reports remain tool-accessible.',
    retrieval: 'Literal-word search over the exact same saved branch report set; never source documents or evaluator answers. Tie-break newest-first. Baseline list/read remains available.',
    primary: 'Strict final artifact correctness and perfect-artifact rate; include every planned continuation in accounting. Execution failures separate from semantic failures.',
    secondary: ['stale-value reuse', 'revised provisional artifact correctness', 'actual memory/source tool use', 'report validity', 'requests and token usage', 'elapsed time (descriptive shared-service observation)'],
    plan: { development: makeJobs('development', 1), scored: makeJobs('scored', 2) },
  };
}

export function verifyProtocol(protocol, sdkRoot, extension, providerConfigPath) {
  readProviderConfig(providerConfigPath);
  if (protocol.providerConfigHash !== hash(readFileSync(providerConfigPath))) throw new Error('Pilot private-provider binding mismatch');
  if (protocol.version !== 1 || JSON.stringify(protocol.sourceHashes) !== JSON.stringify(sourceHashes())) throw new Error('Pilot source binding mismatch');
  if (protocol.sdkVersion !== SDK_VERSION || JSON.stringify(protocol.models) !== JSON.stringify(MODEL_SELECTION) || protocol.concurrency !== CONCURRENCY || protocol.batchDeadlineMs !== BATCH_DEADLINE_MS || protocol.jobTimeoutMs !== JOB_TIMEOUT_MS) throw new Error('Pilot configuration binding mismatch');
  if (protocol.sdkRoot !== realpathSync(sdkRoot) || protocol.extension !== realpathSync(extension) || protocol.extensionHash !== hash(readFileSync(extension)) || protocol.nodeVersion !== process.version) throw new Error('Pilot runtime binding mismatch');
  for (const phase of ['development', 'scored']) if (JSON.stringify(protocol.plan[phase]) !== JSON.stringify(makeJobs(phase, phase === 'development' ? 1 : 2))) throw new Error('Pilot plan binding mismatch');
  return true;
}
