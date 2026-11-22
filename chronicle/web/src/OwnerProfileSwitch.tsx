import { useEffect, useId, useRef, useState } from 'react';
import { Operation_Receipt, Result_Mutation, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { randomUUID } from './uuid.ts';

const path = '/api/maintenance/v1/profile-switch';
const operation = 'owner-profile-switch';
const profileId = /^[0-9a-f]{64}$/;
const requestTimeoutMs = 30_000;
interface Preview { ownerId: string; actor: string; currentProfile: string; targetProfile: string; selectionHash: string; backfillJobs: 0 }
interface Props { connection: ChronicleConnection; user: UserInfo; connected: boolean; mutationBlocked: boolean; pending: string | null; setPending: (id: string | null) => void; refresh: () => void }

function previewOf(value: unknown, ownerId: string): Preview {
  if (typeof value === 'object' && value !== null && 'ownerId' in value && value.ownerId === ownerId &&
      'actor' in value && typeof value.actor === 'string' && value.actor.length > 0 &&
      'currentProfile' in value && typeof value.currentProfile === 'string' && profileId.test(value.currentProfile) &&
      'targetProfile' in value && typeof value.targetProfile === 'string' && profileId.test(value.targetProfile) &&
      'selectionHash' in value && typeof value.selectionHash === 'string' && profileId.test(value.selectionHash) &&
      'backfillJobs' in value && value.backfillJobs === 0) {
    return { ownerId, actor: value.actor, currentProfile: value.currentProfile, targetProfile: value.targetProfile, selectionHash: value.selectionHash, backfillJobs: 0 };
  }
  throw new Error('Profile switch preview could not be verified.');
}

function accepted(value: unknown, id: string, target: string): boolean {
  return typeof value === 'object' && value !== null && 'requestId' in value && value.requestId === id &&
    'targetProfile' in value && value.targetProfile === target && 'backfillJobs' in value && value.backfillJobs === 0;
}

export function OwnerProfileSwitch({ connection, user, connected, mutationBlocked, pending, setPending, refresh }: Props) {
  const heading = useId(), trigger = useRef<HTMLButtonElement>(null), serial = useRef(0);
  const [open, setOpen] = useState(false), [plan, setPlan] = useState<Preview | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const blocked = !connected || mutationBlocked || busy;
  useEffect(() => {
    const unsubscribe = connection.onInvalidate(() => { serial.current++; setPlan(null); setOpen(false); setBusy(false); setMessage(null); setError(null); });
    return () => { serial.current++; unsubscribe(); };
  }, [connection]);

  async function preview() {
    if (blocked || pending !== null) return;
    const request = ++serial.current;
    setOpen(true); setPlan(null); setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) });
      if (!response.ok) throw new Error('Profile switch is unavailable. It requires a compatible deployed embedding profile.');
      const next = previewOf(await response.json(), user.id);
      if (serial.current === request) setPlan(next);
    } catch (cause) { if (serial.current === request) setError(cause instanceof Error ? cause.message : 'Profile preview failed.'); }
    finally { if (serial.current === request) setBusy(false); }
  }
  function committed() {
    setPending(null); setOpen(false); setPlan(null); setError(null);
    setMessage('Indexing profile switched. No backfill jobs were queued.');
    refresh();
  }
  async function apply() {
    if (blocked || pending !== null || plan === null || plan.currentProfile === plan.targetProfile) return;
    const request = ++serial.current, id = randomUUID(crypto);
    setPending(id); setBusy(true); setError(null);
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { 'Content-Type': 'application/json', 'X-Account-Actor': plan.actor },
        body: JSON.stringify({ requestId: id, targetProfile: plan.targetProfile, selectionHash: plan.selectionHash, confirm: true }) });
      if (serial.current !== request) return;
      if ([400, 401, 403, 409].includes(response.status)) {
        setPending(null); setOpen(false); setPlan(null);
        setError('Profile switch was rejected. Review a fresh preview before trying again.');
      } else if (response.ok && accepted(await response.json(), id, plan.targetProfile) && serial.current === request) committed();
      else throw new Error('Unverified response');
    } catch {
      if (serial.current === request) { setOpen(false); setPlan(null); setError('The switch outcome is unknown. Check its receipt before trying again.'); }
    } finally { if (serial.current === request) setBusy(false); }
  }
  async function receipt() {
    if (blocked || pending === null) return;
    const request = ++serial.current, id = pending;
    setBusy(true); setError(null);
    try {
      await read(connection, new Operation_Receipt(id), reply => reply instanceof Result_Mutation &&
        reply.receipt.requestId === id && reply.receipt.operation === operation ? reply.receipt : null);
      if (serial.current === request) committed();
    } catch {
      if (serial.current === request) setError('No successful receipt could be verified. The switch outcome remains unknown.');
    } finally { if (serial.current === request) setBusy(false); }
  }
  return <section className="card" aria-labelledby={heading} data-maintenance="switch-profile">
    <div className="card-head"><h2 id={heading}>Use the new profile for future indexing</h2><span className="chip">owner action</span></div>
    <div className="card-body stack"><p className="small muted">Existing indexed results stay searchable. No backfill runs.</p>
      {message !== null && <p role="status">{message}</p>}{error !== null && !open && <p role="alert">{error}</p>}
      {pending !== null && !open && <p className="small">Switch request: <code>{pending}</code></p>}</div>
    <div className="card-foot"><button type="button" ref={trigger} className="btn btn-sm" disabled={blocked || pending !== null} onClick={() => void preview()}>Review profile switch</button>
      {pending !== null && !open && <button type="button" className="btn btn-sm" disabled={blocked} onClick={() => void receipt()}>Check switch receipt</button>}</div>
    {open && <ConfirmDialog title="Switch profile without backfill?" wide={true} confirmLabel="Switch without backfill" danger={false}
      confirmDisabled={blocked || pending !== null || plan === null || plan.currentProfile === plan.targetProfile} onConfirm={() => void apply()}
      onCancel={() => { if (!busy) { setOpen(false); setPlan(null); trigger.current?.focus(); } }}>
      <p>For your Chronicle account only. New sessions and new revisions use the new profile. Existing publications stay searchable. Unfinished work on the old profile stops and is not automatically requeued.</p>
      {busy && <p role="status">Waiting for the profile switch response…</p>}{error !== null && <p role="alert">{error}</p>}
      {plan !== null && <><dl className="dl"><dt>Current target</dt><dd><code>{plan.currentProfile}</code></dd><dt>New target</dt><dd><code>{plan.targetProfile}</code></dd><dt>Backfill jobs</dt><dd>0</dd></dl>
        {plan.currentProfile === plan.targetProfile && <p>This account already uses the deployed profile.</p>}</>}
    </ConfirmDialog>}
  </section>;
}
