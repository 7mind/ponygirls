// Realistic synthetic data for the Chronicle dashboard, served through the same in-browser protocol fixture
// that the browser tests use (the real React app and transport, a scripted server). No real data is involved.
import { SearchFixture, api } from '../tests-browser/search-fixture.mjs';
import { buildMessages, buildChunks, templateFor } from './transcripts.mjs';

export { api };
export const ARCHIVE_ROWS = 420;
export const COLLECTORS = 36;
const NOW = '2026-11-17T09:00:00Z';
const BASE = Date.parse('2026-11-16T18:20:00Z');
const OWNERS = ['alice', 'alice', 'alice', 'alice', 'alice', 'alice', 'alice', 'bob', 'bob', 'carol'];
const PROJECTS = ['chronicle', 'haystack', 'manure', 'collector', 'infra-nebula', 'billing-gateway', 'ml-eval-harness', 'docs-site', 'storage-controller', undefined];
const BRANCHES = ['main', 'feature/activity-paging', 'fix/lock-timeout', 'refactor/session-renewal', 'release/2026.11', 'wip/very-long-branch-name-for-testing-truncation-behaviour', undefined];
const MODELS = ['claude-sonnet-4-5', 'gpt-5.1-codex', 'qwen3-coder-480b', 'deepseek-v3.2', undefined];
const FORMATS = [[api.SourceFormat.Pi, 'pi'], [api.SourceFormat.Codex, 'codex'], [api.SourceFormat.Claude, 'claude-code'], [api.SourceFormat.Historian, 'historian']];
const TAGS = ['bug', 'migration', 'refactor', 'tests', 'infra', 'ui', 'docs', 'perf', 'security', 'flaky', 'postgres', 'typescript', 'scala', 'nix', 'needs-review'];
const VERBS = ['Fix', 'Investigate', 'Refactor', 'Add', 'Debug', 'Review', 'Migrate', 'Document', 'Profile', 'Untangle'];
const SUBJECTS = ['flaky websocket reconnect test', 'staging migration lock timeout', 'session renewal hook cleanup', 'embedding provider 503 handling', 'activity table pagination', 'collector systemd unit', 'token revocation flow', 'archive relevance ordering', 'dark theme disabled contrast', 'postgres vacuum settings for events', 'uploader backoff and jitter', 'search snippet byte offsets', 'CI cache invalidation', 'OpenAPI schema drift in the ingest endpoint', 'memory growth in the indexing worker', 'unicode normalisation of tool output'];
const LONG_TITLE = 'Investigate why the nightly reindex of all owner HEADs stalls at roughly forty percent when the embedding provider rate-limits, and propose a bounded retry policy that does not multiply the job-level retries already present in the worker';
const FAIL_REASONS = [['Embedding provider unavailable: HTTP 503 after 3 attempts', api.IndexingFailureStage.Embedding], ['Annotation model returned malformed JSON for window 7', api.IndexingFailureStage.Annotation], ['Publication conflict: generation retired during write', api.IndexingFailureStage.Publication], ['Annotation timeout after 900s', api.IndexingFailureStage.Annotation]];
const COLLECTOR_IDS = Array.from({ length: COLLECTORS }, (_, i) => ['dgx-lne', 'devbox', 'ci-runner', 'laptop-pavel', 'sandbox'][i % 5] + '-' + String(Math.floor(i / 5) + 1).padStart(2, '0'));

function uuid(prefix, n) { return `00000000-0000-4000-8000-${String(prefix * 100000 + n).padStart(12, '0')}`; }
function title(i) {
  if (i % 41 === 40) return '';
  if (i % 37 === 36) return LONG_TITLE;
  if (i % 53 === 52) return 'Plan: перенос данных 🦄 → новый кластер (черновик)';
  return `${VERBS[i % VERBS.length]} ${SUBJECTS[(i * 5 + Math.floor(i / 16)) % SUBJECTS.length]}${i % 9 === 0 ? ` (attempt ${1 + i % 4})` : ''}`;
}
function tagsFor(i) { const count = i % 11 === 0 ? 0 : i % 13 === 0 ? 7 : i % 4; return [...new Set(Array.from({ length: count }, (_, k) => TAGS[(i * 3 + k) % TAGS.length]))]; }

export class CaptureFixture extends SearchFixture {
  term = undefined;
  hintResult = query => new api.ExpressionHintsResult('capture-hash', NOW, 0, query.expression.length, ['project:', 'producer:', 'status:', 'tag:', 'branch:'].map(text => new api.ExpressionHint(api.ExpressionHintKind.Field, text, text, text.length)), false);
  constructor() {
    super();
    this.tokens = []; this.staticTokens = []; this.collectors = [];
    this.annotationCount = 0;
    this.seedArchive(); this.seedActivity(); this.seedAccount();
  }
  viewForRevision(revision) { return this.viewAt(revision); }
  messagesAt(revision) { return buildMessages(revision, undefined); }
  chunksAt(view) { return buildChunks(view.revision, view.generationId); }
  get hit() { return new api.SearchHit(this.session, [], 0.9); }
  seedArchive() {
    const rows = [];
    for (let i = 0; i < ARCHIVE_ROWS; i++) {
      const revision = 1 + (i % 11), owner = OWNERS[i % OWNERS.length], [format, producer] = FORMATS[(i * 3 + Math.floor(i / 7)) % FORMATS.length];
      const collector = COLLECTOR_IDS[i % COLLECTORS], template = templateFor(revision);
      const stateIndex = (i * 7) % 20, state = stateIndex < 11 ? api.JobState.Complete : stateIndex < 13 ? api.JobState.Failed : stateIndex < 16 ? api.JobState.Queued : stateIndex < 18 ? api.JobState.Running : undefined;
      const lagged = state === api.JobState.Complete && i % 6 === 0 && revision > 1, publishedRevision = lagged ? revision - 1 : revision;
      const published = state === api.JobState.Complete || (state === api.JobState.Failed && i % 2 === 0) ? this.viewAt(publishedRevision) : undefined;
      const failure = FAIL_REASONS[i % FAIL_REASONS.length];
      const job = state === undefined ? undefined : new api.JobInfo(uuid(9, i), '', revision, state, state === api.JobState.Failed ? 2 + i % 4 : 1 + i % 2, state === api.JobState.Failed ? failure[0] : undefined, state === api.JobState.Complete ? 12 + i % 9 : i % 9, state === api.JobState.Complete ? 12 + i % 9 : i % 5 === 0 ? undefined : 14 + i % 9, state === api.JobState.Failed ? failure[1] : undefined);
      const base = this.archiveAt(i), id = base.head.id, started = new Date(BASE - i * 3.1 * 3600e3 - (i % 7) * 600e3 - 5400e3);
      const metadata = new api.Metadata(title(i), PROJECTS[i % PROJECTS.length], '/work/' + (PROJECTS[i % PROJECTS.length] ?? 'scratch'), 'https://example.invalid/' + (PROJECTS[i % PROJECTS.length] ?? 'scratch') + '.git', BRANCHES[(i + 2) % BRANCHES.length], (0xa0000 + i * 977).toString(16).slice(0, 8), producer, MODELS[(i * 2) % MODELS.length], started.toISOString(), new Date(started.getTime() + 5400e3).toISOString(), tagsFor(i));
      const source = new api.SourceIdentity(`${collector}/native`, i % 17 === 5 ? `yolo:sandbox-${1 + i % 3}` : 'native', format, `producer-session-${i}`, i % 19 === 7 ? `subagent-${i}` : undefined);
      const head = new api.SessionInfo(new api.ContentView(revision, undefined), id, owner, revision, published === undefined ? undefined : publishedRevision, metadata, source, i % 5 === 0 ? api.Completion.Closed : api.Completion.Quiescent, i % 23 === 3);
      const headJob = job === undefined ? undefined : job.with({ sessionId: id });
      rows.push(new api.ArchiveRow(head, published, undefined, i % 29 === 28 ? undefined : new Date(BASE - i * 3.1 * 3600e3 - (i % 7) * 600e3).toISOString(), template.messages, tagsFor(i), headJob, published === undefined ? undefined : api.PassageFormat.ContextAwareProblems));
    }
    this.archiveRows = rows; this.archiveRowCount = rows.length;
  }
  seedActivity() {
    const target = this.targetProfile, own = this.archiveRows.filter(row => row.head.ownerId === this.user.id), jobs = [];
    own.forEach((row, n) => {
      const collectorId = row.head.source.collectorNamespace.split('/')[0];
      if (row.headJob !== undefined) {
        const profile = n % 9 === 4 ? 'obsolete-profile' : target, state = row.headJob.state;
        const classification = profile === target ? api.ActivityJobClass.Current : api.ActivityJobClass.ObsoleteProfile;
        const running = state === api.JobState.Running, active = running && n % 3 !== 0;
        jobs.push(new api.ActivityJob(row.headJob, profile, classification, running ? n % 3 === 2 ? undefined : active ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z' : undefined, active && n % 3 !== 2, classification === api.ActivityJobClass.Current && state === api.JobState.Failed, collectorId, row.head, row.lastTimestamp));
      }
      if (n % 3 === 0 && row.head.revision > 1) {
        const rev = row.head.revision - 1, failed = n % 6 === 0, historical = new api.JobInfo(uuid(8, n), row.head.id, rev, failed ? api.JobState.Failed : api.JobState.Complete, 1 + n % 3, failed ? FAIL_REASONS[n % 4][0] : undefined, 10, 10, failed ? FAIL_REASONS[n % 4][1] : undefined);
        jobs.push(new api.ActivityJob(historical, n % 2 === 0 ? target : 'obsolete-profile', n % 2 === 0 ? api.ActivityJobClass.SupersededRevision : api.ActivityJobClass.SupersededRevisionAndProfile, undefined, false, false, collectorId, row.head.with({ view: new api.ContentView(rev, undefined), revision: rev, indexedRevision: undefined }), row.lastTimestamp));
      }
    });
    this.activityJobs = jobs; this.jobs = jobs.map(item => item.job);
    this.activityCollectors = COLLECTOR_IDS.map((id, index) => {
      const mine = jobs.filter(item => item.collectorId === id), heads = own.filter(row => row.head.source.collectorNamespace === `${id}/native`);
      const phase = [api.CollectorPhase.Idle, api.CollectorPhase.Uploading, api.CollectorPhase.Scanning, api.CollectorPhase.Discovering, api.CollectorPhase.Failed][index % 5], stale = index % 7 === 3;
      const counters = new api.CollectorCounters(1200 + index * 31, 1180 + index * 29, index % 4, 12, 1000 + index * 17, 40 + index, 38 + index, phase === api.CollectorPhase.Failed ? 5 : 0, index % 6 === 0 ? 2 : 0, index % 4, 0, 0, BigInt(2_400_000_000 + index * 31_000_000));
      const report = new api.CollectorProgressUpdate(id, BigInt(1000 + index), uuid(7, index), phase, '2026-11-17T06:10:00Z', counters, 5_000_000n, phase === api.CollectorPhase.Uploading ? 3_100_000n : 5_000_000n, phase === api.CollectorPhase.Uploading ? 1_200_000n : undefined, phase === api.CollectorPhase.Failed ? 'upload rejected: 413 payload too large for session producer-session-77' : undefined);
      const status = index % 9 === 8 ? undefined : new api.CollectorStatus(report, stale ? '2026-11-17T04:12:00Z' : `2026-11-17T08:59:${String(10 + index % 49).padStart(2, '0')}Z`, stale);
      return new api.ActivityCollector(id, status, BigInt(heads.length), BigInt(heads.filter(row => row.headJob === undefined).length), this.counts(mine.filter(item => item.classification === api.ActivityJobClass.Current)), this.counts(mine.filter(item => item.classification !== api.ActivityJobClass.Current)));
    });
    this.collectorExpressions.set('freshness:stale', this.activityCollectors.filter(item => item.status !== undefined && item.status.stale).map(item => item.collectorId));
    this.collectorExpressions.set('phase:failed', this.activityCollectors.filter(item => item.status !== undefined && item.status.report.phase === api.CollectorPhase.Failed).map(item => item.collectorId));
    this.jobExpressions.set('status:failed', jobs.filter(item => item.job.state === api.JobState.Failed).map(item => item.job.id));
    this.jobExpressions.set('status:running', jobs.filter(item => item.job.state === api.JobState.Running).map(item => item.job.id));
    this.jobExpressions.set('agent:subagent', jobs.filter(item => item.session.source.subagentId !== undefined).map(item => item.job.id));
  }
  seedAccount() {
    const names = ['laptop-cli', 'ci-upload', 'collector-dgx-lne-01', 'notebook-experiments', 'temporary token for the demo of the dashboard to the storage team on Thursday', 'mcp-client'];
    this.staticTokens = [new api.TokenInfo(uuid(3, 1), 'collector-static', [api.Scope.Ingest], '2026-09-01T00:00:00Z', false), new api.TokenInfo(uuid(3, 2), 'readonly-dashboard-bot', [api.Scope.Read], '2026-09-01T00:00:00Z', false)];
    this.tokens = Array.from({ length: 5 }, (_, i) => new api.TokenInfo(uuid(3, 10 + i), names[i % names.length], i % 3 === 0 ? [api.Scope.Ingest] : i % 3 === 1 ? [api.Scope.Read, api.Scope.Raw] : [api.Scope.Read], `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, i === 2));
    this.groups = [
      new api.GroupInfo(uuid(4, 1), 'Systems workshop', 'alice', ['alice', 'bob', 'carol']),
      new api.GroupInfo(uuid(4, 2), 'Research circle with an unreasonably long group name that wraps in the card header', 'bob', ['bob', 'alice', ...Array.from({ length: 12 }, (_, i) => `researcher-${i + 1}`)]),
      new api.GroupInfo(uuid(4, 3), 'Storage team', 'alice', ['alice']),
    ];
    this.invitations = [new api.InviteInfo(uuid(5, 1), uuid(4, 7), 'alice', '2026-12-01T00:00:00Z'), new api.InviteInfo(uuid(5, 2), uuid(4, 8), 'alice', '2026-12-05T00:00:00Z')];
  }
  usage() {
    const rate = (tokens, calls, tps, age) => new api.TokenRateWindow(tokens, calls, 0n, tps, age);
    return new api.ModelUsageResult(NOW, '2026-11-17T01:00:00Z', '2026-11-17T08:59:50.010Z', NOW, 9990, api.ModelRateBasis.ProviderReportedCompletedCalls, new api.IndexingSettings(2, 3, 8), [
      new api.ModelUsageSlice(api.ModelPurpose.Annotation, 2, 8123n, 41n, 3n, 0n, rate(412_880n, 36n, 4128.8, 1200n), rate(91_204n, 36n, 912, 1200n), rate(30_552n, 36n, 305, 1200n)),
      new api.ModelUsageSlice(api.ModelPurpose.DocumentEmbedding, 3, 44021n, 12n, 0n, 0n, rate(2_204_000n, 24n, 22040, 800n), undefined, undefined),
      new api.ModelUsageSlice(api.ModelPurpose.QueryEmbedding, 0, 312n, 0n, 0n, 0n, rate(0n, 0n, undefined, undefined), undefined, undefined),
      new api.ModelUsageSlice(api.ModelPurpose.McpTest, 0, 14n, 1n, 0n, 0n, rate(8_411n, 1n, 84.1, 600000n), rate(1_202n, 1n, 12, 600000n), rate(0n, 1n, 0, 600000n)),
    ]);
  }
  matches(row, expression) {
    const parts = expression.match(/"[^"]*"|\S+/g) ?? [], metadata = row.head.metadata;
    return parts.every(raw => {
      const token = raw.replaceAll('"', '');
      if (/^(AND|OR|NOT)$/.test(token) || token.startsWith('mode:') || token === '(' || token === ')') return true;
      const field = /^([a-z-]+):(.*)$/.exec(token);
      if (field !== null) {
        const [, name, value] = field, state = row.headJob === undefined ? 'unscheduled' : row.headJob.state.toLowerCase();
        const actual = { project: metadata.project, branch: metadata.gitBranch, producer: metadata.producer, model: metadata.model, user: row.head.ownerId, status: state, format: row.head.source.format.toLowerCase(), tag: row.tags.join(' ') }[name];
        return actual === undefined ? name === 'after' || name === 'before' : actual.toLowerCase().includes(value.replace(/^\(|\)$/g, '').toLowerCase());
      }
      return `${metadata.title} ${row.tags.join(' ')} ${metadata.project ?? ''}`.toLowerCase().includes(token.replace(/^\(|\)$/g, '').toLowerCase()) || this.messagesAt(row.head.revision).some(message => message.text.toLowerCase().includes(token.replace(/^\(|\)$/g, '').toLowerCase()));
    });
  }
  archiveResult(query) {
    const all = this.archiveRows;
    try { this.archiveRows = all.filter(row => this.matches(row, query.expression)); return super.archiveResult(query); } finally { this.archiveRows = all; }
  }
  relatedFor(sessionId) { return this.archiveRows.filter(row => row.head.id !== sessionId && row.head.ownerId === 'alice').slice(3, 7).map(row => new api.SearchHit(row.head, [], 0.8)); }
  handle(operation, envelope, send, entry) {
    if (operation instanceof api.Operation_Related) { send(new api.Result_Related(new api.RelatedResult(this.relatedFor(operation.sessionId)))); return true; }
    if (operation instanceof api.Operation_ArchiveSearch) {
      if (this.archiveSearchFailure !== null) { send(new api.Result_Error(new api.Failure('unavailable', this.archiveSearchFailure))); return true; }
      const query = operation.query, matched = this.archiveRows.filter(row => this.matches(row, query.expression));
      const offset = query.cursor === undefined ? 0 : Number(query.cursor), term = (query.expression.match(/[A-Za-z][A-Za-z_-]{3,}/g) ?? ['migration']).find(word => !/^(mode|lexical|semantic|hybrid)$/i.test(word)) ?? 'migration';
      const page = matched.slice(offset, offset + query.limit).map(row => row.with({ matchedView: row.publishedView ?? row.head.view }));
      const evidence = page.map(row => {
        const view = row.matchedView, messages = this.messagesAt(view.revision), hits = [];
        for (const message of messages) { const at = message.text.toLowerCase().indexOf(term.toLowerCase()); if (at >= 0 && hits.length < 2) hits.push([message, at]); }
        if (hits.length === 0) hits.push([messages[Math.min(9, messages.length - 1)], 0]);
        const semantic = row.publishedView !== undefined;
        return new api.ArchiveSearchEvidence(row.head.id, hits.map(([message, at]) => { const before = Buffer.byteLength(message.text.slice(0, at)); return new api.ArchiveSourceMatch(view, new api.Span(message.id, before, before + Buffer.byteLength(message.text.slice(at, at + term.length))), semantic ? api.ArchiveMatchKind.Semantic : api.ArchiveMatchKind.Literal, term, semantic ? 'Agent worked around the failing step instead of diagnosing it.' : undefined); }));
      });
      const nextOffset = offset + page.length, result = new api.ArchiveSearchResult(new api.ArchiveResult(page, BigInt(matched.length), nextOffset < matched.length ? String(nextOffset) : undefined, api.ArchiveTextScope.BoundedCandidateSets, 1000, true), evidence);
      const reply = () => send(new api.Result_ArchiveSearch(result));
      if (this.holdSearch) this.pendingSearch.push(reply); else reply();
      return true;
    }
    if (operation instanceof api.Operation_SearchSessionMessages) {
      const key = JSON.stringify([operation.sessionId, operation.literal]);
      let offset = 0;
      if (operation.cursor !== undefined) { const decoded = JSON.parse(Buffer.from(operation.cursor, 'base64url').toString()); if (decoded[0] !== key) throw new Error('Capture find cursor mismatch'); offset = decoded[1]; }
      const needle = operation.literal.toLowerCase(), hits = this.messagesAt(operation.view.revision).flatMap((message, position) => message.text.toLowerCase().includes(needle) ? [new api.MessageSearchHit(message.id, position)] : []);
      const next = offset + operation.limit < hits.length ? Buffer.from(JSON.stringify([key, offset + operation.limit])).toString('base64url') : undefined;
      send(new api.Result_SessionMessageSearch(new api.SessionMessageSearchResult(operation.view, hits.slice(offset, offset + operation.limit), next))); return true;
    }
    return super.handle(operation, envelope, send, entry);
  }
}
CaptureFixture.prototype.releaseSearch = function () { this.holdSearch = false; for (const reply of this.pendingSearch.splice(0)) reply(); };
export function seededFixture(configure) { const fixture = new CaptureFixture(); if (configure !== undefined) configure(fixture); return fixture; }
