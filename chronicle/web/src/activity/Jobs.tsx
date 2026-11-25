import { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { ActivityClaimOrder, SortDirection, ActivityJobClass, ActivityJobScope, ActivityJobSort, ActivityJobsQuery, ExpressionHintTarget_ActivityJobs, JobState, Operation_ActivityJobs, Operation_RetryJob, Result_ActivityJobs, type ActivityClassQueue, type ActivityJob, type ActivityJobsResult, type ActivityResult, type UserInfo } from '../api.ts';
import { read, type ChronicleConnection } from '../client.ts';
import { useSettledInfiniteResource } from '../infinite.ts';
import { validateMetadataExpression } from '../expression.ts';
import type { MutationState } from '../mutations.ts';
import { RouteStateContext, formatRoute, sessionRoute, useRouteState } from '../router.ts';
import type { ManagerStats } from '../transport/types.ts';
import { FilterBar, type FilterField } from '../FilterShortcuts.tsx';
import { MetadataHelp, MetadataQueryBar } from '../MetadataEditor.tsx';
import { ColumnMenu } from '../TableColumns.tsx';
import { Icon } from '../Icon.tsx';
import { Glyph } from '../Glyph.tsx';
import { windowProgress } from '../progress.ts';
import { recordedYoloProfile } from '../recorded-yolo-profile.ts';
import { ACTIVITY_INSTANCE, JOB_CHAINS, JOBS_DRAFT, JOBS_OPENED, JOBS_STATE, collectorsRouteFor, type JobScope, type JobsState } from './state.ts';
import { collectorFilter, withCollector } from './collector-filter.ts';
import { ListTable, count, nextOrder, useListTable, type Column } from './list.tsx';
import { When, clockMinutes, clockTime } from './time.tsx';
import { UNCLASSIFIED_NOTE, ahead, jobClass, orderDescription, stateLabel, waitedFor, waitedSince, why, type Ahead } from './claim-order.ts';

const PAGE_SIZE = 50;
const COLUMN_CHOICES_KEY = 'chronicle.activity.jobs.columns';
const PLACEHOLDER = 'Filter — status:failed AND collector:"ci-runner-04"';
const PERCENT = 100;
// The details toggle, with the cell padding.
const ACTIONS_WIDTH = { min: 72, ideal: 76, max: 120 };
// Shortcut-row order: the fields of the mockup first; the rest fold into "more…".
const fields: readonly FilterField[] = ['collector', 'project', 'branch', 'user', 'tag', 'reason', 'lease', 'agent', 'yolo-profile', 'status', 'producer', 'format', 'model', 'after', 'before', 'profile', 'classification']
  .map(attribute => ({ attribute, label: attribute === 'yolo-profile' ? 'Recorded yolo profile' : attribute[0]!.toUpperCase() + attribute.slice(1) }));
const presets = [{ attribute: 'status', label: 'Failed', value: 'failed' }, { attribute: 'status', label: 'Running', value: 'running' }, { attribute: 'agent', label: 'Main agents', value: 'main' }, { attribute: 'agent', label: 'Subagents', value: 'subagent' }];
const scopeNoun = (scope: JobScope) => scope === ActivityJobScope.Current ? 'current' : 'historical';
function classificationLabel(classification: ActivityJobClass): string {
  switch (classification) {
    case ActivityJobClass.Current: return 'Current';
    case ActivityJobClass.SupersededRevision: return 'Superseded revision';
    case ActivityJobClass.ObsoleteProfile: return 'Obsolete profile';
    case ActivityJobClass.SupersededRevisionAndProfile: return 'Both: superseded revision + obsolete profile';
  }
}
// A Queued job with a lease waits for its next attempt (a transient database failure's back-off); the lease filter calls it inactive.
type Lease = 'Active' | 'Expired' | 'Unleased' | 'Inactive' | 'Waiting';
function lease(row: ActivityJob): Lease { return row.leaseExpiresAt === undefined ? 'Unleased' : row.job.state === JobState.Queued ? 'Waiting' : row.job.state !== JobState.Running ? 'Inactive' : row.leaseActive ? 'Active' : 'Expired'; }
const waiting = (row: ActivityJob) => row.job.state === JobState.Queued && row.leaseExpiresAt !== undefined;
function LeaseCell({ row }: { row: ActivityJob }) {
  const value = lease(row), running = row.job.state === JobState.Running;
  return value === 'Active' ? <span className="status status-ok">Active</span> : running ? <span className="status status-warn">{value}</span> : <span className="muted">{value}</span>;
}
// The fill width is dynamic geometry: set through the CSSOM (shared/ui-web rules).
function Progress({ row }: { row: ActivityJob }) {
  const { completedWindows: done, totalWindows: total, state } = row.job, share = total === undefined || total === 0 ? 0 : Math.min(PERCENT, done * PERCENT / total);
  return <><span className="progress" data-state={state === JobState.Failed ? 'failed' : state === JobState.Complete ? 'complete' : undefined} aria-hidden="true"><span ref={element => { if (element !== null) element.style.setProperty('width', `${share}%`); }}/></span>{done} / {total === undefined ? 'unknown' : total}</>;
}
const CLASS_TITLES: Readonly<Record<'fresh' | 'bulk' | 'unclassified', string>> = { fresh: 'fresh: uploads and individual retries', bulk: 'bulk: retry-all and rebuild', unclassified: `unclassified: ${UNCLASSIFIED_NOTE}` };
const CLASS_CHIPS: Readonly<Record<'fresh' | 'bulk' | 'unclassified', string>> = { fresh: 'chip chip-info', bulk: 'chip', unclassified: 'chip chip-outline' };
/** When a job began waiting and for how long (`16:02 · 2 h 34 min`); the ISO value is the tooltip. */
function Waited({ value, now, inline }: { value: string | undefined; now: number; inline: boolean }) {
  if (value === undefined) return <span className="muted">—</span>;
  const duration = waitedFor(value, now);
  return <span className="waited"><time dateTime={value} title={value}>{waitedSince(value, now)}</time>{duration !== null && (inline ? <span className="muted waited-for"> · {duration}</span> : <span className="when-rel waited-for">waiting {duration}</span>)}</span>;
}
function ClassChip({ bulk }: { bulk: boolean | undefined }) {
  const value = jobClass(bulk);
  return <span className={CLASS_CHIPS[value]} title={CLASS_TITLES[value]}>{value}</span>;
}
/** "N ahead" with its explanation (a tooltip, also for keyboard focus) and the footnote mark. */
const AHEAD_NOTE = 'claim-order-ahead';
/** Shows the footnote in place: a hash link would leave the Jobs route (the router reads the hash). */
function showAheadNote() {
  const note = document.getElementById(AHEAD_NOTE);
  if (note === null) return;
  note.scrollIntoView({ block: 'center' }); note.focus({ preventScroll: true });
}
function NoteMark() { return <button type="button" className="fn-ref" aria-label="About ahead counts" onClick={showAheadNote}>¹</button>; }
function AheadMark({ value }: { value: Ahead }) {
  return <><span className="ahead" tabIndex={0} title={value.title}>{value.text}</span><NoteMark/></>;
}
function Why({ row, order }: { row: ActivityJob; order: ActivityClaimOrder | undefined }) {
  const text = why(row, order, clockMinutes);
  if (text.main === '—') return <span className="muted">—</span>;
  return <><span className={text.running ? 'why-main why-running' : 'why-main'}>{text.main}{text.ahead !== null && <AheadMark value={text.ahead}/>}{text.after}</span>{text.sub !== '' && <div className="cell-sub"><span>{text.sub}</span></div>}</>;
}
const title = (row: ActivityJob) => row.session.metadata.title.length === 0 ? 'Untitled source' : row.session.metadata.title;
// `order` is the claim order of the job list that produced the ranks (undefined until it is read): it names the order of
// "N ahead". `sorts`: whether the server has the claim-order sorts (its summary carries the claim-order counts).
function jobColumns(order: ActivityClaimOrder | undefined, sorts: boolean): readonly Column<ActivityJob, ActivityJobSort>[] { return [
  { sort: ActivityJobSort.LastTimestamp, label: 'Last activity', cell: undefined, width: { min: 120, ideal: 150, max: 170 }, compact: false, medium: false, narrow: false, required: false, title: row => row.lastTimestamp, render: (row, now) => <When value={row.lastTimestamp} now={now} relative="below" missing="Not recorded"/> },
  { sort: ActivityJobSort.Title, label: 'Conversation', cell: undefined, width: { min: 200, ideal: 200, max: 2400 }, compact: true, medium: true, narrow: true, required: true, title: row => `${row.session.metadata.title}\njob r${row.job.revision} · HEAD r${row.session.revision}`, render: row => <>
    <a className="cell-title" href={formatRoute(sessionRoute(row.job.sessionId))}>{title(row)}</a>
    <div className="cell-sub"><span>{row.session.metadata.project === undefined ? 'No project' : row.session.metadata.project} · <span className="branch">{row.session.metadata.gitBranch === undefined ? 'No branch' : row.session.metadata.gitBranch}</span></span></div>
  </> },
  { sort: sorts ? ActivityJobSort.JobClass : null, id: 'Class', label: 'Class', cell: undefined, width: { min: 120, ideal: 120, max: 120 }, compact: true, medium: true, narrow: false, required: false, title: row => CLASS_TITLES[jobClass(row.bulk)], render: row => <ClassChip bulk={row.bulk}/> },
  { sort: ActivityJobSort.State, label: 'State', cell: undefined, width: { min: 100, ideal: 150, max: 160 }, compact: true, medium: true, narrow: true, required: false, title: row => stateLabel(row).title, render: row => { const label = stateLabel(row); return <span className={label.status}>{label.text}</span>; } },
  { sort: sorts ? ActivityJobSort.WaitingSince : null, id: 'WaitingSince', label: 'Waiting since', cell: undefined, width: { min: 150, ideal: 150, max: 190 }, compact: true, medium: true, narrow: false, required: false, title: row => row.waitingSince, render: (row, now) => <Waited value={row.waitingSince} now={now} inline={false}/> },
  { sort: sorts ? ActivityJobSort.WaitingReason : null, id: 'Waiting', label: 'Why not running', cell: undefined, width: { min: 200, ideal: 380, max: 600 }, compact: true, medium: true, narrow: false, required: false, title: row => { const text = why(row, order, clockMinutes); return text.sub === '' ? undefined : text.sub; }, render: row => <Why row={row} order={order}/> },
  { sort: ActivityJobSort.Revision, label: 'Revision', cell: undefined, width: { min: 72, ideal: 88, max: 120 }, compact: false, medium: false, narrow: false, required: false, title: row => `Current HEAD is r${row.session.revision}`, render: row => `r${row.job.revision}` },
  { sort: ActivityJobSort.CompletedWindows, label: 'Windows', cell: undefined, width: { min: 190, ideal: 190, max: 240 }, compact: true, medium: false, narrow: false, required: false, title: row => windowProgress(row.job), render: row => <Progress row={row}/> },
  { sort: ActivityJobSort.LeaseState, label: 'Lease', cell: undefined, width: { min: 108, ideal: 108, max: 120 }, compact: true, medium: false, narrow: false, required: false, title: row => row.leaseExpiresAt === undefined ? 'No lease expiry' : waiting(row) ? `Next attempt ${row.leaseExpiresAt}` : `Lease expires ${row.leaseExpiresAt}`, render: row => <LeaseCell row={row}/> },
  { sort: ActivityJobSort.Attempts, label: 'Attempts', cell: 'col-num', width: { min: 72, ideal: 72, max: 80 }, compact: true, medium: false, narrow: false, required: false, title: () => undefined, render: row => row.job.attempts.toString() },
  { sort: ActivityJobSort.Reason, label: 'Reason', cell: undefined, width: { min: 110, ideal: 200, max: 280 }, compact: false, medium: false, narrow: false, required: false, title: row => row.job.error, render: row => row.job.error === undefined ? <span className="muted">—</span> : <span className="activity-reason">{row.job.state !== JobState.Failed && 'Prior: '}{row.job.error}</span> },
  { sort: ActivityJobSort.Collector, label: 'Collector', cell: 'col-mono', width: { min: 120, ideal: 180, max: 480 }, compact: false, medium: false, narrow: false, required: false, title: row => row.collectorId, render: row => row.collectorId },
  { sort: ActivityJobSort.Profile, label: 'Profile', cell: 'col-mono', width: { min: 120, ideal: 180, max: 480 }, compact: false, medium: false, narrow: false, required: false, title: row => row.profile, render: row => row.profile },
  { sort: ActivityJobSort.TotalWindows, label: 'Windows total', cell: 'col-num', width: { min: 112, ideal: 120, max: 160 }, compact: false, medium: false, narrow: false, required: false, title: () => undefined, render: row => row.job.totalWindows === undefined ? 'Unknown' : row.job.totalWindows.toString() },
  { sort: ActivityJobSort.LeaseExpiresAt, label: 'Lease expiry / next attempt', cell: undefined, width: { min: 140, ideal: 160, max: 200 }, compact: false, medium: false, narrow: false, required: false, title: row => row.leaseExpiresAt, render: (row, now) => <When value={row.leaseExpiresAt} now={now} relative="none" missing="—"/> },
  { sort: ActivityJobSort.Classification, label: 'Classification', cell: undefined, width: { min: 120, ideal: 180, max: 320 }, compact: false, medium: false, narrow: false, required: false, title: row => classificationLabel(row.classification), render: row => classificationLabel(row.classification) },
  { sort: ActivityJobSort.JobId, label: 'Job ID', cell: 'col-mono', width: { min: 120, ideal: 290, max: 320 }, compact: false, medium: false, narrow: false, required: false, title: row => row.job.id, render: row => row.job.id },
  { sort: ActivityJobSort.SessionId, label: 'Source ID', cell: 'col-mono', width: { min: 120, ideal: 290, max: 320 }, compact: false, medium: false, narrow: false, required: false, title: row => row.job.sessionId, render: row => row.job.sessionId },
]; }
function leaseText(item: ActivityJob): string {
  if (waiting(item)) return `Waiting · next attempt ${item.leaseExpiresAt}`;
  const label = item.leaseActive ? 'Active lease at snapshot' : item.leaseExpiresAt === undefined ? 'Unleased' : item.job.state === JobState.Running ? 'Expired lease at snapshot' : 'Inactive lease';
  return `${label}${item.leaseExpiresAt === undefined ? item.leaseActive ? ' · expiry unknown' : ' · no lease expiry' : ` · expires ${item.leaseExpiresAt}`}`;
}
function ClaimDetail({ row, order }: { row: ActivityJob; order: ActivityClaimOrder | undefined }) {
  const position = ahead(row, order), cls = jobClass(row.bulk), now = Date.now();
  return <>
    {position !== null && <><dt>Claim order</dt><dd>{orderDescription(row, order)} · <strong>{position.text}</strong> (all owners; not named)</dd></>}
    <dt>Waiting since</dt><dd><Waited value={row.waitingSince} now={now} inline={true}/></dd>
    <dt>Class</dt><dd>{CLASS_TITLES[cls]}</dd>
  </>;
}
function JobDetail({ row, scope, blocked, retry, order }: { row: ActivityJob; scope: JobScope; blocked: boolean; retry(id: string): void; order: ActivityClaimOrder | undefined }) {
  const { job, session } = row, metadata = session.metadata, failed = job.state === JobState.Failed, current = row.classification === ActivityJobClass.Current;
  const recordedFailure = failed || job.error !== undefined || job.failureStage !== undefined;
  return <div className="activity-detail" role="region" aria-label={`Job ${job.id}`}>
    <div className="activity-detail-main">
      <dl className="dl activity-detail-list">
        {recordedFailure && <><dt>{failed ? 'Failure' : 'Prior attempt'}</dt><dd><span className={failed ? 'activity-failure' : undefined}>{job.error === undefined ? 'No error recorded' : job.error}</span> · {failed ? 'failure stage' : 'prior-attempt failure stage'} {job.failureStage === undefined ? 'unknown (not recorded)' : job.failureStage}</dd></>}
        <ClaimDetail row={row} order={order}/>
        <dt>Revision</dt><dd>job r{job.revision} (metadata of this revision) · current HEAD r{session.revision} · profile <code>{row.profile}</code> · {classificationLabel(row.classification)}</dd>
        <dt>Windows</dt><dd>{windowProgress(job)}{job.state === JobState.Complete ? ' · job complete' : ' · job not Complete at this snapshot'}</dd>
        <dt>Lease</dt><dd className={job.state === JobState.Running && !row.leaseActive ? 'activity-warning' : undefined}>{leaseText(row)}</dd>
        <dt>Collector</dt><dd><a className="mono" href={formatRoute(collectorsRouteFor(withCollector('', row.collectorId)))}>{row.collectorId}</a></dd>
      </dl>
      <dl className="dl activity-detail-list" aria-label={`Job-revision metadata · r${job.revision}`}>
        <dt>Source</dt><dd>{metadata.producer} / {session.source.format} · model {metadata.model === undefined ? 'unknown' : metadata.model}</dd>
        <dt>Recorded</dt><dd>{session.source.subagentId === undefined ? 'main agent · no recorded subagent ID' : `subagent · ${session.source.subagentId}`} · <span title="Recorded source-root claim, not host or launch attestation">yolo profile {recordedYoloProfile(session.source.discoveryRootId) ?? 'not recorded'}</span></dd>
        <dt>Project / branch</dt><dd>{metadata.project === undefined ? 'Unknown' : metadata.project} / {metadata.gitBranch === undefined ? 'Unknown' : metadata.gitBranch}</dd>
        <dt>Tags</dt><dd>{metadata.tags.length === 0 ? 'None' : metadata.tags.join(', ')}</dd>
        <dt>Owner · root</dt><dd><code>{session.ownerId}</code> · {session.source.collectorNamespace} / {session.source.discoveryRootId}</dd>
      </dl>
      {!current && <p className="muted">Historical job · not actionable here. This does not describe the current published view.</p>}
    </div>
    <div className="row activity-detail-actions">
      <a className="btn btn-sm" href={formatRoute(sessionRoute(job.sessionId))}>Open conversation</a>
      {scope === ActivityJobScope.Current && row.retryable && current && failed && <button type="button" className="btn btn-sm" disabled={blocked} onClick={() => retry(job.id)}>Retry indexing</button>}
    </div>
  </div>;
}

// The sorts of the claim-order release. A tab sends one only to a server known to have it (its owner summary carries the
// claim-order counts): after a rollback to an older 1.9.0 server, which cannot decode them, the list falls back to the last
// activity order.
const CLAIM_ORDER_SORTS: ReadonlySet<ActivityJobSort> = new Set([ActivityJobSort.WaitingSince, ActivityJobSort.JobClass, ActivityJobSort.WaitingReason]);
export function Jobs({ connection, stats, user, actions, refresh, refreshNow, summary, summaryFailed }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; refresh: string; refreshNow: () => void; summary: ActivityResult | null; summaryFailed: boolean }) {
  const cache = useContext(RouteStateContext);
  if (cache === null) throw new Error('Jobs requires a RouteStateContext provider');
  const [state, setState] = useRouteState(JOBS_STATE, ACTIVITY_INSTANCE), [draft, setDraft] = useRouteState(JOBS_DRAFT, ACTIVITY_INSTANCE), input = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useRouteState(JOBS_OPENED, ACTIVITY_INSTANCE), region = useRef<HTMLElement>(null), shown = useRef(false);
  // The shell hides a retained view (`hidden` on an ancestor) while another route is shown and renders it again on return.
  useLayoutEffect(() => {
    const element = region.current;
    if (element === null) throw new Error('Jobs region missing');
    const visible = element.closest('[hidden]') === null;
    if (visible && !shown.current && opened !== null && !element.contains(document.activeElement)) {
      const link = element.querySelector<HTMLAnchorElement>(`tr[data-row-id="${CSS.escape(opened)}"] a.cell-title`);
      if (link !== null) link.focus({ preventScroll: true });
    }
    shown.current = visible;
  });
  const supported = summary === null ? summaryFailed ? false : null : summary.queue !== undefined, claimSort = CLAIM_ORDER_SORTS.has(state.sort);
  const fallback = claimSort && supported === false, sort = fallback ? ActivityJobSort.LastTimestamp : state.sort, direction = fallback ? SortDirection.Desc : state.direction;
  const resource = useSettledInfiniteResource<ActivityJob, ActivityJobsResult, string>(cache.read(JOB_CHAINS, ACTIVITY_INSTANCE), connection, stats, JSON.stringify([user.id, state.scope, state.submitted, sort, direction]), refresh, !claimSort || supported !== null, undefined, async cursor => {
    validateMetadataExpression(state.submitted);
    const result = await read(connection, new Operation_ActivityJobs(new ActivityJobsQuery(undefined, state.scope, state.submitted, sort, direction, cursor, PAGE_SIZE)), reply => reply instanceof Result_ActivityJobs ? reply.result : null);
    for (const item of result.jobs) {
      if (item.session.ownerId !== user.id || item.session.id !== item.job.sessionId || item.session.view.revision !== item.job.revision || item.session.view.generationId !== undefined) throw new Error('Activity job metadata does not match its owner, source and job revision');
    }
    return { items: result.jobs, next: result.nextCursor, previous: undefined, meta: result };
  }, item => item.job.id);
  const order = resource.meta === null ? undefined : resource.meta.claimOrder, sorts = supported === true, columns = useMemo(() => jobColumns(order, sorts), [order, sorts]);
  const table = useListTable(columns, COLUMN_CHOICES_KEY, ACTIONS_WIDTH, resource.items.length);
  const meta = resource.meta, failed = resource.error !== null && resource.appendError === null, noun = scopeNoun(state.scope);
  const blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  const chip = collectorFilter(state.submitted);
  function submit(expression: string) { setState(value => ({ ...value, submitted: expression, expanded: null })); if (expression === state.submitted) refreshNow(); }
  function scope(value: JobScope) { setState(previous => previous.scope === value ? previous : { ...previous, scope: value, expanded: null }); }
  function clear() { setDraft(''); submit(''); }
  const retry = (id: string) => { void actions.run(new Operation_RetryJob(id), 'Retry indexing job'); };
  // Editing keeps the rows of the submitted expression, dimmed and labelled, until the edit is submitted (spec §1 principle 5).
  const editing = draft !== state.submitted;
  const counter = editing ? <span data-state="pending">Expression edited · Filter to update</span> : resource.loading ? `Loading ${noun} jobs…` : meta === null ? 'Not loaded' : <><strong>{meta.total.toLocaleString()}</strong> {noun} job{meta.total === 1n ? '' : 's'} · {resource.hasMore ? `${resource.items.length.toLocaleString()} loaded` : 'all loaded'}</>;
  return <><ClaimStrip summary={summary} user={user}/><section className="activity-list" data-editing={editing ? '' : undefined} aria-label="Jobs" data-view="activity-jobs" ref={region} onClickCapture={event => { const row = event.target instanceof Element && event.target.closest('a.cell-title') !== null ? event.target.closest('tr[data-row-id]') : null; if (row instanceof HTMLElement && row.dataset.rowId !== undefined) setOpened(row.dataset.rowId); }}>
    <div className="viewbar activity-viewbar" data-view-bar="">
      <div className="segmented" role="group" aria-label="Indexing job scope">{([[ActivityJobScope.Current, 'Current'], [ActivityJobScope.Historical, 'History']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={state.scope === value} onClick={() => scope(value)}>{label}</button>)}</div>
      <MetadataQueryBar inputRef={input} name="Indexing job" placeholder={PLACEHOLDER} value={draft} applied={state.submitted} change={setDraft} submit={submit} disabled={stats.activeId === null} completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_ActivityJobs(state.scope, undefined) }}/>
      <div className="viewbar-meta" role="status" aria-label="Jobs status">{counter}</div>
      <ColumnMenu name="Indexing jobs" layout={table.layout}/>
    </div>
    <FilterBar expression={draft} change={setDraft} input={input} fields={fields} presets={presets} metadata={true} trailing={<div className="sortline">
      {chip !== null && <span className="chip chip-accent activity-chip">collector: {chip.collector}<button type="button" className="link-button" aria-label={`Remove collector filter ${chip.collector}`} onClick={() => { setDraft(chip.rest); submit(chip.rest); }}><Icon name="x" small={true}/></button></span>}
      <MetadataHelp><p>user (opaque owner ID), tag, project, branch, producer, format, model, status, after, before, collector, profile, classification, reason, lease. Metadata and activity dates belong to the job revision. producer is the recorded harness; format is the source format; model is the recorded source model, not the annotator model; profile is the exact index hash. agent:main means no recorded subagent ID; agent:subagent means an ID is present, not title or parent-link inference, cryptographic lineage or legacy backfill. Job states exclude unscheduled. Lease: active / expired / unleased / inactive (inactive includes a queued job waiting for its next attempt).</p></MetadataHelp>
    </div>}/>
    {failed && <div className="page activity-notice"><div className="notice notice-danger" role="alert"><Glyph name="alert"/><div><div className="notice-title">Jobs could not be loaded</div>{resource.error}<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={refreshNow}>Retry</button></div></div></div></div>}
    {resource.updateAvailable && <div className="update-pill"><button type="button" onClick={resource.applyUpdates}><Icon name="arrow-up" small={true}/>Updated jobs · show latest</button></div>}
    <ListTable name="Indexing jobs" list="activity-jobs" twoLine={true} table={table} resource={resource} rowId={row => row.job.id} rowClass="activity-job-row" rowState={row => row.classification === ActivityJobClass.Current ? undefined : 'historical'} state={{ ...state, sort, direction }}
      sortBy={sort => setState(value => ({ ...value, ...nextOrder(value, sort) }))} toggle={id => setState(value => ({ ...value, expanded: value.expanded === id ? null : id }))}
      detail={row => <JobDetail row={row} scope={state.scope} blocked={blocked} retry={retry} order={order}/>} actions={() => null}
      empty={<EmptyJobs state={state} showHistory={() => scope(ActivityJobScope.Historical)} clear={clear}/>}
      noun={total => count(total, `${noun} job`, `${noun} jobs`)} total={meta === null ? null : meta.total} pageSize={PAGE_SIZE}/>
    <ClaimNotes/>
  </section></>;
}
const CLASSES = [['fresh', 'chip chip-info'], ['bulk', 'chip'], ['unclassified', 'chip chip-outline']] as const;
/** The owner's own current jobs per class in the claim order (owner-scoped: no other owner's job is counted here). */
function ClaimStrip({ summary, user }: { summary: ActivityResult | null; user: UserInfo }) {
  const queue = summary === null ? undefined : summary.queue;
  if (summary === null || queue === undefined) return null;
  const now = Date.now(), waiting = queue.claimOrder === ActivityClaimOrder.Waiting;
  const rows = CLASSES.filter(([name]) => name !== 'unclassified' || queue.unclassified.queued > 0n).map(([name, chip]) => [name, chip, queue[name]] as const);
  const cellCount = (value: bigint, warn: boolean) => warn && value > 0n ? <span className="status status-warn">{value.toLocaleString()}</span> : value.toLocaleString();
  const large = queue.largeAhead === undefined ? null : queue.largeAhead;
  return <section className="claim-strip" aria-label="Your jobs in the claim order">
    <div className="card claim-card">
      <div className="card-head"><h2>Your jobs in the claim order</h2><span className="xs muted">{user.login} only · current jobs · snapshot {clockTime(summary.observedAt)}</span></div>
      <div className="claim-card-body">
        <table className="table table-static table-inset claim-counts" aria-label="Claim-order counts per class">
          <thead><tr><th scope="col">Class</th><th scope="col" className="col-num">Queued</th><th scope="col" className="col-num">Claimable</th><th scope="col" className="col-num">Held</th><th scope="col" className="col-num">Awaiting reclaim</th><th scope="col">Oldest waiting</th></tr></thead>
          <tbody>{rows.map(([name, chip, counts]: readonly [string, string, ActivityClassQueue]) => <tr key={name} data-class={name}>
            <th scope="row"><span className={chip} title={CLASS_TITLES[name as 'fresh' | 'bulk' | 'unclassified']}>{name}</span></th><td className="col-num">{counts.queued.toLocaleString()}</td><td className="col-num">{counts.claimable.toLocaleString()}</td><td className="col-num">{counts.held.toLocaleString()}</td><td className="col-num">{cellCount(counts.awaitingReclaim, true)}</td>
            <td className="claim-oldest"><Waited value={counts.oldestWaitingSince} now={now} inline={true}/></td></tr>)}</tbody>
        </table>
        <dl className="claim-lanes">
          <dt>Order</dt><dd>{waiting ? 'Oldest waiting first within each class' : 'Owner, then source ID (today\'s order)'}</dd>
          <dt>Running</dt><dd>{summary.current.activeRunning > 0n ? <span className="status status-run">{count(summary.current.activeRunning, 'of your jobs', 'of your jobs')}</span> : <span className="muted">None of your jobs</span>}</dd>
          <dt>Large-job lane</dt><dd>{queue.awaitingLarge === 0n ? <span className="muted">None of your jobs waits for it</span> : <>{queue.awaitingLarge.toLocaleString()} of your jobs {queue.awaitingLarge === 1n ? 'waits' : 'wait'} for it{large !== null && <span className="muted"> · <span className="ahead" tabIndex={0} title={`${large.toLocaleString()} jobs (of all owners) will be claimed before the first of them. An order, not a time estimate.`}>{waiting ? `${count(large, 'large job', 'large jobs')} ahead` : `${large.toLocaleString()} ahead`}</span><NoteMark/></span>}</>}</dd>
          <dt>Not counted</dt><dd className="muted">Running jobs with a valid lease; superseded and obsolete jobs (History)</dd>
        </dl>
      </div>
    </div>
  </section>;
}
function ClaimNotes() {
  return <section className="claim-notes" aria-label="Claim-order notes">
    <p id={AHEAD_NOTE} tabIndex={-1}><span className="fn-mark">¹</span><strong>“N ahead”</strong> counts the jobs, of all owners, that will be claimed before this one in its order — an order, not a time estimate; it can grow when older work returns (for example a retry after its back-off). Other owners' jobs are counted, never named.</p>
    <dl className="claim-legend">
      <dt><span className="chip chip-info">fresh</span></dt><dd>uploads and individual retries</dd>
      <dt><span className="chip">bulk</span></dt><dd>retry-all and rebuild</dd>
      <dt><span className="chip chip-outline">unclassified</span></dt><dd>{UNCLASSIFIED_NOTE}</dd>
      <dt>Large-job lane</dt><dd>the one lane that runs jobs indexing more than 100 windows</dd>
      <dt>Waiting since</dt><dd>when the job joined its order (upload, retry, retry-all apply, rebuild); kept through claim, sizing, back-off and reclaim</dd>
    </dl>
  </section>;
}
function EmptyJobs({ state, showHistory, clear }: { state: JobsState; showHistory: () => void; clear: () => void }) {
  const noun = scopeNoun(state.scope);
  return <div className="empty" data-list-state="empty"><Icon name="search" small={false}/><h2>No matching {noun} jobs</h2>
    <p>{state.submitted === '' ? `You have no ${noun} indexing jobs.` : <>No {noun} job matches <code>{state.submitted}</code>.</>}{state.scope === ActivityJobScope.Current && ' History may still contain earlier jobs.'}</p>
    <div className="row">{state.scope === ActivityJobScope.Current && <button type="button" className="btn" onClick={showHistory}>Look in History</button>}{state.submitted !== '' && <button type="button" className="btn btn-ghost" onClick={clear}>Clear filter</button>}</div></div>;
}
