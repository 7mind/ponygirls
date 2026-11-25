import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityClaimOrder, ActivityJob, ActivityJobClass, ActivityJobWaiting_AwaitingLargeLane, ActivityJobWaiting_AwaitingLargePermit, ActivityJobWaiting_AwaitingReclaim, ActivityJobWaiting_BlockedByOlderRevision, ActivityJobWaiting_Held, ActivityJobWaiting_IndexingOff, ActivityJobWaiting_LeaseExhaustedPending, ActivityJobWaiting_LeaseExpiredAwaitingReclaim, ActivityJobWaiting_Queued, ActivityJobWaiting_RunningWithoutLease, Completion, ContentView, JobInfo, JobState, Metadata, SessionInfo, SourceFormat, SourceIdentity, type ActivityJobWaiting } from '../src/api.ts';
import { UNCLASSIFIED_NOTE, ahead, jobClass, orderDescription, stateLabel, waitedFor, waitedSince, why } from '../src/activity/claim-order.ts';

// Specified: the wording of the claim-order reasons (approved mockup of 25 Nov) from the server's reason, class and count.
const ID = '00000000-0000-4000-8000-000000000001';
const time = (iso: string) => `@${iso.slice(11, 16)}`;
function job(state: JobState, waiting: ActivityJobWaiting | undefined, options: { bulk?: boolean | undefined; ahead?: bigint; lease?: string; active?: boolean; error?: string; total?: number } = {}): ActivityJob {
  const info = new JobInfo(ID, ID, 2, state, 1, options.error, 120, options.total, undefined);
  const session = new SessionInfo(new ContentView(2, undefined), ID, 'owner', 2, undefined, new Metadata('Session', undefined, undefined, undefined, undefined, undefined, 'pi', undefined, undefined, undefined, []), new SourceIdentity('c', 'native', SourceFormat.Pi, 's', undefined), Completion.Quiescent, false);
  return new ActivityJob(info, 'p', ActivityJobClass.Current, options.lease, options.active ?? false, false, 'c', session, undefined, '2026-11-25T16:02:00Z', 'bulk' in options ? options.bulk : false, waiting, options.ahead);
}
const line = (row: ActivityJob, order: ActivityClaimOrder | undefined) => { const text = why(row, order, time); return `${text.main}${text.ahead === null ? '' : text.ahead.text}${text.after} | ${text.sub}`; };

test('class: fresh, bulk, or unclassified for a row an older server wrote', () => {
  assert.deepEqual([jobClass(false), jobClass(true), jobClass(undefined)], ['fresh', 'bulk', 'unclassified']);
});
test('every reason under the waiting order, with the count in its class queue or the large-job lane', () => {
  const W = ActivityClaimOrder.Waiting;
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 3n }), W), 'Queued · 3 ahead in the fresh queue | Claimable · a free fresh lane takes the oldest first');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 41n, bulk: true }), W), 'Queued · 41 ahead in the bulk queue | Claimable · bulk lane first; fresh lanes borrow when idle');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_AwaitingLargeLane(), { ahead: 1n, bulk: true, total: 1013 }), W), 'Waiting for the large-job lane · 1 large job ahead | Sized 1,013 windows · runs only on the large-job lane');
  assert.equal(line(job(JobState.Running, new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), { ahead: 0n, lease: '2026-11-25T16:54:00Z' }), W), 'Lease ended @16:54 · 0 ahead in the fresh queue | Worker stopped renewing · any lane may reclaim it');
  assert.equal(line(job(JobState.Running, new ActivityJobWaiting_LeaseExhaustedPending(), { lease: '2026-11-25T16:54:00Z' }), W), 'Lease ended @16:54 · attempt limit reached | The next claim ends it lease-exhausted; retry it then');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_AwaitingReclaim(), { ahead: 2n }), W), 'Indexing settings changed · 2 ahead in the fresh queue | Its running attempt no longer counts · any lane may reclaim it');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Held('2026-11-25T17:30:00Z'), { error: 'model-http' }), W), 'Retrying after @17:30 (back-off) | Prior: model-http · rejoins the fresh order at @17:30');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_BlockedByOlderRevision(6)), W), 'Waiting for older revision r6 (still running) | Joins the fresh order when r6 ends');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_IndexingOff()), W), 'Indexing is turned off for your account | Waits until indexing is turned on again');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Queued(), { bulk: undefined }), W), 'Queued | Claimable · lane 0 takes it', 'no count where the order has none');
});
test('the source-id order names the claim order and the permit, never a class queue; an unknown order names neither', () => {
  const S = ActivityClaimOrder.SourceId;
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 5n, bulk: true }), S), 'Queued · 5 ahead in the claim order | Claimable · owner, then source order');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_AwaitingLargePermit(), { ahead: 9n, total: 150 }), S), 'Waiting for the large-job permit · 9 ahead | Sized 150 windows · only the permit lane takes it');
  assert.equal(line(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 5n }), undefined), 'Queued · 5 ahead in the claim order | Claimable');
  assert.equal(orderDescription(job(JobState.Queued, new ActivityJobWaiting_AwaitingLargePermit(), { ahead: 1n }), S), 'The lane holding the large-job permit · owner, then source ID');
  assert.equal(orderDescription(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 1n, bulk: true }), ActivityClaimOrder.Waiting), 'Bulk lanes · oldest waiting since first, then source ID');
});
test('a Running row with an ended lease never reads as running; a valid lease does', () => {
  const expired = job(JobState.Running, new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), { ahead: 1n, lease: '2026-11-25T16:54:00Z' });
  assert.deepEqual([stateLabel(expired).text, why(expired, ActivityClaimOrder.Waiting, time).running], ['Lease expired — waiting to be reclaimed', false]);
  assert.doesNotMatch(stateLabel(expired).status, /status-run/);
  const running = job(JobState.Running, undefined, { lease: '2026-11-25T17:19:00Z', active: true, total: 300 });
  assert.deepEqual([stateLabel(running).text, line(running, ActivityClaimOrder.Waiting)], ['Running', 'Running · windows 120/300 | Lease active until @17:19 · not waiting']);
  assert.equal(line(job(JobState.Complete, undefined), ActivityClaimOrder.Waiting), '— | ', 'a finished job has no reason');
});
test('"N ahead" is a count with an explanation that names no one', () => {
  const value = ahead(job(JobState.Queued, new ActivityJobWaiting_Queued(), { ahead: 9007199254740993n }), ActivityClaimOrder.Waiting);
  assert.notEqual(value, null);
  assert.equal(value!.text, `${9007199254740993n.toLocaleString()} ahead`);
  assert.match(value!.title, /jobs \(of all owners\) will be claimed before this one in the fresh order\. An order, not a time estimate/);
  assert.equal(ahead(job(JobState.Queued, new ActivityJobWaiting_Held('2026-11-25T17:30:00Z')), ActivityClaimOrder.Waiting), null);
});
test('how long a job has waited: minutes, hours and minutes, days and hours; never negative', () => {
  const now = Date.parse('2026-11-25T17:14:00Z');
  assert.deepEqual(['2026-11-25T17:13:30Z', '2026-11-25T17:09:00Z', '2026-11-25T14:40:00Z', '2026-11-25T15:14:00Z', '2026-11-23T13:00:00Z', '2026-11-24T17:14:00Z', '2026-11-25T18:00:00Z'].map(since => waitedFor(since, now)),
    ['under 1 min', '5 min', '2 h 34 min', '2 h', '2 d 4 h', '1 d', 'under 1 min']);
  assert.equal(waitedFor('not a time', now), null);
});
test('the waiting start is a clock time today, a short date this year, a date before', () => {
  const now = new Date(2026, 10, 25, 17, 14).getTime();
  assert.match(waitedSince(new Date(2026, 10, 25, 14, 40).toISOString(), now), /^14:40$/);
  assert.match(waitedSince(new Date(2026, 10, 24, 9, 5).toISOString(), now), /24.*09:05|09:05.*24/);
  assert.match(waitedSince(new Date(2025, 0, 2, 9, 5).toISOString(), now), /2025/);
});
test('an unclassified job explains itself: queued before the claim order was installed', () => {
  assert.equal(UNCLASSIFIED_NOTE, 'queued before the claim order was installed; the next server start classifies it');
});
test('a Running row without a valid lease is never labelled running, also without a scheduler reason (a historical attempt)', () => {
  const historical = job(JobState.Running, undefined, { lease: '2026-11-25T16:00:00Z', active: false });
  assert.deepEqual([stateLabel(historical).text, why(historical, ActivityClaimOrder.Waiting, time).main], ['Not running · lease ended', '—']);
  assert.doesNotMatch(stateLabel(historical).status, /status-run/);
  assert.equal(stateLabel(job(JobState.Running, undefined, {})).text, 'Not running · no lease');
  const unleased = job(JobState.Running, new ActivityJobWaiting_RunningWithoutLease());
  assert.deepEqual([stateLabel(unleased).text, line(unleased, ActivityClaimOrder.Waiting)], ['Running without a lease', 'Running without a lease | No claim takes a job without a lease · retry it']);
});
test('under today\'s order an ended lease over the large-job size is reclaimed by the permit lane only; under waiting by any lane', () => {
  const large = job(JobState.Running, new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), { lease: '2026-11-25T16:54:00Z', total: 150, ahead: 2n });
  assert.match(line(large, ActivityClaimOrder.SourceId), /\| Worker stopped renewing · the permit lane may reclaim it$/);
  assert.match(line(large, ActivityClaimOrder.Waiting), /\| Worker stopped renewing · any lane may reclaim it$/);
  assert.match(line(job(JobState.Running, new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), { lease: '2026-11-25T16:54:00Z', total: 100 }), ActivityClaimOrder.SourceId), /any lane may reclaim it$/);
});
