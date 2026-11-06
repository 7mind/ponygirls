import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { resolveProject } from '../../ponygirls-decisions/src/project.ts';
import { digest, evidenceFromEntry } from './evidence.ts';
import { HISTORY_CHANNEL, type HistoryFeed } from './feed.ts';
import { MAX_PENDING_EVENTS, type Evidence, type SourceCursor } from './model.ts';
import { effectivePreferences, modelKey, type EffectivePreferences, type PreferenceStore, type StoredPreferences } from './preferences.ts';
import { acquireSessionLock, JournalStore } from './store.ts';
import { HistorianWorker } from './worker.ts';

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

  constructor(pi: ExtensionAPI, preferences: PreferenceStore, ctx: ExtensionContext, agentDir: string, changed: () => void) {
    this.pi = pi; this.preferences = preferences; this.ctx = ctx; this.owner = ctx.sessionManager.getSessionId();
    this.project = resolveProject(ctx.cwd); this.directory = join(agentDir, 'historian', 'projects', digest(this.project)); this.changed = changed;
    this.worker = new HistorianWorker(ctx.modelRegistry);
  }
  effective(): EffectivePreferences { return effectivePreferences(this.preferences.read(), this.ctx.sessionManager.getEntries(), this.owner); }
  private authorized(defaults: StoredPreferences, key: string): boolean {
    const current = effectivePreferences(defaults, this.ctx.sessionManager.getEntries(), this.owner);
    return !this.disposed && current.enabled && modelKey(current.model) === modelKey(current.approvedModel) &&
      JSON.stringify([current.model, current.focus, current.enabledGeneration, current.enabledRevision]) === key;
  }
  private open(): JournalStore {
    if (this.store === null) {
      const release = acquireSessionLock(this.directory, this.owner);
      try { this.store = new JournalStore(join(this.directory, 'journal.sqlite'), this.project); this.release = release; }
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
    const config = this.effective();
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
    if (modelKey(config.model) !== modelKey(config.approvedModel)) throw new Error('Model disclosure not approved; run /historian on (or default on) for the configured model');
    const key = JSON.stringify([config.model, config.focus, config.enabledGeneration, config.enabledRevision]);
    if (this.activeConfiguration !== key) { this.request?.abort(); this.activeConfiguration = key; }
    const store = this.open(); this.discoverFeed();
    const previous = store.state(this.owner);
    const cursors = new Map((previous === null ? [] : previous.cursors).map(c => [c.sourceId, c.offset]));
    const baseline = this.attachmentBaseline || previous === null || !previous.enabled ||
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
    this.preferences.withSnapshot(defaults => {
      if (!this.authorized(defaults, key)) { this.schedule(0); return; }
      if (baseline) gaps.push(`${new Date().toISOString()}: Activation/attachment boundary: earlier or offline history was not backfilled; only already captured pending evidence resumes`);
      store.capture(this.owner, true, [...cursors].map(([sourceId, offset]): SourceCursor => ({ sourceId, offset })), evidence, gaps);
      this.attachmentBaseline = false;
      if (this.working === null && !this.worker.busy && this.failures < MAX_RETRIES && performance.now() >= this.retryAt) {
        const batch = store.batch(this.owner);
        if (batch !== null) {
          const request = new AbortController(); this.request = request;
          this.working = this.worker.run(batch, store.recent(RECENT_EPISODES), model, config.focus, request.signal)
            .then(result => {
              if (this.disposed || request.signal.aborted) return;
              const committed = this.preferences.withSnapshot(latest => {
                if (!this.authorized(latest, key)) return false;
                store.commit(batch, result.proposals, result.meta); return true;
              });
              if (!committed) return;
              this.projectMarkdown(store);
              this.lastCommit = new Date().toISOString(); this.failures = 0; this.error = null;
            }).catch(error => { if (!this.disposed && !request.signal.aborted) { this.failures++; this.retryAt = performance.now() + RETRY_BASE_MS * 2 ** (this.failures - 1); this.fault(error); } })
            .finally(() => { this.working = null; if (this.request === request) this.request = null; if (!this.disposed) { this.changed(); this.schedule(100); } });
        }
      }
    });
    this.projectMarkdown(store);
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
    if (this.capture !== null) await this.capture;
    await this.reconcile();
  }
  status(): string {
    let config: EffectivePreferences;
    try { config = this.effective(); } catch (error) { return `Historian ERROR: ${String(error)}`; }
    const state = this.store === null ? null : this.store.state(this.owner);
    return `Historian ${config.enabled ? 'ON' : 'OFF'} (${config.enabledSource})\n` +
      `Project: ${this.project}\nJournal: ${join(this.directory, 'journal.md')}\n` +
      `Model: ${config.model === null ? 'unconfigured' : `${config.model.provider}/${config.model.id} (${config.model.thinking})`} (${config.modelSource})\n` +
      `Activity: ${this.working !== null ? 'journaling' : this.worker.busy ? 'cancelled; waiting for provider drain' : 'idle'}; pending events: ${this.store === null ? 0 : this.store.pending(this.owner)}\n` +
      `Last commit this runtime: ${this.lastCommit ?? 'none'}; failed attempts: ${this.failures}/${MAX_RETRIES}\n` +
      `Error: ${this.error ?? 'none'}\nMarkdown projection error: ${this.projectionError ?? 'none'}\nCoverage: ${state === null ? 'not capturing' : state.gaps.join('; ') || 'native transcript (not tool internals)'}\n` +
      'Configured provider receives this session family’s eligible evidence and shared published project episodes. Journals are historical, not current-state verification.';
  }
  badge(): string | null {
    if (this.error !== null || this.projectionError !== null) return 'HIST !';
    try { if (!this.effective().enabled) return null; } catch { return 'HIST !'; }
    return this.working === null ? 'HIST' : 'HIST …';
  }
  journal(): string { return this.open().render(); }
  async dispose(): Promise<void> {
    this.disposed = true; if (this.timer !== null) clearTimeout(this.timer); this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null; this.request?.abort();
    if (this.capture !== null) await this.capture;
    // Worker cancellation is bounded and late results are fenced by disposed above.
    if (this.working !== null) await this.working;
    const cleanup = () => { this.store?.close(); this.store = null; this.release?.(); this.release = null; };
    if (this.worker.busy) {
      this.ctx.ui.notify('Historian cancellation is awaiting provider drain; session ownership remains locked until it settles', 'warning');
      void this.worker.waitForIdle().then(cleanup).catch(error => console.error('Historian deferred cleanup failed:', error));
    } else cleanup();
  }
}
