# Indexing claim order — specification of a fairer order (draft, no code)
Owner decision Q147 (24 Nov): "Write a specification for a fairer claim order (no code yet) and show it to me".
Code read at `main` = d7ae4cc7 (the production commit). Markers: **[v]** verified in code here, **[r]** from the cited reports
(.local/overhaul-20261117/reports/retry-all/REPORT.md = RA, retry-sample/REPORT.md = RS, STATE.md 24 Nov), **[i]** inference.

## 1. For the owner (read this first)
- **Today.** When a lane is free it takes the queued conversation whose *random* id sorts first (UUIDs are drawn at first
  upload), not the one that has waited longest; and it serves owners strictly in id order, so one owner's backlog would
  starve another's. Arrival time is not stored anywhere. Conversations above 100 windows need the single "large" slot, but
  that slot goes to whichever lane loops first, which then takes the lowest-id job of *any* size.
- **Why it matters (24 Nov).** The live session 08ffb631 has a low id, so it always won the large slot; after its appends
  its running job was cut short (4 jobs 13:36–17:27Z, 2 more by 20:57Z) and restarted after a wait — ≈31 windows/h instead
  of ≈43/h, still ≈600 windows to go. Meanwhile 47 other large jobs (one waiting since 16:02Z) had not started by 20:57Z and
  no other large job ran after 16:09Z; the slot sat idle up to 12–17 min while large jobs waited. A small job's wait was luck:
  0–2 jobs ahead for the sample retries, up to the whole queue (≈1,100) for a high id [i].
- **What changes for you.** Jobs are taken oldest-waiting first; bulk retries/rebuilds can no longer bury freshly uploaded
  sessions (they get a guaranteed share of lanes instead of the whole queue); owners share lanes equally; the large slot goes
  to the large job that has waited longest and is released at once when a lane finds its job small; optionally (D3) a live
  session's running job is no longer cut by its own appends, so after one full run its later jobs are small increments.
- **Cost.** One additive migration (two columns, one partial index; the current binary still runs on it); a rewrite of the
  claim query (the hot path of indexing); a restart to deploy and one more to switch on. Risk: a claim bug stops indexing or
  mis-orders it — contained by a configuration switch whose off position is today's order (rollback = flip + restart).
- **Decisions you must make** (recommendation first):
  - **D1 Owners.** (a) equal lane share among owners with queued work [rec]; (b) keep strict owner-id priority; (c) weights.
  - **D2 Bulk vs fresh.** (a) two classes: re-queued work (retry, retry-failed, rebuild) is guaranteed 1 of 4 lanes, freshly
    uploaded work the rest, each oldest-first [rec]; (b) one oldest-first queue (on 24 Nov fresh sessions would have waited
    behind 891 retries, ≈31–46 h); (c) re-queued work only when nothing fresh waits (can starve it).
  - **D3 Live session.** (a) a running job is carried across a pure append — it finishes and publishes its revision, the
    next job indexes only the new tail [rec; changes an ANNOT2 rule, so a separate unit with its own review]; (b) a quiet
    period before re-indexing (does not stop the large cut; adds latency to every live session); (c) neither: after each cut
    the session's next job queues behind every large job that waited longer (on 24 Nov: behind 47, i.e. days).
  - **D4 Rollout.** (a) behind `indexing.claimOrder` (default = today), on after verify [rec]; (b) unconditional. (2nd large slot: §9.)

## 2. Current behaviour at d7ae4cc7 [v]
- **Lanes.** `annotationSessions` lanes (default 4, Core.scala:75; production 4 [r RA]) loop `iteration` (Models.scala:578-587,
  589-601); an idle lane sleeps 1 s (:114). Each iteration first tries the large permit (`large.tryPermit`, ModelAdmission.scala:20,23;
  `IndexingCapacity.largeJobs = 1`, Core.scala:82) and holds it for the whole iteration, whatever it claims (Models.scala:579-585).
- **Claim** (`claim`, Database.scala:431-436): first `supersedeEndedLeases` (:441-453) ends Running jobs of an older revision
  whose lease ended; then `claimHead` (:454-490): owners with an enabled user and a target in the profile set, `ORDER BY t.owner`
  (:461) — iterated, first owner yielding a claim wins (`collectFirst`, :489): strict priority by owner id. Per owner target:
  exhausted leases (attempts ≥ 5) end `lease-exhausted` (:464-469); then ONE source `ORDER BY s.id FOR UPDATE OF s SKIP LOCKED
  LIMIT 1` (:474-478) with a claimable head job (`j.revision = s.revision`, attempts < 5, `Jobs.claimable`), no older-revision
  job Running (:476), and — without the permit — no head job with `total_windows > 100` or Queued with a known total (:477).
  The job row is taken `FOR UPDATE SKIP LOCKED` (:481): state Running, attempts+1, fence+1, lease = now + lease, totals reset.
  `s.id` is `UUID.randomUUID()` at the source's first upload (:310): a session's rank is random and fixed for life.
- **Claimable** (`Jobs.claimable`, :262-263): Queued with `lease_until` NULL or past (a *held* job is not), or Running with an
  ended lease (reclaim, charged as an attempt).
- **Large jobs.** After the count pass a job indexing `> LargeJobs.windows = 100` windows (Core.scala:298-307; total − the
  published parent's cut, Models.scala:456-462) on a lane without the permit is *deferred* (`defer`, Database.scala:637-646):
  Queued, attempt refunded, fence+1, `total_windows` recorded — the only way a Queued job carries a total, hence the filter at
  :477. A lane with the permit runs it. Nothing is refused for its size (comment :470-473; ingest-limits spec §5.2.7: the permit
  now shares lane time, not heap — ModelAdmission.scala:8-10 still gives the older heap reason).
- **Append** (`ingest` :296-332 → `Jobs.switched` :276-281): every other unfinished job of an older revision ends *superseded*
  (`superseded-revision`, fence+1; its ANNOT2 partials deleted, `Jobs.supersede` :257-260); a Running job with a valid lease
  keeps its claim (`Jobs.leased` :253-255) and the new head job waits for it (:476). The leased old job may still publish its
  revision (switch refuses only if a newer generation is published, :843-848). It is ended later by (1) any failure, which
  supersedes instead of re-queuing an older revision (`failAt` :886-897, `holdTransient` :905, `defer` :641-642); (2) with
  `annotationContinuations` ON (production [r]), the first write of a window with a committed prefix, which requires
  `head = claim.revision` (`prefixAuthority` :526-529; ANNOT2 design REL-B r4 "an older revision's chain is not grandfathered
  past the switch") → `stale-claim` → superseded; (3) a lease that ended (renewal needs `lease_until > now`, :649-655, :509).
  Kept: accepted windows (checkpoints), reused by reference by the next run (Models.scala:467-470; Database.scala:619); lost:
  the window in flight, its partial, and the wait. RA attributes the stale-claims to (3); the `job failed code=stale-claim`
  line does not distinguish (2) from (3) [i: (2) is the likelier for a 1,000-window session with continuations ON].
- **Start-up** supersedes older-revision jobs left Queued/Running (migrations/001.sql:19-21). **Leases, fences:** lease 300 s,
  renewal 30 s on its own permit (Models.scala:622-625); every state change bumps `fence`; writes are fenced (:508-510).
- **Holds.** A transient database failure holds the job Queued with `lease_until` = next attempt, attempt refunded, back-off
  1, 2, 4, 8, 15 … min, Failed `database-transient` at the 10th in a row (:242-252, :899-923; restart-robustness §4).
- **Retry.** Attempts limit 5 (:243). `RetryJob` (:264-273), retry-failed (RetryFailedJobs.scala:84-86) and an owner rebuild
  (ReindexCohort.scala:64) re-queue with attempts 0 and a new epoch/run.
- **Publication gate.** Staging transactions take a gate permit, then the background admission (Database.scala:35, :665-672).
- **Timestamps today.** `ch_jobs` (001.sql:12, 003, 010, 015, 029): only `lease_until` (lease end, or a held job's next attempt);
  `ch_sources`, `ch_revisions`: none (`ch_revision_info.message_time` is the source's own message time, 024:57-58). **No arrival
  or queue time exists.** Index: `ch_jobs_claim(state,lease_until)` (001.sql:15).

## 3. Observed effects, 24 Nov [r]
- Queue: 15:53Z 289 Queued (288 fresh) + 4 Running; 16:59Z, after the 891-job apply, 1,148 (all pavel); 20:57Z 1,074.
- Live session 08ffb631: 10 head revisions 43–52 (13:11:03–16:20:52Z); 6 jobs superseded while Queued; 4 ran and were cut:
  c68e6e17 pod roll (+7 windows), e268e5e5 model-http → superseded (+15), 4d178a0b stale-claim 14:47:42 (+14), 7092dfbe
  stale-claim 17:27:18 (+100). Then 30c37108 stale-claim 18:25:56 after revs 53/54, be06fa02 model-http 20:08:15 → superseded (+62).
  Accepted 272/1010 (13:31) → 406/1013 (17:49) → 507/1013 (20:57): ≈31–34 windows/h overall, ≈43/h uninterrupted; ≈14–20 h left.
- Large lane: since 16:09Z no job > 100 windows ran other than 08ffb631's. Idle with large jobs waiting: 17:27:18 → 17:39–17:44
  (12–17 min: the permit served small jobs, 30c37108 deferred 17:32:35, then taken), ≤ 3.5 min after 18:25:56, ≤ 2.5 min after
  20:08. Waiting at 20:57: 46 applied large jobs (8 sized) + 666b5a41 (Queued since 16:02:55, deferred 16:09:17 — the oldest).
  RS estimate: the 46 large jobs, one at a time, ≈ 80–200 h. Sample retries had 0–2 sources ahead (ids sorted early) [RS §2].

## 4. Requirements (each testable; §8)
- **R1 bounded wait.** A claimable job J is overtaken only by jobs that were waiting before J (by the order of §5.3) or by a
  bounded number of returns of those jobs (attempt limit, hold limit); never by an unbounded stream of later arrivals.
- **R2 owners.** Lanes are shared equally among owners with a claimable job (max-min by Running jobs); owner id is no priority.
- **R3 large slot.** The slot goes to the longest-waiting claimable large job; it is held only by a job that indexes > 100
  windows; a session that keeps being appended cannot keep it against older large waiters.
- **R4 live session.** Appends to a session do not throw away its running indexing (D3). Freshness: under D3a search shows the
  revision the job claimed until it publishes, then the tail follows as a small incremental job (a lag of one job, not a
  restart); under D3b a session is not re-indexed until it has been quiet for Q; under D3c a cut large job waits its turn.
- **R5 fresh sessions.** Freshly uploaded small sessions are not queued behind bulk re-queued work: they get ≥ L − backlogLanes
  − 1 lanes (one may hold the large slot) (D2a). No size preference in a class (size unknown before the count pass): keeps R1.
- **R6 invariants kept** [v]: one job per (source, revision, profile) (001.sql:12 UNIQUE); one claim per source — the head waits
  while an older revision runs (:476); an older-revision job is never queued again (:641, :890, :905, 001.sql:19-21); fences on
  every write (:508-510); leases, renewal on its own permit, reclaim of ended leases, `lease-exhausted` (:441-453, :464-469);
  held jobs not claimable before `lease_until` (:262-263); attempts limit 5, deferral and holds refund the attempt (:643, :918);
  `SKIP LOCKED` — concurrent lanes never wait for each other's claim, a locked source is passed by (:478, :481); claims only
  for enabled owners, current target, not tombstoned (:461-463, :474); a claim decodes no message (Models.scala:581); no job
  refused for its size (§5.2.7); at most `largeJobs` large jobs run; publication monotonic (:845-846).

## 5. Design
### 5.1 Alternatives
| (A chosen: stateless but for 2 columns, one checkable order) | A. age order + class share + FIFO large slot [rec] | B. per-owner round robin, age within owner | C. weighted score |
|---|---|---|---|
| order | (class share, owner Running count, waiting_since, s.id) | rotate owners by last service, then age | age + w₁·small − w₂·owner load … |
| R1 | yes, proof §5.6 | yes within owner; needs stored last-service per owner | only with an aging term; bound depends on weights |
| R2 | max-min by Running jobs, stateless | strict rotation, needs state that survives restarts | tunable, opaque |
| R5 | class share | no (bulk retry of one owner buries his fresh sessions) | yes if size known — it is not |
| cost | 2 columns + 1 partial index | + per-owner state table, rotation races | weights to tune; hard to test exactly |

### 5.2 Stored state (migration 032, additive; runs at every start, idempotent, like 029)
- `ch_jobs.waiting_since timestamptz NOT NULL DEFAULT clock_timestamp()` — when the job began waiting for its *current* service;
  `ch_jobs.requeued boolean NOT NULL DEFAULT false` — class B (re-queued work) vs class N (uploaded work); index
  `ch_jobs_waiting ON ch_jobs(profile, requeued, waiting_since, session_id) WHERE state IN ('Queued','Running')`.
- Backfill: unfinished jobs get the migration time (ties → `s.id`: today's order for the backlog present at the change);
  `requeued = annotation_retry_epoch > 0` [i: catches retry and retry-failed; rebuild jobs cannot be told apart, start as N].
- The previous binary runs on this schema (additive columns with defaults, never read by it); its inserts get correct values;
  its retries leave both columns unchanged (a bounded mis-order after a roll back and forth). A down script (server stopped)
  drops index and columns, only for a full revert.

### 5.3 Definitions
- **Set**: insert by an append (`Jobs.switched`): `requeued=false`, `waiting_since = min(now, waiting_since of each job of the
  source and profile this switch supersedes while Queued)` — a source keeps its place while it waits; a job that was *running*
  donates nothing. Insert/re-queue by RetryJob, retry-failed, rebuild: `requeued=true`, `waiting_since=now`.
  **Unchanged by** claim, deferral, hold, retryable failure, reclaim of an ended lease (the job is still owed its service).
- **Candidate**: a head job claimable by today's conditions (:474-477; permit rule §5.4). **L** = lanes; `backlogLanes` =
  class-B share (key `indexing.backlogLanes`, default 1, valid 0..L−1); `Rᴮ` = Running jobs with a valid lease and
  `requeued`; `Rₒ` = Running jobs with a valid lease of owner o. **Preferred class** P = B if `Rᴮ < backlogLanes`, else N.
- **Order (the rule a test checks):** the claimed job is the first candidate not locked by another transaction by
  `ORDER BY (j.requeued <> P), Rₒ, j.waiting_since, s.id`. Rᴮ and Rₒ are read in the claim transaction without locks: concurrent
  lanes may see the same counts (tolerance: at most L−1 claims out of share order, corrected by the next claims).

### 5.4 Large slot
- A lane still tries the permit at the start of an iteration. **With** it, it first claims the oldest candidate whose head job
  has a known `total_windows > 100` (deferred large), by `ORDER BY waiting_since, s.id` across owners and classes; if none, it
  claims by §5.3. If the job it then counts indexes ≤ 100 windows, it **releases the permit before Phase W** (today it keeps it
  for the whole job, Models.scala:579). **Without** it, a lane passes deferred large jobs (as :477) and defers a job it finds
  large (as :459-460), `waiting_since` unchanged — so a job's place in the large line is its waiting time, not its deferral time.
- Work-conserving: the lane that finishes a large job loops at once, takes the permit and the next large job. A live session's
  large job holds the slot for the windows of the revision it claimed (finite). Under D3a it then publishes and the session's
  next job indexes only the appended tail (≤ 100 windows unless the gap is long) — no permit. Under D3c a cut job's successor
  waits with `waiting_since` = its append time, behind older large waiters (R3).

### 5.5 Live session (D3a, a separate unit behind `indexing.carryAcrossAppend`, default false)
- A leased Running job whose head moved by a **pure append** — the head revision in the claim's epoch and holding at least its
  messages, the condition incremental publication already uses (Database.scala:699-704) — keeps prefix authority: REL-B r4's
  head-equality applies only when the head is not a pure append. The job finishes and publishes its revision; the head job
  waits (:476), then runs incrementally from the published cut. A non-append switch (new epoch) behaves as today.
- Must be re-derived against the ANNOT2 design before building: why r4 forbade older-revision chains (partials deleted at
  supersession; successor's rows keyed by its own job, G2-T14) and that no successor reads an older job's partial.
- D3b (quiet period Q) is not proposed for building now; if chosen: a head job is a candidate only when its revision is older
  than Q or its `waiting_since` is older than a maximum M (keeps R1); needs the switch time stored (a third column).

### 5.6 Why no claimable job starves (argument for R1–R3)
Each job runs finitely (lease, attempts ≤ 5, consecutive holds ≤ 10, windows finite). Within one (class, owner) jobs are
claimed in `waiting_since` order; a later arrival has a later `waiting_since` (inheritance only replaces a source's own Queued
job, retry sets now), so the jobs ahead of J are a finite set that grows only by their own bounded returns. Class P gets the
next claim whenever it has candidates; with L ≥ 2 and `backlogLanes` in 1..L−1 both classes hold ≥ 1 lane whenever they have
work (with L = 1 class N has priority — a documented limit). Within the class the owner with fewest Running jobs is served;
Running jobs end, so J's owner becomes minimal within at most (owners − 1) claims of that class. Large: the line is FIFO by
`waiting_since`, the slot is work-conserving, each holder finite; an unsized large job is sized at its first ordinary claim,
which R1 bounds. Locks only delay (SKIP LOCKED passes a source that another lane is claiming or writing for one claim).

### 5.7 Claim cost
One statement driven by `ch_jobs_waiting` (unfinished jobs only: ≈ 1,400 rows on 24 Nov), in order, joining `ch_sources` by
primary key and checking the older-Running condition through `UNIQUE(session_id,revision,profile)`; rows read ≈ rows passed
(held, blocked, deferred-large for permit-less lanes, locked) + 1. Rᴮ, Rₒ come from `ch_jobs_claim` (≤ L Running rows). The
per-owner loop (:461-489) becomes one query over the eligible (owner, target) pairs computed as today (`OwnerTargets.eligible`).

## 6. Compatibility and rollout
- `indexing.claimOrder`: `"source-id"` (today, default) | `"waiting"`; read at start, invalid value refuses the start (like
  `annotationContinuations`). Migration 032 ships with the binary regardless; the switch only selects the claim statement and the
  permit release. `indexing.carryAcrossAppend` is independent and later (D3a).
- Rollout: deploy (restart 1; order unchanged) → verify → ConfigMap flip + restart 2. Rollback: flip back + restart; no data change;
  jobs keep their columns; the previous binary also runs on the schema.
- Jobs queued at the flip keep `waiting_since` = migration time (all equal) → today's `s.id` order among themselves, every later
  arrival behind them; jobs of 24 Nov's apply (`annotation_retry_epoch > 0`) are class B. Running jobs are not touched.

## 7. Observability
- Logs (ids, counts): `job claimed jobId owner class=N|B preferred=N|B waitingSeconds permit=yes|no`; `large slot taken jobId
  indexedWindows waitingSeconds` / `released jobId reason=small|complete|ended`; the deferral line (Models.scala:460) +waitingSeconds.
- Activity view: per owner × class — queued, claimable, held ("Waiting · next attempt", Jobs.tsx:76), oldest waiting age; large
  line — the holder (job, session, windows a/b, since), the deferred large jobs in order with their ages; job list column
  "Waiting since" (sortable). API: `waitingSince` and `requeued` on activity jobs.

## 8. Test plan (PostgreSQL-backed, owned databases; existing suites must pass unchanged)
- T1 order: fixtures with explicit `waiting_since`, classes, owners, Running leases → the claimed job is the minimum of §5.3's key;
  ties by `s.id`; with the switch off, today's order (regression).
- T2 R1: J queued, later arrivals inserted between claims → J claimed after exactly the jobs ahead of it (+ their scripted returns).
- T3 set/unchanged: append over a Queued head inherits; over a Running job does not; retry/retry-failed/rebuild set now and B;
  defer, hold, retryable failure, reclaim keep the value.
- T4 R2: owners a (1,000 old jobs) and b (fresh), 4 lanes → b holds ≥ 2 lanes after ≤ 2 claims; renaming owners changes nothing.
- T5 R5: B backlog + N arrivals → Rᴮ ≥ 1 whenever B has candidates; N takes the rest; either class alone takes all lanes; default
  `backlogLanes = 1` asserted in a separate test.
- T6 R3: sized large jobs start in `waiting_since` order; a permit lane with no sized large job claims ordinarily and releases the
  permit before Phase W when the job is small (another lane then takes a large job); a found-large job is deferred with its value kept.
- T7 R4 (D3a): T7-0 first reproduces on d7ae4cc7's code which path ends a leased old job after an append with continuations ON;
  then: pure append during a run → the job finishes with continuation writes, publishes, the head job is incremental, no permit;
  new-epoch switch → today's stale-claim. R6: held job never claimed early even if oldest; head waits for older Running; attempts,
  `lease-exhausted`, start-up supersession unchanged.
- T8 concurrency: L concurrent claim transactions on one fixture → no source claimed twice, no claim waits on another's lock,
  claimed set = first k by key except locked rows; plan uses `ch_jobs_waiting` on 10,000 unfinished jobs (EXPLAIN, rows read).
- T9 replay of 24 Nov (scripted provider, controlled clock): one 1,013-window session (406 accepted) appended every 5 min (+1
  window), 47 sized large jobs, 1,000 small B jobs, N arrivals every 2 min, 4 lanes. Bounds: the slot is never free while a
  sized large job is a candidate for longer than one lane iteration; large jobs start in `waiting_since` order; under D3a the
  live job is not cut and its later jobs take no permit; under D3c no older large waiter is overtaken by its successor; each N job
  with q N-jobs ahead is claimed within ⌈(q+1)/(L−backlogLanes−1)⌉ service units; every B job within its jobs-ahead bound.
- Timing rule: order depends on stored values set by fixtures, not elapsed time; leases/back-off use the existing configurable
  fixtures, production defaults asserted separately; assertions keep their kind; no retries or filtered cases.

## 9. Out of scope; open questions
- Out: owner weights; size-based preference; a second large permit (§5.2.7 says the permit now guards lane time, not heap —
  ModelAdmission.scala:8-10 disagrees; needs a heap measurement first: on 24 Nov it would roughly halve the ≈ 80–200 h);
  changing leases, holds, attempt limits or the publication gate; the retry-all watch itself.
- Open: which path ended 08ffb631's leased jobs (T7-0); whether ANNOT2's r4 can be relaxed for pure appends (D3a review);
  whether rebuild jobs should be backfilled as B (no marker exists); L = 1 deployments (class N priority).
