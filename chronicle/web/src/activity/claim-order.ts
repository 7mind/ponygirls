import { ActivityClaimOrder, ActivityJobWaiting_AwaitingLargeLane, ActivityJobWaiting_AwaitingLargePermit, ActivityJobWaiting_AwaitingReclaim, ActivityJobWaiting_BlockedByOlderRevision, ActivityJobWaiting_Held, ActivityJobWaiting_IndexingOff, ActivityJobWaiting_LeaseExhaustedPending, ActivityJobWaiting_LeaseExpiredAwaitingReclaim, ActivityJobWaiting_Queued, ActivityJobWaiting_RunningWithoutLease, JobState, type ActivityClaimOrderJobsResult, type ActivityJob, type ActivityJobClaimOrder, type ActivityJobWaiting } from '../api.ts';

// Claim order in Activity (indexing claim-order spec §7; approved mockup of 25 Nov): why a job is not running, its class and
// its position. The server decides the reason (CONTRACT.md "Claim order in Activity"); this module only words it.

/** A row of the Jobs list: the job list's row (the existing `ActivityJob`, unchanged) and its claim-order entry, which the
  * claim-order read returns beside it (`ActivityClaimOrderJobs`), merged by job id. */
export class JobRow {
  constructor(readonly item: ActivityJob, readonly claim: ActivityJobClaimOrder) {}
  get job() { return this.item.job; }
  get profile() { return this.item.profile; }
  get classification() { return this.item.classification; }
  get leaseExpiresAt() { return this.item.leaseExpiresAt; }
  get leaseActive() { return this.item.leaseActive; }
  get retryable() { return this.item.retryable; }
  get collectorId() { return this.item.collectorId; }
  get session() { return this.item.session; }
  get lastTimestamp() { return this.item.lastTimestamp; }
  get waitingSince(): string | undefined { return this.claim.waitingSince; }
  get bulk(): boolean | undefined { return this.claim.bulk; }
  get waiting(): ActivityJobWaiting | undefined { return this.claim.waiting; }
  get ahead(): bigint | undefined { return this.claim.ahead; }
}
/** The page's rows with their claim-order entries: exactly one entry per job, in the page's order (else the reply is refused). */
export function mergeClaimOrder(result: ActivityClaimOrderJobsResult): JobRow[] {
  const jobs = result.page.jobs, claims = result.jobs;
  if (jobs.length !== claims.length || jobs.some((item, index) => item.job.id !== claims[index]!.jobId)) throw new Error('Claim-order entries do not match the job list');
  return jobs.map((item, index) => new JobRow(item, claims[index]!));
}

export type JobClass = 'fresh' | 'bulk' | 'unclassified';
/** A job without a class: an older server queued it before this one installed the claim order (migration 033). The start
  * fill of this server's next start classifies every unfinished job, so an unfinished one lasts at most until then; a job
  * that finished before keeps no class ("not recorded", never classified). */
export const UNCLASSIFIED_NOTE = 'queued before the claim order was installed; the next server start classifies it while it is unfinished';
export const NOT_RECORDED_NOTE = 'class not recorded: the job finished before the claim order was installed';
/** The Class cell: a finished job without a class is "not recorded" (no start classifies it), an unfinished one unclassified. */
export interface ClassLabel { readonly text: string; readonly title: string; readonly chip: string }
const CLASS_LABELS: Readonly<Record<JobClass, ClassLabel>> = {
  fresh: { text: 'fresh', title: 'fresh: uploads and individual retries', chip: 'chip chip-info' },
  bulk: { text: 'bulk', title: 'bulk: retry-all and rebuild', chip: 'chip' },
  unclassified: { text: 'unclassified', title: `unclassified: ${UNCLASSIFIED_NOTE}`, chip: 'chip chip-outline' },
};
export function classLabel(row: JobRow): ClassLabel {
  const cls = jobClass(row.bulk), finished = row.job.state === JobState.Complete || row.job.state === JobState.Failed;
  return cls === 'unclassified' && finished ? { text: 'not recorded', title: `Class ${NOT_RECORDED_NOTE.slice('class '.length)}`, chip: 'muted' } : CLASS_LABELS[cls];
}
const MINUTE_MS = 60_000, HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
/** How long a job has waited at `now`: `5 min`, `2 h 34 min`, `3 d 4 h` (under a minute: `under 1 min`). */
export function waitedFor(since: string, now: number): string | null {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return null;
  const age = Math.max(0, now - start);
  if (age < MINUTE_MS) return 'under 1 min';
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min`;
  if (age < DAY_MS) { const minutes = Math.floor((age % HOUR_MS) / MINUTE_MS); return `${Math.floor(age / HOUR_MS)} h${minutes === 0 ? '' : ` ${minutes} min`}`; }
  const hours = Math.floor((age % DAY_MS) / HOUR_MS);
  return `${Math.floor(age / DAY_MS)} d${hours === 0 ? '' : ` ${hours} h`}`;
}
/** A waiting start in the browser's zone: `16:02` today, `Dec 31, 21:26` this year, `Dec 31, 2025` before. */
export function waitedSince(since: string, now: number): string {
  const date = new Date(since), today = new Date(now);
  if (Number.isNaN(date.getTime())) return since;
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return date.getFullYear() === today.getFullYear() ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function jobClass(bulk: boolean | undefined): JobClass { return bulk === undefined ? 'unclassified' : bulk ? 'bulk' : 'fresh'; }
/** The order a job's `ahead` is counted in, by the claim order in force (unknown before the summary is read). */
export function orderName(order: ActivityClaimOrder | undefined, row: JobRow): string {
  if (row.waiting instanceof ActivityJobWaiting_AwaitingLargeLane) return 'large-job lane';
  if (order === ActivityClaimOrder.Waiting) return jobClass(row.bulk);
  return 'claim';
}
/** The order a job waits in, as the detail names it. */
export function orderDescription(row: JobRow, order: ActivityClaimOrder | undefined): string {
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
export function ahead(row: JobRow, order: ActivityClaimOrder | undefined): Ahead | null {
  if (row.ahead === undefined) return null;
  const n = row.ahead, large = row.waiting instanceof ActivityJobWaiting_AwaitingLargeLane, jobs = n === 1n ? 'job' : 'jobs', name = orderName(order, row);
  const text = large ? `${n.toLocaleString()} large ${jobs} ahead` : `${n.toLocaleString()} ahead`;
  const title = large ? `${n.toLocaleString()} large ${jobs} (of all owners) will be claimed by the large-job lane before this one. ${ORDER_NOTE}`
    : `${n.toLocaleString()} ${jobs} (of all owners) will be claimed before this one in the ${name} order. ${ORDER_NOTE}`;
  return { count: n, text, title, suffix: large ? '' : name === 'claim' ? ' in the claim order' : ` in the ${name} queue` };
}
const NOT_INDEXING = 'your account is not indexed now: its indexing is turned off, or this server does not run its index profile';
/** What the State column shows: the stored state, or what the waiting reason makes of it. */
export interface StateLabel { readonly text: string; readonly status: string; readonly title: string }
const STATES: Readonly<Record<JobState, string>> = { [JobState.Complete]: 'status status-ok', [JobState.Queued]: 'status', [JobState.Running]: 'status status-run', [JobState.Failed]: 'status status-danger' };
export function stateLabel(row: JobRow): StateLabel {
  const stored = row.job.state, w = row.waiting;
  if (w instanceof ActivityJobWaiting_LeaseExpiredAwaitingReclaim) return { text: 'Lease expired — waiting to be reclaimed', status: 'status status-warn state-wrap', title: 'Stored state: Running, lease ended — not an active worker' };
  if (w instanceof ActivityJobWaiting_LeaseExhaustedPending) return { text: 'Lease expired — attempts used up', status: 'status status-warn state-wrap', title: 'Stored state: Running, lease ended at the attempt limit — not an active worker' };
  if (w instanceof ActivityJobWaiting_AwaitingReclaim) return { text: 'Waiting to be reclaimed', status: 'status status-warn state-wrap', title: 'Stored state: Running, invalidated by an indexing settings change — not an active worker' };
  if (w instanceof ActivityJobWaiting_Held) return { text: 'Held', status: 'status status-idle', title: 'Stored state: Queued, with a future attempt time' };
  if (w instanceof ActivityJobWaiting_BlockedByOlderRevision) return { text: 'Blocked', status: 'status status-idle', title: 'Stored state: Queued' };
  // IndexingOff has two causes the server does not tell apart: the account's indexing is turned off, or this server does not run
  // the account's index profile (a retained target). The wording holds for both; turning indexing on alone may not help.
  if (w instanceof ActivityJobWaiting_IndexingOff) return { text: 'Not indexing', status: 'status status-idle', title: `Stored state: ${stored}; ${NOT_INDEXING}` };
  if (w instanceof ActivityJobWaiting_RunningWithoutLease) return { text: 'Running without a lease', status: 'status status-warn state-wrap', title: 'Stored state: Running, no lease — not an active worker' };
  // A Running row is shown running only while its lease is valid (also a historical job, whose claim may continue).
  if (stored === JobState.Running && !row.leaseActive) return { text: row.leaseExpiresAt === undefined ? 'Not running · no lease' : 'Not running · lease ended', status: 'status status-warn state-wrap', title: 'Stored state: Running, without a valid lease — not an active worker' };
  return { text: stored, status: STATES[stored], title: stored };
}
/** The "Why not running" cell: a main line (with the position, when there is one) and a detail line. */
export interface WhyText { readonly main: string; readonly ahead: Ahead | null; readonly after: string; readonly sub: string; readonly running: boolean }
/** LargeJobs.windows: a job of more windows needs the large-job permit (lane). */
const LARGE_JOB_WINDOWS = 100;
const PLURAL_WINDOWS = (total: number | undefined) => total === undefined ? 'an unknown number of windows' : `${total.toLocaleString()} window${total === 1 ? '' : 's'}`;
export function why(row: JobRow, order: ActivityClaimOrder | undefined, time: (iso: string) => string): WhyText {
  const w = row.waiting, position = ahead(row, order), cls = jobClass(row.bulk), prior = row.job.error === undefined ? '' : `Prior: ${row.job.error} · `;
  const queue = order === ActivityClaimOrder.Waiting && cls !== 'unclassified' ? `the ${cls} order` : 'the claim order';
  const at = (text: string) => position === null ? text : `${text} · `;
  if (w instanceof ActivityJobWaiting_Queued) {
    const sub = order === ActivityClaimOrder.Waiting ? cls === 'bulk' ? 'Claimable · bulk lane first; fresh lanes borrow when idle' : cls === 'fresh' ? 'Claimable · a free fresh lane takes the oldest first' : 'Claimable · lane 0 takes it'
      : order === ActivityClaimOrder.SourceId ? 'Claimable · owner, then source order' : 'Claimable';
    return { main: at('Queued'), ahead: position, after: position === null ? '' : position.suffix, sub, running: false };
  }
  if (w instanceof ActivityJobWaiting_AwaitingLargeLane) return { main: at('Waiting for the large-job lane'), ahead: position, after: '', sub: `Sized ${PLURAL_WINDOWS(row.job.totalWindows)} · runs only on the large-job lane`, running: false };
  if (w instanceof ActivityJobWaiting_AwaitingLargePermit) return { main: at('Waiting for the large-job permit'), ahead: position, after: '', sub: `Sized ${PLURAL_WINDOWS(row.job.totalWindows)} · only the permit lane takes it`, running: false };
  if (w instanceof ActivityJobWaiting_LeaseExpiredAwaitingReclaim) {
    const ended = row.leaseExpiresAt === undefined ? 'Lease ended' : `Lease ended ${time(row.leaseExpiresAt)}`;
    // Today's order with a job over the large-job size: only the lane holding the permit takes it.
    const permit = order !== ActivityClaimOrder.Waiting && row.job.totalWindows !== undefined && row.job.totalWindows > LARGE_JOB_WINDOWS;
    return { main: at(ended), ahead: position, after: position === null ? '' : position.suffix, sub: permit ? 'Worker stopped renewing · the permit lane may reclaim it' : 'Worker stopped renewing · any lane may reclaim it', running: false };
  }
  if (w instanceof ActivityJobWaiting_LeaseExhaustedPending) {
    const ended = row.leaseExpiresAt === undefined ? 'Lease ended' : `Lease ended ${time(row.leaseExpiresAt)}`;
    return { main: `${ended} · attempt limit reached`, ahead: null, after: '', sub: 'The next claim ends it lease-exhausted; retry it then', running: false };
  }
  if (w instanceof ActivityJobWaiting_RunningWithoutLease) return { main: 'Running without a lease', ahead: null, after: '', sub: 'No claim takes a job without a lease · retry it', running: false };
  if (w instanceof ActivityJobWaiting_AwaitingReclaim) return { main: at('Indexing settings changed'), ahead: position, after: position === null ? '' : position.suffix, sub: 'Its running attempt no longer counts · an eligible lane may reclaim it', running: false };
  if (w instanceof ActivityJobWaiting_Held) return { main: `Retrying after ${time(w.nextAttemptAt)} (back-off)`, ahead: null, after: '', sub: `${prior}rejoins ${queue} at ${time(w.nextAttemptAt)}`, running: false };
  if (w instanceof ActivityJobWaiting_BlockedByOlderRevision) return { main: `Waiting for older revision r${w.revision} (still running)`, ahead: null, after: '', sub: `Joins ${queue} when r${w.revision} ends`, running: false };
  if (w instanceof ActivityJobWaiting_IndexingOff) return { main: 'Your account is not being indexed', ahead: null, after: '', sub: 'Indexing off, or your index profile is not run here', running: false };
  if (row.job.state === JobState.Running && row.leaseActive) {
    const total = row.job.totalWindows === undefined ? 'unknown' : row.job.totalWindows.toLocaleString();
    return { main: `Running · windows ${row.job.completedWindows.toLocaleString()}/${total}`, ahead: null, after: '', sub: row.leaseExpiresAt === undefined ? 'Not waiting' : `Lease active until ${time(row.leaseExpiresAt)} · not waiting`, running: true };
  }
  return { main: '—', ahead: null, after: '', sub: '', running: false };
}
