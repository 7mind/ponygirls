import { useEffect, useState } from 'react';
import { CollectorPhase, JobState, Operation_CollectionStatus, Operation_IngestStatus, Operation_RetryJob, Result_CollectionStatus, Result_Status } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { Blank, ErrorNotice } from './App.tsx';
import { ACTIVITY_POLL_INTERVAL_MS, formatBytes, windowProgress } from './progress.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
export function Activity({ connection, stats, actions }: { connection: ChronicleConnection; stats: ManagerStats; actions: MutationState }) {
  const [refresh, setRefresh] = useState(0), [offset, setOffset] = useState(0);
  useEffect(() => {
    if (stats.activeId === null) return;
    const timer = window.setInterval(() => setRefresh(n => n + 1), ACTIVITY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connection, stats.activeId, stats.generation]);
  const collectors = useResource(connection, stats, 'collectors', `${refresh}`, true,
    () => read(connection, new Operation_CollectionStatus(), r => r instanceof Result_CollectionStatus ? r.result : null));
  const jobs = useResource(connection, stats, `jobs:${offset}`, `${refresh}:${actions.revision}`, true,
    () => read(connection, new Operation_IngestStatus(offset, 30), r => r instanceof Result_Status ? r.result : null));
  return <main className="management-page activity-page"><div className="page-heading"><span className="eyebrow">PIPELINE / OWN ACTIVITY</span><h1>Ingestion activity</h1><p>Collection and index publication are separate. Failed annotation does not remove the original source.</p></div><button onClick={() => setRefresh(n => n + 1)}>Refresh status ↻</button><p className="tiny">Authorized snapshots · refreshed every 4 seconds while connected. Missing reports do not establish completion or health.</p>
    <section aria-labelledby="collection-heading" className="management-section"><h2 id="collection-heading">Collection</h2><p className="tiny">Latest report per collector (up to 100). Freshness is server-received time, not a command or proof that a worker is running. Idle does not mean all sources are complete.</p>
      {collectors.error && <ErrorNotice>{collectors.error}</ErrorNotice>}{collectors.loading && <p role="status">Rechecking collection status…</p>}
      {collectors.data?.collectors.map(({ report, receivedAt, stale }) => <article className="collector-card" key={report.collectorId}>
        <div className="section-heading"><h3>{report.collectorId}</h3><span className={`badge ${stale || report.phase === CollectorPhase.Failed ? 'job-error' : ''}`}>{report.phase} · {stale ? 'Stale — no recent report' : 'Recent report'}</span></div>
        <p className="tiny">Received {receivedAt} · started {report.startedAt}</p><p className="tiny">Run <code>{report.runId}</code> · sequence {report.sequence.toString()}</p>
        {stale && <p className="job-error">Last known snapshot only; current progress and worker health are unknown.</p>}
        {report.error && <p className="job-error" role="status">Collector error: {report.error}</p>}
        <dl className="progress-counters">
          <div><dt>Scanned / discovered sessions</dt><dd>{report.counters.scanned} / {report.counters.discovered}</dd></div>
          <div><dt>Scanned bytes</dt><dd>{formatBytes(report.counters.scannedBytes)}</dd></div>
          <div><dt>Queued sessions</dt><dd>{report.counters.enqueued}</dd></div>
          <div><dt>Acknowledged uploaded sessions</dt><dd>{report.counters.uploaded}</dd></div>
          <div><dt>Acknowledged uploaded bytes / queued payload bytes</dt><dd>{formatBytes(report.uploadedBytes)} / {formatBytes(report.totalUploadBytes)}</dd></div>
          {report.phase === CollectorPhase.Uploading && <div><dt>Current payload size (not acknowledged progress)</dt><dd>{formatBytes(report.currentUploadTotalBytes)}</dd></div>}
          <div><dt>Waiting for quiet</dt><dd>{report.counters.waiting}</dd></div>
          <div><dt>Pending queue</dt><dd>{report.counters.pending}</dd></div>
          <div><dt>Quarantined</dt><dd>{report.counters.quarantined}</dd></div>
          <div><dt>Stopped</dt><dd>{report.counters.stopped}</dd></div>
          <div><dt>Conflicts</dt><dd>{report.counters.conflicts}</dd></div>
          <div><dt>Upload failures</dt><dd>{report.counters.uploadFailures}</dd></div>
          <div><dt>Excluded</dt><dd>{report.counters.excluded}</dd></div>
          <div><dt>Unchanged</dt><dd>{report.counters.unchanged}</dd></div>
        </dl><p className="tiny">Acknowledgements are archive receipts, not index publication. Uploads may include a queue from earlier runs.</p>
      </article>)}
      {collectors.data?.collectors.length === 0 && <Blank title="No collector reports">Collection progress is unknown. This does not mean collection is configured, stopped, healthy or complete.</Blank>}
    </section>
    <section aria-labelledby="indexing-heading" className="management-section"><h2 id="indexing-heading">Indexing jobs</h2><p className="tiny">Processed windows are not published until the job is Complete. An unknown total is not zero.</p>
      {jobs.error && <ErrorNotice>{jobs.error}</ErrorNotice>}{jobs.loading && <div className="loading-line" role="status">Rechecking job status…</div>}
      {jobs.data && <><div className="job-list">{jobs.data.jobs.map(job => <article className="job-row" key={job.id}><span className={`job-state state-${job.state.toLowerCase()}`}>{job.state === JobState.Complete ? '✓' : job.state === JobState.Failed ? '!' : '◷'} {job.state}</span><div><h3>Revision {job.revision}</h3><code>{job.sessionId}</code><p className="tiny">Job {job.id} · attempt {job.attempts}</p><p>{windowProgress(job)} · {job.state === JobState.Complete ? 'Published' : 'Not published by this job'}</p>{job.error && <p className="job-error">{job.error}</p>}</div>{job.state === JobState.Failed && job.error !== 'superseded-revision' && <button disabled={actions.busy || actions.uncertain !== null || stats.activeId === null} onClick={() => void actions.run(new Operation_RetryJob(job.id), 'Retry indexing job')}>Retry job</button>}</article>)}</div>{jobs.data.jobs.length === 0 && <Blank title="No indexing jobs">No jobs in this authorized status page. This is not a claim that collection is configured or complete.</Blank>}<nav className="pagination" aria-label="Job pages"><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 30))}>← Previous</button><span>{jobs.data.total} jobs</span><button disabled={offset + 30 >= jobs.data.total} onClick={() => setOffset(n => n + 30)}>Next →</button></nav></>}
    </section>
  </main>;
}
