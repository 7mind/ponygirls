import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { appendPage, assembled, evaluationTrace, terminal, conditionViolations } from './live_protocol.mjs';
import { verifyCatalogV3, finalAnswerV3 } from './agent_protocol_v3.mjs';
import { verifyProbeInput, probeRunMetadata } from './probe_policy_v3.mjs';
const [project, inputPath, output] = process.argv.slice(2);
assert.ok(project && inputPath && output);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
verifyProbeInput(input);
assert.ok(['lexical', 'semantic', 'hybrid'].includes(input.mode));
assert.equal(input.factFormat, 'ordered-string-values-v1');
assert.equal(input.relatedPolicy, 'deny');
const origin = new URL(input.origin);
assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.protocol, 'http:'); assert.equal(origin.origin, input.origin);
const load = name => import(pathToFileURL(`${project}/generated/typescript/${name}`).href);
const api = Object.assign({}, ...await Promise.all(['Operation', 'Result', 'ClientEnvelope', 'ServerEnvelope', 'LoginRequest', 'LoginResponse', 'McpTestCatalog', 'McpTestSnapshot'].map(name => load(`chronicle/api/${name}.ts`))));
const { BaboonCodecContext } = await load('BaboonSharedRuntime.ts');
const ctx = BaboonCodecContext.Default;
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const { chromium } = await import(pathToFileURL(input.playwright).href);
const browser = await chromium.launch({ headless: true, executablePath: input.chromium });
let context, page, activeRun, controlRpc, activeDirectory, activeCursor = 0n, cancelPromise;
const summaries = [], controls = [];
async function cancelActive() {
  if (activeRun === undefined || controlRpc === undefined) return;
  if (cancelPromise !== undefined) return cancelPromise;
  const identity = activeRun, directory = activeDirectory, received = activeCursor;
  cancelPromise = (async () => {
    const receipt = await controlRpc(new api.Operation_CancelMcpTest(identity.instanceId, identity.runId));
    assert.ok(receipt instanceof api.Result_McpTestRun);
    save(directory + '/cancel.json', api.McpTestSnapshot_JsonCodec.instance.encode(ctx, receipt.result));
    const drained = await controlRpc(new api.Operation_ReadMcpTest(identity.instanceId, identity.runId, received, 40));
    assert.ok(drained instanceof api.Result_McpTestRun);
    const snapshot = api.McpTestSnapshot_JsonCodec.instance.encode(ctx, drained.result);
    save(directory + '/cancel-drain.json', snapshot);
    assert.equal(snapshot.instanceId, identity.instanceId); assert.equal(snapshot.runId, identity.runId);
    assert.equal(snapshot.state, 'Cancelled'); assert.equal(snapshot.hasMore, false);
    assert.equal(snapshot.events.length, 0);
    save(directory + '/cancel-proof.json', { terminalConfirmed: true, retainedTraceErasedByServer: true,
      lastReceivedSequence: received.toString(), serverHighWater: snapshot.lastSequence,
      claim: 'cancellation receipt and terminal read; NOT a complete original trace or proof provider computation ceased' });
  })();
  return cancelPromise;
}
async function closeBrowser() {
  const cleanup = { contextClosed: context === undefined, browserClosed: false, errors: [] };
  const bounded = action => Promise.race([action(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('browser cleanup deadline')), 10000); timer.unref(); })]);
  try { if (context !== undefined) await bounded(() => context.close()); cleanup.contextClosed = true; }
  catch (error) { cleanup.errors.push({ stage: 'context', message: String(error) }); }
  try { await bounded(() => browser.close()); cleanup.browserClosed = true; }
  catch (error) { cleanup.errors.push({ stage: 'browser', message: String(error) }); }
  return cleanup;
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  try { await cancelActive(); }
  catch (error) { save(output + '/signal-cancel-failure.json', { message: String(error) }); }
  const cleanup = await closeBrowser();
  save(output + '/signal-cleanup.json', { signal, ...cleanup });
  process.exit(signal === 'SIGTERM' ? 143 : 130);
});
try {
  context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
  page = await context.newPage(); await page.goto(input.origin + '/api/versions');
  const login = api.LoginRequest_JsonCodec.instance.encode(ctx, new api.LoginRequest(input.login, readFileSync(input.passwordFile, 'utf8').trim()));
  const authenticated = await page.evaluate(async body => {
    const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, login);
  assert.equal(authenticated.status, 200);
  assert.equal(api.LoginResponse_JsonCodec.instance.decode(ctx, authenticated.body).user.id, input.login);
  await page.evaluate(() => {
    const url = new URL('/api/ws', location.href); url.protocol = 'ws:';
    const socket = new WebSocket(url), pending = new Map();
    const rejectAll = error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
    window.liveOpen = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error('socket-open timeout')); }, 10000);
      socket.onopen = () => { clearTimeout(timeout); resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('socket-open error')); };
      socket.onclose = () => { clearTimeout(timeout); reject(new Error('socket closed')); rejectAll(new Error('originating socket closed')); };
    });
    socket.onmessage = event => {
      try {
        const frame = JSON.parse(event.data);
        if (Object.hasOwn(frame.result, 'Ping')) {
          socket.send(JSON.stringify({ requestId: frame.requestId, operation: { Pong: { nonce: frame.result.Ping.nonce } } })); return;
        }
        const waiter = pending.get(frame.requestId);
        if (waiter !== undefined) { pending.delete(frame.requestId); clearTimeout(waiter.timer); waiter.resolve(frame); }
      } catch (error) { rejectAll(error); socket.close(); }
    };
    window.liveRpc = frame => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('originating socket unavailable')); return; }
      const timer = setTimeout(() => { pending.delete(frame.requestId); reject(new Error('RPC timeout; execution uncertain')); }, 15000);
      pending.set(frame.requestId, { resolve, reject, timer }); socket.send(JSON.stringify(frame));
    });
    window.liveClose = () => socket.close();
  });
  await page.evaluate(() => window.liveOpen);
  async function rpc(operation) {
    const id = randomUUID(), frame = api.ClientEnvelope_JsonCodec.instance.encode(ctx, new api.ClientEnvelope(id, operation));
    const raw = await page.evaluate(value => window.liveRpc(value), frame);
    const envelope = api.ServerEnvelope_JsonCodec.instance.decode(ctx, raw);
    assert.equal(envelope.requestId, id);
    controls.push({ requestId: id, operation: operation.constructor.name, result: envelope.result.constructor.name });
    if (envelope.result instanceof api.Result_Error) throw new Error('RPC domain error: ' + envelope.result.failure.code);
    return envelope.result;
  }
  controlRpc = rpc;
  assert.ok(await rpc(new api.Operation_Hello([api.ClientEnvelope.BaboonDomainVersion])) instanceof api.Result_Hello);
  const response = await rpc(new api.Operation_McpTestTools()); assert.ok(response instanceof api.Result_McpTestTools);
  const catalog = response.result;
  const encodedCatalog = api.McpTestCatalog_JsonCodec.instance.encode(ctx, catalog);
  save(output + '/catalog.json', encodedCatalog);
  assert.equal(catalog.model, input.agentModel);
  verifyCatalogV3(encodedCatalog, input, input.catalogVariant);
  for (const task of input.tasks) {
    const directory = `${output}/${task.id}`; mkdirSync(directory, { mode: 0o700 });
    const startedAt = Date.now();
    const runId = randomUUID(), identity = { instanceId: catalog.instanceId, runId };
    activeRun = identity; activeDirectory = directory; activeCursor = 0n; cancelPromise = undefined;
    const metadata = probeRunMetadata(input, task, identity, api.ClientEnvelope.BaboonDomainVersion);
    const prompt = metadata.prompt;
    save(directory + '/run.json', metadata);
    let events = [], pageNumber = 0, lastState = 'NotStarted', lastFailure = null, failed = null, terminalUnconfirmed = false, abortAfterTask = false, normalDrainComplete = false;
    const deadline = performance.now() + 930000;
    try {
      let result;
      try { result = await rpc(new api.Operation_StartMcpTest(identity.instanceId, runId, prompt)); }
      catch (error) {
        save(directory + '/start-uncertain.json', { error: String(error), policy: 'Never replay Start; read original persisted run identity only' });
        result = await rpc(new api.Operation_ReadMcpTest(identity.instanceId, runId, 0n, 40));
      }
      while (true) {
        assert.ok(result instanceof api.Result_McpTestRun);
        const snapshot = api.McpTestSnapshot_JsonCodec.instance.encode(ctx, result.result);
        save(`${directory}/page-${String(pageNumber++).padStart(4, '0')}.json`, snapshot);
        lastState = snapshot.state; lastFailure = snapshot.failure;
        events = appendPage(events, snapshot, identity, encodedCatalog.limits);
        activeCursor = events.length === 0 ? 0n : BigInt(events.at(-1).sequence);
        if (terminal(snapshot.state) && !snapshot.hasMore) { normalDrainComplete = true; break; }
        assert.ok(performance.now() < deadline, 'client whole-run deadline');
        if (!snapshot.hasMore) await new Promise(resolve => setTimeout(resolve, 2000));
        const cursor = events.length === 0 ? 0n : BigInt(events.at(-1).sequence);
        result = await rpc(new api.Operation_ReadMcpTest(identity.instanceId, runId, cursor, 40));
      }
      if (lastState === 'Complete') {
        const answer = finalAnswerV3(events, task.id);
        save(directory + '/answer.json', answer);
      } else failed = { type: 'model-run-failed', state: lastState, failure: lastFailure };
    } catch (error) {
      failed = { type: 'client-or-final-output-failed', message: String(error) };
      save(directory + '/failure-before-cancel.json', failed);
      save(directory + '/events-before-cancel.json', events);
      try { await cancelActive(); }
      catch (cancelError) {
        terminalUnconfirmed = true; abortAfterTask = true;
        save(directory + '/cancel-failure.json', { message: String(cancelError), terminalUnconfirmed: true, policy: 'abort matrix and close originating socket before any next Start' });
      }
    } finally {
      save(directory + '/events.json', events);
      save(directory + '/native-outcome.json', { taskId: task.id, state: lastState, failure: failed, serverFailure: lastFailure,
        claim: 'controller observation before trace normalization; raw native snapshots retained separately' });
      let trace = [];
      try {
        save(directory + '/assembled.json', assembled(events));
        trace = evaluationTrace(events, task.id);
      } catch (error) {
        failed = { type: 'trace-normalization-failed', message: String(error), priorFailure: failed };
        abortAfterTask = true;
        save(directory + '/trace-normalization-failure.json', failed);
      }
      writeFileSync(directory + '/trace.jsonl', trace.map(item => JSON.stringify(item)).join('\n') + (trace.length ? '\n' : ''), { flag: 'wx', mode: 0o600 });
      const violations = conditionViolations(trace, input.mode, input.project);
      const outcome = { taskId: task.id, mode: input.mode, protocolPolicy: input.protocolPolicy,
                        apiVersion: api.ClientEnvelope.BaboonDomainVersion, catalogVariant: input.catalogVariant, terminalUnconfirmed, traceComplete: normalDrainComplete && !abortAfterTask, state: lastState, failure: failed, conditionViolations: violations.length,
                        events: events.length, toolCalls: trace.length, elapsedMs: Date.now() - startedAt, claim: 'execution state is not answer correctness' };
      save(directory + '/outcome.json', outcome); summaries.push(outcome);
      if (!terminalUnconfirmed) activeRun = undefined;
    }
    if (abortAfterTask) throw new Error('matrix aborted after unconfirmed cancellation or invalid trace; no next Start');
  }
  save(output + '/summary.json', summaries);
  if (summaries.some(item => item.failure !== null || item.conditionViolations !== 0)) process.exitCode = 2;
} catch (error) {
  save(output + '/fatal.json', { type: error.constructor.name, message: String(error) });
  process.exitCode = 1;
} finally {
  save(output + '/controller-rpc.json', controls);
  try { await cancelActive(); }
  catch (error) { save(output + '/final-cancel-failure.json', { message: String(error) }); process.exitCode = 1; }
  if (page !== undefined && !page.isClosed()) await page.evaluate(() => window.liveClose()).catch(() => {});
  const cleanup = await closeBrowser();
  save(output + '/browser-cleanup.json', cleanup);
  if (cleanup.errors.length !== 0) process.exitCode = 1;
}
