import { ActivityClaimOrder, ActivityJobWaiting_AwaitingLargeLane, ActivityJobWaiting_AwaitingLargePermit, ActivityJobWaiting_AwaitingReclaim, ActivityJobWaiting_BlockedByOlderRevision, ActivityJobWaiting_Held, ActivityJobWaiting_IndexingOff, ActivityJobWaiting_LeaseExhaustedPending, ActivityJobWaiting_LeaseExpiredAwaitingReclaim, ActivityJobWaiting_Queued, JobState, type ActivityJob } from '../api.ts';

// Claim order in Activity (indexing claim-order spec §7; approved mockup of 25 Nov): why a job is not running, its class and
// its position. The server decides the reason (CONTRACT.md "Claim order in Activity"); this module only words it.
export type JobClass = 'fresh' | 'bulk' | 'unclassified';
export function jobClass(bulk: boolean | undefined): JobClass { return bulk === undefined ? 'unclassified' : bulk ? 'bulk' : 'fresh'; }
/** The order a job's `ahead` is counted in, by the claim order in force (unknown before the summary is read). */
export function orderName(order: ActivityClaimOrder | undefined, row: ActivityJob): string {
  if (row.waiting instanceof ActivityJobWaiting_AwaitingLargeLane) return 'large-job lane';
  if (order === ActivityClaimOrder.Waiting) return jobClass(row.bulk);
  return 'claim';
}
/** The order a job waits in, as the detail names it. */
export function orderDescription(row: ActivityJob, order: ActivityClaimOrder | undefined): string {
  if (order === ActivityClaimOrder.Waiting) {
    if (row.waiting instanceof ActivityJobWaiting_AwaitingLargeLane) return 'Large-job lane · oldest waiting since first, then source ID';
    const cls = jobClass(row.bulk);
    return cls === 'unclassified' ? 'Lane 0 · oldest waiting since first, then source ID' : `${cls === 'fresh' ? 'Fresh' : 'Bulk'} lanes · oldest waiting since first, then source ID`;
  }
  if (row.waiting instanceof ActivityJobWaiting_AwaitingLargePermit) return 'The lane holding the large-job permit · owner, then source ID';
  return 'Owner, then source ID';
}
/** "N ahead": a count of jobs of all owners claimed before this one, never who they are. */
export interface Ahead { readonly count: bigint; readonly text: string; readonly title: string; readonly suffix: string }
const ORDER_NOTE = 'An order, not a time estimate: it can grow when older work returns, e.g. a retry.';
export function ahead(row: ActivityJob, order: ActivityClaimOrder | undefined): Ahead | null {
  if (row.ahead === undefined) return null;
  const n = row.ahead, large = row.waiting instanceof ActivityJobWaiting_AwaitingLargeLane, jobs = n === 1n ? 'job' : 'jobs', name = orderName(order, row);
  const text = large ? `${n.toLocaleString()} large ${jobs} ahead` : `${n.toLocaleString()} ahead`;
  const title = large ? `${n.toLocaleString()} large ${jobs} (of all owners) will be claimed by the large-job lane before this one. ${ORDER_NOTE}`
    : `${n.toLocaleString()} ${jobs} (of all owners) will be claimed before this one in the ${name} order. ${ORDER_NOTE}`;
  return { count: n, text, title, suffix: large ? '' : name === 'claim' ? ' in the claim order' : ` in the ${name} queue` };
}
/** What the State column shows: the stored state, or what the waiting reason makes of it. */
export interface StateLabel { readonly text: string; readonly status: string; readonly title: string }
const STATES: Readonly<Record<JobState, string>> = { [JobState.Complete]: 'status status-ok', [JobState.Queued]: 'status', [JobState.Running]: 'status status-run', [JobState.Failed]: 'status status-danger' };
export function stateLabel(row: ActivityJob): StateLabel {
  const stored = row.job.state, w = row.waiting;
  if (w instanceof ActivityJobWaiting_LeaseExpiredAwaitingReclaim) return { text: 'Lease expired — waiting to be reclaimed', status: 'status status-warn state-wrap', title: 'Stored state: Running, lease ended — not an active worker' };
  if (w instanceof ActivityJobWaiting_LeaseExhaustedPending) return { text: 'Lease expired — attempts used up', status: 'status status-warn state-wrap', title: 'Stored state: Running, lease ended at the attempt limit — not an active worker' };
  if (w instanceof ActivityJobWaiting_AwaitingReclaim) return { text: 'Waiting to be reclaimed', status: 'status status-warn state-wrap', title: 'Stored state: Running, invalidated by an indexing settings change — not an active worker' };
  if (w instanceof ActivityJobWaiting_Held) return { text: 'Held', status: 'status status-idle', title: 'Stored state: Queued, with a future attempt time' };
  if (w instanceof ActivityJobWaiting_BlockedByOlderRevision) return { text: 'Blocked', status: 'status status-idle', title: 'Stored state: Queued' };
  if (w instanceof ActivityJobWaiting_IndexingOff) return { text: 'Indexing off', status: 'status status-idle', title: `Stored state: ${stored}; indexing is turned off for this account` };
  return { text: stored, status: STATES[stored], title: stored };
}
/** The "Why not running" cell: a main line (with the position, when there is one) and a detail line. */
export interface WhyText { readonly main: string; readonly ahead: Ahead | null; readonly after: string; readonly sub: string; readonly running: boolean }
const PLURAL_WINDOWS = (total: number | undefined) => total === undefined ? 'an unknown number of windows' : `${total.toLocaleString()} window${total === 1 ? '' : 's'}`;
export function why(row: ActivityJob, order: ActivityClaimOrder | undefined, time: (iso: string) => string): WhyText {
  const w = row.waiting, position = ahead(row, order), cls = jobClass(row.bulk), prior = row.job.error === undefined ? '' : `Prior: ${row.job.error} · `;
  const queue = order === ActivityClaimOrder.Waiting && cls !== 'unclassified' ? `the ${cls} order` : 'the claim order';
  const at = (text: string) => position === null ? text : `${text} · `;
  if (w instanceof ActivityJobWaiting_Queued) {
    const sub = order === ActivityClaimOrder.Waiting ? cls === 'bulk' ? 'Claimable · bulk lane first; fresh lanes borrow when idle' : cls === 'fresh' ? 'Claimable · a free fresh lane takes the oldest first' : 'Claimable · lane 0 takes it in waiting order'
      : order === ActivityClaimOrder.SourceId ? 'Claimable · claimed in owner, then source order' : 'Claimable';
    return { main: at('Queued'), ahead: position, after: position === null ? '' : position.suffix, sub, running: false };
  }
  if (w instanceof ActivityJobWaiting_AwaitingLargeLane) return { main: at('Waiting for the large-job lane'), ahead: position, after: '', sub: `Sized ${PLURAL_WINDOWS(row.job.totalWindows)} · runs only on the large-job lane`, running: false };
  if (w instanceof ActivityJobWaiting_AwaitingLargePermit) return { main: at('Waiting for the large-job permit'), ahead: position, after: position === null ? '' : position.suffix, sub: `Sized ${PLURAL_WINDOWS(row.job.totalWindows)} · only a lane holding the large-job permit takes it`, running: false };
  if (w instanceof ActivityJobWaiting_LeaseExpiredAwaitingReclaim) {
    const ended = row.leaseExpiresAt === undefined ? 'Lease ended' : `Lease ended ${time(row.leaseExpiresAt)}`;
    return { main: at(ended), ahead: position, after: position === null ? '' : position.suffix, sub: 'Worker stopped renewing · any lane may reclaim it', running: false };
  }
  if (w instanceof ActivityJobWaiting_LeaseExhaustedPending) {
    const ended = row.leaseExpiresAt === undefined ? 'Lease ended' : `Lease ended ${time(row.leaseExpiresAt)}`;
    return { main: `${ended} · attempt limit reached`, ahead: null, after: '', sub: 'The next claim ends it lease-exhausted; retry it then', running: false };
  }
  if (w instanceof ActivityJobWaiting_AwaitingReclaim) return { main: at('Indexing settings changed'), ahead: position, after: position === null ? '' : position.suffix, sub: 'Its running attempt no longer counts · any lane may reclaim it', running: false };
  if (w instanceof ActivityJobWaiting_Held) return { main: `Retrying after ${time(w.nextAttemptAt)} (back-off)`, ahead: null, after: '', sub: `${prior}rejoins ${queue} at ${time(w.nextAttemptAt)}`, running: false };
  if (w instanceof ActivityJobWaiting_BlockedByOlderRevision) return { main: `Waiting for older revision r${w.revision} (still running)`, ahead: null, after: '', sub: `Joins ${queue} when r${w.revision} ends`, running: false };
  if (w instanceof ActivityJobWaiting_IndexingOff) return { main: 'Indexing is turned off for your account', ahead: null, after: '', sub: 'Waits until indexing is turned on again', running: false };
  if (row.job.state === JobState.Running && row.leaseActive) {
    const total = row.job.totalWindows === undefined ? 'unknown' : row.job.totalWindows.toLocaleString();
    return { main: `Running · windows ${row.job.completedWindows.toLocaleString()}/${total}`, ahead: null, after: '', sub: row.leaseExpiresAt === undefined ? 'Not waiting' : `Lease active until ${time(row.leaseExpiresAt)} · not waiting`, running: true };
  }
  return { main: '—', ahead: null, after: '', sub: '', running: false };
}
