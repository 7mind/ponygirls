import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { resolveProject } from '../../ponygirls-decisions/src/project.ts';
import { digest } from '../src/evidence.ts';
import { JournalStore } from '../src/store.ts';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Fixture state deadline'); await new Promise(r => setTimeout(r, 10)); }
}
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-host-'));
  const agentDir = join(directory, 'agent'); const cwd = join(directory, 'project');
  mkdirSync(agentDir); mkdirSync(cwd);
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
    additionalExtensionPaths: [process.env.PI_HISTORIAN_SUBAGENTS_EXTENSION ?? resolve(import.meta.dirname, '../../ponygirls-subagents/index.ts'),
      process.env.PI_HISTORIAN_EXTENSION ?? resolve(import.meta.dirname, '../index.ts')], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  const calls = { main: [], historian: [] }; let holding = false; const pending = [];
  for (const provider of ['main', 'historian']) runtime.registerProvider(provider, {
    api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 }],
    streamSimple(model, context, options) {
      calls[provider].push(structuredClone(context));
      let text = 'Synthetic main response';
      if (provider === 'historian') {
        const body = context.messages.find(m => m.role === 'user').content;
        const payload = JSON.parse(typeof body === 'string' ? body : body.map(c => c.text).join(''));
        const selected = payload.evidence.find(e => e.text.includes('EXPERIMENT_'));
        text = JSON.stringify(selected === undefined ? [] : [{ episodeId: null, expectedRevision: 0, title: 'Synthetic experiment', kind: 'experiment', status: 'ongoing',
          claims: [{ section: 'objective', basis: 'reported', text: 'Controlled synthetic experiment', evidence: [selected.ref] }] }]);
      }
      const stream = createAssistantMessageEventStream(); let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        const message = { role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id, usage,
          stopReason: options.signal.aborted ? 'aborted' : 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
      };
      if (provider === 'historian' && holding) { pending.push(finish); options.signal.addEventListener('abort', finish, { once: true }); }
      else queueMicrotask(finish);
      return stream;
    },
  });
  const manager = sdk.SessionManager.create(cwd, join(directory, 'sessions'));
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: runtime.getModel('main', 'scripted'), thinkingLevel: 'off',
    settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: [] });
  const errors = []; await session.bindExtensions({ mode: 'rpc', onError: e => errors.push(e) });
  t.after(async () => {
    await session.prompt('/historian off');
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await session.abort(); session.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const project = resolveProject(cwd);
  const journalDir = join(agentDir, 'historian', 'projects', digest(project));
  const database = join(journalDir, 'journal.sqlite');
  const revisions = () => {
    if (!existsSync(database)) return [];
    const store = new JournalStore(database, project); try { return store.recent(100); } finally { store.close(); }
  };
  return { session, manager, calls, errors, database, journalDir, cwd, agentDir, revisions, hold: () => { holding = true; }, release: () => { holding = false; for (const finish of pending.splice(0)) finish(); } };
}

test('real Pi: explicit opt-in, outside-project shared publication, reload and disabled intervals', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.session.prompt('EXPERIMENT_BEFORE_ENABLE');
  assert.equal(existsSync(f.database), false); assert.equal(f.calls.historian.length, 0);
  await f.session.prompt('/historian on');
  assert.equal(f.calls.historian.length, 0, 'no model fallback');
  await f.session.prompt('/historian model historian scripted off');
  await f.session.prompt('/historian on');
  await f.session.prompt('EXPERIMENT_AUTHORIZED password="SECRET_SENTINEL"');
  await eventually(() => f.revisions().length === 1);
  const first = f.revisions()[0]; const source = f.manager.getEntries().find(e => e.type === 'message' && JSON.stringify(e.message.content).includes('EXPERIMENT_AUTHORIZED'));
  assert.ok(source); assert.equal(first.owner, f.manager.getSessionId());
  assert.ok(!f.journalDir.startsWith(f.cwd + '/'));
  const sent = JSON.stringify(f.calls.historian);
  assert.doesNotMatch(sent, /EXPERIMENT_BEFORE_ENABLE|SECRET_SENTINEL/);
  for (const context of f.calls.historian) assert.deepEqual(getCurrentTools(context.messages), []);
  await f.session.prompt('/historian off');
  const callsBefore = f.calls.historian.length;
  await f.session.prompt('EXPERIMENT_DISABLED_INTERVAL');
  await f.session.reload();
  await f.session.prompt('EXPERIMENT_DISABLED_RELOAD');
  assert.equal(f.calls.historian.length, callsBefore);
  await f.session.prompt('/historian on');
  await f.session.prompt('EXPERIMENT_AFTER_RELOAD');
  await eventually(() => f.revisions().length === 2);
  assert.doesNotMatch(JSON.stringify(f.calls.historian), /EXPERIMENT_DISABLED_INTERVAL|EXPERIMENT_DISABLED_RELOAD/);
  const markdown = readFileSync(join(f.journalDir, 'journal.md'), 'utf8');
  assert.doesNotMatch(markdown, /Subagent history feed unavailable/, 'real subagents bridge is attached before Historian');
  assert.match(markdown, new RegExp(`entry ${source.id}`));
  assert.match(markdown, /SHA-256/); assert.deepEqual(f.errors, []);
});

test('real Pi: OFF aborts a running worker and prevents its publication; pending work resumes only on explicit enable', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.session.prompt('/historian model historian scripted off'); await f.session.prompt('/historian on');
  f.hold(); await f.session.prompt('EXPERIMENT_CANCELLED');
  await eventually(() => f.calls.historian.length === 1);
  await f.session.prompt('/historian off'); f.release();
  assert.deepEqual(f.revisions(), []);
  await f.session.prompt('EXPERIMENT_OFF');
  await f.session.prompt('/historian on');
  await eventually(() => f.revisions().length === 1);
  assert.doesNotMatch(JSON.stringify(f.calls.historian), /EXPERIMENT_OFF/);
  assert.deepEqual(f.errors, []);
});
