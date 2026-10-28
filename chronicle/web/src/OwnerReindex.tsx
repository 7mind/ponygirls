import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Operation_PreviewOwnerReindex, Operation_ApplyOwnerReindex, Result_OwnerReindexPreview, Scope, type OwnerReindexPlan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
interface Props { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }
export function OwnerReindex(props: Props) { return <OwnerReindexControl key={JSON.stringify([props.user.id, props.stats.activeId, props.stats.generation])} {...props}/>; }
function OwnerReindexControl({ connection, stats, user, actions }: Props) {
  const [plan, setPlan] = useState<OwnerReindexPlan | null>(null), [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const serial = useRef(0), trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  const blocked = stats.activeId === null || !user.scopes.includes(Scope.Read) || actions.busy || actions.uncertain !== null || busy;
  function clear() { serial.current++; setPlan(null); setConfirmed(false); setOpen(false); setBusy(false); setError(null); }
  useEffect(() => { const unsubscribe = connection.onInvalidate(() => { restoreFocus.current = false; clear(); }); return () => { serial.current++; unsubscribe(); }; }, [connection]);
  useLayoutEffect(() => { if (restoreFocus.current && !open && !blocked && trigger.current !== null) { restoreFocus.current = false; trigger.current.focus(); } }, [open, blocked]);
  async function preview() {
    if (blocked) return;
    const request = ++serial.current; setPlan(null); setConfirmed(false); setOpen(true); setBusy(true); setError(null);
    try {
      const result = await read(connection, new Operation_PreviewOwnerReindex(), reply => reply instanceof Result_OwnerReindexPreview ? reply.result : null);
      if (!/^[0-9a-f]{64}$/.test(result.selectionHash) || !result.targetProfile || !result.currentTargetProfile || [result.heads, result.alreadyCurrent, result.replacements].some(count => count < 0n) || result.alreadyCurrent !== 0n || result.replacements !== result.heads) throw new Error('Invalid rebuild preview: every captured HEAD must be selected for the current pipeline.');
      if (serial.current === request) setPlan(result);
    } catch (cause) { if (serial.current === request) setError(cause instanceof Error ? cause.message : 'Archive rebuild preview failed'); }
    finally { if (serial.current === request) setBusy(false); }
  }
  async function apply() {
    if (blocked || !confirmed || plan === null) return;
    const request = serial.current, operation = new Operation_ApplyOwnerReindex(plan.targetProfile, plan.selectionHash, true);
    setPlan(null); setConfirmed(false); setBusy(true);
    const applied = await actions.run(operation, 'Rebuild archive index');
    if (serial.current !== request) return;
    setBusy(false);
    if (applied) { restoreFocus.current = true; clear(); }
    else setError('Apply was not verified. Resolve any unknown outcome using its receipt; otherwise request a fresh preview and explicitly confirm again.');
  }
  return <div className="owner-reindex"><button ref={trigger} disabled={blocked} onClick={() => void preview()}>Rebuild archive index</button><p className="tiny">Owner-only, all non-tombstone source HEADs, independent of table expressions, collector filters and Current/History scope. Every captured HEAD is rebuilt with the sole current pipeline, including already-indexed HEADs. Prior publication/search remains available until atomic replacement; replaced derived generations become explicitly unavailable. Original revision-only source and permitted raw records remain readable. Apply acceptance is not completion.</p>
    {open && <section className="notice" aria-label="Archive rebuild preview" aria-busy={busy}><h3>Rebuild archive index</h3>{busy && <p role="status">Waiting for archive rebuild response…</p>}{error !== null && <p role="alert">{error}</p>}{plan !== null && <form onSubmit={event => { event.preventDefault(); void apply(); }}><p>Current pipeline target <code>{plan.targetProfile}</code> · read-only identity, not a profile choice.</p><dl className="goal50-settings"><div><dt>All your HEADs</dt><dd>{plan.heads.toString()}</dd></div><div><dt>Replacement jobs</dt><dd>{plan.replacements.toString()}</dd></div></dl><label className="check-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={blocked}/>I confirm rebuilding all {plan.replacements.toString()} captured HEADs with the current pipeline. Existing publications remain until atomic replacement; old derived generation pins then become unavailable.</label><button className="primary" disabled={blocked || !confirmed}>Confirm archive index rebuild</button></form>}{plan === null && !busy && <button disabled={blocked} onClick={() => void preview()}>Request fresh archive rebuild preview</button>}<button type="button" disabled={busy} onClick={() => { restoreFocus.current = true; clear(); }}>Cancel archive rebuild preview</button></section>}
  </div>;
}
