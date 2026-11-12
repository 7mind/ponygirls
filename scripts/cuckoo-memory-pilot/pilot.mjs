import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProtocol, verifyProtocol } from './protocol.mjs';
import { hash } from './memory.mjs';
import { saveJson } from './harness.mjs';

const [action, outputArgument, phase] = process.argv.slice(2);
if (!['freeze', 'run'].includes(action) || outputArgument === undefined || !process.env.PI_SDK_ROOT || !process.env.PI_CUCKOO_EXTENSION || !process.env.PI_PILOT_PROVIDER_CONFIG) throw new Error('Usage: pilot.mjs freeze OUTPUT | run OUTPUT development|scored');
const output = resolve(outputArgument); const protocolPath = join(output, 'protocol.json');
const emit = value => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));
if (action === 'freeze') {
  mkdirSync(output, { recursive: false });
  const protocol = createProtocol(process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG);
  writeFileSync(protocolPath, JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' });
  emit({ kind: 'protocol-frozen', protocolHash: hash(readFileSync(protocolPath)), developmentJobs: protocol.plan.development.length, scoredJobs: protocol.plan.scored.length });
} else {
  if (!['development', 'scored'].includes(phase) || !process.env.PI_PILOT_AUTH_PATH) throw new Error('Pilot invalid phase or missing credential-store path');
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  verifyProtocol(protocol, process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG);
  if (phase === 'scored') {
    const development = JSON.parse(readFileSync(join(output, 'development-status.json'), 'utf8'));
    if (development.protocolHash !== hash(readFileSync(protocolPath)) || development.jobs.some(job => job.status !== 'completed')) throw new Error('Pilot needs complete same-protocol development execution before scored runs (semantic failures do not block)');
  }
  const statusPath = join(output, `${phase}-status.json`);
  if (existsSync(statusPath)) throw new Error('Pilot phase already started; preserve it and use a new protocol directory instead of overwriting attempts');
  const jobsRoot = join(output, phase); mkdirSync(jobsRoot);
  const status = { phase, protocolHash: hash(readFileSync(protocolPath)), startedAt: new Date().toISOString(), status: 'running', jobs: protocol.plan[phase].map(job => ({ id: job.id, status: 'pending', exitCode: null })) };
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', { flag: 'wx' });
  let cursor = 0; let stopped = false;
  const active = new Set();
  const stop = () => {
    stopped = true;
    for (const child of active) child.kill('SIGTERM');
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const batchTimer = setTimeout(stop, protocol.batchDeadlineMs);
  async function next() {
    while (!stopped && cursor < protocol.plan[phase].length) {
      const index = cursor++; const job = protocol.plan[phase][index]; const row = status.jobs[index];
      verifyProtocol(protocol, process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG);
      const jobFile = join(jobsRoot, `${job.id}.json`); writeFileSync(jobFile, JSON.stringify(job, null, 2) + '\n', { flag: 'wx' });
      const directory = join(jobsRoot, job.id);
      const log = join(jobsRoot, `${job.id}.log`); const fd = openSync(log, 'wx');
      row.status = 'running'; row.startedAt = new Date().toISOString(); saveJson(statusPath, status); emit({ kind: 'job-start', id: job.id });
      const child = spawn(process.execPath, [join(import.meta.dirname, 'worker.mjs'), jobFile, directory, protocolPath], { cwd: resolve(import.meta.dirname, '../..'), env: process.env, stdio: ['ignore', fd, fd] });
      closeSync(fd); active.add(child);
      let killTimer;
      const timer = setTimeout(() => { row.timeout = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 10000); }, protocol.jobTimeoutMs);
      const outcome = await new Promise(resolveChild => {
        child.once('error', () => resolveChild({ code: null, signal: null, spawnError: true }));
        child.once('close', (code, signal) => resolveChild({ code, signal, spawnError: false }));
      });
      clearTimeout(timer); clearTimeout(killTimer); active.delete(child);
      row.finishedAt = new Date().toISOString(); row.exitCode = outcome.code; row.signal = outcome.signal; row.spawnError = outcome.spawnError;
      try {
        const bytes = readFileSync(join(directory, 'result.json'));
        row.resultSha256 = hash(bytes);
        const result = JSON.parse(bytes.toString('utf8'));
        row.status = outcome.code === 0 && result.status === 'completed' && result.job.id === job.id && result.caseInputHash === job.caseInputHash && result.inferenceKind === 'live' ? 'completed' : 'failed';
      } catch { row.status = 'failed'; row.resultUnavailable = true; }
      saveJson(statusPath, status); emit({ kind: 'job-done', id: job.id, status: row.status, exitCode: row.exitCode, finished: status.jobs.filter(item => ['completed', 'failed'].includes(item.status)).length, planned: status.jobs.length });
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(protocol.concurrency, protocol.plan[phase].length) }, () => next())); }
  finally {
    clearTimeout(batchTimer); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    for (const row of status.jobs) if (row.status === 'pending') { row.status = 'not-run'; row.reason = 'batch deadline or cancellation'; }
    status.finishedAt = new Date().toISOString(); status.status = status.jobs.every(row => row.status === 'completed') ? 'completed' : 'failed'; saveJson(statusPath, status);
  }
  emit({ kind: 'phase-done', phase, status: status.status, jobs: status.jobs.length });
  process.exitCode = status.status === 'completed' ? 0 : 1;
}
