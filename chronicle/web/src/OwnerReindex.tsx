import { useEffect, useRef, useState } from 'react';
import { Operation_PreviewOwnerReindex, Operation_ApplyOwnerReindex, Result_OwnerReindexPreview, Scope, type OwnerReindexPlan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
interface Props { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }
export function OwnerReindex(props: Props) { return <OwnerReindexControl key={JSON.stringify([props.user.id, props.stats.activeId, props.stats.generation])} {...props}/>; }
function OwnerReindexControl({ connection, stats, user, actions }: Props) {
  const [plan, setPlan] = useState<OwnerReindexPlan | null>(null), [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const serial = useRef(0), trigger = useRef<HTMLButtonElement>(null);
  const blocked = stats.activeId === null || !user.scopes.includes(Scope.Read) || actions.busy || actions.uncertain !== null || busy;
  function clear() { serial.current++; setPlan(null); setConfirmed(false); setOpen(false); setBusy(false); setError(null); }
  useEffect(() => { const unsubscribe = connection.onInvalidate(clear); return () => { serial.current++; unsubscribe(); }; }, [connection]);
  async function preview() {
    if (blocked) return;
    const request = ++serial.current; setPlan(null); setConfirmed(false); setOpen(true); setBusy(true); setError(null);
    try {
      const result = await read(connection, new Operation_PreviewOwnerReindex(), reply => reply instanceof Result_OwnerReindexPreview ? reply.result : null);
      if (!/^[0-9a-f]{64}$/.test(result.selectionHash) || !result.targetProfile || !result.currentTargetProfile || [result.heads, result.alreadyCurrent, result.replacements].some(count => count < 0n) || result.alreadyCurrent + result.replacements !== result.heads) throw new Error('Invalid owner reprocess preview.');
      if (serial.current === request) setPlan(result);
    } catch (cause) { if (serial.current === request) setError(cause instanceof Error ? cause.message : 'Owner reprocess preview failed'); }
    finally { if (serial.current === request) setBusy(false); }
  }
  async function apply() {
    if (blocked || !confirmed || plan === null) return;
    const request = serial.current, operation = new Operation_ApplyOwnerReindex(plan.targetProfile, plan.selectionHash, true);
    setPlan(null); setConfirmed(false); setBusy(true);
    const applied = await actions.run(operation, 'Reprocess all my current source HEADs');
    if (serial.current !== request) return;
    setBusy(false);
    if (applied) { clear(); if (trigger.current !== null) trigger.current.focus(); }
    else setError('Apply was not verified. Resolve any unknown outcome using its receipt; otherwise request a fresh preview and explicitly confirm again.');
  }
  return <div className="owner-reindex"><button ref={trigger} disabled={blocked} onClick={() => void preview()}>Preview reprocessing all my HEADs</button><p className="tiny">Owner-only, all non-tombstone source HEADs, independent of table expressions, collector filters and Current/History scope. Prior publications, raw revisions and history remain readable until replacement publications commit. Queue empty is not completion; verify each HEAD publication.</p>
    {open && <section className="notice" aria-label="Owner reprocess preview" aria-busy={busy}><h3>Reprocess your current source HEADs</h3>{busy && <p role="status">Waiting for owner reprocess response…</p>}{error !== null && <p role="alert">{error}</p>}{plan !== null && <form onSubmit={event => { event.preventDefault(); void apply(); }}><p>Current target <code>{plan.currentTargetProfile}</code><br/>New target <code>{plan.targetProfile}</code></p><dl className="goal50-settings"><div><dt>All your HEADs</dt><dd>{plan.heads.toString()}</dd></div><div><dt>Already current</dt><dd>{plan.alreadyCurrent.toString()}</dd></div><div><dt>Replacement jobs</dt><dd>{plan.replacements.toString()}</dd></div></dl><label className="check-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={blocked}/>I confirm changing my target profile and reprocessing all {plan.replacements.toString()} selected HEADs. Existing publications and history are preserved.</label><button className="primary" disabled={blocked || !confirmed}>Confirm owner reprocess</button></form>}{plan === null && !busy && <button disabled={blocked} onClick={() => void preview()}>Request fresh owner reprocess preview</button>}<button type="button" disabled={busy} onClick={() => { clear(); if (trigger.current !== null) trigger.current.focus(); }}>Cancel owner reprocess preview</button></section>}
  </div>;
}
