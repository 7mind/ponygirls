# Indexing claim order — specification of a fairer order (agreed specification, not built (rev 3))
Owner decision Q147 (24 Nov): "Write a specification for a fairer claim order (no code yet) and show it to me". Reviews: §11.
Code at `main` = d7ae4cc7. **[v]** checked in code here;
**[r]** from RA = reports/retry-all/REPORT.md, RS = reports/retry-sample/REPORT.md, STATE.md 24 Nov, or the review; **[i]** inference.

**Status.** Owner decision Q148 (25 Nov), verbatim: "Approve the recommended options but do not build yet; keep it as an agreed
specification;; save the spec in the repo and that's it". Approved: option (a) of each of D1, D2, D3 and D4 as described in §1.
Nothing is implemented, measured or scheduled; building it needs a new owner decision.

## 1. For the owner (read this first)
- **Today.** A free lane takes the claimable session whose *random* id sorts first, owners strictly in id order. The one
  "large" permit (jobs > 100 windows) goes to whichever lane loops first, and that lane takes the lowest-id job of any size.
- **24 Nov.** The live session 08ffb631 had six runs end early: 1 pod roll, 2 `model-http`, 3 `stale-claim`. Three runs ended
  at the ANNOT2 head check after an append; an older run can still finish if it needs no prefix operation (§3). The low ID helped
  when a permit-bearing lane could claim the live job; small jobs also held the permit. 666b5a41 (large) waited from 16:02Z on.
- **Proposal.** Lane 0 owns the large permit. Class lanes pick the oldest eligible, unlocked job in their preferred class by
  stored transaction-start age, not commit order; lane 0 prioritizes sized-large jobs across classes. No owner receives a
  guaranteed share. Bulk = bulk retry-failed and rebuild. An ordering guarantee under stated assumptions, not starvation freedom.
- **Does not solve:** capacity (one large lane; 46 large-by-total retries ≈ 80–200 h, conditional estimate RS §7), order before
  sizing, the live session's cuts (D3), any time bound. **Cost:** two nullable columns, four partial indexes, new candidate
  selection, a restart per deploy and flag change (§6). Risk: a claim bug stops or mis-orders indexing; flag off = today.
- **Decisions** (recommendation first; each option: what it gives / costs / does not solve):
  - **D1 Owners.** (a) arrival order [rec for three users] [approved]: no owner priority, no owner receives a guaranteed share; a burst
    delays later arrivals of its class. (b) rotation: needs state per class; inexact when the next owner's rows are held, locked
    or large. (c) today's id priority: higher ids wait without bound.
  - **D2 Bulk vs fresh.** (a) static preference with fallback, `bulkLanes = 1` [rec] [approved]: each class has a fixed number of preferred
    lanes, not a minimum number running its jobs; a borrowed lane returns at its next claim, with no time bound. The fresh class
    includes individual retries; only bulk retry-failed and rebuild are assigned to bulk, and replacing a queued job preserves
    its class (a batch of individual retries can queue ahead of uploads). (b) hard reservation: lanes never borrow and idle when
    their class is empty. (c) one oldest-first queue: uploads wait behind a bulk apply (conditional estimate 24 Nov ≈ 31–46 h).
  - **D3 Live session.** The cut is an annotation-continuations rule; the claim order only decides where the session's NEXT
    job waits. Reset versus inherit applies only when a valid older run has no queued successor; replacing a queued or
    lease-ended job inherits its age. (a) reset to the append's time [rec] [approved]: fair; behind every older sized-large job, so in a
    24 Nov-like backlog its search can stay stale for days. (b) inherit the running job's age: inheritance can let repeated
    successors cut ahead. Replacing a deferred job loses its size marker. Avoiding the cut: later unit "carry across a pure append".
  - **D4 Large lane and rollout.** (a) dedicated with fallback [rec] [approved]: takes the next unlocked sized-large job at its next claim,
    otherwise the oldest eligible job of any size. (b) dedicated without fallback: saves the lane for discovered large work but
    can idle. (c) next-free dispatch: can leave the permit unused while all lanes are busy. None guarantees FIFO before sizing.
    Rollout: flag `indexing.claimOrder` off by default, on after verify [rec]; leaving the new image needs a reseed on return (§6).

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
  `prefixAuthority` (:526-529) → `stale-claim`: partial load (when it finds a row), discard, and prefix operations (incl. the
  first continuation write) require head equality (:543-600); ordinary checkpoints and renewal allow an older revision but
  retain their existing authority checks, including binding for checkpoints (:520-523, :649-655). Renewal: every 30 s plus
  extra renewals between annotation attempts (Models.scala:280, 288, 290, 519). Publication also needs authority, lease,
  binding and, incrementally, an unchanged parent (:843-851). Reuse needs an equal checkpoint input (IndexCheckpoints.scala:65-66).
- **Fences.** Claim, deferral, supersession, retry, rebuild bump `fence`; Complete (:868), ordinary failure (:892) and
  hold/exhaustion (:914-923) do not — state, run and lease also carry authority (:508-510).
- **Holds** (:242-252, :899-923): transient failure → Queued with `lease_until` = next attempt, attempt refunded, 1, 2, 4, 8,
  15 … min, Failed at the 10th in a row; progress restarts the count.
- **Re-queue paths** (F8): single `RetryJob` (:264-273) — annotation epoch +1, new run only from Complete; bulk retry-failed
  (RetryFailedJobs.scala:84-86) — epoch +1, same run; owner rebuild (ReindexCohort.scala:59-67) — new run and target epoch,
  annotation epoch unchanged; rebuild members identifiable by `ch_reindex_members(job_id, run_id, target_epoch)`.
- **Start.** Older-revision Queued/Running jobs end superseded (001.sql:19-21), partials deleted (Database.scala:92-93).
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
  valid — then fails `head = claim revision` (:528), the head check of prefix operations. e268e5e5 (44, 14:06:20Z) and
  be06fa02 (54, 20:08:15Z) logged `window failed` at stage annotation, then `job failed` `model-http`. All five: Failed
  `superseded-revision`, attempts 1 (`failAt` :890). **Three runs ended at the ANNOT2 head check after an append; an older
  run can still finish if it needs no prefix operation.** Rev 1's "missed lease renewal" reading is withdrawn.
- Permit: since 16:09Z no job > 100 windows other than 08ffb631's ran; no large job ran 17:27:18 → 17:39–17:44 (12–17 min, the
  permit served small jobs; 30c37108 deferred 17:32:35, then taken), ≤ 3.5 min after 18:25:56, ≤ 2.5 min after 20:08.
- Waiting at 20:57Z: 666b5a41 (since 16:02:55, deferred 16:09:17) and 46 applied jobs > 100 windows by **pre-retry total**, of
  which 8 had deferred; ≈ 1,064 queued jobs had no known total [review]. Sample retries had 0–2 sources ahead (low ids) [RS §2].

## 4. Requirements (each has a test in §8)
- **R1 order.** Class lanes pick the oldest eligible, unlocked job in their preferred class by stored transaction-start age,
  not commit order; lane 0 prioritizes sized-large jobs across classes. No owner receives a guaranteed share. This is an
  ordering guarantee, not starvation freedom: eventual service assumes lanes keep making claims, candidates can be locked (are
  not held by other transactions at every claim), and older work stops returning ahead of them. Not promised: a time bound.
- **R2 owners.** No owner id priority; order is by arrival within a class (D1a).
- **R3 large.** Only lane 0 runs a job indexing > 100 windows. Lane 0 takes sized-large candidates (Queued with a total from a
  deferral) oldest-first across classes before anything else. An unsized large job is sized at its class turn (R1) or by lane 0
  when no sized one waits. Not promised: order between a sized younger and a not-yet-sized older job (D-d).
- **R4 live session.** A head inserted while its source's older job runs gets its age by D3; nothing more is promised now.
- **R5 classes.** Each class has a fixed number of preferred lanes, not a minimum number running its jobs; a borrowed lane
  returns at its next claim, with no time bound. Flag on requires L ≥ 3 and 1 ≤ `bulkLanes` ≤ L − 2 (start refused otherwise).
- **R6 kept** [v]: one job per (source, revision, profile) (001.sql:12); head waits while an older revision runs; older-revision
  jobs never re-queued; fences and run/lease authority on every write; renewal permit; holds not claimable early; attempts
  ≤ 5, deferral/hold refunds; no job refused for its total size; publication monotonic. **Claim rechecks kept exactly:**
  (1) `supersedeEndedLeases` in its own transaction first; (2) per eligible target the `lease-exhausted` cleanup; (3) keep
  `OwnerTargets.eligible`'s shared locks on the enabled user and current target before locking sources (IndexProfiles.scala:
  39-47), and keep the existing write-authority checks; staging checks job/run/fence/lease, while publication switch also checks
  current target (:665-672, :843-845); (4) source locked `FOR UPDATE OF s SKIP LOCKED`, head revision read under it;
  (5) older-Running check; (6) job row locked `FOR UPDATE SKIP LOCKED` by an UPDATE whose WHERE re-evaluates claimable,
  attempts < 5, revision and profile on the locked version — never an id-only update; (7) the fenced transition (attempts+1,
  fence+1, lease). A skipped job lock passes that source; selection continues in order.

## 5. Design
### 5.1 Alternatives considered
Rev 1's weighted key (class share + per-owner Running counts) starves (D-a: four owners, class priority), races (D-b: all
lanes see zero bulk Running) and cannot be index-ordered (D-h). Per-owner rotation needs state (D1b). Rev 2 keeps one stored key.

### 5.2 `waiting_since` and `bulk` (set in the same transaction as the event)
| event | `waiting_since` | `bulk` |
|---|---|---|
| first upload / direct ingest (switch, no older unfinished job) | transaction time `now()` | false |
| append superseding a Queued, held or lease-ended Running job | that job's value | that job's value (D-f) |
| append, valid older lease, no Queued head | D3a: `now()`; D3b: the running job's value | D3a false; D3b inherited |
| single `RetryJob` (browser or bearer) | `now()` | false (interactive) |
| bulk retry-failed apply / owner rebuild | the apply's `now()`, one value for all its jobs | true |
| claim, deferral, hold, its return, failure to Queued, reclaim after lease end | unchanged | unchanged |
Reset versus inherit (row 3) applies only when a valid older run has no queued successor; replacing a queued or lease-ended
job inherits its age (row 2); replacing a deferred job loses its size marker. Ties: `session_id` (a UUID: it breaks ties within
the new order, not the old owner-first order). Ages are transaction-start times, not commit order.

### 5.3 Lanes
- Lane 0 holds the permit for the process lifetime (no try, no release; D-e's early-release race does not arise). Order:
  sized-large candidates by (`waiting_since`, `session_id`); if none, any candidate in that order; it runs whatever it sizes.
- Lanes 1..`bulkLanes` prefer bulk, the others fresh: candidates of the preferred class in (`waiting_since`, `session_id`)
  order, else of the other class; they pass sized-large rows and defer a job they size > 100 windows (`waiting_since` kept).
- 24 Nov [i]: Rev 52 queued before the bulk apply and would rank ahead of those retries once sized; the trace cannot
  establish its actual wait or discovery order.
- A Running job past its lease is not "sized-large" (its total is not indexed work, D-d): any lane may reclaim it and sizes it.
- **Ordering guarantee and its assumptions** [i]: this is an ordering guarantee, not starvation freedom: eventual service
  assumes lanes keep making claims, candidates can be locked, and older work stops returning ahead of them. Counter-example
  (review 2, D-c): two older bulk jobs alternate on the sole bulk-preferring lane — each attempt outlasts the other's hold,
  succeeds on its previously failed search range and then fails on another (Database.scala:819, 905-918: progress restarts the
  streak, the hold refunds the attempt); while the other lanes keep taking fresh work, a later bulk job never runs.

### 5.4 Indexes and cost
- `ch_jobs_class ON ch_jobs(bulk, waiting_since, session_id) WHERE state IN ('Queued','Running')` (class lanes);
  `ch_jobs_age ON ch_jobs(waiting_since, session_id) WHERE state IN ('Queued','Running')` (lane 0 fallback);
  `ch_jobs_sized ON ch_jobs(waiting_since, session_id) WHERE state='Queued' AND total_windows IS NOT NULL` (lane 0 first);
  `ch_jobs_running ON ch_jobs(session_id, profile) WHERE state='Running'` (older-Running check, not a walk over revisions).
- Selection: one statement in index order over the eligible (owner, target profile) pairs read first under the shared locks of
  R6 (3), joining `ch_sources` by
  key; time-dependent conditions (held, lease) are filters, so rows read = rows passed; that is measured, not assumed.
- **Requirement:** the whole claim path — both cleanups (today they visit every source of the eligible owners, :447-449,
  :464-466), selection, job lock, transition — p99 ≤ 50 ms over 1,000 claims at 10,000 queued rows on a production-shaped
  schema (3 owners, 2 profiles, 100 held, 100 sized-large, 4 Running, one source with 2,000 revisions), measured on demand;
  verify checks plan shape (these index scans, no Sort over candidates). If cleanup breaks the bound, it moves onto
  `ch_jobs_running` (open, §10). Status (measured 25 Nov): bound not met in either mode because of the existing lease-expiry step; owner decision Q159: accepted, the rewrite onto ch_jobs_running is deferred to its own unit.

### 5.5 Migration 032, start fill, previous binary
- `ADD COLUMN IF NOT EXISTS waiting_since timestamptz, ADD COLUMN IF NOT EXISTS bulk boolean`: nullable, no default (no rewrite,
  no volatile default). The four indexes on unfinished rows only.
- Start fill (every start, before the worker): unfinished rows with a NULL get `waiting_since = now()` (one value) and
  `bulk = (current rebuild member by job_id/run_id/target_epoch) OR annotation_retry_epoch > 0` [i: single retries are filed
  as bulk once]; UUID breaks ties within the new order, not the old owner-first order. The new image writes both columns on
  every event of §5.2 also with the flag off.
- Previous image: never reads or writes them; its new jobs get NULL (filled at the next new-image start, placed at that time);
  its retries and rebuilds leave stale values (old age, old class). After any old-image period that ran a retry or rebuild:
  `reseed` (server stopped). Reseed puts unfinished jobs at one timestamp, applies the same cohort/epoch classification as start
  fill, and loses relative ages; UUID breaks ties within the new order, not the old owner-first order. Down script:
  drop indexes and columns, full revert only.

## 6. Flag, image, restart
- `indexing.claimOrder` = `"source-id"` (default) | `"waiting"`; invalid → start refused; read at start. **Flag off, new image:**
  today's selection and try-permit; columns maintained, indexes unused. **Flag on:** §5.3. **Old image:** order back to today;
  columns go stale → start fill + reseed on return.
- Every flag change is a restart, and every restart supersedes older-revision Queued/Running jobs and deletes their partials
  (001.sql:19-21, Database.scala:92-93). A head-revision run interrupted by restart waits for its lease to expire; the next
  eligible claim either reclaims it and charges an attempt, or ends it `lease-exhausted` if no attempts remain (:464-469).
  Queue metadata survives; running work does not. A later carry-across-append unit has its own flag; this flag does not
  disable it, and a restart ends any carried run.

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
- T4 (R5, D-b) synchronized claims: per-lane assertions at controlled lock points (each lane takes the minimum of its order
  among rows unlocked at its statement), no source twice, no claim waiting on another's lock; bulk lane borrowed by fresh,
  then a bulk apply → bulk claimed at that lane's next claim; fresh lanes borrowed by bulk, then late fresh arrivals → claimed
  at their next claims.
- T5 (R3, D-d) older unsized vs younger sized large: lane 0 takes the younger (documented); once the older is sized it precedes
  younger sized ones; lease-ended incremental job with total 1,013 indexing 10 → reclaimed by a class lane, runs, no deferral;
  only lane 0 ever runs > 100 windows; cancelling lane 0 mid-job leaves the job to lease reclaim and the permit with lane 0.
- T6 (R6, D-g) a claim expired and reclaimed: the old fence cannot checkpoint, renew or publish; a same-profile rebuild
  between target read and source lock waits for the shared target lock, so no job is claimed with a stale epoch; lane B's
  stale snapshot of J after lane A's commit → no overwrite.
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
  job exercises prefix authority. The D-c alternation (two bulk jobs, one bulk lane) is a documented case, asserted as such.
- Remark (review 2, for the implementation review, not blocking): T4 must not use an "exactly the first L" oracle — with bulk
  B1 globally oldest, lane 0 taking B1 first can yield {B1, B2, F1}, the bulk lane taking B1 first {B1, F1, F2}; and test a
  same-profile rebuild between selection and locking (the reviewer's text was cut off there).

## 9. Out of scope
Owner weights; size preference; a second large lane (permit rationale: heap per ModelAdmission.scala:8-10, lane time per
ingest-limits spec §5.2.7 — needs a heap measurement); leases, holds, attempt limits, publication gate; avoiding the live
session's cut (§3: REL-B r4 head equality, Database.scala:528), i.e. the units carry across a pure append (search stays at
the claimed revision, possibly many revisions behind; the tail can exceed 100 windows or be a root publication if incremental
publication is off or the parent is ineligible), quiet period (its maximum can fire during continuous uploads and cut again).

## 10. Open issues after review
- D-c: This is an ordering guarantee, not starvation freedom: eventual service assumes lanes keep making claims, candidates
  can be locked, and older work stops returning ahead of them (counter-example §5.3).
- D-d: no order between a sized younger and an unsized older large job; strict FIFO would need to resolve older candidates' size
  before dispatching a younger large job — not proposed.
- D-h: the 50 ms bound is an implementation verification gate, not a measured result; today's cleanups may need their own index. Status (measured 25 Nov): bound not met in either mode because of the existing lease-expiry step; owner decision Q159: accepted, the rewrite onto ch_jobs_running is deferred to its own unit.
- D-i: retry epoch alone does not tell single from bulk retry, so the start fill files single retries as bulk once; reseed
  after an old-image period loses relative ages (rebuild runs stay identifiable by cohort membership).
- D1 rotation, D2 hard reservation, D4b/c: offered to the owner, not specified in detail.
- R5 needs L ≥ 3 with the flag on; L ≤ 2 deployments keep today's order.

## 11. Review history
- 24 Nov, round 1 (advisory, REVIEW-1.md/-1b.md): NOT READY — facts F1–F8 wrong or overstated; rev 1's design (class shares,
  per-owner counts) allowed starvation, races and an expensive claim. Rev 2 corrected the facts and replaced the design.
- 24 Nov, incident evidence (RA "Early ends of 08ffb631 jobs") settled F5: the three stale-claims came from `prefixAuthority:528`.
- 24 Nov, round 2 (advisory, REVIEW-2.md): NOT READY with exact replacement wording (F4, F6, D-b, D-c, D-d, D-g, D-i, D1–D4,
  restart). Rev 3 applied that wording without a third round.
- The design has not been implemented or measured.
- 25 Nov, owner decision Q148: recommended options (a) of D1–D4 approved; agreed specification, not to be built yet.
