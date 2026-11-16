import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { resolveProject } from '../../../ponygirls-decisions/src/project.ts';
import { digest } from '../../src/evidence.ts';
import { JournalStore } from '../../src/store.ts';

const [directory, sentinel] = process.argv.slice(2);
const STATE_DEADLINE_MS = 5000;
const POLL_INTERVAL_MS = 10;
const agentDir = join(directory, 'agent'), cwd = join(directory, 'project');
process.env.PI_CODING_AGENT_DIR = agentDir;
if (process.send === undefined) throw new Error('IPC required');
const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
  additionalExtensionPaths: [process.env.PI_HISTORIAN_SUBAGENTS_EXTENSION ?? resolve(import.meta.dirname, '../../../ponygirls-subagents/index.ts'),
    process.env.PI_HISTORIAN_EXTENSION ?? resolve(import.meta.dirname, '../../index.ts')],
  noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
await loader.reload();
if (loader.getExtensions().errors.length !== 0) throw new Error(JSON.stringify(loader.getExtensions().errors));
const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
let providerAdmissions = 0;
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
for (const provider of ['main', 'historian']) runtime.registerProvider(provider, {
  api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://fixture.invalid',
  models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 }],
  streamSimple(model, context, options) {
    let text = 'Controlled main response';
    if (provider === 'historian') {
      providerAdmissions++;
      const body = context.messages.find(m => m.role === 'user').content;
      const payload = JSON.parse(typeof body === 'string' ? body : body.map(c => c.text).join(''));
      const selected = payload.evidence.find(e => e.text.includes(sentinel));
      text = JSON.stringify({ proposals: selected === undefined ? [] : [{ episodeId: null, expectedRevision: 0, title: sentinel, kind: 'experiment', status: 'ongoing',
        claims: [{ section: 'objective', basis: 'reported', text: 'Controlled concurrent experiment', evidence: [selected.ref] }] }] });
    }
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const message = { role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id, usage,
        stopReason: options.signal.aborted ? 'aborted' : 'stop', timestamp: Date.now() };
      stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
    });
    return stream;
  },
});
const manager = sdk.SessionManager.create(cwd, join(directory, 'sessions'));
const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: runtime.getModel('main', 'scripted'), thinkingLevel: 'off',
  settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: [] });
const notifications = [], errors = [];
const uiContext = { ...session.extensionRunner.getUIContext(), notify: (message, type) => notifications.push({ message, type }) };
const project = resolveProject(cwd), database = join(agentDir, 'historian', 'projects', digest(project), 'journal.sqlite');
function inspect() {
  if (!existsSync(database)) return { baseline: false, revisions: [] };
  const store = new JournalStore(database, project);
  try { return { baseline: store.state(manager.getSessionId()) !== null, revisions: store.recent(100).filter(r => r.owner === manager.getSessionId()) }; }
  finally { store.close(); }
}
async function handle(command) {
  if (command === 'bind') {
    await session.bindExtensions({ mode: 'rpc', uiContext, onError: error => errors.push(error) });
    await session.prompt('/historian status');
    process.send({ bound: true, sessionId: manager.getSessionId(), baseline: inspect().baseline, notifications, errors });
  } else if (command === 'capture') {
    await session.prompt(sentinel);
    const deadline = Date.now() + STATE_DEADLINE_MS;
    while (inspect().revisions.length === 0) {
      if (Date.now() > deadline) throw new Error(`SDK publication deadline: ${JSON.stringify({ notifications, errors })}`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    await session.prompt('/historian status');
    process.send({ published: true, sessionId: manager.getSessionId(), revisionOwners: inspect().revisions.map(r => r.owner), providerAdmissions, notifications, errors });
  } else if (command === 'shutdown') {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await session.abort(); session.dispose(); process.disconnect();
  } else throw new Error('Unknown SDK fixture command');
}
process.on('message', command => { handle(command).catch(error => {
  process.send({ error: error.stack }, () => { session.dispose(); process.exitCode = 1; process.disconnect(); });
}); });
process.send({ prepared: true, sessionId: manager.getSessionId() });
