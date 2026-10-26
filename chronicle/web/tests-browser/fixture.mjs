import * as api from '../src/api.ts';
import { createHash } from 'node:crypto';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.ts';
const context = BaboonCodecContext.Default;
const ID = { session: '00000000-0000-4000-8000-000000000001', chunk: '00000000-0000-4000-8000-000000000002', token: '00000000-0000-4000-8000-000000000003', group: '00000000-0000-4000-8000-000000000004', invitation: '00000000-0000-4000-8000-000000000005', job: '00000000-0000-4000-8000-000000000006', otherGroup: '00000000-0000-4000-8000-000000000007' };
function ordered(rows, value, id, direction) {
  return [...rows].sort((left, right) => {
    const a = value(left), b = value(right);
    if (a === undefined || b === undefined) return a === b ? id(left).localeCompare(id(right)) : a === undefined ? 1 : -1;
    const order = a < b ? -1 : a > b ? 1 : 0;
    return (direction === api.SortDirection.Asc ? order : -order) || id(left).localeCompare(id(right));
  });
}
function fixturePage(rows, cursor, limit, key) {
  let offset = 0;
  if (cursor !== undefined) { const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (decoded[0] !== key) throw new Error('Fixture cursor binding mismatch'); offset = decoded[1]; }
  return { rows: rows.slice(offset, offset + limit), next: offset + limit < rows.length ? Buffer.from(JSON.stringify([key, offset + limit])).toString('base64url') : undefined };
}
function leaseState(item) { return item.job.state !== api.JobState.Running ? 'inactive' : item.leaseActive ? 'active' : item.leaseExpiresAt === undefined ? 'unleased' : 'expired'; }
export class ChronicleFixture {
  user = new api.UserInfo('alice', 'alice', [api.Scope.Read, api.Scope.Raw]);
  version = new api.VersionInfo('1.3.0', '1.0.0', ['1.3.0', '1.2.0', '1.1.0', '1.0.0']);
  sockets = []; calls = []; requests = []; receipts = new Map(); tokens = []; staticTokens = []; collectors = []; collectionDenied = false;
  groups = [new api.GroupInfo(ID.group, 'Systems workshop', 'alice', ['alice', 'bob']), new api.GroupInfo(ID.otherGroup, 'Research circle', 'bob', ['bob', 'alice'])];
  invitations = [new api.InviteInfo(ID.invitation, ID.otherGroup, 'alice', '2030-01-01T00:00:00Z')];
  jobs = [new api.JobInfo(ID.job, ID.session, 2, api.JobState.Failed, 3, 'Embedding provider unavailable; archived source is preserved.', 0, undefined)];
  archiveRowCount = 1; archiveRows = undefined; archiveExcluded = new Set(); archiveFailure = null; holdArchiveCursor = false; pendingArchive = [];
  activityJobs = undefined; activityCollectors = undefined; collectorExpressions = new Map(); jobExpressions = new Map(); activityFailure = null;
  holdCollectorCursor = false; holdJobCursor = false; pendingCollectors = []; pendingJobs = [];
  targetProfile = 'target-profile'; jobFences = new Map(); bulkPayloads = new Map(); bulkApplyExecutions = 0; bulkDropReply = false; bulkConflictOnce = false; bulkPreviewDenied = false; bulkApplyDenied = false; retryCountsOverride = undefined; messageCount = 87; lateMessageId = 'm65'; holdLocators = false; pendingLocators = [];
  annotationCount = 2; winnerBeyondFirstPage = false; resumedSource = false; headRevision = 2; publishedRevision = 1; messageViewOverride = undefined; chunksViewOverride = undefined; rawRevisionOverride = undefined;
  holdMessages = false; pendingMessages = [];
  mode = 'normal'; signedIn = true; mintUncertain = false; dropLogout = false; rawDenied = true; searchCount = 0;
  metadata = new api.Metadata('Following the migration thread', 'chronicle', '/synthetic/project', 'https://example.invalid/synthetic.git', 'feature/archive', 'ab12cd34', 'pi', 'synthetic-model', '2026-10-23T09:30:00Z', undefined, ['architecture', 'source-fidelity']);
  source = new api.SourceIdentity('synthetic-collector', 'native', api.SourceFormat.Pi, 'synthetic-session', undefined);
  viewAt(revision) { return new api.ContentView(revision, `00000000-0000-4000-8000-${String(5000 + revision).padStart(12, '0')}`); }
  get view() { return this.viewAt(this.publishedRevision); }
  sessionAt(view) { return new api.SessionInfo(view, ID.session, 'alice', this.headRevision, this.publishedRevision, this.metadata, this.source, api.Completion.Quiescent, false); }
  get session() { return this.sessionAt(this.view); }
  messagesAt(revision) { const messages = [new api.Message('m1', undefined, 'user', 'Can we preserve the original 猫🦄 source while the index catches up?', '2026-10-23T09:30:00Z', 0), new api.Message('m2', 'm1', 'assistant', 'Keep immutable source revisions. Publish annotations atomically. A quiescent snapshot does not assert that the process has ended.\n\n<script>alert("untrusted transcript")</script>', '2026-10-23T09:31:00Z', 1), ...Array.from({length: this.messageCount - 2}, (_, i) => new api.Message(`m${i + 3}`, 'm2', i % 2 ? 'tool' : 'assistant', `Synthetic source message ${i + 3}. Literal archived text, never executed.`, undefined, i + 2))];
    return this.resumedSource && revision === 2 ? messages.map(message => message.with({ text: message.id === 'm1' ? 'HEAD r2 changed the original message text completely.' : `Revision 2 changed message ${message.id}.` })) : messages;
  }
  get messages() { return this.messagesAt(this.headRevision); }
  chunksAt(view) {
    if (view.generationId === undefined) return [];
    const messages = this.messagesAt(view.revision);
    const chunks = [new api.Chunk(ID.chunk, ID.session, messages[0].text, 'Keep original source independent from publication.', ['source-fidelity'], [new api.Span('m1', 29, 36)], 0.93), new api.Chunk('00000000-0000-4000-8000-000000000008', ID.session, 'Late source page', 'A passage on a later bounded source page.', ['pagination'], [new api.Span(this.lateMessageId, 0, 9)], 0.8)];
    for (let index = chunks.length; index < this.annotationCount; index++) chunks.push(new api.Chunk(`00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, ID.session, messages[Number(this.lateMessageId.slice(1)) - 1].text, index === 164 ? 'Winning passage beyond the first hundred.' : `Annotated passage ${index + 1}.`, ['pagination'], [new api.Span(this.lateMessageId, 0, 9)], index === 164 ? 0.99 : 0.5));
    return chunks;
  }
  get chunks() { return this.chunksAt(this.view); }
  get hit() { return new api.SearchHit(this.session, this.winnerBeyondFirstPage ? [this.chunks[164]] : this.chunks.slice(0, 2), .93); }
  archiveAt(index) {
    const id = index === 0 ? ID.session : `00000000-0000-4000-8000-${String(10000 + index).padStart(12, '0')}`;
    const metadata = index === 0 ? this.metadata : this.metadata.with({ title: `Synthetic conversation ${String(index + 1).padStart(3, '0')}`, project: index % 5 === 0 ? undefined : `Project ${index % 5}`, gitBranch: `branch-${index % 4}`, producer: index % 2 ? 'pi' : 'codex', model: index % 6 === 0 ? undefined : `model-${index % 3}` });
    const head = this.sessionAt(new api.ContentView(this.headRevision, undefined)).with({ id, metadata });
    const published = index === 0 || index % 3 !== 0 ? this.view : undefined;
    return new api.ArchiveRow(head, published, undefined, index % 17 === 16 ? undefined : new Date(Date.parse('2026-10-23T09:31:00Z') - Math.floor(index / 2) * 60000).toISOString(), this.messageCount + index, index === 0 ? metadata.tags : [`tag-${index % 4}`], index === 0 ? this.jobs.find(job => job.revision === this.headRevision) : undefined);
  }
  get authorizedRows() { return (this.archiveRows ?? Array.from({ length: this.archiveRowCount }, (_, index) => this.archiveAt(index))).filter(row => !this.archiveExcluded.has(row.head.id)); }
  archiveResult(query) {
    let rows = [...this.authorizedRows];
    const value = row => {
      switch (query.sort) {
        case api.ArchiveSort.LastTimestamp: return row.lastTimestamp;
        case api.ArchiveSort.Title: return row.head.metadata.title;
        case api.ArchiveSort.Owner: return row.head.ownerId;
        case api.ArchiveSort.Project: return row.head.metadata.project;
        case api.ArchiveSort.Branch: return row.head.metadata.gitBranch;
        case api.ArchiveSort.Producer: return row.head.metadata.producer;
        case api.ArchiveSort.Format: return row.head.source.format;
        case api.ArchiveSort.Model: return row.head.metadata.model;
        case api.ArchiveSort.Status: return row.headJob === undefined ? 'unscheduled' : row.headJob.state.toLowerCase();
        case api.ArchiveSort.MessageCount: return row.messageCount;
        case api.ArchiveSort.Tags: return [...row.tags].sort()[0];
        default: throw new Error('Unknown fixture sort');
      }
    };
    rows.sort((left, right) => { const a = value(left), b = value(right); if (a === undefined || b === undefined) return a === b ? left.head.id.localeCompare(right.head.id) : a === undefined ? 1 : -1; const order = typeof a === 'number' ? a - b : a.localeCompare(b); return (query.direction === api.SortDirection.Asc ? order : -order) || left.head.id.localeCompare(right.head.id); });
    const offset = query.cursor === undefined ? 0 : Number(query.cursor.split(':').at(-1));
    const lexical = /mode\s*:\s*lexical/i.test(query.expression), text = /original|migration|private-migration|missing-model/.test(query.expression);
    rows = rows.map(row => row.with({ matchedView: text ? lexical ? row.head.view : row.publishedView : undefined }));
    const next = offset + query.limit < rows.length ? `${query.sort}:${query.direction}:${offset + query.limit}` : undefined;
    return new api.ArchiveResult(rows.slice(offset, offset + query.limit), BigInt(rows.length), next, text && !lexical ? api.ArchiveTextScope.BoundedCandidateSets : api.ArchiveTextScope.ExactLexical, text && !lexical ? 1000 : undefined);
  }
  jobSession(job) {
    const metadata = job.revision === this.headRevision ? this.metadata : this.metadata.with({ title: `Historical r${job.revision} conversation`, project: `historical-project-${job.revision}`, gitBranch: `historical-branch-${job.revision}` });
    return this.sessionAt(new api.ContentView(job.revision, undefined)).with({ id: job.sessionId, metadata });
  }
  jobAt(index) {
    const revision = index % 3 === 0 ? this.headRevision - 1 : this.headRevision, profile = index % 5 === 0 ? 'obsolete-profile' : this.targetProfile;
    const classification = revision === this.headRevision ? profile === this.targetProfile ? api.ActivityJobClass.Current : api.ActivityJobClass.ObsoleteProfile : profile === this.targetProfile ? api.ActivityJobClass.SupersededRevision : api.ActivityJobClass.SupersededRevisionAndProfile;
    const row = this.archiveAt(index), states = [api.JobState.Complete, api.JobState.Failed, api.JobState.Queued, api.JobState.Running], state = states[index % states.length];
    const job = new api.JobInfo(`00000000-0000-4000-8000-${String(90000 + index).padStart(12, '0')}`, row.head.id, revision, state, index % 7 + 1, state === api.JobState.Failed ? 'synthetic-failure' : undefined, index, index % 4 === 0 ? undefined : index + 10);
    const session = this.jobSession(job).with({ metadata: this.jobSession(job).metadata.with({ title: `${revision === this.headRevision ? 'Current' : 'Historical'} metadata ${String(index).padStart(3, '0')}`, project: `project-${index % 7}` }) });
    return new api.ActivityJob(job, profile, classification, state === api.JobState.Running ? index % 2 === 0 ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z' : undefined, state === api.JobState.Running && index % 2 === 0, classification === api.ActivityJobClass.Current && state === api.JobState.Failed, `collector-${String(index % 8).padStart(3, '0')}`, session, index % 11 === 0 ? undefined : new Date(Date.parse('2026-10-23T09:31:00Z') - Math.floor(index / 2) * 60000).toISOString());
  }
  get jobRows() { return this.activityJobs ?? this.jobs.map(job => { const current = job.revision === this.headRevision; return new api.ActivityJob(job, this.targetProfile, current ? api.ActivityJobClass.Current : api.ActivityJobClass.SupersededRevision, undefined, false, current && job.state === api.JobState.Failed && job.error !== 'superseded-revision', this.source.collectorNamespace, this.jobSession(job), '2026-10-23T09:31:00Z'); }); }
  counts(jobs) {
    const count = state => BigInt(jobs.filter(item => item.job.state === state).length), running = jobs.filter(item => item.job.state === api.JobState.Running);
    return new api.JobCounts(BigInt(jobs.length), count(api.JobState.Queued), count(api.JobState.Running), count(api.JobState.Failed), count(api.JobState.Complete), BigInt(running.filter(item => item.leaseActive).length), BigInt(running.filter(item => !item.leaseActive && item.leaseExpiresAt !== undefined).length), BigInt(running.filter(item => item.leaseExpiresAt === undefined).length));
  }
  get collectorRows() {
    if (this.activityCollectors !== undefined) return this.activityCollectors;
    const reports = this.collectors.map(status => new api.ActivityCollector(status.report.collectorId, status, 0n, 0n, this.counts([]), this.counts([])));
    const ownRows = this.authorizedRows.filter(row => row.head.ownerId === this.user.id), current = this.jobRows.filter(item => item.classification === api.ActivityJobClass.Current), history = this.jobRows.filter(item => item.classification !== api.ActivityJobClass.Current);
    const namespace = this.source.collectorNamespace, report = reports.find(item => namespace === item.collectorId || namespace.startsWith(`${item.collectorId}/`));
    const base = new api.ActivityCollector(report === undefined ? namespace : report.collectorId, report === undefined ? undefined : report.status, BigInt(ownRows.length), BigInt(ownRows.filter(row => row.headJob === undefined).length), this.counts(current), this.counts(history));
    return [...reports.filter(item => item.collectorId !== base.collectorId), base].sort((a, b) => a.collectorId.localeCompare(b.collectorId));
  }
  collectorValue(row, sort) {
    const countFields = { Total: 'total', Queued: 'queued', Running: 'running', Failed: 'failed', Complete: 'complete', ActiveRunning: 'activeRunning', ExpiredRunning: 'expiredRunning', UnleasedRunning: 'unleasedRunning' };
    if (sort.startsWith('Current')) return row.current[countFields[sort.slice('Current'.length)]];
    if (sort.startsWith('Historical')) return row.historical[countFields[sort.slice('Historical'.length)]];
    switch (sort) {
      case api.ActivityCollectorSort.CollectorId: return row.collectorId;
      case api.ActivityCollectorSort.Phase: return row.status === undefined ? undefined : row.status.report.phase;
      case api.ActivityCollectorSort.Freshness: return row.status === undefined ? 'unknown' : row.status.stale ? 'stale' : 'recent';
      case api.ActivityCollectorSort.ReceivedAt: return row.status === undefined ? undefined : Date.parse(row.status.receivedAt);
      case api.ActivityCollectorSort.ArchiveHeads: return row.archiveHeads;
      case api.ActivityCollectorSort.HeadsWithoutTargetJob: return row.headsWithoutTargetJob;
      default: throw new Error('Unknown fixture collector sort');
    }
  }
  jobValue(row, sort) {
    switch (sort) {
      case api.ActivityJobSort.LastTimestamp: return row.lastTimestamp === undefined ? undefined : Date.parse(row.lastTimestamp);
      case api.ActivityJobSort.Title: return row.session.metadata.title;
      case api.ActivityJobSort.Collector: return row.collectorId;
      case api.ActivityJobSort.State: return row.job.state;
      case api.ActivityJobSort.Revision: return row.job.revision;
      case api.ActivityJobSort.Profile: return row.profile;
      case api.ActivityJobSort.Attempts: return row.job.attempts;
      case api.ActivityJobSort.CompletedWindows: return row.job.completedWindows;
      case api.ActivityJobSort.TotalWindows: return row.job.totalWindows;
      case api.ActivityJobSort.LeaseExpiresAt: return row.leaseExpiresAt === undefined ? undefined : Date.parse(row.leaseExpiresAt);
      case api.ActivityJobSort.LeaseState: return leaseState(row);
      case api.ActivityJobSort.Reason: return row.job.error;
      case api.ActivityJobSort.Classification: return row.classification;
      case api.ActivityJobSort.JobId: return row.job.id;
      case api.ActivityJobSort.SessionId: return row.job.sessionId;
      default: throw new Error('Unknown fixture job sort');
    }
  }
  activityResult(query) {
    const all = this.collectorRows, selected = query.expression === '' ? all : all.filter(row => this.collectorExpressions.get(query.expression).includes(row.collectorId));
    const rows = ordered(selected, row => this.collectorValue(row, query.sort), row => row.collectorId, query.direction);
    const page = fixturePage(rows, query.cursor, query.limit, JSON.stringify(['collectors', this.user.id, query.expression, query.sort, query.direction]));
    const current = this.jobRows.filter(item => item.classification === api.ActivityJobClass.Current), historical = this.jobRows.filter(item => item.classification !== api.ActivityJobClass.Current), owned = this.authorizedRows.filter(row => row.head.ownerId === this.user.id);
    return new api.ActivityResult('2026-10-26T12:00:00Z', this.user, BigInt(owned.length), BigInt(owned.filter(row => row.headJob === undefined).length), this.counts(current), this.counts(historical), page.rows, BigInt(rows.length), BigInt(all.length), page.next);
  }
  activityJobsResult(query) {
    const scoped = this.jobRows.filter(item => (query.scope === api.ActivityJobScope.All || (query.scope === api.ActivityJobScope.Current) === (item.classification === api.ActivityJobClass.Current)) && (query.collectorId === undefined || item.collectorId === query.collectorId));
    const selected = query.expression === '' ? scoped : scoped.filter(row => this.jobExpressions.get(query.expression).includes(row.job.id));
    const rows = ordered(selected, row => this.jobValue(row, query.sort), row => row.job.id, query.direction);
    const page = fixturePage(rows, query.cursor, query.limit, JSON.stringify(['jobs', this.user.id, query.collectorId, query.scope, query.expression, query.sort, query.direction]));
    return new api.ActivityJobsResult('2026-10-26T12:00:00Z', page.rows, BigInt(rows.length), page.next);
  }
  retryPlan() {
    const rows = this.jobRows.filter(row => row.session.ownerId === this.user.id), eligible = rows.filter(row => row.classification === api.ActivityJobClass.Current && row.job.revision === row.session.revision && row.profile === this.targetProfile && row.job.state === api.JobState.Failed);
    const failed = classification => BigInt(rows.filter(row => row.classification === classification && row.job.state === api.JobState.Failed).length), unchanged = state => BigInt(rows.filter(row => row.job.state === state).length);
    const counts = this.retryCountsOverride ?? new api.RetryFailedCounts(BigInt(eligible.length), failed(api.ActivityJobClass.SupersededRevision), failed(api.ActivityJobClass.ObsoleteProfile), failed(api.ActivityJobClass.SupersededRevisionAndProfile), unchanged(api.JobState.Queued), unchanged(api.JobState.Running), unchanged(api.JobState.Complete));
    const selection = [this.user.id, this.targetProfile, ...eligible.map(row => [row.job.id, row.job.revision, this.jobFences.get(row.job.id) ?? 0]).sort((left, right) => left[0].localeCompare(right[0]))];
    return new api.RetryFailedPlan(this.targetProfile, createHash('sha256').update(JSON.stringify(selection)).digest('hex'), counts);
  }
  async install(page) {
    await page.route('**/api/login', route => {
      const request = api.LoginRequest_JsonCodec.instance.decode(context, route.request().postDataJSON());
      if (!['alice', 'bob'].includes(request.login) || request.password !== 'synthetic-password') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(api.Failure_JsonCodec.instance.encode(context, new api.Failure('unauthorized', 'Invalid credentials'))) });
      this.user = new api.UserInfo(request.login, request.login, [api.Scope.Read, api.Scope.Raw]);
      this.signedIn = true; this.mode = 'normal';
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Set-Cookie': 'chronicle_session=synthetic; HttpOnly; SameSite=Strict; Path=/' }, body: JSON.stringify(api.LoginResponse_JsonCodec.instance.encode(context, new api.LoginResponse(this.user, this.version))) });
    });
    await page.routeWebSocket('**/api/ws', socket => {
      const entry = { socket, mode: this.mode, closed: false }; this.sockets.push(entry);
      socket.onClose(() => { entry.closed = true; });
      socket.onMessage(data => {
        const envelope = api.ClientEnvelope_JsonCodec.instance.decode(context, JSON.parse(String(data)));
        this.calls.push(envelope); this.requests.push({ userId: this.user.id, envelope }); const operation = envelope.operation;
        if (entry.mode === 'blackhole' || this.mode === 'outage') return;
        const send = result => socket.send(JSON.stringify(api.ServerEnvelope_JsonCodec.instance.encode(context, new api.ServerEnvelope(envelope.requestId, result))));
        if (this.mode === 'unauthorized' || !this.signedIn) { send(new api.Result_Error(new api.Failure('unauthorized', 'Your session expired. Sign in again.'))); return; }
        if (this.mode === 'version') { send(new api.Result_Error(new api.Failure('version-mismatch', 'Dashboard update required'))); return; }
        if (operation instanceof api.Operation_Hello) { send(new api.Result_Hello(this.version, this.user)); return; }
        if (operation instanceof api.Operation_Ping) { send(new api.Result_Pong(operation.nonce)); return; }
        if (operation instanceof api.Operation_Pong) return;
        if (operation instanceof api.Operation_Whoami) { send(new api.Result_Whoami(this.user)); return; }
        if (operation instanceof api.Operation_Archive) {
          this.searchCount++;
          if (this.archiveFailure !== null) { send(new api.Result_Error(new api.Failure('invalid', this.archiveFailure))); return; }
          const result = this.archiveResult(operation.query), reply = () => send(new api.Result_Archive(result));
          if (this.holdArchiveCursor && operation.query.cursor !== undefined) this.pendingArchive.push(reply); else reply();
          return;
        }
        if (operation instanceof api.Operation_Activity) {
          if (this.collectionDenied) { send(new api.Result_Error(new api.Failure('forbidden', 'Collection status denied'))); return; }
          if (this.activityFailure !== null || (operation.query.expression !== '' && !this.collectorExpressions.has(operation.query.expression))) { send(new api.Result_Error(new api.Failure('invalid', this.activityFailure ?? 'Unsupported synthetic metadata expression'))); return; }
          const result = this.activityResult(operation.query), reply = () => send(new api.Result_Activity(result));
          if (this.holdCollectorCursor && operation.query.cursor !== undefined) this.pendingCollectors.push(reply); else reply(); return;
        }
        if (operation instanceof api.Operation_ActivityJobs) {
          if (this.activityFailure !== null || (operation.query.expression !== '' && !this.jobExpressions.has(operation.query.expression))) { send(new api.Result_Error(new api.Failure('invalid', this.activityFailure ?? 'Unsupported synthetic metadata expression'))); return; }
          const result = this.activityJobsResult(operation.query), reply = () => send(new api.Result_ActivityJobs(result));
          if (this.holdJobCursor && operation.query.cursor !== undefined) this.pendingJobs.push(reply); else reply(); return;
        }
        if (operation instanceof api.Operation_PreviewRetryFailed) { send(this.bulkPreviewDenied ? new api.Result_Error(new api.Failure('forbidden', 'Browser Read scope required for retry preview')) : new api.Result_RetryFailedPreview(this.retryPlan())); return; }
        if (operation instanceof api.Operation_ApplyRetryFailed) {
          if (this.bulkApplyDenied) { send(new api.Result_Error(new api.Failure('forbidden', 'Browser Read scope required for retry'))); return; }
          const payload = JSON.stringify(api.Operation_JsonCodec.instance.encode(context, operation)), stored = this.receipts.get(envelope.requestId);
          if (stored !== undefined) { send(this.bulkPayloads.get(envelope.requestId) === payload ? stored : new api.Result_Error(new api.Failure('conflict', 'Request payload changed'))); return; }
          if (this.bulkConflictOnce) { this.bulkConflictOnce = false; for (const row of this.jobRows) this.jobFences.set(row.job.id, (this.jobFences.get(row.job.id) ?? 0) + 1); }
          const plan = this.retryPlan();
          if (!operation.confirm || operation.targetProfile !== plan.targetProfile || operation.selectionHash !== plan.selectionHash) { send(new api.Result_Error(new api.Failure('conflict', 'Indexing selection changed; preview again'))); return; }
          const ids = new Set(this.jobRows.filter(row => row.session.ownerId === this.user.id && row.classification === api.ActivityJobClass.Current && row.job.revision === row.session.revision && row.profile === this.targetProfile && row.job.state === api.JobState.Failed).map(row => row.job.id));
          const retried = job => ids.has(job.id) ? job.with({ state: api.JobState.Queued, attempts: 0, error: undefined, completedWindows: 0, totalWindows: undefined }) : job;
          this.jobs = this.jobs.map(retried); if (this.activityJobs !== undefined) this.activityJobs = this.activityJobs.map(row => ids.has(row.job.id) ? row.with({ job: retried(row.job), retryable: false, leaseActive: false, leaseExpiresAt: undefined }) : row);
          this.bulkApplyExecutions++; const receipt = new api.Result_RetryFailed(new api.RetryFailedResult(envelope.requestId, plan.targetProfile, BigInt(ids.size), plan.counts));
          this.receipts.set(envelope.requestId, receipt); this.bulkPayloads.set(envelope.requestId, payload); if (!this.bulkDropReply) send(receipt); return;
        }
        if (operation instanceof api.Operation_LocateMessage) {
          const view = operation.view, messages = this.messagesAt(view.revision), position = messages.findIndex(message => message.id === operation.messageId);
          const reply = () => send(position < 0 ? new api.Result_Error(new api.Failure('not-found', 'Source message not found')) : new api.Result_LocatedMessage(new api.MessageLocation(view, position, messages.length)));
          if (this.holdLocators) this.pendingLocators.push(reply); else reply(); return;
        }
        if (operation instanceof api.Operation_Search) {
          this.searchCount++;
          const lexical = operation.query.mode === api.SearchMode.Lexical;
          send(new api.Result_Search(new api.SearchResult([this.hit], 1, lexical ? api.SearchCountScope.ExactMatches : api.SearchCountScope.CandidateWindow, lexical ? undefined : operation.query.mode === api.SearchMode.Hybrid ? 2000 : 1000))); return;
        }
        if (operation instanceof api.Operation_Facets) { send(new api.Result_Facets(new api.FacetsResult([new api.Facet('chronicle', 1)], [new api.Facet('feature/archive', 1)], [new api.Facet('architecture', 1)]))); return; }
        if (operation instanceof api.Operation_GetSession) { const view = operation.view ?? this.view, row = this.authorizedRows.find(item => item.head.id === operation.sessionId), session = row === undefined ? this.sessionAt(view) : row.head.with({ view }); send(new api.Result_Session(new api.SessionResult(session, this.chunksAt(view).slice(0, 100)))); return; }
        if (operation instanceof api.Operation_GetChunks) { const view = this.chunksViewOverride ?? operation.view ?? this.view, chunks = this.chunksAt(view); send(new api.Result_Chunks(new api.ChunksResult(chunks.slice(operation.offset, operation.offset + operation.limit), chunks.length, operation.offset, view))); return; }
        if (operation instanceof api.Operation_GetMessages) { const view = this.messageViewOverride ?? operation.view ?? this.view, messages = this.messagesAt(view.revision); const reply = () => send(new api.Result_Messages(new api.MessagesResult(messages.slice(operation.offset, operation.offset + operation.limit), messages.length, operation.offset, view))); if (this.holdMessages) this.pendingMessages.push(reply); else reply(); return; }
        if (operation instanceof api.Operation_GetRaw) { const revision = this.rawRevisionOverride ?? operation.revision ?? this.headRevision; send(this.rawDenied ? new api.Result_Error(new api.Failure('forbidden', 'Raw permission denied for this source')) : new api.Result_Raw(new api.RawResult([new api.RawFile('synthetic.jsonl', '0'.repeat(64), this.resumedSource ? JSON.stringify({ revision }) : '{"synthetic":true}')], revision))); return; }
        if (operation instanceof api.Operation_Related) { send(new api.Result_Related(new api.RelatedResult([]))); return; }
        if (operation instanceof api.Operation_ListTokens) { send(new api.Result_Tokens(new api.TokensResult([...this.staticTokens.map(info => new api.ListedToken(info, api.TokenSource.StaticConfig)), ...this.tokens.map(info => new api.ListedToken(info, api.TokenSource.Issued))]))); return; }
        if (operation instanceof api.Operation_ListGroups) { send(new api.Result_Groups(new api.GroupsResult(this.groups, this.invitations))); return; }
        if (operation instanceof api.Operation_CollectionStatus) { send(this.collectionDenied ? new api.Result_Error(new api.Failure('forbidden', 'Collection status denied')) : new api.Result_CollectionStatus(new api.CollectorStatusResult(this.collectors))); return; }
        if (operation instanceof api.Operation_IngestStatus) { send(new api.Result_Status(new api.StatusResult(this.jobs, this.jobs.length))); return; }
        if (operation instanceof api.Operation_Receipt) { const receipt = this.receipts.get(operation.mutationId); send(receipt ? receipt instanceof api.Result_Token || receipt instanceof api.Result_RetryFailed ? receipt : new api.Result_Mutation(receipt) : new api.Result_Error(new api.Failure('not-found', 'Receipt not found'))); return; }
        let entityId;
        if (operation instanceof api.Operation_MintToken) {
          entityId = ID.token; const token = new api.TokenInfo(entityId, operation.name, operation.scopes, '2026-10-24T00:00:00Z', false); this.tokens = [token];
          this.receipts.set(envelope.requestId, new api.Result_Token(new api.TokenResult(token, undefined)));
          if (this.mintUncertain) return;
          send(new api.Result_Token(new api.TokenResult(token, 'synthetic-secret-shown-once'))); return;
        }
        if (operation instanceof api.Operation_RevokeToken) this.tokens = this.tokens.map(token => token.id === operation.tokenId ? token.with({ revoked: true }) : token);
        if (operation instanceof api.Operation_CreateGroup) { entityId = ID.group; this.groups = [...this.groups, new api.GroupInfo('00000000-0000-4000-8000-000000000009', operation.name, 'alice', ['alice'])]; }
        if (operation instanceof api.Operation_Invite) this.invitations = [...this.invitations, new api.InviteInfo('00000000-0000-4000-8000-000000000010', operation.groupId, operation.targetId, '2030-01-01T00:00:00Z')];
        if (operation instanceof api.Operation_AcceptInvite) this.invitations = this.invitations.filter(invitation => invitation.id !== operation.invitationId);
        if (operation instanceof api.Operation_RemoveMember) this.groups = this.groups.map(group => group.id === operation.groupId ? group.with({ members: group.members.filter(member => member !== operation.userId) }) : group);
        if (operation instanceof api.Operation_LeaveGroup || operation instanceof api.Operation_DeleteGroup) this.groups = this.groups.filter(group => group.id !== operation.groupId);
        if (operation instanceof api.Operation_RetryJob) this.jobs = this.jobs.map(job => job.id === operation.jobId ? job.with({ state: api.JobState.Queued }) : job);
        if (operation instanceof api.Operation_Logout) this.mode = 'unauthorized';
        const receipt = new api.MutationReceipt(envelope.requestId, operation.$type.split('#').at(-1), entityId); this.receipts.set(envelope.requestId, receipt); if (operation instanceof api.Operation_Logout && this.dropLogout) return; send(new api.Result_Mutation(receipt));
      });
    });
  }
  releaseCollectors() { this.holdCollectorCursor = false; for (const reply of this.pendingCollectors.splice(0)) reply(); }
  releaseJobs() { this.holdJobCursor = false; for (const reply of this.pendingJobs.splice(0)) reply(); }
  releaseArchive() { this.holdArchiveCursor = false; for (const reply of this.pendingArchive.splice(0)) reply(); }
  releaseLocators() { this.holdLocators = false; for (const reply of this.pendingLocators.splice(0)) reply(); }
  releaseMessages() { this.holdMessages = false; for (const reply of this.pendingMessages.splice(0)) reply(); }
  blackholeActive() { const active = this.sockets.filter(s => !s.closed).at(-1); if (!active) throw new Error('No socket'); active.mode = 'blackhole'; }
  restart() { for (const entry of this.sockets.filter(s => !s.closed)) entry.socket.close({ code: 1012, reason: 'Synthetic server restart' }); }
}
export { api };
