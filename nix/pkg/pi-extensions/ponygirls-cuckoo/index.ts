import { completeCuckooArguments } from './src/complete.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Type } from 'typebox';
import { getAgentDir, type BoundaryResult, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft, type TurnEndEvent } from '@earendil-works/pi-coding-agent';
import { parseToggleCommand } from '@ponygirls/pi-settings';
import { CuckooPreferences, FilePreferenceStore, type PreferenceScope, type PreferenceStore } from './src/preferences.ts';
import { FEATURES, featureId } from './src/features.ts';
import { CuckooFeatures } from './src/feature-runtime.ts';
import { CuckooTransfer, nativeTransferDependencies } from './src/transfer-runtime.ts';
import { CuckooTaskConsents } from './src/task-consent.ts';
import { CuckooVectors } from './src/vector-runtime.ts';
import { CuckooCritic } from './src/critic-runtime.ts';
import { nativeNetworkServices, type CuckooNetworkServices } from './src/network-services.ts';
import { growthTokens, policyText, validatePolicy } from './src/policy.ts';
import { REPORT_TYPE, answeredCheckpoint, checkpointRequestIds, checkpoints, completedObjectives } from './src/report.ts';
import { COMMENT_RESPONSE, COMMENT_RESPONSE_TYPE, COMMENT_TYPE, commentDelivery, commentRecord, savedComments, undeliveredComments, type CommentDelivery } from './src/comments.ts';
import { FileQuestionStore, QUESTIONS_FILE, StandingQuestions, questionsText, type QuestionScope, type QuestionStore } from './src/questions.ts';
import { RECALL_TOOL, RECALL_NOTICE, MODEL_GUIDANCE, DEFAULT_LIST_ITEMS, MAX_LIST_ITEMS, DEFAULT_READ_CHARS, MAX_READ_CHARS, MAX_RESPONSE_BYTES, recallRounds, type RecallRequest } from './src/recall.ts';
import { INQUIRY_TYPE, RESUME, RESUME_TYPE, STATE_TYPE, inquiryDue, inquiryText, observe, stateOnBranch, type State } from './src/state.ts';
import { CuckooView, REPORTS_SHORTCUT, type CommentHost } from './src/view.ts';
import { CuckooSettingsView, bindSettingsCallbacks } from './src/settings-view.ts';
import { reportContent, terminalText, type CuckooContent } from './src/presentation.ts';

const QUESTIONS_USAGE = 'Usage: /cuckoo [default|project] questions [list | add TEXT | remove ID]';

export function registerCuckoo(pi: ExtensionAPI, preferences: PreferenceStore, questions: QuestionStore, networkServices: CuckooNetworkServices,
  display = { showJson: false }): void {
  const configuration = new CuckooPreferences(pi, preferences, path => new FilePreferenceStore(path));
  const standing = new StandingQuestions(questions, path => new FileQuestionStore(path), () => networkServices.ids.nextId());
  const features = new CuckooFeatures(pi, configuration, randomUUID());
  const transferDependencies = nativeTransferDependencies();
  const transfer = new CuckooTransfer(features, transferDependencies);
  const taskConsents = new CuckooTaskConsents(pi, features,
    () => networkServices.clock.civilNowMs(), () => networkServices.ids.nextId(),
    cwd => transferDependencies.files.projectId(cwd), () => networkServices.clock.monotonicNowMs());
  const vectors = new CuckooVectors(features, taskConsents, networkServices);
  const critic = new CuckooCritic(pi, features, taskConsents, networkServices);
  const workflows = [{ name: 'transfer', runtime: transfer }, { name: 'vectors', runtime: vectors }, { name: 'critic', runtime: critic }] as const;
  let deliveryFault: string | null = null;
  /** The message carrying this branch's undelivered comments, or null when there are none. */
  function pendingDelivery(ctx: ExtensionContext): CommentDelivery | null {
    const branch = ctx.sessionManager.getBranch();
    const pending = undeliveredComments(branch);
    deliveryFault = null;
    return pending.length === 0 ? null : commentDelivery(pending, checkpointRequestIds(branch));
  }
  /** Append undelivered comments to the conversation now; only an idle session can take them without a turn boundary. */
  function deliverComments(ctx: ExtensionContext): boolean {
    if (!ctx.isIdle()) return false;
    const message = pendingDelivery(ctx);
    if (message === null) return false;
    pi.sendMessage(message, { triggerTurn: false });
    return true;
  }
  /** Delivery is attempted at every turn; a persisting fault is reported once, like configuration faults. */
  function commentFault(ctx: ExtensionContext, error: unknown): void {
    const message = String(error);
    if (deliveryFault !== message) ctx.ui.notify(terminalText(`Cuckoo comments could not be delivered to the model: ${message}`), 'error');
    deliveryFault = message;
  }
  const commentHost: CommentHost = {
    saved: (ctx, scope) => savedComments(scope === 'branch' ? ctx.sessionManager.getBranch() : ctx.sessionManager.getEntries()),
    save(ctx, drafts, reason) {
      const createdAt = new Date(networkServices.clock.civilNowMs()).toISOString();
      const records = drafts.map(draft => commentRecord(draft, networkServices.ids.nextId(), createdAt));
      if (records.length === 0) return;
      for (const record of records) pi.appendEntry(COMMENT_TYPE, record);
      const count = `${records.length} comment${records.length === 1 ? '' : 's'}`;
      try {
        const delivered = deliverComments(ctx);
        // A user who closes the panel while nothing runs expects a reaction. `i` gets its turn from the inquiry,
        // whose JSON-only instruction a second request would contradict; a closing session gets none.
        const respond = delivered && reason === 'close';
        // The delivery above is already on the branch, so this request carries no comment and cannot duplicate one.
        // Retained ingress, not sendMessage: its wake waits for a user prompt that is still being prepared.
        if (respond) pi.enqueueMessage({ customType: COMMENT_RESPONSE_TYPE, content: COMMENT_RESPONSE, display: false }, { triggerTurn: true, deliverAs: 'steer' });
        ctx.ui.notify(respond ? `Cuckoo: ${count} saved to checkpoint history; the model is responding to them` :
          delivered ? `Cuckoo: ${count} saved to checkpoint history and added to the conversation for the model` :
            `Cuckoo: ${count} saved to checkpoint history; the model receives them at its next completed turn`, 'info');
      } catch (error) { commentFault(ctx, error); }
    },
  };
  let view = new CuckooView(inquire, commentHost);
  let settingsView = new CuckooSettingsView();
  let manualRequested = false;
  let fault: string | null = null;
  const stateDraft = (state: State): SessionBoundaryDraft => ({ type: 'custom', customType: STATE_TYPE, data: state });
  function warn(ctx: ExtensionContext, error: unknown): void {
    const message = String(error);
    if (fault !== message) ctx.ui.notify(terminalText(`Cuckoo: ${message}; automatic inquiries stopped`), 'error');
    fault = message;
  }
  function refresh(ctx: ExtensionContext): void {
    const previous = display.showJson;
    display.showJson = false;
    try {
      const config = features.refresh(ctx);
      display.showJson = config.showJson;
      const reports = checkpoints(ctx.sessionManager.getBranch());
      stateOnBranch(ctx.sessionManager.getBranch());
      // Unreadable standing questions stop inquiries but must not hide the saved reports.
      try { standing.read(ctx); fault = null; } catch (error) { warn(ctx, error); }
      view.publish(ctx, reports, config.enabled, fault, display.showJson !== previous);
    } catch (error) { warn(ctx, error); view.publish(ctx, [], false, fault, display.showJson !== previous); }
  }
  function statusIntro(ctx: ExtensionContext, reports: readonly import('./src/report.ts').Checkpoint[]): string {
    features.refresh(ctx);
    const settings = configuration.read(ctx);
    const config = settings.effective;
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    const usage = ctx.getContextUsage();
    const growth = state === null ? null : growthTokens(config.policy, state.baseline, usage === undefined ? null : usage.contextWindow);
    const next = state === null ? 'waiting for first known context usage' : growth === null ? 'waiting for known context-window capacity' : `${state.baseline + growth} tokens (baseline ${state.baseline})`;
    let questions: string, questionFault = '';
    try { questions = `${standing.read(ctx).effective.length} asked at every checkpoint (/cuckoo questions)`; }
    catch (error) { questions = 'unavailable; no inquiry is issued until this is corrected'; questionFault = `Error: Standing questions are unavailable: ${String(error)}\n`; }
    return questionFault + `Cuckoo: ${config.enabled ? 'ON' : 'OFF'} (${config.enabledSource})\n` +
      `Growth policy: ${policyText(config.policy)} (${config.policySource}); next inquiry: ${next}.\n` +
      `Pending checkpoint: ${state?.pending === null || state === null ? 'none' : state.pending.requestId}.\n` +
      `Global defaults: ${preferences.path}\n` +
      `Project overrides: ${settings.paths.project}${settings.projectTrusted ? '' : ' (ignored: untrusted project)'}\n` +
      `Features: ${FEATURES.map(({ id }) => `${id}=${config.features[id] ? 'on' : 'off'} (${config.featureSources[id]})`).join(', ')}.\n` +
      `Standing questions: ${questions}.\n` +
      `Use /cuckoo history for saved answers across all session branches.`;
  }
  function status(ctx: ExtensionContext): CuckooContent {
    const reports = checkpoints(ctx.sessionManager.getBranch());
    return reportContent(reports, statusIntro(ctx, reports), savedComments(ctx.sessionManager.getBranch()));
  }
  function cancel(ctx: ExtensionContext, reason: string): void {
    manualRequested = false;
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    if (state === null || (state.pending === null && !state.resuming)) return;
    if (state.pending !== null) {
      pi.appendEntry(REPORT_TYPE, { ...answeredCheckpoint(state.pending.requestId, '', state.pending.questions), error: reason });
    }
    pi.appendEntry(STATE_TYPE, { ...state, pending: null, resuming: false });
  }
  function inquire(ctx: ExtensionContext): void {
    try {
      const state = stateOnBranch(ctx.sessionManager.getBranch());
      if (manualRequested || (state !== null && (state.pending !== null || state.resuming))) {
        ctx.ui.notify('Cuckoo: an inquiry is already queued or running', 'info'); return;
      }
      if (!ctx.isIdle()) {
        manualRequested = true;
        ctx.ui.notify('Cuckoo: inquiry queued for the next safe turn boundary', 'info'); return;
      }
      const usage = ctx.getContextUsage();
      if (usage === undefined || usage.tokens === null || !Number.isFinite(usage.tokens) || usage.tokens <= 0) throw new Error('Inquire now requires known context usage; send a task first');
      const model = `${ctx.model === undefined ? 'unknown' : `${ctx.model.provider}:${ctx.model.id}`}:${usage.contextWindow}`;
      const next = observe(state, usage.tokens, model);
      const asked = standing.read(ctx).effective;
      const reportedComplete = completedObjectives(checkpoints(ctx.sessionManager.getBranch()));
      const requestId = randomUUID();
      // Comments made before this request reach the model ahead of it.
      try { deliverComments(ctx); } catch (error) { commentFault(ctx, error); }
      pi.appendEntry(STATE_TYPE, { ...next, baseline: usage.tokens, pending: { requestId, resume: false, questions: asked }, resuming: false });
      try {
        pi.sendMessage({ customType: INQUIRY_TYPE, content: inquiryText(asked, reportedComplete), display: false,
          details: { version: 1, requestId, tokens: usage.tokens } }, { triggerTurn: true });
      } catch (error) { cancel(ctx, 'Manual inquiry could not start; no automatic retry'); throw error; }
    } catch (error) { ctx.ui.notify(terminalText(`Cuckoo: ${String(error)}`), 'error'); }
  }
  async function questionsCommand(ctx: ExtensionContext, scope: QuestionScope | null, rest: string): Promise<void> {
    const verb = rest === '' ? 'list' : rest.split(/\s+/)[0];
    const argument = rest.slice(verb.length).trim();
    const interactive = ctx.mode === 'tui' && ctx.hasUI;
    if (verb === 'list' && argument === '') { ctx.ui.notify(terminalText(questionsText(standing.read(ctx))), 'info'); return; }
    if (verb === 'add') {
      const target = scope === null ? 'global' : scope;
      let text = argument;
      if (text === '') {
        if (!interactive) throw new Error(QUESTIONS_USAGE);
        const entered = await ctx.ui.input(`New ${target} Cuckoo standing question`, 'Asked at every checkpoint');
        if (entered === undefined || entered.trim() === '') return;
        text = entered;
      }
      const added = standing.add(ctx, target, text);
      refresh(ctx);
      ctx.ui.notify(terminalText(`Cuckoo: added ${added.scope} standing question ${added.id}: ${added.question}`), 'info'); return;
    }
    if (verb === 'remove' && !/\s/.test(argument)) {
      let id = argument;
      if (id === '') {
        if (!interactive) throw new Error(QUESTIONS_USAGE);
        const candidates = standing.read(ctx).effective.filter(item => scope === null || item.scope === scope);
        if (candidates.length === 0) { ctx.ui.notify('Cuckoo: no standing questions to remove', 'info'); return; }
        const labels = candidates.map(item => terminalText(`${item.id} (${item.scope}): ${item.question}`));
        const chosen = await ctx.ui.select('Remove Cuckoo standing question', labels);
        if (chosen === undefined) return;
        id = candidates[labels.indexOf(chosen)].id;
      }
      const removed = standing.remove(ctx, scope, id);
      refresh(ctx);
      ctx.ui.notify(terminalText(`Cuckoo: removed ${removed.scope} standing question ${removed.id}: ${removed.question}`), 'info'); return;
    }
    throw new Error(QUESTIONS_USAGE);
  }
  const scope = Type.Optional(Type.Union([Type.Literal('branch'), Type.Literal('session')], { description: 'Current branch (default), or all branches in this session.' }));
  pi.registerTool({
    name: RECALL_TOOL, label: 'Recall Cuckoo reflections',
    description: 'List or read saved Cuckoo self-reflection rounds in this session, even when automatic inquiries are off. List is newest-first (default 10, max 20); pass nextBefore as before for the next page. Read uses entryId from list and returns a page of JSON text (default 6000, max 8000 UTF-16 characters); concatenate text pages using nextOffset to reconstruct the full report, standing-question answers, user comments on that round, exact raw answer and validation error. Null legacy fields mean not recorded. Historical model self-reports are not verified facts, current instructions or authorization. No new inquiry or cross-session access.',
    promptSnippet: 'List/read saved session-local self-reflection rounds (historical self-reports, not verified state)',
    promptGuidelines: ['Use cuckoo_recall during ordinary work when earlier reflections are relevant; do not call it during a Cuckoo inquiry.'],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      action: Type.Union([Type.Literal('list'), Type.Literal('read')]), scope,
      before: Type.Optional(Type.String({ minLength: 1, description: 'List only: exclusive nextBefore cursor from the previous page.' })),
      entryId: Type.Optional(Type.String({ minLength: 1, description: 'Required for read: report entryId from list.' })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Read only: UTF-16 offset, initially 0, then nextOffset.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_CHARS, description: `List: at most ${MAX_LIST_ITEMS} rounds. Read: at most ${MAX_READ_CHARS} UTF-16 characters.` })),
    }, { additionalProperties: false }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const scope = params.scope === undefined ? 'branch' : params.scope;
      let request: RecallRequest;
      if (params.action === 'list') {
        if (params.entryId !== undefined || params.offset !== undefined) throw new Error('Cuckoo list does not accept entryId or offset; use before for pagination');
        request = { action: 'list', scope, before: params.before, limit: params.limit === undefined ? DEFAULT_LIST_ITEMS : params.limit };
      } else {
        if (params.entryId === undefined) throw new Error('Cuckoo read requires entryId from list');
        if (params.before !== undefined) throw new Error('Cuckoo read does not accept before; use offset for pagination');
        request = { action: 'read', scope, entryId: params.entryId, offset: params.offset === undefined ? 0 : params.offset, limit: params.limit === undefined ? DEFAULT_READ_CHARS : params.limit };
      }
      const result = recallRounds(ctx.sessionManager.getEntries(), ctx.sessionManager.getBranch(), request);
      const details = { sessionId: ctx.sessionManager.getSessionId(), notice: RECALL_NOTICE, ...result };
      const text = JSON.stringify(details);
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Cuckoo recall metadata exceeds the response size limit; no partial result returned');
      return { content: [{ type: 'text', text }], details };
    },
  });
  pi.registerCommand('cuckoo', {
    description: 'Objectives and progress checkpoints; comments, questions',
    getArgumentCompletions: completeCuckooArguments,
    handler: async (args, ctx) => {
      try {
        const trimmed = args.trim();
        const workflow = workflows.find(item => trimmed === item.name || trimmed.startsWith(`${item.name} `));
        if (workflow !== undefined) {
          try { await workflow.runtime.command(trimmed.slice(workflow.name.length).trim(), ctx); }
          catch (error) { ctx.ui.notify(terminalText(`Cuckoo ${workflow.name}: ${String(error)}`), 'error'); }
          return;
        }
        const questionWords = /^(?:(default|project)\s+)?questions(?:\s+(.*))?$/s.exec(trimmed);
        if (questionWords !== null) {
          const target: QuestionScope | null = questionWords[1] === 'project' ? 'project' : questionWords[1] === 'default' ? 'global' : null;
          try { await questionsCommand(ctx, target, questionWords[2] === undefined ? '' : questionWords[2].trim()); }
          catch (error) { ctx.ui.notify(terminalText(`Cuckoo questions: ${String(error)}`), 'error'); }
          return;
        }
        if (trimmed === 'settings') {
          await settingsView.show(ctx, bindSettingsCallbacks(configuration, ctx, async request => {
            const kind = await ctx.ui.select(`Cuckoo ${request.scope} policy kind (current: ${request.value.kind})`, ['relative', 'window', 'tokens'], { signal: request.signal });
            if (kind === undefined || request.signal.aborted) return undefined;
            const value = await ctx.ui.input(`Cuckoo ${kind} value (current: ${request.value.value})`, 'Enter a positive number', { signal: request.signal });
            if (value === undefined || request.signal.aborted) return undefined;
            if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) throw new Error('Policy value must be a positive number');
            return validatePolicy({ kind, value: Number(value) });
          }, () => refresh(ctx)));
          return;
        }
        if (trimmed.split(/\s+/).join(' ') === 'inquire now') { inquire(ctx); return; }
        if (trimmed === '' || trimmed === 'reports' || trimmed === 'status') {
          const reports = checkpoints(ctx.sessionManager.getBranch());
          await view.showReports(ctx, reports, statusIntro(ctx, reports)); return;
        }
        if (trimmed === 'history') { await view.showHistory(ctx, ctx.sessionManager.getEntries(), ctx.sessionManager.getBranch()); return; }
        const signal = ctx.signal ?? new AbortController().signal;
        const toggle = parseToggleCommand(trimmed);
        if (toggle !== null && toggle.kind !== 'status') {
          configuration.apply(ctx, toggle.kind === 'session' ? 'session' : 'global', [{ field: 'enabled', value: toggle.enabled }], signal);
        } else {
          const words = trimmed.split(/\s+/);
          const scope: PreferenceScope = words[0] === 'default' ? 'global' : words[0] === 'project' ? 'project' : 'session';
          if (scope !== 'session') words.shift();
          if (scope === 'project' && words.length === 1 && ['on', 'off', 'inherit'].includes(words[0])) {
            configuration.apply(ctx, scope, [{ field: 'enabled', value: words[0] === 'inherit' ? null : words[0] === 'on' }], signal);
          } else if (words[0] === 'feature' && words.length === 3 && ['on', 'off', 'inherit'].includes(words[2])) {
            configuration.apply(ctx, scope, [{ field: 'feature', id: featureId(words[1]), value: words[2] === 'inherit' ? null : words[2] === 'on' }], signal);
          } else {
            if (words[0] === 'threshold' && words.length === 2) words.splice(0, words.length, 'policy', ...(words[1] === 'inherit' ? ['inherit'] : ['relative', words[1]]));
            if (scope !== 'global' && words.length === 2 && words[0] === 'policy' && words[1] === 'inherit') configuration.apply(ctx, scope, [{ field: 'policy', value: null }], signal);
            else {
              if (words.length !== 3 || words[0] !== 'policy' || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(words[2])) throw new Error('Usage: /cuckoo [default|project] feature NAME on|off|inherit, or [default|project] policy relative PERCENT|window PERCENT|tokens COUNT; policy inherit');
              configuration.apply(ctx, scope, [{ field: 'policy', value: validatePolicy({ kind: words[1], value: Number(words[2]) }) }], signal);
            }
          }
        }
        refresh(ctx); ctx.ui.notify(terminalText(status(ctx).plain), 'info');
      } catch (error) { warn(ctx, error); }
    },
  });
  pi.registerShortcut(REPORTS_SHORTCUT.key, { description: 'View Cuckoo objectives and progress', handler: async ctx => {
    try {
      const reports = checkpoints(ctx.sessionManager.getBranch());
      await view.showReports(ctx, reports, statusIntro(ctx, reports));
    } catch (error) { warn(ctx, error); }
  } });
  pi.on('session_start', (_event, ctx) => {
    features.start(ctx);
    settingsView.dispose(); settingsView = new CuckooSettingsView();
    manualRequested = false;
    view = new CuckooView(inquire, commentHost);
    try { cancel(ctx, 'Checkpoint interrupted by reload or session replacement; no automatic retry'); } catch (error) { warn(ctx, error); }
    refresh(ctx);
  });
  pi.on('session_tree', (_event, ctx) => {
    settingsView.dispose(); settingsView = new CuckooSettingsView();
    try { features.navigate(ctx); cancel(ctx, 'Checkpoint interrupted by branch navigation; no automatic retry'); } catch (error) { warn(ctx, error); }
    refresh(ctx);
  });
  pi.on('before_agent_start', (event, ctx) => {
    let scheduling: string;
    try {
      const config = features.refresh(ctx);
      scheduling = `Automatic inquiries at run start: ${config.enabled ? 'ON' : 'OFF'}; policy: ${policyText(config.policy)}.`;
    } catch (error) { warn(ctx, error); scheduling = 'Automatic inquiry configuration unavailable due to invalid settings; saved rounds remain readable.'; }
    event.systemPromptOptions.sections.cuckoo = `${scheduling}\n${MODEL_GUIDANCE}`;
    if (event.messageType === 'user') {
      try { cancel(ctx, 'Checkpoint superseded by a new user prompt'); } catch (error) { warn(ctx, error); }
      try { critic.ordinaryRunStart(ctx); }
      catch (error) { ctx.ui.notify(terminalText(`Cuckoo critic unavailable: ${String(error)}`), 'error'); }
    }
    // Comments saved while no boundary or idle point could take them (compaction, reload) join this run's first request.
    try {
      const message = pendingDelivery(ctx);
      if (message !== null) return { message };
    } catch (error) { commentFault(ctx, error); }
  });
  pi.on('message_start', (event, ctx) => {
    if (event.message.role === 'user') {
      try { cancel(ctx, 'Checkpoint superseded by delivered user input'); } catch (error) { warn(ctx, error); }
    }
  });
  pi.on('context', (event, ctx) => {
    const closed = new Set(checkpoints(ctx.sessionManager.getBranch()).map(report => report.requestId));
    return { messages: event.messages.map(message => {
      if (message.role !== 'custom' || message.customType !== INQUIRY_TYPE) return message;
      const details: unknown = message.details;
      if (typeof details !== 'object' || details === null || !('requestId' in details) || typeof details.requestId !== 'string' || !closed.has(details.requestId)) return message;
      return { ...message, content: 'This Cuckoo checkpoint is closed or cancelled. Its historical inquiry is no longer active; follow the current user task.' };
    }) };
  });
  pi.on('tool_call', (_event, ctx) => {
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    if (state !== null && state.pending !== null) return { block: true, reason: 'Tool execution is not permitted during a Cuckoo checkpoint.' };
  });
  /** Checkpoint capture, resumption and scheduling at one turn boundary; `base` is the drafts every result starts with. */
  function cadenceBoundary(event: TurnEndEvent, ctx: ExtensionContext, completed: boolean, base: readonly SessionBoundaryDraft[]): BoundaryResult | undefined {
    const branch = ctx.sessionManager.getBranch();
    const previous = stateOnBranch(branch);
    if (previous !== null && previous.pending !== null) {
      const message = event.message;
      if (message.role !== 'assistant') throw new Error('Cuckoo turn boundary must carry an assistant response');
      const raw = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const result = answeredCheckpoint(previous.pending.requestId, raw, previous.pending.questions);
      if (!completed || message.stopReason !== 'stop' || message.content.some(part => part.type === 'toolCall')) {
        result.report = null; result.error = 'Checkpoint response interrupted, failed, or attempted tool use; no retry';
      }
      const resume = completed && (previous.pending.resume || message.content.some(part => part.type === 'toolCall'));
      const entries: SessionBoundaryDraft[] = [...base,
        { type: 'custom', customType: REPORT_TYPE, data: { ...result, messageEntryId: event.messageEntryId, content: message.content } },
        stateDraft({ ...previous, pending: null, resuming: resume })];
      if (result.error !== null) ctx.ui.notify(ctx.mode === 'tui' ? 'Cuckoo: invalid checkpoint; raw response preserved in /cuckoo history' :
        terminalText(`Cuckoo: ${result.error}; raw response preserved`), 'warning');
      if (resume) entries.push({ type: 'custom_message', customType: RESUME_TYPE, content: RESUME, display: false });
      return { entries, ...(resume ? { continue: true } : {}) };
    }
    if (previous !== null && previous.resuming) return { entries: [...base, stateDraft({ ...previous, resuming: false })] };
    if (!completed) return;
    const config = features.refresh(ctx);
    if (!config.enabled && !manualRequested) { refresh(ctx); return; }
    if (event.context.pendingMessages.length > 0 || event.entries.some(entry => entry.type === 'compaction' || entry.type === 'context_edit' || entry.type === 'custom_message')) return;
    const usage = ctx.getContextUsage();
    if (usage === undefined || usage.tokens === null || !Number.isFinite(usage.tokens) || usage.tokens <= 0) return;
    const model = `${ctx.model === undefined ? 'unknown' : `${ctx.model.provider}:${ctx.model.id}`}:${usage.contextWindow}`;
    const state = observe(previous, usage.tokens, model);
    if (!manualRequested && !inquiryDue(state, config.policy, usage.contextWindow)) return { entries: [...base, stateDraft(state)] };
    const asked = standing.read(ctx).effective;
    const reportedComplete = completedObjectives(checkpoints(branch));
    manualRequested = false;
    const requestId = randomUUID();
    const resume = (event.message.role === 'assistant' && (event.message.stopReason === 'toolUse' || event.message.content.some(part => part.type === 'toolCall'))) || event.continue;
    return { entries: [...base,
      stateDraft({ ...state, baseline: usage.tokens, pending: { requestId, resume, questions: asked }, resuming: false }),
      { type: 'custom_message', customType: INQUIRY_TYPE, content: inquiryText(asked, reportedComplete), display: false, details: { version: 1, requestId, tokens: usage.tokens } }], continue: true };
  }
  pi.on('turn_end', (event: TurnEndEvent, ctx) => {
    try { event.entries.push(...critic.ordinaryBoundary(event, ctx)); }
    catch (error) { ctx.ui.notify(terminalText(`Cuckoo critic unavailable: ${String(error)}`), 'error'); }
    const completed = event.outcome === 'completed' && !(ctx.signal !== undefined && ctx.signal.aborted);
    // Comments precede every Cuckoo draft of this boundary, so an inquiry issued here is asked after them.
    const base: SessionBoundaryDraft[] = [...event.entries];
    if (completed) {
      try {
        const message = pendingDelivery(ctx);
        if (message !== null) base.push({ type: 'custom_message', ...message });
      } catch (error) { commentFault(ctx, error); }
    }
    let result: BoundaryResult | undefined;
    try { result = cadenceBoundary(event, ctx, completed, base); } catch (error) { warn(ctx, error); }
    return result === undefined && base.length > event.entries.length ? { entries: base } : result;
  });
  pi.on('agent_settled', (event, ctx) => {
    if (manualRequested) {
      manualRequested = false;
      ctx.ui.notify('Cuckoo: queued inquiry could not reach a safe boundary; no automatic retry', 'warning');
    }
    if (event.aborted) { try { cancel(ctx, 'Checkpoint aborted; no automatic retry'); } catch (error) { warn(ctx, error); } }
    try { deliverComments(ctx); } catch (error) { commentFault(ctx, error); }
    refresh(ctx);
  });
  pi.on('turn_start', (_event, ctx) => refresh(ctx));
  // Closing the report panel saves its comments; that must not depend on the other disposals succeeding.
  pi.on('session_shutdown', (_event, ctx) => { try { view.dispose(ctx); } finally { settingsView.dispose(); features.shutdown(); } });
}
export default function (pi: ExtensionAPI): void {
  const display = { showJson: false };
  const captured = new Set<string>();
  const registerDisplay = (liveCheckpoint: boolean) => {
    // Pi snapshots this transformer at component creation; its live decision survives later turns and redraws.
    pi.registerMarkdownTransformer((text, { messageId }) =>
      !display.showJson && (messageId === undefined ? liveCheckpoint : captured.has(messageId)) ? '🐦 Updating cuckoo status ...' : text,
    { messageTypes: ['assistant'] });
  };
  registerDisplay(false);
  // Replay visits custom entries before rendering Markdown, even when /reload rebuilds before session_start.
  pi.registerEntryRenderer<{ messageEntryId?: string }>(REPORT_TYPE, entry => {
    if (typeof entry.data?.messageEntryId === 'string') captured.add(entry.data.messageEntryId);
    return undefined;
  });
  pi.on('message_start', (event, ctx) => {
    if (event.message.role !== 'assistant') return;
    const branch = ctx.sessionManager.getBranch();
    // Pi can append auxiliary custom context after the inquiry in the same dispatch.
    const input = branch.findLast(entry => entry.type === 'custom_message' ? entry.customType === INQUIRY_TYPE :
      entry.type === 'message' && entry.message.role !== 'system');
    const details = input?.type === 'custom_message' && input.customType === INQUIRY_TYPE ? input.details : undefined;
    registerDisplay(typeof details === 'object' && details !== null && 'requestId' in details &&
      typeof details.requestId === 'string' && details.requestId === stateOnBranch(branch)?.pending?.requestId);
  });
  const agentDir = getAgentDir();
  registerCuckoo(pi, new FilePreferenceStore(join(agentDir, 'cuckoo.json')), new FileQuestionStore(join(agentDir, QUESTIONS_FILE)), nativeNetworkServices(agentDir), display);
}
