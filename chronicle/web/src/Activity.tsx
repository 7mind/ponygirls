import { useEffect, useState } from 'react';
import { Operation_IngestStatus, Operation_RetryJob, Result_Status } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { Blank, ErrorNotice } from './App.tsx';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
export function Activity({ connection, stats, actions }: { connection: ChronicleConnection; stats: ManagerStats; actions: MutationState }) {
  const [refresh, setRefresh] = useState(0), [offset, setOffset] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setRefresh(n => n + 1), 10_000); return () => window.clearInterval(timer); }, []);
  const jobs = useResource(connection, stats, `${offset}:${refresh}:${actions.revision}`, true,
    () => read(connection, new Operation_IngestStatus(offset, 30), r => r instanceof Result_Status ? r.result : null));
  return <main className="management-page activity-page"><div className="page-heading"><span className="eyebrow">PIPELINE / OWN JOBS</span><h1>From source to searchable.</h1><p>Archive receipts are not index publication. Failed annotation does not remove the original source.</p></div><div className="section-heading"><h2>Indexing jobs</h2><button onClick={() => setRefresh(n => n + 1)}>Refresh status ↻</button></div><p className="tiny">Authorized job snapshot · refreshed every 10 seconds while this page is open. Collector root coverage is not exposed by this API.</p>
    {jobs.error && <ErrorNotice>{jobs.error}</ErrorNotice>}{jobs.loading && <div className="loading-line" role="status">Rechecking job status…</div>}
    {jobs.data && <><div className="job-list">{jobs.data.jobs.map(job => <article className="job-row" key={job.id}><span className={`job-state state-${job.state.toLowerCase()}`}>{job.state === 'Complete' ? '✓' : job.state === 'Failed' ? '!' : '◷'} {job.state}</span><div><h3>Revision {job.revision}</h3><code>{job.sessionId}</code><p className="tiny">Job {job.id} · attempt {job.attempts}</p>{job.error && <p className="job-error">{job.error}</p>}</div>{job.state === 'Failed' && job.error !== 'superseded-revision' && <button disabled={actions.busy || actions.uncertain !== null || stats.activeId === null} onClick={() => void actions.run(new Operation_RetryJob(job.id), 'Retry indexing job')}>Retry job</button>}</article>)}</div>{jobs.data.jobs.length === 0 && <Blank title="Nothing waiting in the wings.">No jobs in this authorized status page. This is not a claim that collection is configured or complete.</Blank>}<nav className="pagination" aria-label="Job pages"><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 30))}>← Previous</button><span>{jobs.data.total} jobs</span><button disabled={offset + 30 >= jobs.data.total} onClick={() => setOffset(n => n + 30)}>Next →</button></nav></>}
  </main>;
}
