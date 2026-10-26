import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Operation_ApplyRetryFailed, Operation_PreviewRetryFailed, Result_RetryFailedPreview, Scope, type RetryFailedCounts, type RetryFailedPlan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
import './retry-failed.css';

export interface RetryFailedIndexingProps { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; eligibleFailed: bigint | null }

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

export function RetryFailedIndexing(props: RetryFailedIndexingProps) {
  return <OwnerRetryFailedIndexing key={JSON.stringify([props.user.id, props.stats.activeId, props.stats.generation, props.user.scopes.includes(Scope.Read)])} {...props}/>;
}
function OwnerRetryFailedIndexing({ connection, stats, user, actions, eligibleFailed }: RetryFailedIndexingProps) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [applying, setApplying] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [plan, setPlan] = useState<RetryFailedPlan | null>(null), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement>(null), sequence = useRef(0), lastApplyHash = useRef<string | null>(null), previewHash = useRef<string | null>(null), currentConnection = useRef(connection);
  currentConnection.current = connection;
  const headingId = useId(), explanationId = useId(), canRead = user.scopes.includes(Scope.Read);
  const blocked = !canRead || stats.activeId === null || actions.busy || actions.uncertain !== null || loading || applying;
  const canPreview = !blocked && eligibleFailed !== null && eligibleFailed > 0n;
  function closePreview(restoreFocus: boolean) {
    sequence.current++; lastApplyHash.current = null; previewHash.current = null;
    setOpen(false); setLoading(false); setApplying(false); setConfirmed(false); setPlan(null); setError(null); setConflict(false);
    if (restoreFocus && trigger.current !== null) trigger.current.focus();
  }
  useEffect(() => {
    closePreview(false);
    const unsubscribe = connection.onInvalidate(() => closePreview(false));
    return () => { sequence.current++; unsubscribe(); };
  }, [connection]);
  useEffect(() => { if (open && heading.current !== null) heading.current.focus(); }, [open]);
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
  useEffect(() => {
    if (actions.errorCode !== 'conflict' || actions.busy || applying || lastApplyHash.current === null || lastApplyHash.current !== previewHash.current) return;
    lastApplyHash.current = null; setConfirmed(false); setPlan(null);
    void preview(true);
  }, [actions.errorCode, actions.busy, applying]);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPreview || plan === null || !confirmed || plan.counts.eligibleCurrentFailed <= 0n) return;
    const request = sequence.current;
    lastApplyHash.current = plan.selectionHash;
    setConfirmed(false); setPlan(null); setApplying(true);
    const applied = await actions.run(new Operation_ApplyRetryFailed(plan.targetProfile, plan.selectionHash, true), 'Retry current failed indexing jobs');
    if (sequence.current !== request || currentConnection.current !== connection) return;
    setApplying(false);
    if (applied) closePreview(true);
  }
  return <div className="retry-failed-action"><button ref={trigger} disabled={!canPreview} aria-describedby={explanationId} onClick={() => void preview(false)}>Retry all current failed indexing jobs</button>
    <p id={explanationId} className="tiny">{eligibleFailed === null ? 'The unfiltered current failed job count is unknown. Refresh your owner summary before retrying.' : eligibleFailed <= 0n ? 'No current failed indexing jobs are eligible. Historical failures are excluded.' : 'Applies to all your current failed jobs, regardless of the table expression, collector filter or scope. Historical failures are excluded.'}</p>
    {!canRead && <p className="tiny">Read scope is required to preview and retry indexing jobs.</p>}{stats.activeId === null && <p className="tiny">A verified browser connection is required to preview and retry indexing jobs.</p>}
    {open && <section className="notice retry-failed-preview" aria-labelledby={headingId} aria-busy={loading || applying}><h3 id={headingId} ref={heading} tabIndex={-1}>Retry failed indexing preview</h3>
      <p>Only your Failed jobs at the current source HEAD and target profile will be queued. Queued, Running, Complete and historical jobs stay untouched. This does not change the index profile or establish completion or publication.</p>
      {conflict && <p role="status">The selection or target profile changed. Review a fresh preview and confirm again; the previous selection has not been resubmitted.</p>}
      {loading && <p role="status">Loading read-only retry preview…</p>}{applying && <p role="status">Applying the confirmed indexing retry…</p>}{error !== null && <div className="notice error" role="alert">{error}</div>}
      {plan !== null && <form onSubmit={event => void apply(event)}><p>Target profile <code>{plan.targetProfile}</code></p><RetryFailedCountsTable counts={plan.counts} caption="Read-only preview · all your indexing jobs"/>
        {plan.counts.eligibleCurrentFailed === 0n && <p>No current failed jobs are eligible in this preview. Historical failures are excluded.</p>}
        <label className="check-label"><input type="checkbox" checked={confirmed} disabled={blocked || plan.counts.eligibleCurrentFailed <= 0n} onChange={event => setConfirmed(event.target.checked)}/>I confirm retrying all {plan.counts.eligibleCurrentFailed.toString()} eligible current failed indexing jobs under this target profile.</label>
        <button type="submit" className="primary" disabled={!canPreview || !confirmed || plan.counts.eligibleCurrentFailed <= 0n}>Confirm retry indexing jobs</button>
      </form>}
      {!loading && !applying && plan === null && error === null && !conflict && <p>Request a new preview before confirming another retry.</p>}
      <button type="button" className="small-button retry-failed-cancel" disabled={applying} onClick={() => closePreview(true)}>Cancel retry preview</button>
    </section>}
  </div>;
}
