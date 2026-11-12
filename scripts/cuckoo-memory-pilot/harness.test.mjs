import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getCase } from './cases.mjs';
import { runJob } from './harness.mjs';
import { continuationObservations } from './analyze.mjs';
import { DELTA_FOCUS } from './memory.mjs';

if (!process.env.PI_SDK_ROOT || !process.env.PI_CUCKOO_EXTENSION) throw new Error('Pinned SDK/extension required for native instrument tests');
const sdk = await import(pathToFileURL(join(process.env.PI_SDK_ROOT, 'dist/index.js')).href);
const require = createRequire(join(process.env.PI_SDK_ROOT, 'package.json'));
const { Type } = await import(pathToFileURL(require.resolve('typebox')).href);
const { createAssistantMessageEventStream, getCurrentTools } = await import(pathToFileURL(join(process.env.PI_SDK_ROOT, 'node_modules/@earendil-works/pi-ai/dist/index.js')).href);
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

async function fixture(t, writing, fail) {
  const parent = mkdtempSync(join(tmpdir(), 'cuckoo-pilot-instrument-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const runtime = await sdk.ModelRuntime.create({ authPath: join(parent, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const contexts = []; let calls = 0;
  runtime.registerProvider('pilot-fixture', { api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://fixture.invalid', models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], contextWindow: 65536, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      contexts.push(structuredClone(context)); const request = ++calls;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options.onPayload({ model: model.id, messages: context.messages }, model);
        const last = context.messages.at(-1); const text = JSON.stringify(last); let content;
        const tool = (name, args) => [{ type: 'toolCall', id: `call-${request}`, name, arguments: args }];
        if (text.includes('Restate me your objectives')) content = [{ type: 'text', text: JSON.stringify({ objectives: [{ objective: 'release plan U-current', progress: 'Transport verified', issues: [], eta: 'Unknown' }], rules: [] }) }];
        else if (last.role === 'toolResult') {
          const data = JSON.parse(last.content.filter(part => part.type === 'text').map(part => part.text).join(''));
          if (last.toolName === 'fixture_list') content = tool('fixture_read', { ids: data.records.slice(0, 6).map(record => record.id) });
          else if (last.toolName === 'cuckoo_search') content = tool('cuckoo_recall', { action: 'read', entryId: data.matches[0].entryId });
          else if (last.toolName === 'cuckoo_recall' && data.rounds !== undefined) content = tool('cuckoo_recall', { action: 'read', entryId: data.rounds[0].entryId });
          else if (last.toolName === 'cuckoo_recall') content = tool('fixture_list', {});
          else content = [{ type: 'text', text: '{}' }];
        } else if (text.includes('Resume final review')) content = getCurrentTools(context.messages).some(item => item.name === 'cuckoo_search') ? tool('cuckoo_search', { query: 'release U current' }) : tool('cuckoo_recall', { action: 'list' });
        else content = tool('fixture_list', {});
        const failed = fail && request === 1;
        const message = { role: 'assistant', provider: model.provider, model: model.id, api: model.api, content: failed ? [{ type: 'text', text: 'Partial response' }] : content,
          usage: failed ? zero : { ...zero, input: 1000, output: 30, totalTokens: 1030 }, stopReason: failed ? 'error' : content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(), ...(failed ? { errorMessage: 'Synthetic controlled failure' } : {}) };
        stream.push({ type: 'start', partial: message });
        if (failed) stream.push({ type: 'error', reason: 'error', error: message }); else stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })().catch(error => { stream.push({ type: 'error', reason: 'error', error }); stream.end(); });
      return stream;
    } });
  const caseData = getCase('upgrade'); caseData.initialPrompt += ' REMOVABLE_PREFIX_MARKER';
  const result = await runJob({ job: { id: `fixture-${writing}`, provider: 'pilot-fixture', model: 'scripted', thinking: 'off', writing, caseId: 'upgrade', continuations: [{ id: 'ordinary-reduced', selective: false, reduced: true }, { id: 'selective-reduced', selective: true, reduced: true }, { id: 'ordinary-full', selective: false, reduced: false }] },
    caseData, directory: join(parent, 'job'), sdk, Type, runtime, model: runtime.getModel('pilot-fixture', 'scripted'), extension: process.env.PI_CUCKOO_EXTENSION, onProgress() {}, inferenceKind: 'scripted', signal: new AbortController().signal });
  return { result, contexts };
}

// Behavioral-Active / Effectual-GoodCommunication: actual SDK/filesystem, scripted provider is not a semantic agent.
for (const writing of ['current', 'delta']) test(`${writing}: native checkpoints/forks/reduction preserve identical evidence and bounded tools`, { timeout: 30000 }, async t => {
  const { result, contexts } = await fixture(t, writing, false);
  assert.equal(result.status, 'completed', JSON.stringify(result.errors)); assert.equal(result.prefix.reports.length, 4); assert.equal(result.prefix.validReports, 4);
  assert.equal(result.prefix.deltaInjections, writing === 'delta' ? 4 : 0);
  for (const run of result.continuations) {
    assert.equal(run.reportSetHashBefore, result.prefix.reportSetHash); assert.equal(run.reports.length, 4);
    assert.equal(run.requests.length, run.responses.length); assert.equal(run.usage.unknownResponses, 0);
    assert.ok(run.toolCalls.some(call => call.name === 'cuckoo_recall' && call.args.action === 'read'));
    assert.ok(run.toolCalls.some(call => call.name === 'fixture_read'));
    const native = readFileSync(run.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const observations = continuationObservations(native, getCase('upgrade').finalPrompt);
    assert.ok(observations.calls.some(call => call.memoryRead), 'actual SDK persists recall details used by analysis');
    assert.ok(observations.calls.flatMap(call => call.sourceIds).length > 0, 'actual SDK persists source record IDs used by analysis');
    assert.equal(run.activeTools.includes('cuckoo_search'), run.arm.selective);
    assert.ok(!run.activeTools.some(name => ['read', 'write', 'bash', 'edit'].includes(name)));
    if (run.arm.reduced) assert.ok(!run.projectedRolesAfterReduction.includes('assistant'));
  }
  const inquiries = contexts.filter(context => JSON.stringify(context.messages.at(-1)).includes('Restate me your objectives'));
  assert.equal(inquiries.length, 4);
  for (const context of inquiries) assert.equal(JSON.stringify(context.messages.at(-1)).includes(DELTA_FOCUS), writing === 'delta');
  const finalContexts = contexts.filter(context => JSON.stringify(context.messages.at(-1)).includes('Resume final review'));
  assert.equal(finalContexts.length, 3);
  assert.doesNotMatch(JSON.stringify(finalContexts[0]), /REMOVABLE_PREFIX_MARKER/);
  assert.doesNotMatch(JSON.stringify(finalContexts[1]), /REMOVABLE_PREFIX_MARKER/);
  assert.match(JSON.stringify(finalContexts[2]), /REMOVABLE_PREFIX_MARKER/);
  assert.doesNotMatch(JSON.stringify(contexts), /Hammer Mode/);
});

test('failed prefixes retain native session identity, partial public output and unknown usage', { timeout: 30000 }, async t => {
  const { result } = await fixture(t, 'current', true);
  assert.equal(result.status, 'failed'); assert.equal(result.prefix.status, 'failed'); assert.equal(result.continuations.length, 0);
  assert.equal(result.prefix.responses[0].text, 'Partial response');
  assert.equal(typeof result.prefix.sessionFile, 'string'); assert.equal(typeof result.prefix.sessionSha256, 'string');
  assert.equal(result.prefix.usage.unknownResponses, 1);
});
