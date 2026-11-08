import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft, type TurnEndEvent } from '@earendil-works/pi-coding-agent';
import { parseToggleCommand, sessionEnabledData, TOGGLE_ARGUMENTS } from '@ponygirls/pi-settings';
import { ENABLED_TYPE, THRESHOLD_TYPE, FilePreferenceStore, effectivePreferences, validateThresholdPercent, type PreferenceStore } from './src/preferences.ts';
import { REPORT_TYPE, checkpoint, checkpoints, reportText } from './src/report.ts';
import { INQUIRY, INQUIRY_TYPE, RESUME, RESUME_TYPE, STATE_TYPE, inquiryDue, observe, stateOnBranch, type State } from './src/state.ts';
import { CuckooView, terminalText } from './src/view.ts';

export function registerCuckoo(pi: ExtensionAPI, preferences: PreferenceStore): void {
  let view = new CuckooView();
  let fault: string | null = null;
  const stateDraft = (state: State): SessionBoundaryDraft => ({ type: 'custom', customType: STATE_TYPE, data: state });
  function warn(ctx: ExtensionContext, error: unknown): void {
    const message = String(error);
    if (fault !== message) ctx.ui.notify(terminalText(`Cuckoo: ${message}; automatic inquiries stopped`), 'error');
    fault = message;
  }
  function refresh(ctx: ExtensionContext): void {
    try {
      const config = effectivePreferences(preferences.read(), ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId());
      const reports = checkpoints(ctx.sessionManager.getBranch());
      stateOnBranch(ctx.sessionManager.getBranch());
      fault = null; view.publish(ctx, reports, config.enabled, null);
    } catch (error) { warn(ctx, error); view.publish(ctx, [], false, fault); }
  }
  function status(ctx: ExtensionContext): string {
    const config = effectivePreferences(preferences.read(), ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId());
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    const next = state === null ? 'waiting for first known context usage' : `${state.baseline + Math.ceil(state.baseline * config.thresholdPercent / 100)} tokens (baseline ${state.baseline})`;
    return `Cuckoo: ${config.enabled ? 'ON' : 'OFF'} (${config.enabledSource})\n` +
      `Relative context growth: ${config.thresholdPercent}% (${config.thresholdSource}); next inquiry: ${next}.\n` +
      `Pending checkpoint: ${state?.pending === null || state === null ? 'none' : state.pending.requestId}.\n` +
      `Global defaults: ${preferences.path}\n\n${reportText(checkpoints(ctx.sessionManager.getBranch()))}`;
  }
  function cancel(ctx: ExtensionContext, reason: string): void {
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    if (state === null || (state.pending === null && !state.resuming)) return;
    if (state.pending !== null) {
      pi.appendEntry(REPORT_TYPE, { ...checkpoint(state.pending.requestId, ''), error: reason });
    }
    pi.appendEntry(STATE_TYPE, { ...state, pending: null, resuming: false });
  }
  pi.registerCommand('cuckoo', {
    description: 'Show objectives/progress; on|off|inherit|default on|default off|threshold PERCENT|threshold inherit|default threshold PERCENT|status',
    getArgumentCompletions: prefix => [...TOGGLE_ARGUMENTS, 'threshold 15', 'threshold inherit', 'default threshold 15'].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      try {
        const trimmed = args.trim();
        if (trimmed === '' || trimmed === 'reports' || trimmed === 'status') { await view.show(ctx, status(ctx)); return; }
        const toggle = parseToggleCommand(trimmed);
        if (toggle !== null && toggle.kind !== 'status') {
          if (toggle.kind === 'session') pi.appendEntry(ENABLED_TYPE, sessionEnabledData(ctx.sessionManager.getSessionId(), toggle.enabled));
          else preferences.write({ ...preferences.read(), enabled: toggle.enabled });
        } else {
          const words = trimmed.split(/\s+/); const global = words[0] === 'default';
          if (global) words.shift();
          if (words.length !== 2 || words[0] !== 'threshold') throw new Error('Usage: /cuckoo [on|off|inherit|default on|default off|[default] threshold PERCENT|threshold inherit|status]');
          const value = words[1];
          if (value === 'inherit' && !global) pi.appendEntry(THRESHOLD_TYPE, { version: 1, sessionId: ctx.sessionManager.getSessionId(), thresholdPercent: null });
          else {
            if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error('Expected a numeric relative-growth percentage');
            const thresholdPercent = validateThresholdPercent(Number(value));
            if (global) preferences.write({ ...preferences.read(), thresholdPercent });
            else pi.appendEntry(THRESHOLD_TYPE, { version: 1, sessionId: ctx.sessionManager.getSessionId(), thresholdPercent });
          }
        }
        refresh(ctx); ctx.ui.notify(terminalText(status(ctx)), 'info');
      } catch (error) { warn(ctx, error); }
    },
  });
  pi.registerShortcut('ctrl+alt+c', { description: 'View Cuckoo objectives and progress', handler: async ctx => {
    try { await view.show(ctx, status(ctx)); } catch (error) { warn(ctx, error); }
  } });
  pi.on('session_start', (_event, ctx) => {
    view = new CuckooView();
    try { cancel(ctx, 'Checkpoint interrupted by reload or session replacement; no automatic retry'); } catch (error) { warn(ctx, error); }
    refresh(ctx);
  });
  pi.on('session_tree', (_event, ctx) => {
    try { cancel(ctx, 'Checkpoint interrupted by branch navigation; no automatic retry'); } catch (error) { warn(ctx, error); }
    refresh(ctx);
  });
  pi.on('before_agent_start', (event, ctx) => {
    if (event.messageType === 'user') {
      try { cancel(ctx, 'Checkpoint superseded by a new user prompt'); } catch (error) { warn(ctx, error); }
    }
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
    if (state !== null && state.pending !== null) return { block: true, reason: 'Cuckoo checkpoint requires JSON only; tool execution is not permitted for this response.' };
  });
  pi.on('turn_end', (event: TurnEndEvent, ctx) => {
    try {
      const branch = ctx.sessionManager.getBranch();
      const previous = stateOnBranch(branch);
      const completed = event.outcome === 'completed' && !(ctx.signal !== undefined && ctx.signal.aborted);
      if (previous !== null && previous.pending !== null) {
        const message = event.message;
        if (message.role !== 'assistant') throw new Error('Cuckoo turn boundary must carry an assistant response');
        const raw = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        const result = checkpoint(previous.pending.requestId, raw);
        if (!completed || message.stopReason !== 'stop' || message.content.some(part => part.type === 'toolCall')) {
          result.report = null; result.error = 'Checkpoint response interrupted, failed, or attempted tool use; no retry';
        }
        const resume = completed && (previous.pending.resume || message.content.some(part => part.type === 'toolCall'));
        const entries: SessionBoundaryDraft[] = [...event.entries,
          { type: 'custom', customType: REPORT_TYPE, data: { ...result, messageEntryId: event.messageEntryId, content: message.content } },
          stateDraft({ ...previous, pending: null, resuming: resume })];
        if (result.error !== null) ctx.ui.notify(terminalText(`Cuckoo: ${result.error}; raw response preserved`), 'warning');
        if (resume) entries.push({ type: 'custom_message', customType: RESUME_TYPE, content: RESUME, display: false });
        return { entries, ...(resume ? { continue: true } : {}) };
      }
      if (previous !== null && previous.resuming) return { entries: [...event.entries, stateDraft({ ...previous, resuming: false })] };
      if (!completed) return;
      const config = effectivePreferences(preferences.read(), ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId());
      if (!config.enabled) { refresh(ctx); return; }
      if (event.context.pendingMessages.length > 0 || event.entries.some(entry => entry.type === 'compaction' || entry.type === 'context_edit' || entry.type === 'custom_message')) return;
      const usage = ctx.getContextUsage();
      if (usage === undefined || usage.tokens === null || !Number.isFinite(usage.tokens) || usage.tokens <= 0) return;
      const model = `${ctx.model === undefined ? 'unknown' : `${ctx.model.provider}:${ctx.model.id}`}:${usage.contextWindow}`;
      const state = observe(previous, usage.tokens, model);
      if (!inquiryDue(state, config.thresholdPercent)) return { entries: [...event.entries, stateDraft(state)] };
      const requestId = randomUUID();
      const resume = (event.message.role === 'assistant' && (event.message.stopReason === 'toolUse' || event.message.content.some(part => part.type === 'toolCall'))) || event.continue;
      return { entries: [...event.entries,
        stateDraft({ ...state, baseline: usage.tokens, pending: { requestId, resume }, resuming: false }),
        { type: 'custom_message', customType: INQUIRY_TYPE, content: INQUIRY, display: false, details: { version: 1, requestId, tokens: usage.tokens } }], continue: true };
    } catch (error) { warn(ctx, error); }
  });
  pi.on('agent_settled', (event, ctx) => {
    if (event.aborted) { try { cancel(ctx, 'Checkpoint aborted; no automatic retry'); } catch (error) { warn(ctx, error); } }
    refresh(ctx);
  });
  pi.on('turn_start', (_event, ctx) => refresh(ctx));
  pi.on('session_shutdown', (_event, ctx) => view.dispose(ctx));
}
export default function (pi: ExtensionAPI): void { registerCuckoo(pi, new FilePreferenceStore(join(getAgentDir(), 'cuckoo.json'))); }
