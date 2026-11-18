import { useContext, useLayoutEffect, useRef } from 'react';
import { ActivityJobClass, ActivityJobScope, ActivityJobSort, ActivityJobsQuery, ExpressionHintTarget_ActivityJobs, JobState, Operation_ActivityJobs, Operation_RetryJob, Result_ActivityJobs, type ActivityJob, type ActivityJobsResult, type UserInfo } from '../api.ts';
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
import { ACTIVITY_INSTANCE, JOB_CHAINS, JOBS_DRAFT, JOBS_OPENED, JOBS_STATE, jobsRouteFor, type JobScope, type JobsState } from './state.ts';
import { collectorFilter, withCollector } from './collector-filter.ts';
import { ListTable, count, nextOrder, useListTable, type Column } from './list.tsx';
import { When } from './time.tsx';

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
const STATES: Readonly<Record<JobState, string>> = { [JobState.Complete]: 'status status-ok', [JobState.Queued]: 'status', [JobState.Running]: 'status status-run', [JobState.Failed]: 'status status-danger' };
const scopeNoun = (scope: JobScope) => scope === ActivityJobScope.Current ? 'current' : 'historical';
function classificationLabel(classification: ActivityJobClass): string {
  switch (classification) {
    case ActivityJobClass.Current: return 'Current';
    case ActivityJobClass.SupersededRevision: return 'Superseded revision';
    case ActivityJobClass.ObsoleteProfile: return 'Obsolete profile';
    case ActivityJobClass.SupersededRevisionAndProfile: return 'Both: superseded revision + obsolete profile';
  }
}
type Lease = 'Active' | 'Expired' | 'Unleased' | 'Inactive';
function lease(row: ActivityJob): Lease { return row.leaseExpiresAt === undefined ? 'Unleased' : row.job.state !== JobState.Running ? 'Inactive' : row.leaseActive ? 'Active' : 'Expired'; }
function LeaseCell({ row }: { row: ActivityJob }) {
  const value = lease(row), running = row.job.state === JobState.Running;
  return value === 'Active' ? <span className="status status-ok">Active</span> : running ? <span className="status status-warn">{value}</span> : <span className="muted">{value}</span>;
}
// The fill width is dynamic geometry: set through the CSSOM (shared/ui-web rules).
function Progress({ row }: { row: ActivityJob }) {
  const { completedWindows: done, totalWindows: total, state } = row.job, share = total === undefined || total === 0 ? 0 : Math.min(PERCENT, done * PERCENT / total);
  return <><span className="progress" data-state={state === JobState.Failed ? 'failed' : state === JobState.Complete ? 'complete' : undefined} aria-hidden="true"><span ref={element => { if (element !== null) element.style.setProperty('width', `${share}%`); }}/></span>{done} / {total === undefined ? 'unknown' : total}</>;
}
const title = (row: ActivityJob) => row.session.metadata.title.length === 0 ? 'Untitled source' : row.session.metadata.title;
const columns: readonly Column<ActivityJob, ActivityJobSort>[] = [
  { sort: ActivityJobSort.LastTimestamp, label: 'Last activity', cell: undefined, width: { min: 120, ideal: 150, max: 170 }, compact: true, narrow: false, required: false, title: row => row.lastTimestamp, render: (row, now) => <When value={row.lastTimestamp} now={now} relative="below" missing="Not recorded"/> },
  { sort: ActivityJobSort.Title, label: 'Conversation', cell: undefined, width: { min: 200, ideal: 360, max: 2400 }, compact: true, narrow: true, required: true, title: row => `${row.session.metadata.title}\njob r${row.job.revision} · HEAD r${row.session.revision}`, render: row => <>
    <a className="cell-title" href={formatRoute(sessionRoute(row.job.sessionId))}>{title(row)}</a>
    <div className="cell-sub"><span>{row.session.metadata.project === undefined ? 'No project' : row.session.metadata.project} · <span className="branch">{row.session.metadata.gitBranch === undefined ? 'No branch' : row.session.metadata.gitBranch}</span></span></div>
  </> },
  { sort: ActivityJobSort.State, label: 'State', cell: undefined, width: { min: 100, ideal: 116, max: 140 }, compact: true, narrow: true, required: false, title: row => row.job.state, render: row => <span className={STATES[row.job.state]}>{row.job.state}</span> },
  { sort: ActivityJobSort.Revision, label: 'Revision', cell: undefined, width: { min: 72, ideal: 88, max: 120 }, compact: true, narrow: false, required: false, title: row => `Current HEAD is r${row.session.revision}`, render: row => `r${row.job.revision}` },
  { sort: ActivityJobSort.Attempts, label: 'Attempts', cell: 'col-num', width: { min: 80, ideal: 92, max: 120 }, compact: true, narrow: false, required: false, title: () => undefined, render: row => row.job.attempts.toString() },
  { sort: ActivityJobSort.CompletedWindows, label: 'Windows', cell: undefined, width: { min: 150, ideal: 164, max: 220 }, compact: true, narrow: false, required: false, title: row => windowProgress(row.job), render: row => <Progress row={row}/> },
  { sort: ActivityJobSort.LeaseState, label: 'Lease', cell: undefined, width: { min: 120, ideal: 128, max: 160 }, compact: true, narrow: false, required: false, title: row => row.leaseExpiresAt === undefined ? 'No lease expiry' : `Lease expires ${row.leaseExpiresAt}`, render: row => <LeaseCell row={row}/> },
  { sort: ActivityJobSort.Reason, label: 'Reason', cell: undefined, width: { min: 110, ideal: 200, max: 280 }, compact: true, narrow: false, required: false, title: row => row.job.error, render: row => row.job.error === undefined ? <span className="muted">—</span> : <span className="activity-reason">{row.job.state !== JobState.Failed && 'Prior: '}{row.job.error}</span> },
  { sort: ActivityJobSort.Collector, label: 'Collector', cell: 'col-mono', width: { min: 120, ideal: 180, max: 480 }, compact: false, narrow: false, required: false, title: row => row.collectorId, render: row => row.collectorId },
  { sort: ActivityJobSort.Profile, label: 'Profile', cell: 'col-mono', width: { min: 120, ideal: 180, max: 480 }, compact: false, narrow: false, required: false, title: row => row.profile, render: row => row.profile },
  { sort: ActivityJobSort.TotalWindows, label: 'Windows total', cell: 'col-num', width: { min: 112, ideal: 120, max: 160 }, compact: false, narrow: false, required: false, title: () => undefined, render: row => row.job.totalWindows === undefined ? 'Unknown' : row.job.totalWindows.toString() },
  { sort: ActivityJobSort.LeaseExpiresAt, label: 'Lease expiry', cell: undefined, width: { min: 140, ideal: 160, max: 200 }, compact: false, narrow: false, required: false, title: row => row.leaseExpiresAt, render: (row, now) => <When value={row.leaseExpiresAt} now={now} relative="none" missing="—"/> },
  { sort: ActivityJobSort.Classification, label: 'Classification', cell: undefined, width: { min: 120, ideal: 180, max: 320 }, compact: false, narrow: false, required: false, title: row => classificationLabel(row.classification), render: row => classificationLabel(row.classification) },
  { sort: ActivityJobSort.JobId, label: 'Job ID', cell: 'col-mono', width: { min: 120, ideal: 290, max: 320 }, compact: false, narrow: false, required: false, title: row => row.job.id, render: row => row.job.id },
  { sort: ActivityJobSort.SessionId, label: 'Source ID', cell: 'col-mono', width: { min: 120, ideal: 290, max: 320 }, compact: false, narrow: false, required: false, title: row => row.job.sessionId, render: row => row.job.sessionId },
];
function leaseText(item: ActivityJob): string {
  const label = item.leaseActive ? 'Active lease at snapshot' : item.leaseExpiresAt === undefined ? 'Unleased' : item.job.state === JobState.Running ? 'Expired lease at snapshot' : 'Inactive lease';
  return `${label}${item.leaseExpiresAt === undefined ? item.leaseActive ? ' · expiry unknown' : ' · no lease expiry' : ` · expires ${item.leaseExpiresAt}`}`;
}
function JobDetail({ row, scope, blocked, retry }: { row: ActivityJob; scope: JobScope; blocked: boolean; retry(id: string): void }) {
  const { job, session } = row, metadata = session.metadata, failed = job.state === JobState.Failed, current = row.classification === ActivityJobClass.Current;
  const recordedFailure = failed || job.error !== undefined || job.failureStage !== undefined;
  return <div className="activity-detail" role="region" aria-label={`Job ${job.id}`}>
    <div className="activity-detail-main">
      <dl className="dl activity-detail-list">
        {recordedFailure && <><dt>{failed ? 'Failure' : 'Prior attempt'}</dt><dd><span className={failed ? 'activity-failure' : undefined}>{job.error === undefined ? 'No error recorded' : job.error}</span> · {failed ? 'failure stage' : 'prior-attempt failure stage'} {job.failureStage === undefined ? 'unknown (not recorded)' : job.failureStage}</dd></>}
        <dt>Revision</dt><dd>job r{job.revision} (metadata of this revision) · current HEAD r{session.revision} · profile <code>{row.profile}</code> · {classificationLabel(row.classification)}</dd>
        <dt>Windows</dt><dd>{windowProgress(job)}{job.state === JobState.Complete ? ' · job complete' : ' · job not Complete at this snapshot'}</dd>
        <dt>Lease</dt><dd className={job.state === JobState.Running && !row.leaseActive ? 'activity-warning' : undefined}>{leaseText(row)}</dd>
        <dt>Collector</dt><dd><a className="mono" href={formatRoute(jobsRouteFor(withCollector('', row.collectorId), scope))}>{row.collectorId}</a></dd>
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

export function Jobs({ connection, stats, user, actions, refresh, refreshNow }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; refresh: string; refreshNow: () => void }) {
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
  const resource = useSettledInfiniteResource<ActivityJob, ActivityJobsResult, string>(cache.read(JOB_CHAINS, ACTIVITY_INSTANCE), connection, stats, JSON.stringify([user.id, state.scope, state.submitted, state.sort, state.direction]), refresh, true, undefined, async cursor => {
    validateMetadataExpression(state.submitted);
    const result = await read(connection, new Operation_ActivityJobs(new ActivityJobsQuery(undefined, state.scope, state.submitted, state.sort, state.direction, cursor, PAGE_SIZE)), reply => reply instanceof Result_ActivityJobs ? reply.result : null);
    for (const item of result.jobs) {
      if (item.session.ownerId !== user.id || item.session.id !== item.job.sessionId || item.session.view.revision !== item.job.revision || item.session.view.generationId !== undefined) throw new Error('Activity job metadata does not match its owner, source and job revision');
    }
    return { items: result.jobs, next: result.nextCursor, previous: undefined, meta: result };
  }, item => item.job.id);
  const table = useListTable(columns, COLUMN_CHOICES_KEY, ACTIONS_WIDTH, resource.items.length);
  const meta = resource.meta, failed = resource.error !== null && resource.appendError === null, noun = scopeNoun(state.scope);
  const blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  const chip = collectorFilter(state.submitted);
  function submit(expression: string) { setState(value => ({ ...value, submitted: expression, expanded: null })); if (expression === state.submitted) refreshNow(); }
  function scope(value: JobScope) { setState(previous => previous.scope === value ? previous : { ...previous, scope: value, expanded: null }); }
  function clear() { setDraft(''); submit(''); }
  const retry = (id: string) => { void actions.run(new Operation_RetryJob(id), 'Retry indexing job'); };
  const counter = resource.loading ? `Loading ${noun} jobs…` : meta === null ? 'Not loaded' : <><strong>{meta.total.toLocaleString()}</strong> {noun} job{meta.total === 1n ? '' : 's'} · {resource.hasMore ? `${resource.items.length.toLocaleString()} loaded` : 'all loaded'}</>;
  return <section className="activity-list" aria-label="Jobs" data-view="activity-jobs" ref={region} onClickCapture={event => { const row = event.target instanceof Element && event.target.closest('a.cell-title') !== null ? event.target.closest('tr[data-row-id]') : null; if (row instanceof HTMLElement && row.dataset.rowId !== undefined) setOpened(row.dataset.rowId); }}>
    <div className="viewbar activity-viewbar" data-view-bar="">
      <div className="segmented" role="group" aria-label="Indexing job scope">{([[ActivityJobScope.Current, 'Current'], [ActivityJobScope.Historical, 'History']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={state.scope === value} onClick={() => scope(value)}>{label}</button>)}</div>
      <MetadataQueryBar inputRef={input} name="Indexing job" placeholder={PLACEHOLDER} value={draft} applied={state.submitted} change={setDraft} submit={submit} disabled={stats.activeId === null} completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_ActivityJobs(state.scope, undefined) }}/>
      <div className="viewbar-meta" role="status" aria-label="Jobs status">{counter}</div>
      <ColumnMenu name="Indexing jobs" layout={table.layout}/>
    </div>
    <FilterBar expression={draft} change={setDraft} input={input} fields={fields} presets={presets} metadata={true} trailing={<div className="sortline">
      {chip !== null && <span className="chip chip-accent activity-chip">collector: {chip.collector}<button type="button" className="link-button" aria-label={`Remove collector filter ${chip.collector}`} onClick={() => { setDraft(chip.rest); submit(chip.rest); }}><Icon name="x" small={true}/></button></span>}
      <MetadataHelp><p>user (opaque owner ID), tag, project, branch, producer, format, model, status, after, before, collector, profile, classification, reason, lease. Metadata and activity dates belong to the job revision. producer is the recorded harness; format is the source format; model is the recorded source model, not the annotator model; profile is the exact index hash. agent:main means no recorded subagent ID; agent:subagent means an ID is present, not title or parent-link inference, cryptographic lineage or legacy backfill. Job states exclude unscheduled. Lease: active / expired / unleased / inactive.</p></MetadataHelp>
    </div>}/>
    {failed && <div className="page activity-notice"><div className="notice notice-danger" role="alert"><Glyph name="alert"/><div><div className="notice-title">Jobs could not be loaded</div>{resource.error}<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={refreshNow}>Retry</button></div></div></div></div>}
    {resource.updateAvailable && <div className="update-pill"><button type="button" onClick={resource.applyUpdates}><Icon name="arrow-up" small={true}/>Updated jobs · show latest</button></div>}
    <ListTable name="Indexing jobs" list="activity-jobs" twoLine={true} table={table} resource={resource} rowId={row => row.job.id} rowClass="activity-job-row" rowState={row => row.classification === ActivityJobClass.Current ? undefined : 'historical'} state={state}
      sortBy={sort => setState(value => ({ ...value, ...nextOrder(value, sort) }))} toggle={id => setState(value => ({ ...value, expanded: value.expanded === id ? null : id }))}
      detail={row => <JobDetail row={row} scope={state.scope} blocked={blocked} retry={retry}/>} actions={() => null}
      empty={<EmptyJobs state={state} showHistory={() => scope(ActivityJobScope.Historical)} clear={clear}/>}
      noun={total => count(total, `${noun} job`, `${noun} jobs`)} total={meta === null ? null : meta.total} pageSize={PAGE_SIZE}/>
  </section>;
}
function EmptyJobs({ state, showHistory, clear }: { state: JobsState; showHistory: () => void; clear: () => void }) {
  const noun = scopeNoun(state.scope);
  return <div className="empty" data-list-state="empty"><Icon name="search" small={false}/><h2>No matching {noun} jobs</h2>
    <p>{state.submitted === '' ? `You have no ${noun} indexing jobs.` : <>No {noun} job matches <code>{state.submitted}</code>.</>}{state.scope === ActivityJobScope.Current && ' History may still contain earlier jobs.'}</p>
    <div className="row">{state.scope === ActivityJobScope.Current && <button type="button" className="btn" onClick={showHistory}>Look in History</button>}{state.submitted !== '' && <button type="button" className="btn btn-ghost" onClick={clear}>Clear filter</button>}</div></div>;
}
