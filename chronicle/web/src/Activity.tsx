import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ActivityJobClass, ActivityJobScope, ActivityJobsQuery, ActivityQuery, CollectorPhase, JobState, Operation_Activity, Operation_ActivityJobs, Operation_RetryJob, Result_Activity, Result_ActivityJobs, Scope, type ActivityCollector, type ActivityJob, type ActivityJobsResult, type ActivityResult, type CollectorStatus, type JobCounts, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { Blank, ErrorNotice } from './App.tsx';
import { ACTIVITY_POLL_INTERVAL_MS, formatBytes, windowProgress } from './progress.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
import './activity.css';

const ACTIVITY_PAGE_SIZE = 50;
interface ActivityProps { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }

function JobTotals({ current, historical, caption }: { current: JobCounts; historical: JobCounts; caption: string }) {
  return <table className="activity-counts"><caption className="sr-only">{caption}</caption><thead><tr><th scope="col">Jobs</th><th scope="col">Total</th><th scope="col">Queued</th><th scope="col">Running</th><th scope="col">Failed</th><th scope="col" title="Complete job state">Done</th></tr></thead><tbody>
    {([{ label: 'Current', counts: current }, { label: 'Historical', counts: historical }]).map(({ label, counts }) => <tr key={label}><th scope="row">{label}</th><td>{counts.total.toString()}</td><td>{counts.queued.toString()}</td><td>{counts.running.toString()}</td><td className={label === 'Current' && counts.failed > 0n ? 'activity-failure' : ''}>{counts.failed.toString()}</td><td>{counts.complete.toString()}</td></tr>)}
  </tbody></table>;
}
function RunningLeases({ counts, label }: { counts: JobCounts; label: string }) {
  return <p className="tiny activity-running-leases"><strong>{label} Running leases:</strong> {counts.activeRunning.toString()} active · {counts.expiredRunning.toString()} expired · {counts.unleasedRunning.toString()} unleased</p>;
}
function LastReport({ status }: { status: CollectorStatus | undefined }) {
  if (status === undefined) return <p className="tiny activity-report-unknown">No stored report · collection progress unknown. This does not establish health, configuration or completion.</p>;
  const { report, receivedAt, stale } = status;
  return <div className="activity-last-report"><p><span className={`badge ${stale || report.phase === CollectorPhase.Failed ? 'activity-warning' : ''}`}>{report.phase} · {stale ? 'Stale report (>120s)' : 'Recent report'}</span></p><p className="tiny">Last report received <time dateTime={receivedAt}>{receivedAt}</time></p>
    {stale && <p className="tiny activity-warning">Last known snapshot only; current collection progress is unknown.</p>}
    {report.error !== undefined && <p className="activity-failure">Collector error: {report.error}</p>}
    <details className="activity-report-details"><summary>Per-run collector counters</summary><p className="tiny">Run <code>{report.runId}</code> · sequence {report.sequence.toString()} · started <time dateTime={report.startedAt}>{report.startedAt}</time></p>
      <dl className="activity-run-counters">
        <div><dt>Scanned / discovered sessions</dt><dd>{report.counters.scanned.toString()} / {report.counters.discovered.toString()}</dd></div>
        <div><dt>Scanned bytes</dt><dd>{formatBytes(report.counters.scannedBytes)}</dd></div>
        <div><dt>Enqueued sessions</dt><dd>{report.counters.enqueued.toString()}</dd></div>
        <div><dt>Uploaded sessions (archive receipts)</dt><dd>{report.counters.uploaded.toString()}</dd></div>
        <div><dt>Acknowledged bytes / queued payload bytes</dt><dd>{formatBytes(report.uploadedBytes)} / {formatBytes(report.totalUploadBytes)}</dd></div>
        {report.phase === CollectorPhase.Uploading && <div><dt>Current payload size (not acknowledged progress)</dt><dd>{formatBytes(report.currentUploadTotalBytes)}</dd></div>}
        <div><dt>Waiting for quiet</dt><dd>{report.counters.waiting.toString()}</dd></div>
        <div><dt>Pending upload queue</dt><dd>{report.counters.pending.toString()}</dd></div>
        <div><dt>Quarantined</dt><dd>{report.counters.quarantined.toString()}</dd></div>
        <div><dt>Stopped</dt><dd>{report.counters.stopped.toString()}</dd></div>
        <div><dt>Conflicts</dt><dd>{report.counters.conflicts.toString()}</dd></div>
        <div><dt>Upload failures</dt><dd>{report.counters.uploadFailures.toString()}</dd></div>
        <div><dt>Excluded</dt><dd>{report.counters.excluded.toString()}</dd></div>
        <div><dt>Unchanged</dt><dd>{report.counters.unchanged.toString()}</dd></div>
      </dl><p className="tiny">Per-run discovery/upload counters, not indexing-job totals. Receipts may include a queue from earlier runs and do not establish index publication.</p>
    </details>
  </div>;
}
function classificationLabel(classification: ActivityJobClass): string {
  switch (classification) {
    case ActivityJobClass.Current: return 'Current';
    case ActivityJobClass.SupersededRevision: return 'Superseded revision';
    case ActivityJobClass.ObsoleteProfile: return 'Obsolete profile';
    case ActivityJobClass.SupersededRevisionAndProfile: return 'Both: superseded revision + obsolete profile';
  }
}
function JobLease({ item }: { item: ActivityJob }) {
  const label = item.leaseActive ? 'Active lease at snapshot' : item.leaseExpiresAt === undefined ? 'Unleased' : item.job.state === JobState.Running ? 'Expired lease at snapshot' : 'Inactive lease';
  return <p className={`tiny activity-job-lease ${item.job.state === JobState.Running && !item.leaseActive ? 'activity-warning' : ''}`}>{label}{item.leaseExpiresAt === undefined ? item.leaseActive ? ' · expiry unknown' : ' · no lease expiry' : <> · expires <time dateTime={item.leaseExpiresAt}>{item.leaseExpiresAt}</time></>}</p>;
}
function JobRow({ item, scope, blocked, actions }: { item: ActivityJob; scope: ActivityJobScope; blocked: boolean; actions: MutationState }) {
  const { job } = item;
  const retryable = scope === ActivityJobScope.Current && item.retryable && item.classification === ActivityJobClass.Current && job.state === JobState.Failed;
  return <article className={`activity-job-row ${item.classification === ActivityJobClass.Current ? '' : 'activity-historical'}`} data-scroll-anchor={job.id}>
    <div className="activity-job-heading"><span className={`job-state state-${job.state.toLowerCase()}`}>{job.state}</span><span className="badge">{classificationLabel(item.classification)}</span>{retryable && <button className="small-button" disabled={blocked} onClick={() => void actions.run(new Operation_RetryJob(job.id), 'Retry indexing job')}>Retry job</button>}</div>
    <h3>Revision {job.revision.toString()} · profile <code>{item.profile}</code></h3><p className="tiny">Session <code>{job.sessionId}</code></p><p className="tiny">Job <code>{job.id}</code> · attempt {job.attempts.toString()}</p>
    <p className="activity-window-progress">{windowProgress(job)}{job.state === JobState.Complete ? ' · job complete' : ' · not published by this job'}</p><JobLease item={item}/>
    {job.error !== undefined && <p className="activity-failure">{job.state === JobState.Running ? 'Prior-attempt error' : 'Job error'}: {job.error}</p>}
    {job.state === JobState.Failed && !retryable && <p className="tiny">{item.classification !== ActivityJobClass.Current || scope === ActivityJobScope.Historical ? 'Historical failure · not actionable here.' : 'Retry is not available for this snapshot.'}</p>}
  </article>;
}
function AboutSnapshots({ user }: { user: UserInfo }) {
  return <details className="activity-about"><summary>About these snapshots</summary><div className="activity-about-content"><p>Only {user.login}'s collectors and jobs are shown. Sharing does not expose collector reports. Refresh checks are requested every 4 seconds while connected; in-flight page chains finish before another refresh starts. Browser HTTP/socket availability is not collector or worker health.</p><p>Current jobs match the source HEAD revision and target profile. Historical jobs retain every other revision/profile. Done is the Complete job state. HEADs without a target job are not Queued. Counts measure jobs, not collector events.</p><p>Last-report freshness uses server-received time. Missing reports, Idle, upload receipts and processed windows do not establish coverage, completion, worker health or index publication. Per-run counters can include queues from earlier runs.</p><p>Pages are live authorized snapshots, not one frozen corpus. Processed windows are not publication, and an unknown total is not zero. A Complete historical job does not establish the current published view; expired or unleased Running jobs are not active workers.</p></div></details>;
}
export function Activity(props: ActivityProps) { return <OwnerActivity key={props.user.id} {...props}/>; }
function OwnerActivity({ connection, stats, user, actions }: ActivityProps) {
  const [refresh, setRefresh] = useState(0), [scope, setScope] = useState(ActivityJobScope.Current);
  const [collectorId, setCollectorId] = useState<string | undefined>(undefined), [collectorDraft, setCollectorDraft] = useState('');
  const jobScroll = useRef<HTMLDivElement>(null);
  const canRead = user.scopes.includes(Scope.Read), blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  useEffect(() => {
    if (stats.activeId === null || !canRead) return;
    const timer = window.setInterval(() => setRefresh(n => n + 1), ACTIVITY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connection, stats.activeId, stats.generation, canRead]);
  useEffect(() => { if (jobScroll.current !== null) jobScroll.current.scrollTop = 0; }, [scope, collectorId]);
  const collectors = useInfiniteResource<ActivityCollector, ActivityResult, string>(connection, stats, JSON.stringify(['activity', user.id]), `${refresh}:${actions.revision}`, canRead, undefined, async cursor => {
    const result = await read(connection, new Operation_Activity(new ActivityQuery(cursor, ACTIVITY_PAGE_SIZE)), r => r instanceof Result_Activity ? r.result : null);
    if (result.user.id !== user.id) throw new Error('Activity response belongs to a different account');
    return { items: result.collectors, next: result.nextCursor, previous: undefined, meta: result };
  }, collector => collector.collectorId);
  const jobs = useInfiniteResource<ActivityJob, ActivityJobsResult, string>(connection, stats, JSON.stringify(['activity-jobs', user.id, scope, collectorId]), `${refresh}:${actions.revision}`, canRead, undefined, async cursor => {
    const result = await read(connection, new Operation_ActivityJobs(new ActivityJobsQuery(collectorId, scope, cursor, ACTIVITY_PAGE_SIZE)), r => r instanceof Result_ActivityJobs ? r.result : null);
    return { items: result.jobs, next: result.nextCursor, previous: undefined, meta: result };
  }, item => item.job.id);
  function selectCollector(id: string | undefined) { setCollectorId(id); setCollectorDraft(id === undefined ? '' : id); }
  function filterJobs(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setCollectorId(collectorDraft === '' ? undefined : collectorDraft); }
  return <ScrollAnchor><main className="management-page activity-page"><div className="page-heading activity-page-heading"><div><h1>Ingestion activity</h1></div><div className="activity-heading-actions"><AboutSnapshots user={user}/><button disabled={stats.activeId === null || !canRead || collectors.refreshing || jobs.refreshing} onClick={() => setRefresh(n => n + 1)}>Refresh snapshots ↻</button></div></div>
    {!canRead ? <ErrorNotice>Read scope is required to view your activity.</ErrorNotice> : <>
      {collectors.error !== null && <ErrorNotice>{collectors.error}</ErrorNotice>}
      {collectors.loading && <p className="activity-loading" role="status">Loading your activity summary…</p>}
      {collectors.meta !== null && <section className="activity-overview" aria-labelledby="activity-overview-heading"><div className="section-heading"><h2 id="activity-overview-heading">Your indexing totals</h2><span className="tiny">Summary observed <time dateTime={collectors.meta.observedAt}>{collectors.meta.observedAt}</time>{collectors.refreshing ? ' · refreshing…' : ''}</span></div>
        <dl className="activity-head-counts"><div><dt>Archive HEADs</dt><dd>{collectors.meta.archiveHeads.toString()}</dd></div><div><dt>HEADs without target job</dt><dd>{collectors.meta.headsWithoutTargetJob.toString()} <span>· no job, not Queued</span></dd></div></dl>
        <JobTotals current={collectors.meta.current} historical={collectors.meta.historical} caption="All your current and historical indexing jobs"/><RunningLeases counts={collectors.meta.current} label="Current"/><RunningLeases counts={collectors.meta.historical} label="Historical"/>
      </section>}
      <div className="activity-workspace"><section className="management-section activity-collectors" aria-labelledby="activity-collectors-heading"><div className="section-heading"><h2 id="activity-collectors-heading">Collection</h2><span className="eyebrow">{collectors.meta === null ? 'UNKNOWN' : `${collectors.meta.totalCollectors.toString()} TOTAL`}</span></div>
        {collectors.updateAvailable && <button className="small-button activity-show-updates" disabled={collectors.refreshing} onClick={collectors.applyUpdates}>Show updated collectors</button>}
        <div className="activity-collector-scroll" data-scroll-container tabIndex={0} role="region" aria-label="Your collector summaries">
          {collectors.items.map(collector => <article className="activity-collector-card" key={collector.collectorId} data-scroll-anchor={collector.collectorId}><div className="activity-collector-heading"><h3><code>{collector.collectorId}</code></h3><button className="small-button" aria-pressed={collectorId === collector.collectorId} onClick={() => selectCollector(collector.collectorId)}>View jobs</button></div>
            <p className="tiny">{collector.archiveHeads.toString()} archive HEADs · {collector.headsWithoutTargetJob.toString()} without target job (not Queued)</p><JobTotals current={collector.current} historical={collector.historical} caption={`Indexing jobs for ${collector.collectorId}`}/>
            <details className="activity-lease-details"><summary>Running lease breakdown</summary><RunningLeases counts={collector.current} label="Current"/><RunningLeases counts={collector.historical} label="Historical"/></details><LastReport status={collector.status}/>
          </article>)}
          {collectors.meta !== null && collectors.items.length === 0 && !collectors.loading && <Blank title="No collectors or source namespaces">No owned collector report or source namespace was returned. Collection configuration and progress remain unknown.</Blank>}
          <InfiniteTrigger enabled={collectors.hasMore && collectors.error === null && !collectors.loading && !collectors.refreshing} loading={collectors.loadingMore} load={collectors.loadMore} label="Load more collector summaries"/>
        </div>
      </section><section className="management-section activity-jobs" aria-labelledby="activity-jobs-heading"><div className="section-heading"><h2 id="activity-jobs-heading">Indexing jobs</h2><span className="eyebrow" role="status">{jobs.meta === null ? 'UNKNOWN' : `${jobs.meta.total.toString()} ${scope === ActivityJobScope.Current ? 'CURRENT' : 'HISTORICAL'} JOBS`}</span></div>
        <div className="activity-job-controls"><div className="activity-scope-switch" role="group" aria-label="Indexing job scope"><button aria-pressed={scope === ActivityJobScope.Current} onClick={() => setScope(ActivityJobScope.Current)}>Current</button><button aria-pressed={scope === ActivityJobScope.Historical} onClick={() => setScope(ActivityJobScope.Historical)}>History</button></div>
          <form className="activity-collector-filter" onSubmit={filterJobs}><label>Collector ID<input list="activity-collector-ids" value={collectorDraft} onChange={event => setCollectorDraft(event.target.value)} placeholder="All my collectors"/></label><datalist id="activity-collector-ids">{collectors.items.map(collector => <option key={collector.collectorId} value={collector.collectorId}/>)}</datalist><button type="submit" className="small-button">Apply</button><button type="button" className="small-button" disabled={collectorId === undefined && collectorDraft === ''} onClick={() => selectCollector(undefined)}>All my collectors</button></form>
        </div>
        {collectorId !== undefined && <p className="tiny activity-section-note">Collector <code>{collectorId}</code></p>}
        {jobs.meta !== null && <p className="tiny activity-job-observed">Job page observed <time dateTime={jobs.meta.observedAt}>{jobs.meta.observedAt}</time>{jobs.refreshing ? ' · refreshing…' : ''}.</p>}
        {jobs.error !== null && <ErrorNotice>{jobs.error}</ErrorNotice>}{jobs.loading && <p className="activity-loading" role="status">Loading {scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs…</p>}
        {jobs.updateAvailable && <button className="small-button activity-show-updates" disabled={jobs.refreshing} onClick={jobs.applyUpdates}>Show updated jobs</button>}
        <div className="activity-job-scroll" ref={jobScroll} data-scroll-container tabIndex={0} role="region" aria-label={`${scope === ActivityJobScope.Current ? 'Current' : 'Historical'} indexing jobs`}>
          {jobs.items.map(item => <JobRow key={item.job.id} item={item} scope={scope} blocked={blocked} actions={actions}/>)}
          {jobs.meta !== null && jobs.items.length === 0 && !jobs.loading && <Blank title={`No ${scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs`}>No matching jobs were returned for this owner and collector filter. This does not establish collection completion.</Blank>}
          <InfiniteTrigger enabled={jobs.hasMore && jobs.error === null && !jobs.loading && !jobs.refreshing} loading={jobs.loadingMore} load={jobs.loadMore} label={`Load more ${scope === ActivityJobScope.Current ? 'current' : 'historical'} jobs`}/>
        </div>
      </section></div>
    </>}
  </main></ScrollAnchor>;
}
