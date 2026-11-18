import { useEffect, useId, useRef, useState } from 'react';
import { ActivityJobScope, Operation_ApplyRetryFailed, Operation_PreviewRetryFailed, Result_RetryFailedPreview, Scope, type ActivityResult, type RetryFailedCounts, type RetryFailedPlan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { addMetadataFilter } from './expression.ts';
import type { MutationState } from './mutations.ts';
import { formatRoute } from './router.ts';
import type { ManagerStats } from './transport/types.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { jobsRouteFor } from './activity/state.ts';
import './retry-failed.css';

export interface RetryFailedIndexingProps { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; summary: ActivityResult | null }

export function RetryFailedCountsTable({ counts, caption }: { counts: RetryFailedCounts; caption: string }) {
  const rows = [
    { label: 'Eligible current failed jobs', count: counts.eligibleCurrentFailed },
    { label: 'Historical failed · superseded revision (excluded)', count: counts.supersededRevisionFailed },
    { label: 'Historical failed · obsolete profile (excluded)', count: counts.obsoleteProfileFailed },
    { label: 'Historical failed · superseded revision and profile (excluded)', count: counts.supersededRevisionAndProfileFailed },
    { label: 'Current Queued (unchanged)', count: counts.unchangedQueued },
    { label: 'Current Running (unchanged)', count: counts.unchangedRunning },
    { label: 'Current Complete (unchanged)', count: counts.unchangedComplete },
  ];
  return <table className="retry-failed-counts"><caption>{caption}</caption><thead><tr><th scope="col">Population</th><th scope="col">Jobs</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.count.toString()}</td></tr>)}</tbody></table>;
}

/** Maintenance card "Retry failed indexing jobs" (spec §3.1): a read-only preview in a confirmation dialog, then one explicit Apply. */
export function RetryFailedIndexing(props: RetryFailedIndexingProps) {
  return <OwnerRetryFailedIndexing key={JSON.stringify([props.user.id, props.stats.activeId, props.stats.generation, props.user.scopes.includes(Scope.Read)])} {...props}/>;
}
function OwnerRetryFailedIndexing({ connection, stats, user, actions, summary }: RetryFailedIndexingProps) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [applying, setApplying] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [plan, setPlan] = useState<RetryFailedPlan | null>(null), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false);
  const sequence = useRef(0), lastApplyHash = useRef<string | null>(null), previewHash = useRef<string | null>(null), currentConnection = useRef(connection);
  currentConnection.current = connection;
  const headingId = useId(), explanationId = useId(), canRead = user.scopes.includes(Scope.Read);
  const eligibleFailed = summary === null ? null : summary.current.failed;
  const blocked = !canRead || stats.activeId === null || actions.busy || actions.uncertain !== null || loading || applying;
  const canPreview = !blocked && eligibleFailed !== null && eligibleFailed > 0n;
  function closePreview() {
    sequence.current++; lastApplyHash.current = null; previewHash.current = null;
    setOpen(false); setLoading(false); setApplying(false); setConfirmed(false); setPlan(null); setError(null); setConflict(false);
  }
  useEffect(() => {
    closePreview();
    const unsubscribe = connection.onInvalidate(() => closePreview());
    return () => { sequence.current++; unsubscribe(); };
  }, [connection]);
  async function preview(afterConflict: boolean) {
    if (blocked || (!afterConflict && (eligibleFailed === null || eligibleFailed <= 0n))) return;
    const request = ++sequence.current;
    lastApplyHash.current = null; previewHash.current = null;
    setOpen(true); setLoading(true); setConfirmed(false); setPlan(null); setError(null); setConflict(afterConflict);
    try {
      const result = await read(connection, new Operation_PreviewRetryFailed(), reply => reply instanceof Result_RetryFailedPreview ? reply.result : null);
      if (sequence.current !== request || currentConnection.current !== connection) return;
      previewHash.current = result.selectionHash; setPlan(result);
    } catch (cause) {
      if (sequence.current === request && currentConnection.current === connection) setError(cause instanceof Error ? cause.message : 'Retry preview failed');
    } finally { if (sequence.current === request && currentConnection.current === connection) setLoading(false); }
  }
  // A direct conflict of the confirmed selection reads a new plan; nothing is resubmitted.
  useEffect(() => {
    if (actions.errorCode !== 'conflict' || actions.busy || applying || lastApplyHash.current === null || lastApplyHash.current !== previewHash.current) return;
    lastApplyHash.current = null; setConfirmed(false); setPlan(null);
    void preview(true);
  }, [actions.errorCode, actions.busy, applying]);
  async function apply() {
    if (!canPreview || plan === null || !confirmed || plan.counts.eligibleCurrentFailed <= 0n) return;
    const request = sequence.current;
    lastApplyHash.current = plan.selectionHash;
    setConfirmed(false); setPlan(null); setApplying(true);
    const applied = await actions.run(new Operation_ApplyRetryFailed(plan.targetProfile, plan.selectionHash, true), 'Retry current failed indexing jobs');
    if (sequence.current !== request || currentConnection.current !== connection) return;
    setApplying(false);
    if (applied) closePreview();
  }
  const disabledReason = !canRead ? 'Read scope is required to preview and retry indexing jobs.' : stats.activeId === null ? 'A verified browser connection is required to preview and retry indexing jobs.' : actions.uncertain !== null ? 'Resolve the uncertain operation before requesting another retry preview.' : applying ? 'Applying the confirmed indexing retry…' : actions.busy ? 'Another account operation is pending.' : loading ? 'Loading read-only retry preview…' : eligibleFailed === null ? 'The unfiltered current failed job count is unknown. Refresh your owner summary before retrying.' : eligibleFailed <= 0n ? 'No current failed indexing jobs are eligible.' : null;
  const eligible = plan === null ? null : plan.counts.eligibleCurrentFailed;
  return <section className="card" aria-labelledby={headingId} data-maintenance="retry">
    <div className="card-head"><h2 id={headingId}>Retry failed indexing jobs</h2><span className={eligibleFailed !== null && eligibleFailed > 0n ? 'chip chip-danger' : 'chip'}>{eligibleFailed === null ? 'count unknown' : `${eligibleFailed.toLocaleString()} eligible`}</span></div>
    <div className="card-body stack"><p className="small muted" id={explanationId}>{disabledReason !== null && <><strong>{disabledReason}</strong> </>}Re-queues every current failed job under the target profile, regardless of list filters. Historical failures are excluded. The preview is read-only; Queued is not complete or published.</p>
      <dl className="dl dl-fixed"><dt>Eligible now</dt><dd>{eligibleFailed === null ? 'unknown' : <><strong>{eligibleFailed.toLocaleString()}</strong> current failed</>}</dd><dt>Excluded</dt><dd>{summary === null ? 'unknown' : `${summary.historical.failed.toLocaleString()} historical failed`}</dd></dl></div>
    <div className="card-foot"><button type="button" className="btn btn-primary" disabled={!canPreview} aria-describedby={explanationId} onClick={() => void preview(false)}>Retry all current failed indexing jobs</button>
      {eligibleFailed !== null && eligibleFailed > 0n && <a className="btn btn-ghost" href={formatRoute(jobsRouteFor(addMetadataFilter('', 'status', 'failed'), ActivityJobScope.Current))}>View the {eligibleFailed.toLocaleString()} jobs</a>}</div>
    {open && <ConfirmDialog title={eligible === null ? 'Retry failed indexing jobs?' : `Retry ${eligible.toLocaleString()} failed indexing jobs?`} wide={true} confirmLabel={eligible === null ? 'Retry jobs' : `Retry ${eligible.toLocaleString()} jobs`} danger={false}
      confirmDisabled={!canPreview || plan === null || !confirmed || plan.counts.eligibleCurrentFailed <= 0n} onConfirm={() => void apply()} onCancel={() => { if (!applying) closePreview(); }}>
      <p>Queues Failed jobs at the current source HEAD and target profile. Other jobs and the index profile stay unchanged.</p>
      {conflict && <p role="status">The selection or target profile changed. Review a fresh preview and confirm again; the previous selection has not been resubmitted.</p>}
      {loading && <p role="status">Loading read-only retry preview…</p>}{applying && <p role="status">Applying the confirmed indexing retry…</p>}
      {error !== null && <div className="notice notice-danger" role="alert">{error}</div>}
      {plan !== null && <><p>Target profile <code>{plan.targetProfile}</code></p><RetryFailedCountsTable counts={plan.counts} caption="Read-only preview · all your indexing jobs"/>
        {plan.counts.eligibleCurrentFailed === 0n && <p>No current failed jobs are eligible in this preview. Historical failures are excluded.</p>}
        <label className="check"><input type="checkbox" checked={confirmed} disabled={blocked || plan.counts.eligibleCurrentFailed <= 0n} onChange={event => setConfirmed(event.target.checked)}/>I confirm retrying all {plan.counts.eligibleCurrentFailed.toString()} eligible current failed indexing jobs under this target profile.</label></>}
      {!loading && !applying && plan === null && error === null && !conflict && <p>Request a new preview before confirming another retry.</p>}
    </ConfirmDialog>}
  </section>;
}
