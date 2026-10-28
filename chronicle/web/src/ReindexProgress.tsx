import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Operation_GetReindexStatus, Result_ReindexStatus, type OwnerReindexResult, type ReindexStatusResult } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
import { REINDEX_STATUS_POLL_MS, ReindexStatusReadPermit, rebuildConclusion, validateReindexStatus, type RebuildCohort } from './reindex-status.ts';
interface Tracking { scope: string; cohort: RebuildCohort; observation: ReindexStatusResult | null; phase: 'polling' | 'paused' | 'terminal'; error: string | null }
export interface RebuildProgressState { tracking: Tracking | null; busy: boolean; check(): void }
// App-owned: an accepted command identity outlives transient mutation notices and
// Activity mounts. Observations never authorize or replay an Apply command.
export function useRebuildProgress(connection: ChronicleConnection, stats: ManagerStats, ownerId: string | null, canRead: boolean, accepted: OwnerReindexResult | null): RebuildProgressState {
  const permit = useMemo(() => new ReindexStatusReadPermit(), [connection]);
  const busy = useSyncExternalStore(permit.subscribe, permit.getSnapshot, permit.getSnapshot);
  const [state, setState] = useState<Tracking | null>(null), [epoch, setEpoch] = useState(0);
  const ready = ownerId !== null && canRead && stats.activeId !== null;
  const scope = JSON.stringify([ownerId, canRead, stats.activeId, stats.generation, epoch]), currentScope = useRef(scope); currentScope.current = scope;
  const adopted = useRef('');
  useEffect(() => connection.onInvalidate(() => { currentScope.current = ''; adopted.current = ''; setState(null); setEpoch(value => value + 1); }), [connection]);
  useEffect(() => { if (!ready) setState(null); }, [scope, ready]);
  useEffect(() => {
    if (!ready || accepted === null) return;
    const key = JSON.stringify([scope, accepted.requestId]); if (adopted.current === key) return;
    adopted.current = key;
    setState({ scope, cohort: { requestId: accepted.requestId, targetProfile: accepted.targetProfile, total: accepted.heads }, observation: null, phase: 'polling', error: null });
  }, [scope, ready, accepted]);
  const tracking = ready && state !== null && state.scope === scope ? state : null;
  const requestId = tracking === null ? null : tracking.cohort.requestId, target = tracking === null ? null : tracking.cohort.targetProfile, total = tracking === null ? null : tracking.cohort.total, phase = tracking === null ? null : tracking.phase;
  useEffect(() => {
    if (tracking === null || phase !== 'polling') return;
    const cohort = tracking.cohort; let disposed = false, timer: number | null = null;
    const applicable = () => !disposed && currentScope.current === scope;
    function update(change: (previous: Tracking) => Tracking) { setState(previous => previous !== null && previous.scope === scope && previous.cohort.requestId === cohort.requestId ? change(previous) : previous); }
    async function poll() {
      const release = permit.acquire();
      if (release === null) { if (applicable()) update(previous => ({ ...previous, observation: null, phase: 'paused', error: 'A prior status read is still unsettled. Check again after it settles; no read was queued.' })); return; }
      try {
        const result = await read(connection, new Operation_GetReindexStatus(cohort.requestId), reply => reply instanceof Result_ReindexStatus ? reply.result : null);
        if (!applicable()) return;
        validateReindexStatus(result, cohort);
        update(previous => ({ ...previous, observation: result, phase: result.pending === 0n ? 'terminal' : 'polling', error: null }));
        if (result.pending > 0n) timer = window.setTimeout(() => void poll(), REINDEX_STATUS_POLL_MS);
      } catch (cause) {
        if (!applicable()) return;
        if (cause instanceof RequestFailure && ['forbidden', 'unauthorized'].includes(cause.code)) setState(null);
        else update(previous => ({ ...previous, observation: null, phase: 'paused', error: cause instanceof Error ? cause.message : 'Rebuild status unavailable; no progress is inferred.' }));
      } finally { release(); }
    }
    void poll();
    return () => { disposed = true; if (timer !== null) window.clearTimeout(timer); };
  }, [connection, scope, requestId, target, total, phase, permit]);
  function check() { if (permit.getSnapshot()) return; setState(previous => ready && previous !== null && previous.scope === scope && previous.phase === 'paused' ? { ...previous, phase: 'polling', error: null } : previous); }
  return { tracking, busy, check };
}
export function ReindexProgress({ progress }: { progress: RebuildProgressState }) {
  const tracking = progress.tracking; if (tracking === null) return null;
  const observed = tracking.observation;
  return <section className="notice" role="region" aria-label="Archive rebuild progress" aria-busy={progress.busy}><h3>Archive rebuild progress</h3><p>Accepted rebuild request <code>{tracking.cohort.requestId}</code> · current pipeline target <code>{tracking.cohort.targetProfile}</code></p><p>Captured cohort: {tracking.cohort.total.toString()} HEADs. Apply acceptance is not completion; later HEADs are not added to this cohort.</p>
    <p role="status" aria-live="polite">{observed === null ? 'Awaiting verified cohort status; no completion is inferred.' : `${observed.complete.toString()} complete · ${observed.superseded.toString()} superseded · ${observed.failed.toString()} failed · ${observed.pending.toString()} pending`}</p>
    {observed !== null && <p>{rebuildConclusion(observed)}</p>}{tracking.error !== null && <p role="alert">{tracking.error} Status polling stopped. No rebuild was repeated.</p>}{tracking.phase === 'paused' && <button type="button" className="small-button" disabled={progress.busy} onClick={progress.check}>Check rebuild status</button>}
  </section>;
}
