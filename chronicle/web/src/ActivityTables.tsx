import { memo } from 'react';
import type { ReactNode } from 'react';
import { ActivityCollectorSort, ActivityJobSort, SortDirection, ActivityJobClass, ActivityJobScope, CollectorPhase, JobState, type ActivityCollector, type ActivityJob, type CollectorStatus, type JobCounts } from './api.ts';
import { formatBytes, windowProgress } from './progress.ts';

export interface SortOrder<S> { field: S; direction: SortDirection }
interface Column<Row, S> { sort: S; label: string; title: string; render(row: Row): ReactNode }
type CountField = 'total' | 'queued' | 'running' | 'failed' | 'complete' | 'activeRunning' | 'expiredRunning' | 'unleasedRunning';
const countColumns: readonly { field: CountField; label: string; current: ActivityCollectorSort; historical: ActivityCollectorSort }[] = [
  { field: 'total', label: 'total', current: ActivityCollectorSort.CurrentTotal, historical: ActivityCollectorSort.HistoricalTotal },
  { field: 'queued', label: 'queued', current: ActivityCollectorSort.CurrentQueued, historical: ActivityCollectorSort.HistoricalQueued },
  { field: 'running', label: 'running', current: ActivityCollectorSort.CurrentRunning, historical: ActivityCollectorSort.HistoricalRunning },
  { field: 'failed', label: 'failed', current: ActivityCollectorSort.CurrentFailed, historical: ActivityCollectorSort.HistoricalFailed },
  { field: 'complete', label: 'complete', current: ActivityCollectorSort.CurrentComplete, historical: ActivityCollectorSort.HistoricalComplete },
  { field: 'activeRunning', label: 'active leases', current: ActivityCollectorSort.CurrentActiveRunning, historical: ActivityCollectorSort.HistoricalActiveRunning },
  { field: 'expiredRunning', label: 'expired leases', current: ActivityCollectorSort.CurrentExpiredRunning, historical: ActivityCollectorSort.HistoricalExpiredRunning },
  { field: 'unleasedRunning', label: 'unleased', current: ActivityCollectorSort.CurrentUnleasedRunning, historical: ActivityCollectorSort.HistoricalUnleasedRunning },
];
export const Time = memo(function Time({ value }: { value: string | undefined }) {
  if (value === undefined) return <span className="quiet">Unknown</span>;
  const date = new Date(value);
  return <time dateTime={value}>{Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>;
});
export function freshness(row: ActivityCollector): string { return row.status === undefined ? 'Unknown' : row.status.stale ? 'Stale' : 'Recent'; }
function leaseState(row: ActivityJob): string { return row.job.state !== JobState.Running ? 'Inactive' : row.leaseActive ? 'Active' : row.leaseExpiresAt === undefined ? 'Unleased' : 'Expired'; }
export const collectorColumns: readonly Column<ActivityCollector, ActivityCollectorSort>[] = [
  { sort: ActivityCollectorSort.CollectorId, label: 'Collector', title: 'Collector ID', render: row => <code title={row.collectorId}>{row.collectorId}</code> },
  { sort: ActivityCollectorSort.Phase, label: 'Phase', title: 'Last reported phase', render: row => row.status === undefined ? 'Unknown' : <span className={`badge ${row.status.report.phase === CollectorPhase.Failed ? 'activity-warning' : ''}`}>{row.status.report.phase}</span> },
  { sort: ActivityCollectorSort.Freshness, label: 'Freshness', title: 'Report freshness', render: row => <span className={`badge ${freshness(row) === 'Stale' ? 'activity-warning' : ''}`}>{freshness(row)}</span> },
  { sort: ActivityCollectorSort.ReceivedAt, label: 'Received', title: 'Report received time', render: row => <Time value={row.status === undefined ? undefined : row.status.receivedAt}/> },
  { sort: ActivityCollectorSort.ArchiveHeads, label: 'HEADs', title: 'Archive HEADs', render: row => row.archiveHeads.toString() },
  { sort: ActivityCollectorSort.HeadsWithoutTargetJob, label: 'No target job', title: 'HEADs without target-profile job', render: row => row.headsWithoutTargetJob.toString() },
  ...countColumns.map(column => ({ sort: column.current, label: `Current ${column.label}`, title: `Current ${column.label}`, render: (row: ActivityCollector) => <span className={column.field === 'failed' && row.current.failed > 0n ? 'activity-failure' : ''}>{row.current[column.field].toString()}</span> })),
  ...countColumns.map(column => ({ sort: column.historical, label: `History ${column.label}`, title: `Historical ${column.label}`, render: (row: ActivityCollector) => row.historical[column.field].toString() })),
];
export const jobColumns: readonly Column<ActivityJob, ActivityJobSort>[] = [
  { sort: ActivityJobSort.LastTimestamp, label: 'Last activity', title: 'Job-revision source activity', render: row => <Time value={row.lastTimestamp}/> },
  { sort: ActivityJobSort.Title, label: 'Title', title: 'Job-revision title', render: row => <><strong className="activity-job-title" title={row.session.metadata.title}>{row.session.metadata.title.length === 0 ? 'Untitled source' : row.session.metadata.title}</strong><span className="activity-subline">{row.session.metadata.project === undefined ? 'No project' : row.session.metadata.project} · {row.session.metadata.gitBranch === undefined ? 'No branch' : row.session.metadata.gitBranch}</span></> },
  { sort: ActivityJobSort.Collector, label: 'Collector', title: 'Job collector ID', render: row => <code title={row.collectorId}>{row.collectorId}</code> },
  { sort: ActivityJobSort.State, label: 'State', title: 'Job state', render: row => <span className={`job-state state-${row.job.state.toLowerCase()}`}>{row.job.state}</span> },
  { sort: ActivityJobSort.Revision, label: 'Revision', title: 'Job revision', render: row => <span title={`Current HEAD is r${row.session.revision}`}>r{row.job.revision}</span> },
  { sort: ActivityJobSort.Profile, label: 'Profile', title: 'Index profile hash', render: row => <code title={row.profile}>{row.profile}</code> },
  { sort: ActivityJobSort.Attempts, label: 'Attempts', title: 'Job attempts', render: row => row.job.attempts.toString() },
  { sort: ActivityJobSort.CompletedWindows, label: 'Windows done', title: 'Completed windows', render: row => row.job.completedWindows.toString() },
  { sort: ActivityJobSort.TotalWindows, label: 'Windows total', title: 'Total windows', render: row => row.job.totalWindows === undefined ? 'Unknown' : row.job.totalWindows.toString() },
  { sort: ActivityJobSort.LeaseExpiresAt, label: 'Lease expiry', title: 'Lease expiry', render: row => <Time value={row.leaseExpiresAt}/> },
  { sort: ActivityJobSort.LeaseState, label: 'Lease', title: 'Lease state', render: row => <span className={row.job.state === JobState.Running && !row.leaseActive ? 'activity-warning' : ''}>{leaseState(row)}</span> },
  { sort: ActivityJobSort.Reason, label: 'Reason', title: 'Failure or prior-attempt reason', render: row => row.job.error === undefined ? '—' : <span className="activity-reason" title={row.job.error}>{row.job.state !== JobState.Failed && 'Prior: '}{row.job.error}</span> },
  { sort: ActivityJobSort.Classification, label: 'Classification', title: 'Revision and profile classification', render: row => <span className="badge">{classificationLabel(row.classification)}</span> },
  { sort: ActivityJobSort.JobId, label: 'Job ID', title: 'Job ID', render: row => <code title={row.job.id}>{row.job.id}</code> },
  { sort: ActivityJobSort.SessionId, label: 'Source ID', title: 'Source session ID', render: row => <code title={row.job.sessionId}>{row.job.sessionId}</code> },
];
export function SortHeader<Row, S extends string>({ column, order, change }: { column: Column<Row, S>; order: SortOrder<S>; change(field: S): void }) {
  const selected = order.field === column.sort;
  return <th scope="col" data-sort={column.sort} aria-sort={selected ? order.direction === SortDirection.Asc ? 'ascending' : 'descending' : 'none'}><button aria-label={`Sort by ${column.title}`} title={column.title} onClick={() => change(column.sort)}>{column.label}<span aria-hidden="true">{selected ? order.direction === SortDirection.Asc ? '↑' : '↓' : '↕'}</span></button></th>;
}
export function nextOrder<S>(previous: SortOrder<S>, field: S): SortOrder<S> { return { field, direction: previous.field === field && previous.direction === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc }; }
export function JobTotals({ current, historical, caption }: { current: JobCounts | null; historical: JobCounts | null; caption: string }) {
  return <table className="activity-counts"><caption className="sr-only">{caption}</caption><thead><tr><th scope="col">Jobs</th><th scope="col">Total</th><th scope="col">Queued</th><th scope="col">Running</th><th scope="col">Failed</th><th scope="col" title="Complete job state">Complete</th></tr></thead><tbody>
    {([{ label: 'Current', counts: current }, { label: 'Historical', counts: historical }]).map(({ label, counts }) => <tr key={label}><th scope="row">{label}</th>{(['total', 'queued', 'running', 'failed', 'complete'] as const).map(field => <td key={field} className={label === 'Current' && field === 'failed' && counts !== null && counts.failed > 0n ? 'activity-failure' : ''}>{counts === null ? '—' : counts[field].toString()}</td>)}</tr>)}
  </tbody></table>;
}
export function RunningLeases({ counts, label }: { counts: JobCounts; label: string }) {
  return <p className="tiny activity-running-leases"><strong>{label} Running leases:</strong> {counts.activeRunning.toString()} active · {counts.expiredRunning.toString()} expired · {counts.unleasedRunning.toString()} unleased</p>;
}
export function LastReport({ status }: { status: CollectorStatus | undefined }) {
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
export function JobDetails({ item }: { item: ActivityJob }) {
  const { job, session } = item, metadata = session.metadata;
  return <details className="activity-row-details"><summary>Details</summary><div className="activity-detail-panel"><h3>Job-revision metadata · r{job.revision}</h3><p className="tiny">Current HEAD r{session.revision} · metadata/content pin r{session.view.revision}. The source model is not the index profile.</p><dl className="activity-run-counters">
    <div><dt>Owner ID</dt><dd><code>{session.ownerId}</code></dd></div><div><dt>Project / branch</dt><dd>{metadata.project === undefined ? 'Unknown' : metadata.project} / {metadata.gitBranch === undefined ? 'Unknown' : metadata.gitBranch}</dd></div>
    <div><dt>Producer / source format</dt><dd>{metadata.producer} / {session.source.format}</dd></div><div><dt>Source model</dt><dd>{metadata.model === undefined ? 'Unknown' : metadata.model}</dd></div>
    <div><dt>Tags</dt><dd>{metadata.tags.length === 0 ? 'None' : metadata.tags.join(', ')}</dd></div><div><dt>Collector namespace / root</dt><dd>{session.source.collectorNamespace} / {session.source.discoveryRootId}</dd></div>
  </dl><p className="activity-window-progress">{windowProgress(job)}{job.state === JobState.Complete ? ' · job complete' : ' · not published by this job'}</p><JobLease item={item}/>
    {job.error !== undefined && <p className="activity-failure">{job.state === JobState.Running ? 'Prior-attempt error' : 'Job error'}: {job.error}</p>}
    {item.classification !== ActivityJobClass.Current && <p className="tiny">Historical job · not actionable here. This does not describe the current published view.</p>}
  </div></details>;
}

export const CollectorRows = memo(function CollectorRows({ items, selected, select }: { items: readonly ActivityCollector[]; selected: string | undefined; select(id: string): void }) {
  return <>{items.map(collector => <tr className="activity-collector-row" key={collector.collectorId} data-scroll-anchor={collector.collectorId} data-freshness={freshness(collector).toLowerCase()}>{collectorColumns.map(column => <td key={column.sort} data-column={column.sort}>{column.render(collector)}</td>)}<td className="activity-row-actions"><button className="small-button" aria-pressed={selected === collector.collectorId} onClick={() => select(collector.collectorId)}>View jobs</button><details className="activity-row-details"><summary>Details</summary><div className="activity-detail-panel"><h3>{collector.collectorId}</h3><RunningLeases counts={collector.current} label="Current"/><RunningLeases counts={collector.historical} label="Historical"/><LastReport status={collector.status}/></div></details></td></tr>)}</>;
});
export const JobRows = memo(function JobRows({ items, scope, blocked, retry }: { items: readonly ActivityJob[]; scope: ActivityJobScope; blocked: boolean; retry(id: string): void }) {
  return <>{items.map(item => <tr className={`activity-job-row ${item.classification === ActivityJobClass.Current ? '' : 'activity-historical'}`} key={item.job.id} data-scroll-anchor={item.job.id}>{jobColumns.map(column => <td key={column.sort} data-column={column.sort}>{column.render(item)}</td>)}<td className="activity-row-actions">{scope === ActivityJobScope.Current && item.retryable && item.classification === ActivityJobClass.Current && item.job.state === JobState.Failed && <button className="small-button" disabled={blocked} onClick={() => retry(item.job.id)}>Retry indexing</button>}<JobDetails item={item}/></td></tr>)}</>;
});
