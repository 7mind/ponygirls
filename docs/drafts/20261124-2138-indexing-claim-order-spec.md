# Indexing claim order — specification of a fairer order (draft rev 2, no code)
Owner decision Q147 (24 Nov): "Write a specification for a fairer claim order (no code yet) and show it to me". Rev 2 answers
review 1 (reports/claim-order/REVIEW-1.md, -1b.md: F1–F8, D-a…D-j). Code at `main` = d7ae4cc7. **[v]** checked in code here;
**[r]** from RA = reports/retry-all/REPORT.md, RS = reports/retry-sample/REPORT.md, STATE.md 24 Nov, or the review; **[i]** inference.

## 1. For the owner (read this first)
- **Today.** A free lane takes the claimable session whose *random* id sorts first, owners strictly in id order. The one
  "large" permit (jobs > 100 windows) goes to whichever lane loops first, and that lane takes the lowest-id job of any size.
- **24 Nov.** The live session 08ffb631 had six runs end early: 1 pod roll, 2 `model-http`, 3 `stale-claim` — each of those
  three at its first window with kept parts after a newer revision had arrived (observed, §3). Its low id won whenever its job
  was claimable; small jobs also held the permit. 666b5a41 (large, since 16:02Z) had not started by 20:57Z.
- **Proposal.** One key: when a job started waiting. Lane 0 owns the large permit: oldest known-large job, else oldest of any
  kind. Other lanes: a fixed number prefer *bulk* work (bulk retry, rebuild), the rest *fresh* uploads; each takes its class's
  oldest and borrows only when its class has nothing claimable. No owner priority; today's locking and rechecks stay.
- **Does not solve.** Capacity (one large lane; 24 Nov's 46 retried large-by-total jobs ≈ 80–200 h one at a time, conditional
  estimate RS §7); order of large jobs before a claim has sized them; the live session's cuts (below, D3); an hour bound.
- **Cost.** Two nullable columns, four partial indexes, new candidate selection, a restart per deploy and flag change (never
  free for running work, §6). Risk: a claim bug stops or mis-orders indexing; flag off = today.
- **Decisions** (recommendation first; each option: guarantees / costs / does not solve):
  - **D1 Owners.** (a) arrival order: no owner priority; one owner's burst delays only later arrivals of its class; free; gives
    no owner a share [rec for three users]. (b) rotation between owners: each owner with work in turn; needs rotation state
    per class; inexact when the next owner's rows are held, locked or large. (c) today's id priority: unbounded for higher ids.
  - **D2 Bulk vs fresh.** (a) static preference with fallback, `bulkLanes = 1`: each class always has its lanes; a borrowed
    lane returns after its current job (≤ 100 windows, ≈ ≤ 2 h at 0.8–2 windows/min — conditional estimate); never idles
    [rec]. (b) hard reservation: exact shares, a lane idles when its class is empty. (c) one oldest-first queue: fresh uploads
    wait behind a bulk apply (24 Nov conditional estimate: 845 small retries on three lanes ≈ 31–46 h).
  - **D3 Live session.** The cut is an annotation-continuations rule, not the claim order's; the order only decides where the
    session's NEXT job waits: (a) new wait from its append [rec]: fair; behind every older *sized* large job, so in a 24 Nov-like
    backlog its search can stay stale for days; (b) inherit the cut job's age: today's hold on the large lane returns.
    Avoiding the cut itself is the separate later unit "carry a job across a pure append".
  - **D4 Large lane and rollout.** (a) dedicated permit lane, oldest-first over *sized* large jobs, small work when none waits:
    never idles; a newly sized large job waits for that lane's current job [rec]. (b) next-free-lane dispatch (today's try-permit
    plus early release): no dedicated lane; the permit can sit unused for a lane's job and the releasing lane re-takes it first.
    (c) dedicated lane idling without large work: starts large work at once, loses a lane otherwise. Rollout: flag
    `indexing.claimOrder` off by default, on after verify [rec]; returning to the old image needs a reseed afterwards (§6).

## 2. Current behaviour at d7ae4cc7 [v]
- **Lanes.** `annotationSessions` lanes (default 4, Core.scala:75) loop `iteration` (Models.scala:578-601), idle sleep 1 s
  (:114). Each iteration tries the permit (`tryPermit`, ModelAdmission.scala:20,23; `largeJobs = 1`, Core.scala:82) and holds it
  for the whole iteration, whatever it claims (Models.scala:579-585).
- **Claim** (Database.scala:431-490). `supersedeEndedLeases` (:441-453, own transaction) ends Running older-revision jobs whose
  lease ended. `claimHead`: enabled owners with a target in scope, `ORDER BY t.owner` (:461); per owner its eligible current
  target (`OwnerTargets.eligible`, :463): jobs Running past their lease at attempts ≥ 5 end `lease-exhausted` (:464-469); ONE
  source `ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1` (:474-478) with a claimable head job, attempts < 5, no older-revision
  job of that source and profile Running (:476) and, without the permit, no head job with `total_windows > 100` or Queued with a
  known total (:477); then the job row `FOR UPDATE SKIP LOCKED` re-evaluated on its locked version (:480-482). If that job lock
  is skipped, the claim moves to the **next owner**, not the next source (`flatMap`/`collectFirst`, :479-489). First owner that
  yields a claim wins: strict priority by owner id among enabled, in-scope owners with an eligible target.
- **Source ids** are random: `UUID.randomUUID()` at direct ingest (:310) or at upload open (Uploads.scala:143).
- **Claimable** (:262-263): Queued with `lease_until` NULL or past (a *held* job is not), or Running with an ended lease.
- **Large.** A job indexing > 100 windows (total − published parent's cut, Models.scala:456-462; Core.scala:298-307) on a lane
  without the permit is *deferred* (:637-646): Queued, attempt refunded, fence+1, `total_windows` = its **total** — the only
  write of a total on a Queued row (claim, retry, failure-to-Queued and hold set it NULL: :480, :270, :892, :918). Size limits
  remain per message and per window (`index-budget-exceeded`: RevisionContent.scala:158, Models.scala:299), not per job.
- **Append** (`Jobs.switched` :276-281, from direct ingest :327 and upload commit Uploads.scala:283): unfinished older-revision
  jobs end superseded, except a Running one with a valid lease, which keeps its claim; the new head waits for it (:476).
- **Ends of an older-revision run.** A failure that would re-queue it supersedes it instead; a terminal code or attempt
  exhaustion keeps its own code (`failAt` :886-897, :890); a transient failure supersedes (:905). With continuations ON,
  `prefixAuthority` (:526-529: head = claim revision) guards the first continuation write, a partial load that finds a row, and
  prefix reservation/rejection/acceptance (:543-600) → `stale-claim`. Ordinary checkpoint writes and renewal require only
  `head ≥ revision`, the job row and a valid lease (:520-523, :649-655). Renewal: every 30 s plus extra renewals between
  annotation attempts (Models.scala:280, 288, 290, 519). Publication also needs authority, lease, binding and, incrementally,
  an unchanged parent (:843-851). Reuse across runs needs an equal checkpoint input (IndexCheckpoints.scala:65-66,
  Models.scala:158-166).
- **Fences.** Claim, deferral, supersession, retry, rebuild bump `fence`; Complete (:868), ordinary failure (:892) and
  hold/exhaustion (:914-923) do not — state, run and lease also carry authority (:508-510).
- **Holds** (:242-252, :899-923): transient failure → Queued with `lease_until` = next attempt, attempt refunded, 1, 2, 4, 8,
  15 … min, Failed at the 10th in a row; progress restarts the count.
- **Re-queue paths** (F8): single `RetryJob` (:264-273) — annotation epoch +1, new run only from Complete; bulk retry-failed
  (RetryFailedJobs.scala:84-86) — epoch +1, same run; owner rebuild (ReindexCohort.scala:59-67) — new run and target epoch,
  annotation epoch unchanged; rebuild members identifiable by `ch_reindex_members(job_id, run_id, target_epoch)`.
- **Start.** Older-revision Queued/Running jobs end superseded (001.sql:19-21) and their partials are deleted (Database.scala:92-93).
- **Timestamps.** `ch_jobs`: only `lease_until`. Committed uploads record `ch_uploads.terminal_at` (025_uploads.sql:40-44,
  Uploads.scala:286); rebuilds `ch_reindex_requests.created_at` (012:7); direct ingest and retries none. Index:
  `ch_jobs_claim(state,lease_until)` (001.sql:15).

## 3. Observed effects, 24 Nov [r]
- Queue: 15:53Z 289 Queued (288 fresh) + 4 Running; 16:59Z, after the 891-job apply, 1,148 (all pavel); 20:57Z 1,074.
- 08ffb631, revisions 43–52 (13:11:03–16:20:52Z): 6 jobs superseded while Queued; runs ended early: c68e6e17 pod roll (+7
  windows), e268e5e5 `model-http` (+15), be06fa02 `model-http` 20:08:15 (+62); 4d178a0b, 7092dfbe, 30c37108 `stale-claim`
  (14:47:42, 17:27:18, 18:25:56). Accepted 272/1010 (13:31) → 406/1013 (17:49) → 507/1013 (20:57, rev 55; rev 56 queued [review]).
- **Cause of the three stale-claims — observed** (RA table "Early ends of 08ffb631 jobs": Chronicle log of pod 4c806013 + DB,
  read 21:57Z): 4d178a0b (rev 48, 14:47:42Z), 7092dfbe (51, 17:27:18Z), 30c37108 (52, 18:25:56Z) each logged `job failed` code
  and reason `stale-claim`, `chronicle.DomainError`, no stage, origin `chronicle.PostgresArchive.prefixAuthority:528`, after a
  newer head existed (51 at 14:29:44Z, 52 at 16:20:52Z, 54 at 18:20:15Z). [v] `prefixAuthority` (Database.scala:526-529) runs
  `checkpointAuthority` first (:520-523: current, job locked, `lease_until > now`, binding) — that passed, so the lease was
  valid — then fails `head = claim revision` (:528), the check on a window with kept parts. e268e5e5 (44, 14:06:20Z) and
  be06fa02 (54, 20:08:15Z) logged `window failed` at stage annotation, then `job failed` `model-http`. All five: Failed
  `superseded-revision`, attempts 1 (`failAt` :890). **So with continuations on, a running older-revision job of a session
  that has a newer head ends at its first continuation window.** Rev 1's "missed lease renewal" reading is withdrawn.
- Permit: since 16:09Z no job > 100 windows other than 08ffb631's ran; no large job ran 17:27:18 → 17:39–17:44 (12–17 min, the
  permit served small jobs; 30c37108 deferred 17:32:35, then taken), ≤ 3.5 min after 18:25:56, ≤ 2.5 min after 20:08.
- Waiting at 20:57Z: 666b5a41 (since 16:02:55, deferred 16:09:17) and 46 applied jobs > 100 windows by **pre-retry total**, of
  which 8 had deferred; ≈ 1,064 queued jobs had no known total [review]. Sample retries had 0–2 sources ahead (low ids) [RS §2].

## 4. Requirements (each has a test in §8)
- **R1 class order (narrowed).** A lane serving class X never claims an X job with a later (`waiting_since`, `session_id`)
  than a claimable, unlocked X candidate J it may take. J is claimed once the X jobs ahead of it, and their returns, are
  claimed; X's preferring lanes take X at every claim while X has candidates; a lane borrowed by the other class returns after
  its current job. Still waits: a job behind its class's earlier arrivals (a burst of q jobs ahead costs q jobs' service on
  ≥ its preferring lanes); a sized-large job behind every older sized-large job. Not promised: an hour bound, a bound on the
  number of returns (D-c), an owner share.
- **R2 owners.** No owner id priority; order is by arrival within a class (D1a).
- **R3 large.** Only lane 0 runs a job indexing > 100 windows. Lane 0 takes sized-large candidates (Queued with a total from a
  deferral) oldest-first across classes before anything else. An unsized large job is sized at its class turn (R1) or by lane 0
  when no sized one waits. Not promised: order between a sized younger and a not-yet-sized older job (D-d).
- **R4 live session.** A head inserted while its source's older job runs gets its age by D3; nothing more is promised now.
- **R5 fresh.** Fresh work has ≥ L − 1 − `bulkLanes` lanes; bulk work ≥ `bulkLanes`; flag on requires L ≥ 3 and
  1 ≤ `bulkLanes` ≤ L − 2 (start refused otherwise).
- **R6 kept** [v]: one job per (source, revision, profile) (001.sql:12); head waits while an older revision runs; older-revision
  jobs never re-queued; fences and run/lease authority on every write; renewal permit; holds not claimable early; attempts
  ≤ 5, deferral/hold refunds; no job refused for its total size; publication monotonic. **Claim rechecks kept exactly:**
  (1) `supersedeEndedLeases` in its own transaction first; (2) per eligible target the `lease-exhausted` cleanup; (3) owner
  enabled and target read in the claim transaction, target epoch carried into the claim and checked on every write (:502-506);
  (4) source locked `FOR UPDATE OF s SKIP LOCKED`, head revision read under it; (5) older-Running check; (6) job row locked
  `FOR UPDATE SKIP LOCKED` by an UPDATE whose WHERE re-evaluates claimable, attempts < 5, revision and profile on the locked
  version — never an id-only update; (7) the fenced transition (attempts+1, fence+1, lease). A skipped job lock passes that
  source; selection continues in order.

## 5. Design
### 5.1 Alternatives considered
Rev 1's weighted key (class share + per-owner Running counts) starves (D-a: four owners, class priority), races (D-b: all
lanes see zero bulk Running) and cannot be index-ordered (D-h). Per-owner rotation needs state (D1b). Rev 2 keeps one stored key.

### 5.2 `waiting_since` and `bulk` (set in the same transaction as the event)
| event | `waiting_since` | `bulk` |
|---|---|---|
| first upload / direct ingest (switch, no older unfinished job) | transaction time `now()` | false |
| append superseding a Queued, held or lease-ended Running job | that job's value | that job's value (D-f) |
| append while an older job holds a valid lease and no Queued head exists | D3a: `now()`; D3b: the running job's value | D3a false; D3b inherited |
| single `RetryJob` (browser or bearer) | `now()` | false (interactive) |
| bulk retry-failed apply / owner rebuild | the apply's `now()`, one value for all its jobs | true |
| claim, deferral, hold, its return, failure to Queued, reclaim after lease end | unchanged | unchanged |
Ties: `session_id` (today's order). At most one Queued head per source exists, so inheritance never adds a competitor.

### 5.3 Lanes
- Lane 0 holds the permit for the process lifetime (no try, no release; D-e's early-release race does not arise). Order:
  sized-large candidates by (`waiting_since`, `session_id`); if none, any candidate in that order; it runs whatever it sizes.
- Lanes 1..`bulkLanes` prefer bulk, the others fresh: candidates of the preferred class in (`waiting_since`, `session_id`)
  order, else of the other class; they pass sized-large rows and defer a job they size > 100 windows (`waiting_since` kept).
- 24 Nov under D3a [i]: rev 52 (queued 16:20:52Z) would wait behind 666b5a41 (16:02:55Z) only; heads appended after 16:57:09Z
  behind the 46 retried jobs as they get sized (bulk lane / lane 0 order), not behind unsized ones.
- A Running job past its lease is not "sized-large" (its total is not indexed work, D-d): any lane may reclaim it and sizes it.
- **Why nothing claimable starves** [i]: each job runs finitely (lease, attempts ≤ 5, consecutive holds ≤ 10, finite windows).
  Arrivals get `now()`, inheritance replaces a source's own job, so within a class the set ahead of J is finite and grows only
  by returns. Each class has ≥ 1 preferring lane (R5) that takes that class at every claim while it has candidates; borrowed
  lanes run ≤ 100-window jobs. Sized-large jobs are FIFO on lane 0; lane 0's jobs are finite. Returns are finite but not
  numerically bounded (D-c, §10).

### 5.4 Indexes and cost
- `ch_jobs_class ON ch_jobs(bulk, waiting_since, session_id) WHERE state IN ('Queued','Running')` (class lanes);
  `ch_jobs_age ON ch_jobs(waiting_since, session_id) WHERE state IN ('Queued','Running')` (lane 0 fallback);
  `ch_jobs_sized ON ch_jobs(waiting_since, session_id) WHERE state='Queued' AND total_windows IS NOT NULL` (lane 0 first);
  `ch_jobs_running ON ch_jobs(session_id, profile) WHERE state='Running'` (older-Running check, not a walk over revisions).
- Selection: one statement in index order over the eligible (owner, target profile) pairs read first, joining `ch_sources` by
  key; time-dependent conditions (held, lease) are filters, so rows read = rows passed; that is measured, not assumed.
- **Requirement:** the whole claim path — both cleanups (today they visit every source of the eligible owners, :447-449,
  :464-466), selection, job lock, transition — p99 ≤ 50 ms over 1,000 claims at 10,000 queued rows on a production-shaped
  schema (3 owners, 2 profiles, 100 held, 100 sized-large, 4 Running, one source with 2,000 revisions), measured on demand;
  verify checks plan shape (these index scans, no Sort over candidates). If cleanup breaks the bound, it moves onto
  `ch_jobs_running` (open, §10).

### 5.5 Migration 032, start fill, previous binary
- `ADD COLUMN IF NOT EXISTS waiting_since timestamptz, ADD COLUMN IF NOT EXISTS bulk boolean`: nullable, no default (no rewrite,
  no volatile default). The four indexes on unfinished rows only.
- Start fill (every start, before the worker): unfinished rows with a NULL get `waiting_since = now()` (one value) and
  `bulk = (current rebuild member by job_id/run_id/target_epoch) OR annotation_retry_epoch > 0` [i: single retries are filed
  as bulk once]; ties by `session_id` = today's order for that backlog. The new image writes both columns on every event of
  §5.2 also with the flag off.
- Previous image: never reads or writes them; its new jobs get NULL (filled at the next new-image start, placed at that time);
  its retries and rebuilds leave stale values (old age, old class). After any old-image period that ran a retry or rebuild:
  `reseed` (server stopped) sets all unfinished rows as the start fill does — relative ages lost, today's order. Down script:
  drop indexes and columns, full revert only.

## 6. Flag, image, restart
- `indexing.claimOrder` = `"source-id"` (default) | `"waiting"`; invalid → start refused; read at start. **Flag off, new image:**
  today's selection and try-permit; columns maintained, indexes unused. **Flag on:** §5.3. **Old image:** order back to today;
  columns go stale → start fill + reseed on return.
- Every flag change is a restart, and every restart supersedes older-revision Queued/Running jobs and deletes their partials
  (001.sql:19-21, Database.scala:92-93); head-revision Running jobs lose the window in flight and are reclaimed after their lease
  (≤ 300 s, one attempt charged). Queue metadata survives; running work does not. A later carry-across-append unit has its own
  flag; this flag does not disable it, and a restart ends any carried run.

## 7. Observability
- Logs (ids, counts): `job claimed jobId lane=0|bulk|fresh class=bulk|fresh borrowed=yes|no waitingSeconds`; `large job deferred`
  (Models.scala:460) + `waitingSeconds`; start fill/reseed counts.
- Activity: per class and owner — queued, claimable, held, oldest waiting age; lane 0 — current job (windows a/b, since) and
  the sized-large queue in order with ages; job list column "Waiting since". API: `waitingSince`, `bulk` on activity jobs.

## 8. Test plan (PostgreSQL, owned databases; existing suites unchanged; each case fails if its requirement is violated)
- T1 (R1) fixtures with explicit values → each lane kind claims the minimum of its order; ties by `session_id`; flag off = today.
- T2 (R1, D-a) four owners, four lanes, owner A's oldest fresh job J behind three other owners' Running fresh jobs: J is
  claimed at the next fresh-lane claim; no later fresh job before it.
- T3 (§5.2) every row of the table, incl. append over a held and over a lease-ended job, bulk apply one value, rebuild bulk.
- T4 (R5, D-b) synchronized claims: L concurrent claim transactions on a fixed fixture take exactly the first L candidates of
  their lane orders as sets, no source twice, no claim waiting on another's lock; bulk lane borrowed by fresh, then a bulk apply
  → bulk claimed at that lane's next claim; fresh lanes borrowed by bulk, then late fresh arrivals → claimed at their next claims.
- T5 (R3, D-d) older unsized vs younger sized large: lane 0 takes the younger (documented); once the older is sized it precedes
  younger sized ones; lease-ended incremental job with total 1,013 indexing 10 → reclaimed by a class lane, runs, no deferral;
  only lane 0 ever runs > 100 windows; cancelling lane 0 mid-job leaves the job to lease reclaim and the permit with lane 0.
- T6 (R6, D-g) a claim expired and reclaimed: the old fence cannot checkpoint, renew or publish; target change (rebuild)
  between selection and lock → no claim of the superseded job; lane B's stale snapshot of J after lane A's commit → no overwrite.
- T7 (R6) held job never claimed early though oldest; head waits for older Running; attempts, `lease-exhausted`, start-up
  supersession unchanged; existing G2-T14 tests unchanged.
- T8 (§5.4) cost run on demand as specified; verify: plan shape, `ch_jobs_running` used, anti-check rows ≤ Running rows.
- T9 (§5.5, §6) migration on a copy: no rewrite, fill sets one value; old binary inserts and retries, re-upgrade → NULLs filled,
  reseed restores consistency; flag off → today's order with columns maintained.
- T10 replay of 24 Nov (scripted provider, controlled clock): 3 owners; one 1,013-window session (406 accepted) appended every
  5 min; 47 jobs > 100 windows (8 sized); 845 small bulk; fresh arrivals every 2 min; L = 4, `bulkLanes` = 1. Asserts R1 per
  class and lane, R3 FIFO over sized work, D3a/D3b ages of the live session's heads, lane 0 never idle with candidates.
- Timing rule: orders depend on stored values set by fixtures; leases/back-off use existing configurable fixtures with
  production defaults asserted separately (`bulkLanes = 1` default too); no retries, no filtered cases.
- Later units (not this one): carry across append with incremental publication off and with a tail > 100 windows; a quiet
  period whose maximum fires during continuous uploads; a non-append switch counts as a stale-claim control only if the older
  job exercises prefix authority.

## 9. Out of scope
Owner weights; size preference; a second large lane (permit rationale: heap per ModelAdmission.scala:8-10, lane time per
ingest-limits spec §5.2.7 — needs a heap measurement); leases, holds, attempt limits, publication gate; avoiding the live
session's cut (§3: REL-B r4 head equality, Database.scala:528), i.e. the units carry across a pure append (search stays at the claimed revision, possibly many
revisions behind; the tail can exceed 100 windows or be a root publication if incremental publication is off or the parent is
ineligible), quiet period (its maximum can fire during continuous uploads and cut again).

## 10. Open issues after review
- D-c: number of returns (holds alternating over two search ranges restart the streak, :221-228, :905-918) is finite, not bounded;
  R1 is conditioned on it rather than fixed.
- D-d: no order between a sized younger and an unsized older large job; strict FIFO would need sizing at enqueue (a count pass
  per append) — not proposed.
- D-h: the 50 ms bound is a target to confirm by the first measurement; today's cleanups may need their own index.
- D-i: single retries are backfilled as bulk; rebuilds of an old image cannot be told from appends after a downgrade (reseed).
- D1 rotation, D2 hard reservation, D4b/c: offered to the owner, not specified in detail.
- R5 needs L ≥ 3 with the flag on; L ≤ 2 deployments keep today's order.
