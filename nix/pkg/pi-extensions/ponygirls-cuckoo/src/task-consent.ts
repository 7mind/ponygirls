import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CuckooFeatures } from './feature-runtime.ts';
import { NativeMemoryPort } from './memory-runtime.ts';
import { readMemory, resolveSource } from './memory-core.ts';
import { projectStates } from './memory-projection.ts';
import type { RecordStatus, SnapshotRecord, SourceResolution, TextDigest } from './memory-types.ts';
import { confirmOperatorAction, operatorDisplay, previewOperatorText, requireOperatorUI } from './operator-ui.ts';

export type NetworkFeature = 'vectors' | 'critic';
export const TASK_CONSENT_TYPE = 'cuckoo.task-consent';
export const TASK_CONSENT_POLICY = 'operator-approved-task-snapshots-v1';
export const TASK_CONSENT_TTL_MS = 30 * 60 * 1000;
export const TASK_SNAPSHOT_LIMIT = 128;
export const TASK_TEXT_LIMIT_BYTES = 1000000;
export const TASK_NATIVE_ENTRY_LIMIT = 100000;
export const TASK_MEMORY_RECORD_LIMIT = 10000;
export const TASK_OPERATION_LIMITS: Readonly<Record<NetworkFeature, number>> = Object.freeze({ vectors: 256, critic: 32 });

export interface TaskModelBinding {
  readonly id: string;
  readonly label: string;
  readonly destination: string;
  readonly digest: TextDigest;
}
export interface TaskConsent {
  readonly version: 1;
  readonly id: string;
  readonly feature: NetworkFeature;
  readonly taskId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly scopeKey: string;
  readonly binding: TaskModelBinding;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly maxOperations: number;
  readonly policyId: typeof TASK_CONSENT_POLICY;
}
export interface TaskSnapshot {
  readonly record: SnapshotRecord;
  readonly status: RecordStatus;
  readonly sourceStatus: SourceResolution['status'];
}
export interface TaskData {
  readonly consent: TaskConsent;
  readonly label: string;
  readonly snapshots: readonly TaskSnapshot[];
}
export interface TaskOperationPermit {
  readonly id: string;
  readonly consentId: string;
  readonly feature: NetworkFeature;
  readonly signal: AbortSignal;
}
interface LiveConsent {
  readonly consent: TaskConsent;
  readonly abort: AbortController;
  readonly elapsedDeadline: number;
  used: number;
}
interface ScopeToken {
  readonly key: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}
interface TaskContents { readonly label: string; readonly snapshots: readonly TaskSnapshot[] }

function identifier(value: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0 || value.length > maximum) throw new Error('Invalid task consent identity');
  return value;
}
function bindingCopy(value: TaskModelBinding): TaskModelBinding {
  if (!/^sha256-utf16le:[a-f0-9]{64}$/.test(value.digest)) throw new Error('Invalid model configuration digest');
  return Object.freeze({ id: identifier(value.id, 512), label: identifier(value.label, 512),
    destination: identifier(value.destination, 4096), digest: value.digest });
}
function sameBinding(left: TaskModelBinding, right: TaskModelBinding): boolean {
  return left.id === right.id && left.label === right.label && left.destination === right.destination && left.digest === right.digest;
}

/** Live authority is held here, never inferred from a checkbox, task label or old receipt. */
export class CuckooTaskConsents {
  private readonly pi: ExtensionAPI;
  private readonly features: CuckooFeatures;
  private readonly clock: () => number;
  private readonly elapsedClock: () => number;
  private lastElapsed: number | null = null;
  private readonly newId: () => string;
  private readonly projectId: (cwd: string) => string;
  private readonly slots = new Map<NetworkFeature, LiveConsent>();
  private readonly permits = new Map<string, TaskOperationPermit>();
  private parentSignal: AbortSignal | null = null;
  private parentAbort: (() => void) | null = null;
  private boundKey: string | null = null;
  private boundProject: string | null = null;
  private approval: { feature: NetworkFeature; abort: AbortController } | null = null;
  private busy = false;

  constructor(pi: ExtensionAPI, features: CuckooFeatures, clock: () => number, newId: () => string, projectId: (cwd: string) => string, elapsedClock: () => number) {
    this.pi = pi; this.features = features; this.clock = clock; this.newId = newId; this.projectId = projectId; this.elapsedClock = elapsedClock;
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value + TASK_CONSENT_TTL_MS).getTime())) throw new Error('Task consent clock is unavailable');
    return value;
  }

  private elapsed(): number {
    const value = this.elapsedClock();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - TASK_CONSENT_TTL_MS || (this.lastElapsed !== null && value < this.lastElapsed)) {
      this.retire(); throw new Error('Task consent monotonic clock is unavailable');
    }
    this.lastElapsed = value;
    return value;
  }

  private remove(feature: NetworkFeature): void {
    const slot = this.slots.get(feature);
    if (slot !== undefined) {
      this.slots.delete(feature);
      for (const [id, permit] of this.permits) if (permit.consentId === slot.consent.id) this.permits.delete(id);
      slot.abort.abort();
    }
  }

  private retire(): void {
    const slots = [...this.slots.values()]; const approval = this.approval;
    this.slots.clear(); this.permits.clear(); this.approval = null;
    if (this.parentSignal !== null && this.parentAbort !== null) this.parentSignal.removeEventListener('abort', this.parentAbort);
    this.parentSignal = null; this.parentAbort = null; this.boundKey = null; this.boundProject = null;
    for (const slot of slots) slot.abort.abort();
    if (approval !== null) approval.abort.abort();
  }

  private synchronize(ctx: ExtensionContext, feature: NetworkFeature): ScopeToken {
    this.features.requireEnabledFeature(ctx, feature);
    const key = this.features.scopeKey(ctx), signal = this.features.signal(ctx);
    const projectId = identifier(this.projectId(ctx.cwd), 128);
    if (key !== this.boundKey || projectId !== this.boundProject || signal !== this.parentSignal) {
      this.retire();
      if (this.parentSignal !== null && this.parentAbort !== null) this.parentSignal.removeEventListener('abort', this.parentAbort);
      this.boundKey = key; this.boundProject = projectId; this.parentSignal = signal;
      this.parentAbort = () => this.retire(); signal.addEventListener('abort', this.parentAbort, { once: true });
    }
    if (signal.aborted) { this.retire(); throw new Error('Task consent scope cancelled'); }
    const now = this.now(); const elapsed = this.elapsed();
    for (const [kind, slot] of this.slots) {
      if (now < slot.consent.approvedAt || now >= slot.consent.expiresAt || elapsed >= slot.elapsedDeadline) this.remove(kind);
    }
    return { key, projectId, sessionId: ctx.sessionManager.getSessionId(), signal };
  }

  private assertScope(ctx: ExtensionContext, feature: NetworkFeature, token: ScopeToken): void {
    const current = this.synchronize(ctx, feature);
    if (token.signal.aborted || current.key !== token.key || current.projectId !== token.projectId || current.sessionId !== token.sessionId) throw new Error('Task consent scope changed; no automatic approval or retry');
  }

  private records(ctx: ExtensionContext) {
    const view = new NativeMemoryPort(this.pi, ctx.sessionManager).view();
    if (view.entries.length > TASK_NATIVE_ENTRY_LIMIT || view.branch.length > TASK_NATIVE_ENTRY_LIMIT) throw new Error('Native session exceeds task consent entry bound');
    const records = readMemory(view, 'branch');
    if (records.length > TASK_MEMORY_RECORD_LIMIT) throw new Error('Native memory exceeds task consent record bound');
    return { view, records };
  }

  private contents(ctx: ExtensionContext, taskId: string): TaskContents {
    const { view, records } = this.records(ctx);
    const task = records.find(item => item.record.kind === 'task' && item.record.id === taskId);
    if (task === undefined || task.record.kind !== 'task') throw new Error('Approved task is not present on the current branch');
    const selected = records.filter(item => item.record.taskId === taskId);
    const snapshots = selected.flatMap(item => item.record.kind === 'snapshot' ? [item.record] : []);
    if (snapshots.length > TASK_SNAPSHOT_LIMIT || snapshots.reduce((sum, record) => sum + Buffer.byteLength(record.text, 'utf8'), 0) > TASK_TEXT_LIMIT_BYTES) throw new Error('Approved task exceeds snapshot inventory/text bounds; no partial inventory');
    const sources = snapshots.map(record => ({ id: record.id, status: resolveSource(view, record.source, 'branch').status }));
    const states = new Map(projectStates(selected, sources).map(state => [state.id, state]));
    return { label: task.record.label, snapshots: Object.freeze(snapshots.map((record, index) => {
      const state = states.get(record.id);
      if (state === undefined) throw new Error('Task snapshot projection is missing');
      return Object.freeze({ record, status: state.status, sourceStatus: sources[index].status });
    })) };
  }

  current(ctx: ExtensionContext, feature: NetworkFeature): TaskConsent | null {
    this.synchronize(ctx, feature);
    const slot = this.slots.get(feature);
    return slot === undefined ? null : slot.consent;
  }

  data(ctx: ExtensionContext, feature: NetworkFeature, binding: TaskModelBinding): TaskData {
    const consent = this.current(ctx, feature);
    if (consent === null) throw new Error('Task disclosure approval required');
    if (!sameBinding(consent.binding, bindingCopy(binding))) { this.remove(feature); throw new Error('Approved model configuration changed; approval revoked'); }
    return { consent, ...this.contents(ctx, consent.taskId) };
  }

  reserve(ctx: ExtensionContext, feature: NetworkFeature, binding: TaskModelBinding): TaskOperationPermit {
    this.features.requireOrdinaryWork(ctx);
    const data = this.data(ctx, feature, binding);
    const slot = this.slots.get(feature);
    if (slot === undefined || slot.consent !== data.consent) throw new Error('Task consent changed during admission');
    if (slot.used >= slot.consent.maxOperations) throw new Error('Task operation limit reached; explicit approval renewal required');
    const id = identifier(this.newId(), 128);
    if (this.permits.has(id)) throw new Error('Duplicate task operation identity');
    const permit = Object.freeze({ id, consentId: data.consent.id, feature, signal: slot.abort.signal });
    slot.used++; this.permits.set(id, permit);
    return permit;
  }

  check(ctx: ExtensionContext, permit: TaskOperationPermit, binding: TaskModelBinding): TaskData {
    const data = this.data(ctx, permit.feature, binding);
    if (this.permits.get(permit.id) !== permit || permit.signal.aborted || permit.consentId !== data.consent.id) throw new Error('Task operation permit is no longer valid');
    return data;
  }

  remaining(ctx: ExtensionContext, feature: NetworkFeature): number {
    this.synchronize(ctx, feature);
    const slot = this.slots.get(feature);
    return slot === undefined ? 0 : slot.consent.maxOperations - slot.used;
  }

  private receipt(ctx: ExtensionContext, kind: 'approved' | 'revoked', consent: TaskConsent): void {
    const id = identifier(this.newId(), 128);
    const before = new Set(ctx.sessionManager.getEntries().map(entry => entry.id));
    const data = { version: 1, id, kind, consentId: consent.id, feature: consent.feature,
      taskId: consent.taskId, projectId: consent.projectId, sessionId: consent.sessionId,
      bindingId: consent.binding.id, bindingDigest: consent.binding.digest, policyId: consent.policyId,
      approvedAt: consent.approvedAt, expiresAt: consent.expiresAt, maxOperations: consent.maxOperations,
      scope: 'runtime-only; receipt does not restore authorization' };
    this.pi.appendEntry(TASK_CONSENT_TYPE, data);
    const observed = ctx.sessionManager.getEntries().filter(entry => !before.has(entry.id) && entry.type === 'custom' && entry.customType === TASK_CONSENT_TYPE &&
      typeof entry.data === 'object' && entry.data !== null && 'id' in entry.data && entry.data.id === id);
    if (observed.length !== 1) throw new Error('Task consent receipt identity was not observed exactly once');
  }

  revoke(ctx: ExtensionContext, feature: NetworkFeature): void {
    const slot = this.slots.get(feature); this.remove(feature);
    if (this.approval !== null && this.approval.feature === feature) this.approval.abort.abort();
    if (slot !== undefined && ctx.sessionManager.getSessionId() === slot.consent.sessionId) this.receipt(ctx, 'revoked', slot.consent);
  }

  async approve(ctx: ExtensionContext, feature: NetworkFeature, bindings: () => readonly TaskModelBinding[]): Promise<TaskConsent | null> {
    requireOperatorUI(ctx); this.features.requireOrdinaryWork(ctx);
    if (this.busy) throw new Error('A task consent dialog is already active');
    this.busy = true;
    const operation = { feature, abort: new AbortController() };
    try {
      const scope = this.synchronize(ctx, feature);
      this.approval = operation;
      const signal = AbortSignal.any([scope.signal, operation.abort.signal]);
      const token = { ...scope, signal };
      const tasks = this.records(ctx).records.filter(item => item.record.kind === 'task');
      if (tasks.length === 0) throw new Error('Create a current-branch memory task before approving disclosure');
      const taskChoices = tasks.map(item => `${item.record.id} ${operatorDisplay(item.record.kind === 'task' ? item.record.label : '')}`);
      const selectedTask = await ctx.ui.select(`Approve ${feature}: select a task ID`, taskChoices, { signal });
      this.assertScope(ctx, feature, token);
      if (selectedTask === undefined) return null;
      const taskIndex = taskChoices.indexOf(selectedTask);
      if (taskIndex < 0) throw new Error('Invalid task selection');
      const taskId = tasks[taskIndex].record.id;
      const choices = bindings().map(bindingCopy);
      if (choices.length === 0 || choices.length > 1000 || new Set(choices.map(item => item.id)).size !== choices.length) throw new Error('No bounded unambiguous configured model selection available');
      const labels = choices.map(item => `${operatorDisplay(item.id)} ${operatorDisplay(item.label)}`);
      const selectedModel = await ctx.ui.select(`Approve ${feature}: select configured model`, labels, { signal });
      this.assertScope(ctx, feature, token);
      if (selectedModel === undefined) return null;
      const index = labels.indexOf(selectedModel);
      if (index < 0) throw new Error('Invalid model selection');
      const binding = choices[index];
      const requireBinding = (): void => {
        const current = bindings().find(item => item.id === binding.id);
        if (current === undefined || !sameBinding(binding, bindingCopy(current))) throw new Error('Model configuration changed while approval was open');
      };
      requireBinding();
      const contents = this.contents(ctx, taskId);
      const policy = `Approve visible transcript snapshots assigned to task ID ${taskId}, including snapshots added while this dialog is open and later during this lease. ` +
        (feature === 'vectors' ? 'Also approve bounded model-written search query text for this task. ' : 'Only selected task snapshots are sent to the tool-free critic. ') +
        'Task labels and future assignments are model-authored, not proof of semantic scope. No ambient, system, developer or hidden-reasoning blocks are harvested. The checkbox alone grants nothing.';
      const preview = JSON.stringify({ policy, taskId, taskLabel: contents.label, binding,
        maxSnapshots: TASK_SNAPSHOT_LIMIT, maxTextBytes: TASK_TEXT_LIMIT_BYTES,
        snapshots: contents.snapshots.map(item => ({ id: item.record.id, purpose: item.record.purpose, status: item.status, sourceStatus: item.sourceStatus, digest: item.record.digest, text: item.record.text })) });
      if (!await previewOperatorText(ctx, `Review ${feature} task disclosure`, preview, signal)) return null;
      this.assertScope(ctx, feature, token); requireBinding();
      const expiresAt = this.now() + TASK_CONSENT_TTL_MS;
      const elapsedDeadline = this.elapsed() + TASK_CONSENT_TTL_MS;
      const confirmed = await confirmOperatorAction(ctx, `Approve ${feature} task disclosure?`, JSON.stringify({ policy,
        taskId, projectId: token.projectId, sessionId: token.sessionId, binding,
        expiresAt: new Date(expiresAt).toISOString(), maxOperations: TASK_OPERATION_LIMITS[feature],
        lifetime: 'Current runtime/branch only; revoke, configuration change, navigation, reload or shutdown removes access. Provider work already sent may continue.' }), signal);
      this.assertScope(ctx, feature, token); requireBinding();
      if (!confirmed) return null;
      const now = this.now(); if (now >= expiresAt || this.elapsed() >= elapsedDeadline) throw new Error('Task consent dialog expired');
      this.contents(ctx, taskId);
      const consent: TaskConsent = Object.freeze({ version: 1, id: identifier(this.newId(), 128), feature, taskId,
        projectId: token.projectId, sessionId: token.sessionId, scopeKey: token.key, binding,
        approvedAt: now, expiresAt, maxOperations: TASK_OPERATION_LIMITS[feature], policyId: TASK_CONSENT_POLICY });
      this.remove(feature);
      this.assertScope(ctx, feature, token); requireBinding();
      try { this.receipt(ctx, 'approved', consent); }
      catch { throw new Error('Task consent receipt may have been recorded, but no new live grant was created and previous authority was revoked; inspect before explicitly approving again'); }
      this.assertScope(ctx, feature, token); requireBinding();
      this.slots.set(feature, { consent, abort: new AbortController(), elapsedDeadline, used: 0 });
      return consent;
    } finally {
      if (this.approval === operation) this.approval = null;
      operation.abort.abort(); this.busy = false;
    }
  }
}
