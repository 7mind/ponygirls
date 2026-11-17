import { dirname, join } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { resolveProject } from '../../ponygirls-decisions/src/project.ts';
import { digest, evidenceFromEntry } from './evidence.ts';
import { HISTORY_CHANNEL, type HistoryFeed } from './feed.ts';
import { MAX_PENDING_EVENTS, type Evidence, type SourceCursor } from './model.ts';
import { randomUUID } from 'node:crypto';
import type { PreferenceStore } from './preferences.ts';
import type { ScopedConfiguration } from './project-config.ts';
import type { ScopedSettingsScope } from '@ponygirls/pi-settings';
import type { HistorianSettingsSnapshot } from './scoped-values.ts';
import { ProjectSettings, type ConfirmDisclosure, type ProjectApplyResult } from './project-settings.ts';
import { ConfigurationFence, type ConfigurationObservation } from './configuration-fence.ts';
import { acquireSessionLock, JournalStore } from './store.ts';
import { HistorianWorker, OBJECTIVE_VERSION } from './worker.ts';
import { WorkerFailure, type AttemptFinish } from './attempt.ts';
import { ChroniclePreferences, type ChroniclePreferencesValue } from './chronicle-preferences.ts';
import { chronicleTarget } from './chronicle-model.ts';
import { approvedChronicleBinding, configuredChronicleBinding, resolveChronicleBinding, deliverChronicle, HttpChronicleTransport, CHRONICLE_TIMEOUT_MS } from './chronicle-upload.ts';

export const RECONCILE_INTERVAL_MS = 10000;
const MAX_BASELINE_PAGES = 1000;
const PAGE_RECORDS = 128;
const RECENT_EPISODES = 12;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 10000;

export class HistorianController {
  private readonly pi: ExtensionAPI;
  private readonly preferences: PreferenceStore;
  private readonly ctx: ExtensionContext;
  private readonly owner: string;
  readonly directory: string;
  private readonly project: string;
  private readonly changed: () => void;
  private readonly worker: HistorianWorker;
  private store: JournalStore | null = null;
  private release: (() => void) | null = null;
  private feed: HistoryFeed | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Number.POSITIVE_INFINITY;
  private request: AbortController | null = null;
  private working: Promise<void> | null = null;
  private capture: Promise<void> | null = null;
  private disposed = false;
  private attachmentBaseline = true;
  private failures = 0;
  private retryAt = 0;
  private error: string | null = null;
  private projectionError: string | null = null;
  private lastCommit: string | null = null;
  private activeConfiguration: string | null = null;
  private readonly configurationFence = new ConfigurationFence();
  private readonly projectSettings: ProjectSettings;
  private readonly chroniclePreferences: ChroniclePreferences;
  private uploading: Promise<void> | null = null;
  private uploadRequest: AbortController | null = null;
  private uploadTarget: string | null = null;
  private uploadRetryAt = 0;
  private uploadError: string | null = null;

  constructor(pi: ExtensionAPI, preferences: PreferenceStore, ctx: ExtensionContext, changed: () => void) {
    this.pi = pi; this.preferences = preferences; this.ctx = ctx; this.owner = ctx.sessionManager.getSessionId();
    this.project = resolveProject(ctx.cwd); this.directory = join(preferences.journalRoot(), 'projects', digest(this.project)); this.changed = changed;
    this.projectSettings = new ProjectSettings(pi, preferences, this.project,
      candidate => !this.disposed && candidate === this.ctx && candidate.sessionManager.getSessionId() === this.owner, { token: randomUUID });
    this.worker = new HistorianWorker(ctx.modelRegistry);
    this.chroniclePreferences = new ChroniclePreferences(join(dirname(preferences.path), 'historian-chronicle.json'));
  }
  private observeConfiguration(config: ScopedConfiguration): { config: ScopedConfiguration; observation: ConfigurationObservation } {
    const observation = this.configurationFence.observe(config.boundaryKey);
    if (observation.changed) { this.activeConfiguration = null; this.request?.abort(); }
    return { config, observation };
  }
  private configurationFault(): void {
    this.configurationFence.invalidate(); this.attachmentBaseline = true;
    this.activeConfiguration = null; this.request?.abort();
  }
  private configuration(): { config: ScopedConfiguration; observation: ConfigurationObservation } {
    try { return this.observeConfiguration(this.projectSettings.read(this.ctx, null)); }
    catch (error) { this.configurationFault(); throw error; }
  }
  effective(): ScopedConfiguration { return this.configuration().config; }
  private withAuthorization<T>(key: string, use: () => T): T | undefined {
    try {
      return this.projectSettings.withSnapshot(this.ctx, config => {
        const current = this.observeConfiguration(config);
        if (this.disposed || !config.enabled || !config.disclosureApproved || current.observation.key !== key) {
          this.schedule(0); return undefined;
        }
        return use();
      });
    } catch (error) { this.configurationFault(); throw error; }
  }
  private open(): JournalStore {
    if (this.store === null) {
      const stableDirectory = join(dirname(this.preferences.path), 'historian', 'projects', digest(this.project));
      const releaseStable = acquireSessionLock(stableDirectory, this.owner);
      let releaseJournal: (() => void) | null = null;
      const release = () => { try { if (releaseJournal !== null) releaseJournal(); } finally { releaseStable(); } };
      try {
        if (!existsSync(this.directory) || realpathSync(this.directory) !== realpathSync(stableDirectory)) {
          releaseJournal = acquireSessionLock(this.directory, this.owner);
        }
        const store = new JournalStore(join(this.directory, 'journal.sqlite'), this.project);
        try { store.interruptAttempts(this.owner); } catch (error) { store.close(); throw error; }
        this.store = store; this.release = release;
      }
      catch (error) { release(); throw error; }
    }
    return this.store;
  }
  private discoverFeed(): void {
    if (this.feed !== null) return;
    this.pi.events.emit(HISTORY_CHANNEL, { rootSessionId: this.owner, respond: (feed: HistoryFeed) => {
      if (this.disposed) return;
      if (this.feed !== null) throw new Error('Duplicate Historian history service');
      this.feed = feed; this.unsubscribe = feed.subscribe(() => this.schedule(100));
    } });
  }
  schedule(delay: number): void {
    if (this.disposed) return;
    const at = performance.now() + delay;
    if (this.timer !== null) {
      if (this.timerAt <= at) return;
      clearTimeout(this.timer);
    }
    this.timerAt = at;
    this.timer = setTimeout(() => { this.timer = null; void this.reconcile(); }, delay);
    this.timer.unref();
  }
  async reconcile(): Promise<void> {
    if (this.disposed) return;
    if (this.capture !== null) return this.capture;
    this.capture = this.collect().catch(error => this.fault(error)).finally(() => {
      this.capture = null;
      if (!this.disposed) { this.changed(); this.schedule(RECONCILE_INTERVAL_MS); }
    });
    return this.capture;
  }
  private async collect(): Promise<void> {
    this.reconcileChronicle();
    const current = this.configuration(); const config = current.config;
    if (!config.enabled) {
      this.request?.abort(); this.activeConfiguration = null;
      if (this.store === null && existsSync(join(this.directory, 'journal.sqlite'))) this.open();
      if (this.store !== null) {
        const prior = this.store.state(this.owner);
        if (prior !== null && prior.enabled) this.store.capture(this.owner, false, prior.cursors, [], [`${new Date().toISOString()}: Capture disabled: this interval is not backfilled`]);
        this.projectMarkdown(this.store);
      }
      this.error = null; return;
    }
    const model = config.model;
    if (model === null) throw new Error('Configure /historian model PROVIDER MODEL THINKING before enabling');
    if (!config.disclosureApproved) throw new Error('Model disclosure not approved; use /historian on, /historian default on, or explicitly approve project ON in settings');
    const key = current.observation.key;
    if (this.activeConfiguration !== key) { this.request?.abort(); this.activeConfiguration = key; }
    const store = this.open(); this.discoverFeed();
    const previous = store.state(this.owner);
    const cursors = new Map((previous === null ? [] : previous.cursors).map(c => [c.sourceId, c.offset]));
    const baseline = this.attachmentBaseline || current.observation.baselineRequired || previous === null || !previous.enabled ||
      cursors.get('session-enabled-revision') !== config.enabledRevision ||
      (config.enabledGeneration !== null && cursors.get('global-enabled-generation') !== config.enabledGeneration);
    cursors.set('session-enabled-revision', config.enabledRevision);
    if (config.enabledGeneration === null) cursors.delete('global-enabled-generation');
    else cursors.set('global-enabled-generation', config.enabledGeneration);
    const capacity = MAX_PENDING_EVENTS - store.pending(this.owner);
    if (capacity < 0) throw new Error('Historian pending capacity invariant violated');
    const evidence: Evidence[] = []; const gaps: string[] = [];
    const main = this.ctx.sessionManager.getEntries();
    const start = baseline ? main.length : (cursors.get('main') ?? 0);
    if (start > main.length) throw new Error('Main history shrank; refusing to reset capture cursor');
    const end = Math.min(main.length, start + Math.min(PAGE_RECORDS, capacity));
    for (const entry of main.slice(start, end)) {
      const e = evidenceFromEntry(this.owner, 'root', entry); if (e !== null) evidence.push(e);
    }
    cursors.set('main', end);
    if (end < main.length && capacity > 0) this.schedule(100);
    if (this.feed === null) gaps.push('Subagent history feed unavailable; main-session evidence only');
    else {
      const feedBaseline = baseline || !cursors.has('feed-ready');
      if (feedBaseline && !baseline) gaps.push('Late subagent feed attachment: preceding descendant history was not backfilled');
      for (const source of this.feed.sources()) {
        if (source.rootSessionId !== this.owner) throw new Error('Foreign root in Historian source feed');
        if (!Number.isSafeInteger(source.reconstructedPrefixBytes) || source.reconstructedPrefixBytes < 0) throw new Error('Invalid reconstructed history prefix');
        const marker = `baseline:${source.sourceId}`;
        if (feedBaseline) cursors.set(marker, 1);
        const sourceBaseline = cursors.has(marker);
        let offset = Math.max(cursors.get(source.sourceId) ?? 0, source.reconstructedPrefixBytes);
        for (let pageNumber = 0; pageNumber < (sourceBaseline ? MAX_BASELINE_PAGES : 1); pageNumber++) {
          if (!sourceBaseline && evidence.length >= capacity) break;
          const limit = sourceBaseline ? PAGE_RECORDS : Math.min(PAGE_RECORDS, capacity - evidence.length);
          const page = await this.feed.read(source.sourceId, offset, limit);
          if (this.disposed) return;
          if (typeof page.ready !== 'boolean' || page.entries.length > limit) throw new Error('Invalid history page readiness/limit');
          if (page.nextOffset < offset || (!page.eof && page.nextOffset === offset)) throw new Error('History feed did not advance');
          if (!sourceBaseline) for (const entry of page.entries) {
            const e = evidenceFromEntry(source.sessionId, source.agentPath, entry); if (e !== null) evidence.push(e);
          }
          gaps.push(...page.gaps); offset = page.nextOffset;
          if (page.eof) {
            if (sourceBaseline && page.ready) cursors.delete(marker);
            break;
          }
          if (!sourceBaseline && evidence.length < capacity) this.schedule(100);
          if (sourceBaseline && pageNumber === MAX_BASELINE_PAGES - 1) throw new Error('History baseline exceeds bounded scan; not enabled');
        }
        cursors.set(source.sourceId, offset);
      }
      cursors.set('feed-ready', 1);
    }
    // Serialize synchronous capture/admission and commit with defaults mutations, never inference or feed I/O.
    this.withAuthorization(key, () => {
      if (baseline) gaps.push(`${new Date().toISOString()}: Activation/attachment boundary: earlier or offline history was not backfilled; only already captured pending evidence resumes`);
      store.capture(this.owner, true, [...cursors].map(([sourceId, offset]): SourceCursor => ({ sourceId, offset })), evidence, gaps);
      this.configurationFence.captured(key);
      this.attachmentBaseline = false;
      if (this.working === null && !this.worker.busy && this.failures < MAX_RETRIES && performance.now() >= this.retryAt) {
        const batch = store.batch(this.owner);
        if (batch !== null) {
          const recent = store.recent(RECENT_EPISODES);
          const contextDigest = digest(JSON.stringify([batch.id, recent, model, config.focus, OBJECTIVE_VERSION]));
          const attempt = store.beginAttempt(batch, model, OBJECTIVE_VERSION, contextDigest);
          const started = performance.now(); let finalized = false;
          const finish = (result: Omit<AttemptFinish, 'durationMs' | 'endedAt'>) => {
            store.finishAttempt(attempt.id, { ...result, durationMs: performance.now() - started, endedAt: new Date().toISOString() });
            finalized = true;
          };
          const request = new AbortController(); this.request = request;
          this.working = this.worker.run(batch, recent, model, config.focus, request.signal)
            .then(result => {
              finish({ outcome: 'validated', failure: null, ...result.metrics });
              if (this.disposed || request.signal.aborted) return;
              const committed = this.withAuthorization(key, () => {
                let uploadObserved = false;
                try {
                  this.chroniclePreferences.withSnapshot(upload => {
                    uploadObserved = true;
                    const chronicle = upload.enabled ? approvedChronicleBinding(upload) : undefined;
                    store.commit(batch, result.proposals, { ...result.meta, attemptId: attempt.id, ...(chronicle === undefined ? {} : { chronicle }) });
                  });
                } catch (error) {
                  if (uploadObserved) throw error;
                  this.uploadError = 'upload-settings-unavailable';
                  store.commit(batch, result.proposals, { ...result.meta, attemptId: attempt.id });
                  if (result.proposals.length > 0) this.ctx.ui.notify('Historian summaries saved locally; Chronicle upload settings unavailable, so these revisions were not queued (no backfill).', 'error');
                }
                return true;
              }) ?? false;
              if (!committed) return;
              this.projectMarkdown(store);
              this.lastCommit = new Date().toISOString(); this.failures = 0; this.error = null;
            }).catch(error => {
              let reported = error;
              if (!finalized) {
                const failure = error instanceof WorkerFailure ? error : new WorkerFailure('runtime-error', { responseChars: null, usage: null });
                reported = failure;
                try { finish({ outcome: failure.code === 'cancelled' ? 'cancelled' : 'failed', failure: failure.code, ...failure.metrics }); }
                catch (storageError) { this.failures = MAX_RETRIES; this.fault(storageError); return; }
              }
              if (!this.disposed && !request.signal.aborted) { this.failures++; this.retryAt = performance.now() + RETRY_BASE_MS * 2 ** (this.failures - 1); this.fault(reported); }
            })
            .finally(() => { this.working = null; if (this.request === request) this.request = null; if (!this.disposed) { this.changed(); this.schedule(100); } });
        }
      }
    });
    if (this.failures === 0) this.error = null;
    this.projectMarkdown(store);
  }
  chronicleConfiguration(): ChroniclePreferencesValue { return this.chroniclePreferences.read(); }
  private checkChronicleSnapshot(current: ChroniclePreferencesValue, expected: ChroniclePreferencesValue | null): void {
    if (expected !== null && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Chronicle settings changed; reopen the dialog');
  }
  async configureChronicle(endpoint: string, tokenFile: string, expected: ChroniclePreferencesValue | null): Promise<void> {
    this.chroniclePreferences.update(previous => {
      this.checkChronicleSnapshot(previous, expected);
      return { enabled: false, endpoint, tokenFile, tokenHash: null,
        collectorNamespace: previous.collectorNamespace.length === 0 ? `historian-${randomUUID()}` : previous.collectorNamespace };
    });
    await this.chronicleSettingsChanged();
  }
  async enableChronicle(enabled: boolean, expected: ChroniclePreferencesValue | null): Promise<void> {
    this.chroniclePreferences.update(previous => {
      this.checkChronicleSnapshot(previous, expected);
      const tokenHash = enabled ? resolveChronicleBinding(previous).tokenHash : previous.tokenHash;
      return { ...previous, enabled, tokenHash };
    });
    await this.chronicleSettingsChanged();
  }
  async retryChronicle(expected: ChroniclePreferencesValue | null): Promise<void> {
    if (this.uploading !== null) throw new Error('Chronicle upload is active; retry after it finishes');
    const release = acquireSessionLock(this.directory, 'chronicle-uploader');
    try { this.chroniclePreferences.withSnapshot(settings => {
      this.checkChronicleSnapshot(settings, expected);
      this.open().retryChronicle(approvedChronicleBinding(settings));
    }); }
    finally { release(); }
    this.uploadRetryAt = 0; this.uploadError = null;
    await this.reconcile();
  }
  private async chronicleSettingsChanged(): Promise<void> {
    this.uploadRequest?.abort();
    if (this.uploading !== null) await this.uploading;
    this.uploadRetryAt = 0; this.uploadError = null;
    await this.reconcile();
  }
  private reconcileChronicle(): void {
    try {
      const settings = this.chroniclePreferences.read();
      if (!settings.enabled) { this.uploadRequest?.abort(); this.uploadTarget = null; return; }
      const binding = approvedChronicleBinding(settings), target = chronicleTarget(binding);
      if (target !== this.uploadTarget) { this.uploadRequest?.abort(); this.uploadTarget = target; }
      if (this.uploading !== null || performance.now() < this.uploadRetryAt || (!existsSync(join(this.directory, 'journal.sqlite')) && this.store === null)) return;
      const store = this.open();
      if (store.nextChronicle(binding) === null) return;
      let release: () => void;
      try { release = acquireSessionLock(this.directory, 'chronicle-uploader'); }
      catch { this.uploadError = 'uploader-unavailable-or-owned'; return; }
      const request = new AbortController(); this.uploadRequest = request;
      this.uploading = deliverChronicle(store, binding, new HttpChronicleTransport(CHRONICLE_TIMEOUT_MS), request.signal, (expected, admit) => {
        let authorized = false;
        this.chroniclePreferences.withSnapshot(current => {
          if (this.disposed || request.signal.aborted || !current.enabled || JSON.stringify(approvedChronicleBinding(current)) !== JSON.stringify(expected)) return;
          admit(); authorized = true;
        });
        return authorized;
      })
        .then(result => {
          this.uploadError = result.error;
          this.uploadRetryAt = result.state === 'failed' ? performance.now() + RETRY_BASE_MS : 0;
          if (result.state === 'acknowledged') this.schedule(0);
        }).catch(() => { this.uploadError = 'upload-storage-unavailable'; this.uploadRetryAt = performance.now() + RETRY_BASE_MS; })
        .finally(() => {
          release(); this.uploading = null;
          if (this.uploadRequest === request) this.uploadRequest = null;
          if (!this.disposed) { this.changed(); this.schedule(RECONCILE_INTERVAL_MS); }
        });
    } catch { this.uploadRequest?.abort(); this.uploadError = 'upload-settings-unavailable'; }
  }
  chronicleStatus(): string {
    try {
      const settings = this.chroniclePreferences.read();
      const binding = configuredChronicleBinding(settings);
      const status = this.store === null ? null : this.store.chronicleStatus(binding);
      return `Chronicle upload: ${settings.enabled ? 'ON' : 'OFF'} (private global settings; new commits only)\n` +
        `Chronicle destination: ${settings.endpoint || 'unconfigured'}\n` +
        `Chronicle delivery: ${this.uploading === null ? 'idle' : 'uploading'}; pending: ${status === null ? 'unknown (journal not open)' : status.pending}; stopped: ${status === null ? 'unknown' : status.stopped}; acknowledged: ${status === null ? 'unknown' : status.acknowledged}; paused/other destinations: ${status === null ? 'unknown' : status.otherDestinations}\n` +
        `Chronicle error: ${this.uploadError ?? (status === null ? null : status.error) ?? 'none'}\n` +
        'Only summary claims and provenance references are sent, never underlying evidence bodies. Existing claims may recur in new revisions. Chronicle indexing providers and account sharing apply. OFF retains queued work, does not retract admitted requests or delete remote copies.\n';
    } catch { return 'Chronicle upload: unavailable (invalid settings; no new upload authority)\n'; }
  }
  private projectMarkdown(store: JournalStore): void {
    try { store.publishMarkdown(); this.projectionError = null; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.disposed && message !== this.projectionError) this.ctx.ui.notify(`Historian Markdown projection: ${message}`, 'error');
      this.projectionError = message;
    }
  }
  private fault(error: unknown): void {
    this.request?.abort(); this.error = error instanceof Error ? error.message : String(error);
    if (!this.disposed) { this.ctx.ui.notify(`Historian: ${this.error}`, 'error'); this.changed(); }
  }
  async settingsChanged(): Promise<void> {
    this.request?.abort(); this.failures = 0; this.retryAt = 0;
    this.configuration();
    if (this.capture !== null) await this.capture;
    await this.reconcile();
  }
  async applyProjectSettings(changes: unknown, signal: AbortSignal, confirm: ConfirmDisclosure): Promise<ProjectApplyResult> {
    const result = await this.projectSettings.apply(this.ctx, changes, signal, confirm);
    if (result.status === 'applied') await this.settingsChanged();
    return result;
  }
  settingsSnapshot(): HistorianSettingsSnapshot {
    try {
      const snapshot = this.projectSettings.settingsSnapshot(this.ctx);
      const observation = this.configurationFence.observe(snapshot.boundaryKey);
      if (observation.changed) { this.activeConfiguration = null; this.request?.abort(); }
      return snapshot;
    } catch (error) { this.configurationFault(); throw error; }
  }
  async applyScopedSettings(scope: ScopedSettingsScope, changes: unknown, signal: AbortSignal,
    expectedTarget: string, confirm: ConfirmDisclosure): Promise<void> {
    try { await this.projectSettings.applyScoped(this.ctx, scope, changes, signal, expectedTarget, confirm); }
    catch (error) {
      try { this.configuration(); }
      catch (observationError) { throw new AggregateError([error, observationError], 'Historian settings failed and current configuration is unavailable'); }
      throw error;
    }
    await this.settingsChanged();
  }
  private attemptStatus(): string {
    if (this.store === null) return 'Attempt diagnostics: no journal open\n';
    const s = this.store.attemptSummary(this.owner);
    const recent = this.store.attempts(this.owner, 10).map(a =>
      `  ${a.id}: ${a.outcome}${a.failure === null ? '' : ` (${a.failure})`}; ${a.provider}/${a.model} (${a.thinking}); ${a.startedAt}; ${a.durationMs === null ? 'duration unknown' : `${Math.round(a.durationMs)} ms`}; batch ${a.batchId}`);
    return `Attempt totals: ${s.total}; validated: ${s.validated}; failed: ${s.failed}; recovered: ${s.recovered}; cancelled: ${s.cancelled}; interrupted: ${s.interrupted}; running: ${s.running}\n` +
      'This session, since diagnostics began. Admissions, not wire requests (SDK retries may occur). Validated is not published; interrupted means outcome unknown. Recovery means a later validated response for the same batch.\n' +
      (recent.length === 0 ? '' : `Latest attempts (maximum 10):\n${recent.join('\n')}\n`);
  }
  status(): string {
    let config: ScopedConfiguration;
    try { config = this.effective(); } catch (error) { return `Historian ERROR: ${String(error)}`; }
    const state = this.store === null ? null : this.store.state(this.owner);
    return `Historian ${config.enabled ? 'ON' : 'OFF'} (${config.enabledSource})\n` +
      `Project: ${this.project}\nJournal: ${join(this.directory, 'journal.md')}\n` +
      `Disclosure approval: ${config.disclosureApproved ? 'approved' : 'required'}\nModel origin: ${config.modelOrigin}\nFocus source: ${config.focusSource}\n` +
      `Model: ${config.model === null ? 'unconfigured' : `${config.model.provider}/${config.model.id} (${config.model.thinking})`} (${config.modelSource})\n` +
      `Activity: ${this.working !== null ? 'journaling' : this.worker.busy ? 'cancelled; waiting for provider drain' : 'idle'}; pending events: ${this.store === null ? 0 : this.store.pending(this.owner)}\n` +
      `Last commit this runtime: ${this.lastCommit ?? 'none'}; failed attempts: ${this.failures}/${MAX_RETRIES}\n` +
      this.chronicleStatus() + this.attemptStatus() +
      `Error: ${this.error ?? 'none'}\nMarkdown projection error: ${this.projectionError ?? 'none'}\nCoverage: ${state === null ? 'not capturing' : state.gaps.join('; ') || 'native transcript (not tool internals)'}\n` +
      'Configured provider receives this session family’s eligible evidence and shared published project episodes. Journals are historical, not current-state verification.';
  }
  /** Border badge state: null while Historian is off and healthy. */
  badge(): 'idle' | 'working' | 'attention' | null {
    if (this.error !== null || this.projectionError !== null || this.uploadError !== null) return 'attention';
    try { const config = this.effective(); if (!config.enabled) return null; if (!config.disclosureApproved) return 'attention'; } catch { return 'attention'; }
    return this.working === null ? 'idle' : 'working';
  }
  journal(): string { return this.open().render(); }
  async dispose(): Promise<void> {
    this.disposed = true; this.projectSettings.dispose(); if (this.timer !== null) clearTimeout(this.timer); this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null; this.request?.abort(); this.uploadRequest?.abort();
    if (this.capture !== null) await this.capture;
    // Worker cancellation is bounded and late results are fenced by disposed above.
    if (this.working !== null) await this.working;
    if (this.uploading !== null) await this.uploading;
    const cleanup = () => { this.store?.close(); this.store = null; this.release?.(); this.release = null; };
    if (this.worker.busy) {
      this.ctx.ui.notify('Historian cancellation is awaiting provider drain; session ownership remains locked until it settles', 'warning');
      void this.worker.waitForIdle().then(cleanup).catch(error => console.error('Historian deferred cleanup failed:', error));
    } else cleanup();
  }
}
