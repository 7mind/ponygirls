import type { MutationState } from './mutations.ts';
import { MutationToast } from './MutationToast.tsx';
import { Glyph } from './Glyph.tsx';
import { Operation_RevokeToken } from './api.ts';
import { RetryFailedCountsTable } from './RetryFailedIndexing.tsx';
/** Persistent results of mutations; a routine success is the toast, never a block here. */
export function MutationNotice({ actions }: { actions: MutationState }) {
  const blocks = [
    actions.error && <div key="error" className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{actions.error}</div></div>,
    actions.message && <div key="message" className="notice notice-neutral" role="status"><Glyph name="info"/><div>{actions.message}</div></div>,
    actions.retryFailed !== null && <section key="retry" className="notice notice-ok retry-failed-result" aria-label="Indexing retry result"><Glyph name="check-circle"/><div><h3 className="notice-title">Indexing retry applied</h3><p role="status">Server retried {actions.retryFailed.retried.toString()} indexing jobs to Queued. This does not establish Complete job state or index publication.</p><p>Target profile <code>{actions.retryFailed.targetProfile}</code> · request <code>{actions.retryFailed.requestId}</code></p><p>These counts describe the apply-time pre-action population, not current live job totals.</p><RetryFailedCountsTable counts={actions.retryFailed.counts} caption="Apply-time pre-action counts · not a live dashboard"/></div></section>,
    actions.uncertain && <section key="uncertain" className="notice notice-warn uncertain" aria-label="Uncertain mutation"><Glyph name="alert"/><div><h3 className="notice-title">Confirm before repeating</h3><p>{actions.uncertain.label} · request <code>{actions.uncertain.id}</code></p><p>A timeout is not proof that the write failed. No mutation has been replayed automatically.</p>
      <div className="notice-actions"><button type="button" className="btn btn-sm" disabled={actions.busy || !actions.canRecover} onClick={() => void actions.recover()}>Look up receipt</button>{actions.uncertain.absent && <button type="button" className="btn btn-sm" disabled={actions.busy} onClick={() => void actions.retryConfirmedAbsent()}>Retry confirmed-absent request</button>}</div>
      {!actions.canRecover && <p>Sign in to the original account before looking up this receipt.</p>}</div></section>,
    actions.lostTokenId && <section key="lost-token" className="notice notice-warn uncertain"><Glyph name="alert"/><div><h3 className="notice-title">Token committed; secret unavailable</h3><p>The token secret cannot be retrieved or replayed. Revoke token <code>{actions.lostTokenId}</code>, then mint a replacement.</p>
      <div className="notice-actions"><button type="button" className="btn btn-sm" disabled={actions.busy} onClick={() => void actions.run(new Operation_RevokeToken(actions.lostTokenId!), 'Revoke unrecoverable token')}>Revoke unrecoverable token</button></div></div></section>,
  ].filter(block => block !== null && block !== false && block !== '');
  return <>{actions.toast !== null && <MutationToast key={actions.toast.id} message={actions.toast.message} dismiss={() => actions.dismissToast(actions.toast!.id)}/>}{blocks.length > 0 && <div className="mutation-notices stack-sm">{blocks}</div>}</>;
}
