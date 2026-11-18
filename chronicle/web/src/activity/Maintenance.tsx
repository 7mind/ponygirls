import type { ActivityResult, UserInfo } from '../api.ts';
import type { ChronicleConnection } from '../client.ts';
import type { MutationState } from '../mutations.ts';
import type { ManagerStats } from '../transport/types.ts';
import { Glyph } from '../Glyph.tsx';
import { RetryFailedIndexing } from '../RetryFailedIndexing.tsx';
import { OwnerReindex } from '../OwnerReindex.tsx';

/** Maintenance (spec §3.1): the owner-wide bulk actions as cards; each previews exact counts in a confirmation dialog. */
export function Maintenance({ connection, stats, user, actions, summary }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState; summary: ActivityResult | null }) {
  return <section className="page page-narrow stack-lg" aria-label="Maintenance" data-view="activity-maintenance">
    <div className="page-head"><div><h1 className="page-title">Maintenance</h1><p className="page-sub">Bulk actions on your own indexing jobs. Each one shows an exact preview and asks for confirmation before anything changes.</p></div></div>
    <div className="activity-maintenance">
      <RetryFailedIndexing connection={connection} stats={stats} user={user} actions={actions} summary={summary}/>
      <OwnerReindex connection={connection} stats={stats} user={user} actions={actions} summary={summary}/>
    </div>
    <div className="notice notice-neutral"><Glyph name="info"/><div><div className="notice-title">If the outcome of an action is unknown</div>When a confirmation was sent and its reply is lost, a persistent “Confirm before repeating” notice with the request ID and “Look up receipt” stays at the top of the page. Nothing is retried automatically.</div></div>
  </section>;
}
