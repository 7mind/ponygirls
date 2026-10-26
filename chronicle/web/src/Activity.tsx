import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ActivityCollectorSort, ActivityJobSort, SortDirection, ActivityJobScope, ActivityJobsQuery, ActivityQuery, CollectorPhase, JobState, Operation_Activity, Operation_ActivityJobs, Operation_RetryJob, Result_Activity, Result_ActivityJobs, Scope, type ActivityCollector, type ActivityJob, type ActivityJobsResult, type ActivityResult, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { RetryFailedIndexing } from './RetryFailedIndexing.tsx';
import { MetadataEditor } from './MetadataEditor.tsx';
import type { QuickFilterField } from './ExpressionEditor.tsx';
import { validateMetadataExpression } from './expression.ts';
import { collectorColumns, jobColumns, SortHeader, nextOrder, Time, JobTotals, RunningLeases, CollectorRows, JobRows, type SortOrder } from './ActivityTables.tsx';
import { Blank, ErrorNotice } from './App.tsx';
import { ACTIVITY_POLL_INTERVAL_MS } from './progress.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
import './activity.css';

const ACTIVITY_PAGE_SIZE = 50;
interface ActivityProps { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }
function field(name: string, label: string, values: readonly (string | undefined)[]): QuickFilterField { return { attribute: name, label, values: [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))] }; }
function AboutSnapshots({ user }: { user: UserInfo }) {
  return <details className="activity-about"><summary>About these snapshots</summary><div className="activity-about-content"><p>Only {user.login}'s collectors and jobs are shown. Sharing does not expose collector reports. Refresh checks are requested every 4 seconds while connected; in-flight page chains finish before another refresh starts. Browser HTTP/socket availability is not collector or worker health.</p><p>Current jobs match the source HEAD revision and target profile. Historical jobs retain every other revision/profile. Done is the Complete job state. HEADs without a target job are not Queued. Counts measure jobs, not collector events. Owner totals are unfiltered; table counts reflect their filters. Job metadata and activity belong to the job revision, not current HEAD metadata or invented job creation times.</p><p>Last-report freshness uses server-received time. Missing reports, Idle, upload receipts and processed windows do not establish coverage, completion, worker health or index publication. Per-run counters can include queues from earlier runs.</p><p>Pages are live authorized snapshots, not one frozen corpus. Processed windows are not publication, and an unknown total is not zero. A Complete historical job does not establish the current published view; expired or unleased Running jobs are not active workers.</p></div></details>;
}
export function Activity(props: ActivityProps) { return <OwnerActivity key={props.user.id} {...props}/>; }
function OwnerActivity({ connection, stats, user, actions }: ActivityProps) {
  const [refresh, setRefresh] = useState(0), [scope, setScope] = useState(ActivityJobScope.Current);
  const [collectorId, setCollectorId] = useState<string | undefined>(undefined), [collectorDraft, setCollectorDraft] = useState('');
  const [collectorExpression, setCollectorExpression] = useState(''), [collectorQuery, setCollectorQuery] = useState('');
  const [jobExpression, setJobExpression] = useState(''), [jobQuery, setJobQuery] = useState('');
  const [collectorOrder, setCollectorOrder] = useState<SortOrder<ActivityCollectorSort>>({ field: ActivityCollectorSort.CollectorId, direction: SortDirection.Asc });
  const [jobOrder, setJobOrder] = useState<SortOrder<ActivityJobSort>>({ field: ActivityJobSort.LastTimestamp, direction: SortDirection.Desc });
  const collectorScroll = useRef<HTMLDivElement>(null), jobScroll = useRef<HTMLDivElement>(null);
  const canRead = user.scopes.includes(Scope.Read), blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  const collectorKey = JSON.stringify(['activity', user.id, canRead, stats.generation, stats.activeId, collectorQuery, collectorOrder]);
  const jobKey = JSON.stringify(['activity-jobs', user.id, canRead, stats.generation, stats.activeId, scope, collectorId, jobQuery, jobOrder]);
  useEffect(() => {
    if (stats.activeId === null || !canRead) return;
    const timer = window.setInterval(() => setRefresh(n => n + 1), ACTIVITY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connection, stats.activeId, stats.generation, canRead]);
  useEffect(() => { if (collectorScroll.current !== null) collectorScroll.current.scrollTop = 0; }, [connection, collectorKey]);
  useEffect(() => { if (jobScroll.current !== null) jobScroll.current.scrollTop = 0; }, [connection, jobKey]);
  const collectors = useInfiniteResource<ActivityCollector, ActivityResult, string>(connection, stats, collectorKey, `${refresh}:${actions.revision}`, canRead, undefined, async cursor => {
    validateMetadataExpression(collectorQuery);
    const result = await read(connection, new Operation_Activity(new ActivityQuery(collectorQuery, collectorOrder.field, collectorOrder.direction, cursor, ACTIVITY_PAGE_SIZE)), r => r instanceof Result_Activity ? r.result : null);
    if (result.user.id !== user.id) throw new Error('Activity response belongs to a different account');
    return { items: result.collectors, next: result.nextCursor, previous: undefined, meta: result };
  }, collector => collector.collectorId);
  const jobs = useInfiniteResource<ActivityJob, ActivityJobsResult, string>(connection, stats, jobKey, `${refresh}:${actions.revision}`, canRead, undefined, async cursor => {
    validateMetadataExpression(jobQuery);
    const result = await read(connection, new Operation_ActivityJobs(new ActivityJobsQuery(collectorId, scope, jobQuery, jobOrder.field, jobOrder.direction, cursor, ACTIVITY_PAGE_SIZE)), r => r instanceof Result_ActivityJobs ? r.result : null);
    for (const item of result.jobs) {
      if (item.session.ownerId !== user.id || item.session.id !== item.job.sessionId || item.session.view.revision !== item.job.revision || item.session.view.generationId !== undefined) throw new Error('Activity job metadata does not match its owner, source and job revision');
    }
    return { items: result.jobs, next: result.nextCursor, previous: undefined, meta: result };
  }, item => item.job.id);
  const collectorFields = [field('collector', 'Collector ID (exact)', collectors.items.map(row => row.collectorId)), field('phase', 'Reported phase', Object.values(CollectorPhase)), field('freshness', 'Report freshness', ['recent', 'stale', 'unknown']), field('after', 'Report received after', []), field('before', 'Report received before', [])];
  const jobFields = [field('collector', 'Collector ID (exact)', collectors.items.map(row => row.collectorId)), field('user', 'Owner ID (exact)', [user.id]), field('tag', 'Revision tag', jobs.items.flatMap(row => row.session.metadata.tags)), field('project', 'Revision project', jobs.items.map(row => row.session.metadata.project)), field('branch', 'Revision branch', jobs.items.map(row => row.session.metadata.gitBranch)), field('producer', 'Source producer', jobs.items.map(row => row.session.metadata.producer)), field('format', 'Source format', jobs.items.map(row => row.session.source.format)), field('model', 'Source model (not index profile)', jobs.items.map(row => row.session.metadata.model)), field('status', 'Job state', Object.values(JobState)), field('after', 'Source activity after', []), field('before', 'Source activity before', []), field('profile', 'Index profile hash (exact)', jobs.items.map(row => row.profile)), field('classification', 'Revision/profile classification', ['current', 'superseded-revision', 'obsolete-profile', 'superseded-revision-and-profile']), field('reason', 'Failure or prior-attempt reason', jobs.items.map(row => row.job.error)), field('lease', 'Lease state', ['active', 'expired', 'unleased', 'inactive'])];
  const selectCollector = useCallback((id: string | undefined) => { setCollectorId(id); setCollectorDraft(id === undefined ? '' : id); }, []);
  const retryJob = useCallback((id: string) => { void actions.run(new Operation_RetryJob(id), 'Retry indexing job'); }, [actions.run]);
  function filterJobs(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setCollectorId(collectorDraft === '' ? undefined : collectorDraft); }
  const summary = collectors.meta;
  return <ScrollAnchor><main className="management-page activity-page"><div className="page-heading activity-page-heading"><div><h1>Ingestion activity</h1></div><div className="activity-heading-actions"><AboutSnapshots user={user}/><button disabled={stats.activeId === null || !canRead || collectors.refreshing || jobs.refreshing} onClick={() => setRefresh(n => n + 1)}>Refresh snapshots ↻</button></div></div>
    {!canRead ? <ErrorNotice>Read scope is required to view your activity.</ErrorNotice> : <>
      <section className="activity-overview" aria-labelledby="activity-overview-heading"><div className="section-heading"><h2 id="activity-overview-heading">Your indexing totals <span className="quiet">· unfiltered</span></h2><span className="tiny">{summary === null ? 'Summary unknown' : <>Observed <Time value={summary.observedAt}/>{collectors.refreshing ? ' · refreshing…' : ''}</>}</span></div>
        <div className="activity-summary-totals"><dl className="activity-head-counts"><div><dt>Archive HEADs</dt><dd>{summary === null ? '—' : summary.archiveHeads.toString()}</dd></div><div><dt>HEADs without target job</dt><dd>{summary === null ? '—' : summary.headsWithoutTargetJob.toString()} <span>· not Queued</span></dd></div></dl><JobTotals current={summary === null ? null : summary.current} historical={summary === null ? null : summary.historical} caption="All your current and historical indexing jobs"/>
          {summary !== null && <><RunningLeases counts={summary.current} label="Current"/><RunningLeases counts={summary.historical} label="Historical"/></>}</div>
        <RetryFailedIndexing connection={connection} stats={stats} user={user} actions={actions} eligibleFailed={summary === null ? null : summary.current.failed}/>
      </section>
      <div className="activity-workspace"><section className="management-section activity-collectors" aria-labelledby="activity-collectors-heading"><div className="section-heading"><h2 id="activity-collectors-heading">Collectors</h2><span className="eyebrow" role="status">{summary === null ? 'COUNTS UNKNOWN' : `${summary.totalCollectors.toString()} matching / ${summary.allCollectors.toString()} owner collectors · ${collectors.items.length} loaded`}</span></div>
        <MetadataEditor name="Collector" value={collectorExpression} change={setCollectorExpression} submit={setCollectorQuery} fields={collectorFields} disabled={stats.activeId === null} shortcut={false} help={<p>collector (exact ID), phase, freshness (recent / stale / unknown), after, before. Dates use report received time. Missing reports do not establish collector health.</p>}/>
        {collectors.error !== null && <ErrorNotice>{collectors.error}</ErrorNotice>}{collectors.loading && <p className="activity-loading" role="status">Loading collector metadata…</p>}
        {collectors.updateAvailable && <button className="small-button activity-show-updates" disabled={collectors.refreshing} onClick={collectors.applyUpdates}>Show updated collectors</button>}
        <div className="activity-collector-scroll" ref={collectorScroll} data-scroll-container tabIndex={0} role="region" aria-label="Your collector summaries">
          <table className="activity-table activity-collector-table" aria-label="Collectors" aria-busy={collectors.loading || collectors.refreshing || collectors.loadingMore}><thead><tr>{collectorColumns.map(column => <SortHeader key={column.sort} column={column} order={collectorOrder} change={value => setCollectorOrder(previous => nextOrder(previous, value))}/>)}<th scope="col">Actions</th></tr></thead><tbody><CollectorRows items={collectors.items} selected={collectorId} select={selectCollector}/></tbody></table>
          {summary !== null && collectors.items.length === 0 && !collectors.loading && <Blank title="No matching collectors">No owned collector report or source namespace matched. Collection configuration and progress remain unknown.</Blank>}
          <InfiniteTrigger enabled={collectors.hasMore && collectors.error === null && !collectors.loading && !collectors.refreshing} loading={collectors.loadingMore} load={collectors.loadMore} label="Load more collector summaries"/>
        </div>
      </section><section className="management-section activity-jobs" aria-labelledby="activity-jobs-heading"><div className="section-heading"><h2 id="activity-jobs-heading">Indexing jobs</h2><span className="eyebrow" role="status">{jobs.meta === null ? 'COUNTS UNKNOWN' : `${jobs.meta.total.toString()} matching ${scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs · ${jobs.items.length} loaded`}</span></div>
        <div className="activity-job-controls"><div className="activity-scope-switch" role="group" aria-label="Indexing job scope"><button aria-pressed={scope === ActivityJobScope.Current} onClick={() => setScope(ActivityJobScope.Current)}>Current</button><button aria-pressed={scope === ActivityJobScope.Historical} onClick={() => setScope(ActivityJobScope.Historical)}>History</button></div>
          <form className="activity-collector-filter" onSubmit={filterJobs}><label>Collector ID<input list="activity-collector-ids" value={collectorDraft} onChange={event => setCollectorDraft(event.target.value)} placeholder="All my collectors"/></label><datalist id="activity-collector-ids">{collectors.items.map(collector => <option key={collector.collectorId} value={collector.collectorId}/>)}</datalist><button type="submit" className="small-button">Apply</button><button type="button" className="small-button" disabled={collectorId === undefined && collectorDraft === ''} onClick={() => selectCollector(undefined)}>All my collectors</button></form>
        </div>
        <MetadataEditor name="Indexing job" value={jobExpression} change={setJobExpression} submit={setJobQuery} fields={jobFields} disabled={stats.activeId === null} shortcut={true} help={<p>user (opaque owner ID), tag, project, branch, producer, format, model, status, after, before, collector, profile, classification, reason, lease. Metadata and activity dates belong to the job revision. model is the source model; profile is the exact index hash. Job states exclude unscheduled. Lease: active / expired / unleased / inactive.</p>}/>
        {collectorId !== undefined && <p className="tiny activity-section-note">Collector <code>{collectorId}</code></p>}
        {jobs.meta !== null && <p className="tiny activity-job-observed">Job page observed <Time value={jobs.meta.observedAt}/>{jobs.refreshing ? ' · refreshing…' : ''}.</p>}
        {jobs.error !== null && <ErrorNotice>{jobs.error}</ErrorNotice>}{jobs.loading && <p className="activity-loading" role="status">Loading {scope === ActivityJobScope.Current ? 'current' : 'historical'} job metadata…</p>}
        {jobs.updateAvailable && <button className="small-button activity-show-updates" disabled={jobs.refreshing} onClick={jobs.applyUpdates}>Show updated jobs</button>}
        <div className="activity-job-scroll" ref={jobScroll} data-scroll-container tabIndex={0} role="region" aria-label={`${scope === ActivityJobScope.Current ? 'Current' : 'Historical'} indexing jobs`}>
          <table className="activity-table activity-job-table" aria-label="Indexing jobs" aria-busy={jobs.loading || jobs.refreshing || jobs.loadingMore}><thead><tr>{jobColumns.map(column => <SortHeader key={column.sort} column={column} order={jobOrder} change={value => setJobOrder(previous => nextOrder(previous, value))}/>)}<th scope="col">Actions</th></tr></thead><tbody><JobRows items={jobs.items} scope={scope} blocked={blocked} retry={retryJob}/></tbody></table>
          {jobs.meta !== null && jobs.items.length === 0 && !jobs.loading && <Blank title={`No matching ${scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs`}>No matching owner jobs were returned. This does not establish collection completion.</Blank>}
          <InfiniteTrigger enabled={jobs.hasMore && jobs.error === null && !jobs.loading && !jobs.refreshing} loading={jobs.loadingMore} load={jobs.loadMore} label={`Load more ${scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs`}/>
        </div>
      </section></div>
    </>}
  </main></ScrollAnchor>;
}
