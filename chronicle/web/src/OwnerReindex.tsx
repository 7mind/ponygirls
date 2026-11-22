import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Operation_PreviewOwnerReindex, Operation_ApplyOwnerReindex, Result_OwnerReindexPreview, Scope, type ActivityResult, type OwnerReindexPlan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { Glyph } from './Glyph.tsx';
interface Props { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; summary: ActivityResult | null }
/** Maintenance card "Rebuild archive index" (spec §3.1): a read-only preview in a confirmation dialog, then one explicit Apply. */
export function OwnerReindex(props: Props) { return <OwnerReindexControl key={JSON.stringify([props.user.id, props.stats.activeId, props.stats.generation])} {...props}/>; }
function OwnerReindexControl({ connection, stats, user, actions, summary }: Props) {
  const [plan, setPlan] = useState<OwnerReindexPlan | null>(null), [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const serial = useRef(0), trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false), headingId = useId(), explanationId = useId();
  const blocked = stats.activeId === null || !user.scopes.includes(Scope.Read) || actions.busy || actions.uncertain !== null || busy;
  function clear() { serial.current++; setPlan(null); setConfirmed(false); setOpen(false); setBusy(false); setError(null); }
  useEffect(() => { const unsubscribe = connection.onInvalidate(() => { restoreFocus.current = false; clear(); }); return () => { serial.current++; unsubscribe(); }; }, [connection]);
  // After an accepted rebuild the trigger is still disabled while the mutation settles; focus returns once it is enabled again.
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
  return <section className="card" aria-labelledby={headingId} data-maintenance="rebuild">
    <div className="card-head"><h2 id={headingId}>Rebuild archive index</h2><span className="chip">owner action</span></div>
    <div className="card-body stack"><p className="small muted" id={explanationId}>Rebuilds all your source HEADs, including indexed ones, regardless of list filters or Current/History scope. Existing publications stay searchable until each replacement; old derived generation pins then become unavailable. Original source stays readable. Acceptance is not completion.</p>
      <dl className="dl dl-fixed"><dt>Scope</dt><dd>{summary === null ? 'unknown' : `${summary.archiveHeads.toLocaleString()} conversations · ${summary.current.total.toLocaleString()} with a current job`}</dd></dl></div>
    <div className="card-foot"><button type="button" ref={trigger} className="btn btn-danger-quiet" disabled={blocked} aria-describedby={explanationId} onClick={() => void preview()}>Rebuild archive index</button></div>
    {open && <ConfirmDialog title="Rebuild the archive index?" wide={true} confirmLabel="Rebuild index" danger={true} confirmDisabled={blocked || !confirmed || plan === null} onConfirm={() => void apply()} onCancel={() => { if (!busy) clear(); }}>
      <div className="notice notice-warn"><Glyph name="alert"/><div>This schedules a fresh index generation for every captured HEAD, annotating and embedding every window again (no earlier accepted work is reused), and uses model capacity until each replacement completes.</div></div>
      {busy && <p role="status">Waiting for archive rebuild response…</p>}{error !== null && <p role="alert">{error}</p>}
      {plan !== null && <><dl className="dl"><dt>Conversations</dt><dd><strong>{plan.heads.toString()}</strong> archive HEADs</dd><dt>Replacement jobs</dt><dd>{plan.replacements.toString()}</dd><dt>Current pipeline target</dt><dd><code>{plan.targetProfile}</code></dd><dt>Search during rebuild</dt><dd>keeps using published generations</dd></dl>
        <label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={blocked}/>I confirm rebuilding all {plan.replacements.toString()} captured HEADs with the current pipeline. Existing publications remain until atomic replacement; old derived generation pins then become unavailable.</label></>}
      {plan === null && !busy && <div><button type="button" className="btn btn-sm" disabled={blocked} onClick={() => void preview()}>Request fresh archive rebuild preview</button></div>}
    </ConfirmDialog>}
  </section>;
}
