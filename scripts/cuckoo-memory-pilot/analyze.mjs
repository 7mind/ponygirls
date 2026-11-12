import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { grade } from './grade.mjs';
import { aggregateUsage, assistantRecords, hash, reportInventory } from './memory.mjs';
import { verifyProtocol } from './protocol.mjs';
import { getCase } from './cases.mjs';
import { saveJson } from './harness.mjs';

function nativeEntries(run) {
  if (typeof run.sessionFile !== 'string' || typeof run.sessionSha256 !== 'string') return null;
  try {
    const bytes = readFileSync(run.sessionFile);
    if (hash(bytes) !== run.sessionSha256) return null;
    const entries = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    return entries.every(entry => entry !== null && typeof entry === 'object' && typeof entry.type === 'string') ? entries : null;
  } catch { return null; }
}
function nativeResponse(copy, entries, phase) {
  if (copy === undefined || entries === null) return { response: null, matches: copy === undefined };
  const selected = entries.filter(entry => entry.id === copy.entryId && entry.type === 'message' && entry.message.role === 'assistant');
  if (selected.length !== 1) return { response: null, matches: false };
  try { const response = assistantRecords(selected, new Set(), phase)[0]; return { response, matches: hash(response) === hash(copy) }; }
  catch { return { response: null, matches: false }; }
}

export function continuationObservations(entries, prompt) {
  if (entries === null) return null;
  const inputs = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.type === 'message' && entry.message.role === 'user' &&
    (typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) === prompt);
  if (inputs.length !== 1) return null;
  const after = entries.slice(inputs[0].index + 1);
  const calls = after.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').map(({ message }) => ({
    name: message.toolName, isError: message.isError,
    outputChars: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').length,
    memoryRead: message.toolName === 'cuckoo_recall' && !message.isError && message.details?.round !== undefined,
    sourceIds: message.toolName === 'fixture_read' && !message.isError && Array.isArray(message.details?.recordIds) ? message.details.recordIds : [],
  }));
  return { calls, responses: assistantRecords(after, new Set(reportInventory(entries).map(report => report.messageEntryId)), 'final') };
}

export function analyze(output, phase, providerConfigPath) {
  const protocol = JSON.parse(readFileSync(join(output, 'protocol.json'), 'utf8'));
  if (!['development', 'scored'].includes(phase)) throw new Error('Unknown phase');
  verifyProtocol(protocol, protocol.sdkRoot, protocol.extension, providerConfigPath);
  const planned = protocol.plan[phase]; const faults = []; const rows = []; const prefixes = [];
  const statusPath = join(output, `${phase}-status.json`);
  let status = null;
  try { status = JSON.parse(readFileSync(statusPath, 'utf8')); } catch { faults.push('Phase status missing or invalid; result files inspected independently'); }
  if (status !== null && status.protocolHash !== hash(readFileSync(join(output, 'protocol.json')))) faults.push('Phase/protocol identity mismatch');
  const phaseRoot = join(output, phase);
  if (existsSync(phaseRoot)) {
    const expected = new Set(planned.flatMap(job => [job.id, `${job.id}.json`, `${job.id}.log`]));
    for (const name of readdirSync(phaseRoot)) if (!expected.has(name)) faults.push(`Unplanned phase artifact: ${name}`);
  }
  for (const job of planned) {
    let result = null; let resultHash = null;
    try { const bytes = readFileSync(join(phaseRoot, job.id, 'result.json')); resultHash = hash(bytes); result = JSON.parse(bytes.toString('utf8')); } catch { faults.push(`Missing or invalid result: ${job.id}`); }
    const receipt = status === null ? undefined : status.jobs.find(row => row.id === job.id);
    const metadataBound = receipt !== undefined && typeof receipt.resultSha256 === 'string' && receipt.resultSha256 === resultHash;
    const receiptMismatch = receipt !== undefined && typeof receipt.resultSha256 === 'string' && !metadataBound;
    if (receiptMismatch) faults.push(`Result receipt mismatch: ${job.id}`);
    let prefix = null; let resultBound = false; let prefixBound = false; let revisedGrade = null; let revisedText = null;
    if (result !== null) {
      resultBound = !receiptMismatch && hash(result.job) === hash(job) && result.caseInputHash === job.caseInputHash && result.inferenceKind === 'live' && result.model.provider === job.provider && result.model.id === job.model && result.model.thinking === job.thinking;
      if (!resultBound) faults.push(`Result binding mismatch: ${job.id}`);
      prefix = result.prefix;
      const native = nativeEntries(prefix);
      const revised = nativeResponse(prefix.revised, native, 'update');
      const nativeReports = native === null ? null : reportInventory(native);
      prefixBound = resultBound && nativeReports !== null && prefix.reportSetHash === hash(nativeReports) && hash(prefix.reports) === hash(nativeReports) && revised.matches;
      if (!prefixBound) faults.push(`Prefix session/report/response binding unavailable: ${job.id}`);
      revisedText = revised.response === null ? null : revised.response.text;
      revisedGrade = revisedText === null ? null : grade(job.caseId, revisedText);
      prefixes.push({ jobId: job.id, provider: job.provider, model: job.model, caseId: job.caseId, repetition: job.repetition, writing: job.writing,
        status: prefix.status, evidenceBound: prefixBound, revisedGrade, reportCount: prefix.reports?.length ?? 0, validReports: prefix.reports?.filter(report => report.report !== null).length ?? 0,
        usage: aggregateUsage(native === null ? [] : assistantRecords(native, new Set((nativeReports ?? []).map(report => report.messageEntryId)), 'prefix')), requests: metadataBound ? prefix.requests.length : null, elapsedMs: metadataBound ? prefix.elapsedMs ?? null : null, deltaInjections: prefix.deltaInjections,
        reports: nativeReports ?? [], revisedText });
      const expectedArms = new Set(job.continuations.map(arm => arm.id));
      for (const run of result.continuations) if (!expectedArms.has(run.arm.id)) faults.push(`Unplanned continuation: ${run.id}`);
    }
    for (const arm of job.continuations) {
      const candidates = result === null ? [] : result.continuations.filter(run => run.arm.id === arm.id);
      if (candidates.length > 1) faults.push(`Duplicate continuation: ${job.id}/${arm.id}`);
      const run = candidates.length === 1 ? candidates[0] : null;
      const native = run === null ? null : nativeEntries(run);
      const final = nativeResponse(run === null ? undefined : run.final, native, 'final');
      const observations = continuationObservations(native, getCase(job.caseId).finalPrompt);
      const evidenceBound = prefixBound && run !== null && native !== null && observations !== null && final.matches && final.response !== null && run.reportSetHashBefore === prefix.reportSetHash && hash(reportInventory(native)) === prefix.reportSetHash;
      if (run !== null && !evidenceBound) faults.push(`Continuation native/copy binding unavailable: ${job.id}/${arm.id}`);
      const completed = evidenceBound && run.status === 'completed' && final.response.stopReason === 'stop';
      const primary = final.response === null ? null : grade(job.caseId, final.response.text);
      const repeatedFailures = primary === null || revisedGrade === null ? [] : primary.checks.filter(check => !check.pass && revisedGrade.checks.some(before => before.name === check.name && !before.pass)).map(check => check.name);
      const calls = observations === null ? [] : observations.calls;
      rows.push({ id: `${job.id}/${arm.id}`, provider: job.provider, model: job.model, caseId: job.caseId, repetition: job.repetition, writing: job.writing,
        retrieval: arm.selective ? 'selective' : 'ordinary', reduced: arm.reduced, status: run === null ? 'not-run-or-unavailable' : run.status, evidenceBound, metadataBound, completed,
        primary, perfect: completed && primary !== null && primary.perfect, repeatedFailedCheckNames: repeatedFailures,
        memoryCalls: calls.filter(call => ['cuckoo_recall', 'cuckoo_search'].includes(call.name)).length,
        memoryReadCalls: calls.filter(call => call.memoryRead).length,
        searchCalls: calls.filter(call => call.name === 'cuckoo_search').length,
        sourceReadCalls: calls.filter(call => call.name === 'fixture_read').length,
        sourceDocumentsRead: [...new Set(calls.flatMap(call => call.sourceIds))],
        toolErrors: calls.filter(call => call.isError).length,
        returnedToolChars: calls.reduce((sum, call) => sum + call.outputChars, 0),
        requests: metadataBound && run !== null ? run.requests.length : null, elapsedMs: metadataBound ? run?.elapsedMs ?? null : null,
        usage: aggregateUsage(observations === null ? [] : observations.responses), finalText: final.response === null ? null : final.response.text,
        finalEntryId: final.response === null ? null : final.response.entryId, reportSetHash: run?.reportSetHashBefore ?? null,
      });
    }
  }
  const keys = [...new Set(rows.map(row => JSON.stringify([row.provider, row.model, row.writing, row.retrieval, row.reduced])))];
  const groups = keys.map(key => {
    const [provider, model, writing, retrieval, reduced] = JSON.parse(key);
    const group = rows.filter(row => JSON.stringify([row.provider, row.model, row.writing, row.retrieval, row.reduced]) === key);
    return { provider, model, writing, retrieval, reduced, planned: group.length, completed: group.filter(row => row.completed).length,
      perfect: group.filter(row => row.perfect).length,
      contentCorrect: group.filter(row => row.completed && row.primary !== null && row.primary.checks.filter(check => !['schema', 'sources'].includes(check.name)).every(check => check.pass)).length,
      sourcesCorrect: group.filter(row => row.completed && row.primary !== null && row.primary.checks.find(check => check.name === 'sources').pass).length,
      parsed: group.filter(row => row.primary?.parsed).length,
      staleArtifacts: group.filter(row => row.primary?.staleChecks.some(check => check.reused)).length,
      memoryUsers: group.filter(row => row.memoryCalls > 0).length, memoryReadUsers: group.filter(row => row.memoryReadCalls > 0).length,
      searchUsers: group.filter(row => row.searchCalls > 0).length,
      requests: group.every(row => row.requests !== null) ? group.reduce((sum, row) => sum + row.requests, 0) : null, sourceReadCalls: group.reduce((sum, row) => sum + row.sourceReadCalls, 0),
      returnedToolChars: group.reduce((sum, row) => sum + row.returnedToolChars, 0),
      totalTokens: group.reduce((sum, row) => sum + row.usage.totalTokens, 0),
      unknownResponses: group.reduce((sum, row) => sum + row.usage.unknownResponses, 0),
      elapsedMs: group.every(row => row.elapsedMs !== null) ? group.reduce((sum, row) => sum + row.elapsedMs, 0) : null };
  });
  return { analyzedAt: new Date().toISOString(), phase, protocolHash: hash(readFileSync(join(output, 'protocol.json'))), plannedJobs: planned.length, plannedContinuations: planned.reduce((sum, job) => sum + job.continuations.length, 0),
    status: status?.status ?? 'unavailable', faults, groups, prefixes, rows,
    caveats: ['Session/task checks are correlated; do not treat individual checks as independent trials.', 'Retrieval siblings share a prefix; writing arms have different generated histories despite matched source inputs.', 'Prefix resources counted once and separately from final-continuation resources.', 'Unavailable/failed executions remain in planned denominators; evidence binding failures are not semantic task errors.', 'No self-report confidence metric is used as a correctness outcome.'] };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [outputArgument, phase] = process.argv.slice(2);
  if (outputArgument === undefined) throw new Error('Usage: analyze.mjs OUTPUT development|scored');
  const output = resolve(outputArgument); const result = analyze(output, phase, process.env.PI_PILOT_PROVIDER_CONFIG);
  saveJson(join(output, `${phase}-analysis.json`), result);
  console.log(JSON.stringify({ phase, plannedContinuations: result.plannedContinuations, faults: result.faults, groups: result.groups }, null, 2));
  process.exitCode = result.faults.length === 0 ? 0 : 1;
}
