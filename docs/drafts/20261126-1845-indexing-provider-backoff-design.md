# Chronicle indexing: back-off after model-provider failures — design note (DRAFT, nothing built)

Date 2026-11-26 18:45Z, for the owner. Base `main` a2eae616. Design only: no code, no tests, no production access.
`S/` = `chronicle/server/src/main/scala/chronicle/`; `MH` = `shared/model-http/src/main/scala/ponygirls/retrieval/ModelHttp.scala`;
`T/` = `chronicle/server/src/test/scala/chronicle/`. Every code reference was read in this tree. Incident facts are cited from
the overhaul notes (retry-all REPORT.md:30-33, :51-59; retry-followup ALERTS.txt; STATE.md:1133-1135), not re-observed.

## 0. In short, and two corrections to the brief's mechanism
- Confirmed: `failAt` (S/Database.scala:968-984) puts a failed job back to Queued with `lease_until=NULL`. The attempt
  the claim charged stays charged; the job is Failed only at attempts ≥ 5 or on a terminal code. `waiting_since` is
  untouched, so the waiting order (S/ClaimOrder.scala:77, oldest first) offers the same job again at once. The only pause
  is 2 s on the lane that failed (S/Models.scala:569; `FailureBackoff.production` = 2 s, :679). Nothing looks at the cause.
- Correction 1: S/Models.scala:601 sleeps after a *database* hold, :644/:653 after a failed *claim*; only :569 follows a failed job.
- Correction 2: held jobs exist, but large-job deferral is not one: it records `total_windows` with `lease_until=NULL`
  (S/Database.scala:719-729). Holds are written only by `holdTransient` (S/Database.scala:989-1012) for `database-transient`
  (S/Models.scala:558, :690-693): attempt refunded, Queued until `lease_until` = now + 1, 2, 4, 8, then 15 min, Failed at
  the 10th hold in a row (S/Database.scala:259-269); committed progress restarts the count (:997, :735).
- Recommendation: send provider-side failures down that same hold path behind one flag (D1 = A + B2, §3): no migration,
  reply or page change; it would have saved both incidents' jobs. Full refusals over ~1.5 h need the breaker (C) next.

## 1. Current behaviour, traced
**Per call: no retry.** One POST per call: a non-2xx answer raises `model-http` "model returned HTTP n" (MH:67), the
deadline `model-timeout` (MH:73), any other transport error `model-transport` (MH:76). Response headers, `Retry-After`
included, are never read (MH:67). Chronicle re-raises the same code (S/Models.scala:83-88), except `model-response-bound`
and `model-json`, which become `model-output` rejections (:86-87). Admission is a semaphore that waits and never refuses
(S/ModelAdmission.scala:28-31). The HTTP status lives only in the error text, parsed for the log (S/Models.scala:137-139);
the row stores the code alone (`code.take(64)`, S/Database.scala:982).

**Per attempt, by stage.**
- Annotation: each call first reserves a row in the window's ledger, just before dispatch (S/Models.scala:80;
  S/AnnotationAttempts.scala:92-95), so a call answered 429 has used a row. `model-output` and `model-output/truncated`
  are recorded as rejections and the same window is asked again within the attempt (S/Models.scala:234-240, 292-294,
  311-317); the 5th rejection ends the job `annotation-attempts-exhausted`. A window has 10 ledger rows per retry epoch
  (`reservationLimit` = 5 + `attemptLimit`, S/AnnotationAttempts.scala:36-37); once used, the job ends
  `annotation-reservations-exhausted` (:81, :109; S/Models.scala:131). Any other error ends the attempt (:241, :295).
- Embedding: each accepted part is checkpointed (S/Models.scala:330-335). No re-ask: any error ends the attempt (:343).
  The next attempt reuses accepted decisions and parts (:174-181).
- Publication: no model call; it replays checkpoints (S/Models.scala:346-347). Every claim charges one attempt
  (S/ClaimOrder.scala:192, S/Database.scala:558); only attempts < 5 are claimable (S/Database.scala:284-285).

| code | charged | row afterwards | claimable again |
|---|---|---|---|
| `model-http` (any status), `model-timeout`, `model-transport`, embedding `model-output`, `worker-fault` (S/Models.scala:133), `invalid` (:113-114) | yes | `failAt` (S/Database.scala:982): Queued, `lease_until` NULL, `error`=code, `failure_stage`, `transient_failures`=0, windows reset; fence, `waiting_since`, `bulk` kept; Failed at attempts ≥ 5 | at once, still oldest of its class |
| `annotation-attempts-exhausted`, `-reservations-exhausted`, `-input-changed` (S/AnnotationAttempts.scala:44), `index-budget-exceeded` (S/Models.scala:39) | — | Failed whatever the attempts (S/Database.scala:969, :982) | only after a retry |
| `database-transient`, leftover staging | refunded | HELD: Queued, `lease_until`=next attempt, `transient_failures`+1; Failed at the 10th (S/Database.scala:1003-1009) | at `lease_until` |
| `stale-claim` (claim lost, e.g. S/Models.scala:319) | yes (at claim) | no write: every write needs fence, run, epoch and a live lease (`validJob`, S/Database.scala:588-590); with a live lease and a newer head the job is superseded (:978-980) | per the row |
| lease end (process died or hung) | yes (at reclaim) | Running with ended lease: any lane reclaims it (S/Database.scala:285); `lease-exhausted` at attempts ≥ 5 (:540-545) | 300 s after the last renewal (S/Models.scala:686) |
| record failed (DB down) | yes | keeps its lease (S/Models.scala:603-607) | after the lease ends |
| owner's indexing off or epoch changed | refunded | parked: Queued, fence+1 (S/Database.scala:971-977) | when re-enabled |
| `internal`, `config`, `model-telemetry-invariant` | — | stops the worker (S/Models.scala:557, :675) | — |

**Restarts and holds.** A restart leaves head-revision rows alone; at start only older-revision Queued/Running jobs end
superseded (chronicle/migrations/001.sql:19-21). Running jobs come back after their lease ends, each charged one more
attempt. A held row stays held: its hold is just `lease_until`. `Jobs.claimable` excludes Queued rows with a future
`lease_until` (S/Database.scala:284-285). It is a *filter* in the waiting-order candidate statement (S/ClaimOrder.scala:76)
and in today's order (S/Database.scala:551, :558), so a held head-of-queue job is skipped, not waited for. When its time
comes it returns at its old place, because holds keep `waiting_since`/`bulk` (claim-order spec
`docs/drafts/20261124-2138-indexing-claim-order-spec.md:135`). Activity derives `Held` from the same predicate
(S/Activity.scala:109).

**The two incidents, read through this.** (1) 09:02-09:13Z, embedding pod not Ready: each attempt waited out the embedding
deadline (`model-timeout`, Embedding); five jobs used 5 attempts each (REPORT.md:30-32, :52-56). (2) From about 17:56Z
the provider answered 429, partially (other jobs kept running); five jobs Failed `model-http` at Annotation with windows
28/33, 3/5, 5/7, 6/8, 6/8, 7fc785e8 by 18:00Z (ALERTS.txt; STATE.md:1133-1134). A manual `RetryJob` resets
`waiting_since` (S/Database.scala:295), so a retried job waits behind 369-377 others (REPORT.md:52-59).

## 2. Failure taxonomy (proposed)
- **Provider or infrastructure** (cannot be the job's fault): `model-http` 429, 502, 503, 504, 529; `model-transport`
  (the endpoint is not there); `model-timeout` at Embedding. An embedding batch is at most 16 inputs of at most 16 KiB
  (S/Models.scala:113-114), so a timeout there means the endpoint is not answering.
- **Configuration** (not the job's fault, but nothing can succeed): `model-http` 401, 403, 404.
- **Content** (can be the job's fault): `model-http` 400, 413, 422; `model-output/truncated`; the annotation rejections
  and their terminal codes; `index-budget-exceeded`; `invalid`.
- **Ambiguous:** `model-timeout` at Annotation (a window can make the model reason up to 65,536 response tokens,
  S/Models.scala:102); `model-http` 500 and 408; embedding `model-output` (a count or vector mismatch is more likely the
  server's fault); `worker-fault`, `stale-claim`, `lease-exhausted` (our own side).
- The code **can** tell apart the status class (error text, S/Models.scala:137-139) and the stage (`StagedFailure`, :160,
  :555). It **cannot** tell a connect from a read timeout (MH:73), the cause of a transport error (MH:76), `Retry-After`,
  or whether a 429 is our own rate or another workload on the same account (STATE.md:1134 hypothesis).

## 3. Design options
Walkthrough setup: 4 lanes (lane 0 large, 1 bulk, 2 fresh; REPORT.md:33), hundreds of queued jobs. `f` is how long a
failing attempt takes: one round trip for a 429, the configured deadline for a timeout.

**Today.** The head job is reclaimed until its 5 attempts are gone, then the next. Under full refusal jobs die at about
4 ÷ (5·(f + 2 s)) per second, many per minute for fast 429s. Incident 1 (f = the embedding deadline): 25 attempts and 5
jobs in 11 min; incident 2 (partial refusal): 5 jobs in 35 min.

**A. Per-job hold, attempts still charged.** On a provider-side failure, `failAt` also sets `lease_until` = now +
d(attempts), d = 1, 2, 4, 8 min. Changes: S/Database.scala:982 (one more SET), classification at S/Models.scala:556-569,
the flag; no schema.
- Incident 1: a job failing at 09:02 is tried again about 09:03, 09:05 and 09:09 and succeeds about 09:17, having spent
  4 of its 5 attempts. A job that had already spent 2 still fails, and the lanes spread failures so more jobs lose 1-4.
- Incident 2: 5 failures need at least 15 min, so the 35-min burst still kills jobs, only more slowly. Not enough alone.

**B. Accounting for provider-side failures.**
- B1, charge as now: today's behaviour. B2, refund the attempt. Without a hold, the waiting order re-claims the same job within seconds: a hot loop against a
  refusing provider. Acceptable only with A or C, and it needs a stop rule: a count of consecutive refunds
  (`transient_failures` exists).
- B3, charge up to attempt 4, never the 5th: still burns 4 attempts per outage and adds a rule.
- B4, give up after elapsed time: nothing records when a run of failures began (`waiting_since` is queue age), so it needs
  a migration. A count on a fixed schedule already implies a minimum time (10 ≥ 90 min, 26 ≥ 5.5 h).
- Hidden limit for B2/B4: at Annotation each failed call also uses one of the window's 10 ledger rows (§1). Today the 5
  attempts cap a window's provider rows at 5. Once attempts are refunded, the ledger becomes the limit: after
  10 − (rejections and kept answers already in the window) provider failures, the job ends
  `annotation-reservations-exhausted`, a content-looking code for an outage. So any count limit above 10 helps Embedding
  failures only. Keep the ledger: it is the runaway bound on calls (AGENTS.md keeps runaway safeguards).

**C. Lane breaker with probe** (Worker memory, no schema).
- Trip after K provider-side job failures in a row across all lanes, no committed answer between (K = lanes = 4). While
  open, every lane sleeps instead of claiming, lane 0 too (it keeps its permit, S/Models.scala:636); the pause grows 1, 2,
  4, 8, 15 min. When it ends, one lane claims normally as the probe: success or a non-provider outcome closes the breaker,
  a provider-side failure lengthens the pause. Changes: a gate before `laneIteration`/`iteration`
  (S/Models.scala:641-655), the outcome hook at :556-569, the flag. Search queries do not pass through the worker.
- C alone (charged): the K failures that trip it are the head job's own re-claims (4 attempts), and the first probe takes
  its 5th. Incident 1 would lose 1 job instead of 5.
- C with D1, full refusal: after K failures about one probe per pause. The oldest job takes most probes (its hold,
  ≤ 15 min, ends before the next pause does) and fails after about 90-135 min; every other job is untouched. A probe
  outside any job would need an owner-less model call (`ModelCallContext` carries an owner for telemetry,
  S/ModelTelemetry.scala:16, S/Models.scala:67-69); not now.

**D. Combinations.**
- **D1 = A + B2.** Provider-side codes go through `holdTransient`, generalised to take the code and the schedule
  (S/Database.scala:989-1017).
  - The attempt is refunded and the job held 1, 2, 4, 8, 15 … min; at the 10th hold in a row it is Failed, keeping the
    provider code. Any committed answer restarts the count through the existing `progressed` flag
    (S/Database.scala:235-246, :997, :735), which every checkpoint, kept answer and acceptance sets (:670, :681, :697).
  - Changes: a classifier next to `Worker.transient` (S/Models.scala:690) and one case before the generic branch (:558);
    `recordedTransient` matching the recorded code (S/Database.scala:1014-1017); the trait (S/Core.scala:365); the flag in
    `IndexingCapacity` (S/Core.scala:60), read at start like `claimOrder`. No migration: `lease_until`,
    `transient_failures`, `error`, `failure_stage` and `attempts` carry everything.
  - Incident 1: nothing charged; a job is held at most 4 times by 09:13, none Failed. Cost: up to 8 min extra delay after
    recovery, one failed call per job per hold.
  - Incident 2: a job fails only after 10 holds in a row with no committed answer, at least 90 min. The lost jobs had
    3-28 windows done; if each attempt committed an answer before its 429, their counts kept restarting and they survive
    (an assumption: per-attempt progress was not read). Our call rate after a 429 also drops (each job waits ≥ 1 min).
  - Limit: a full refusal longer than about 1.5 h fails every job the lanes have touched, possibly the whole queue.
- **D2 = D1 + C:** a multi-hour full refusal costs about 1 job per 1.5-2 h instead of the queue.
- **Smallest design that would have saved both incidents: D1.** For incident 2 this holds under the assumption above, or
  if the refusal stayed partial, or if a full refusal lasted under about 90 min.

**Interplay** (A and D1; C as noted).
- Waiting order and classes: a held row is filtered out (S/ClaimOrder.scala:76), so its lane takes the next job of its
  class, or borrows, and the row returns to its old place when due (spec :135). Known limit D-c (spec :150-152): a job
  that progresses, fails and is held can alternate on the single bulk lane; under D1 it keeps progressing, so it does
  finish. C claims nothing while open.
- Large lane and permit: a failure or hold clears `total_windows` (S/Database.scala:982, :1008). A small lane sizes the
  job again and defers it (refunded, no model call; S/Models.scala:490-491, 499-500), then lane 0 takes it, as after
  `failAt` today. A held large job never blocks lane 0. C pauses lane 0 too.
- Lease reclaim: unchanged. Holds are written only on a valid lease (`validJob`); a lease that ends before the write
  leaves the row as it was (tested in T/TransientPublicationTest.scala:634).
- Restart: a hold survives on the row, and should (a restart does not fix the provider); C's state is lost and re-trips.
- Supersession: a new upload supersedes a held job (S/Database.scala:311); the new head inherits `waiting_since` and
  `bulk` (spec :131) and starts unheld. A hold on an older revision supersedes the job instead (S/Database.scala:995).
- `RetryJob` clears a hold and moves the job to the back of the fresh class (S/Database.scala:295). "Retry failed" takes
  Failed rows only (S/RetryFailedJobs.scala:88-90), never a held job. The page offers Retry only on Failed jobs
  (chronicle/web/src/activity/Jobs.tsx:146).
- Continuations and checkpoints: a hold keeps partials and checkpoints; only supersession and `RetryJob` delete them
  (S/Database.scala:274-277, :297). The ledger and its epoch are unchanged (bound: see B).

## 4. Interface
- Today a held job shows: State "Held", tooltip "Stored state: Queued, with a future attempt time"
  (chronicle/web/src/activity/claim-order.ts:106); Why-not-running "Retrying after HH:MM (back-off)" with sub-line
  "Prior: <error> · rejoins the fresh order at HH:MM" (:143); a Held count per class (Jobs.tsx:231; S/Activity.scala:178);
  and in the older `ActivityJobs` reply Queued, `leaseExpiresAt` = next attempt, `leaseActive` false
  (T/TransientPublicationTest.scala:104-106).
- D1 changes none of this: a provider hold reads "Held · Retrying after 18:42 (back-off) · Prior: model-http · rejoins the
  fresh order at 18:42". Existing replies stay byte-identical; no new field, operation or label. A row Failed at the limit
  keeps the provider code, an existing value.
- Option (decision 4): show the status ("Prior: model-http/429"). That is a new stored value in an existing field, which
  older CLIs print verbatim; it needs the claim-order unit's additivity proof (new operations, existing replies
  byte-identical, old-CLI compat run; claim-order DEPLOYMENT.md:9, :45-46).
- C only: without an indicator a paused worker looks like "Queued · Claimable" jobs. It needs a new read operation (say
  `ActivityIndexingPause`) above the job table. Labels to confirm: "Indexing paused — the model provider is refusing
  requests" · "since HH:MM" · "next probe HH:MM" · "last failure: <code> (<stage>)" · "Indexing resumed HH:MM".

## 5. Configuration and rollout
- **Flag** `indexing.providerBackoff`: boolean, default false, read at start; a wrong type is a named start failure like
  the other indexing keys (S/Core.scala:84-90). Off means exactly today's behaviour: the new case never matches.
- **Parameters** (code constants like `transientBackoff`, S/Database.scala:269): 60 s × 2 capped at 15 min, Failed at the
  10th hold in a row: the existing database hold's values (S/Database.scala:268). 10 holds take ≥ 90 min, covering
  both incidents, and 10 equals the window ledger, so the hold limit comes first when nothing else used the window.
  Tests inject a shorter schedule through the Worker constructor, as `FailureBackoff` is
  (S/plugins/ChroniclePlugin.scala:35-40). C: K = annotationSessions; pauses 1, 2, 4, 8, 15 min. **Migration:** none.
- **Deploy**, staged like the claim order: stage 0 flag off (one restart, no behaviour change), stage 1 flag on (one
  restart). Rollback: flag off and a restart; held rows come due within 15 min and refunded attempts stay refunded. Base:
  main (a2eae616) carries another session's commits beyond production 1878c823 (STATE.md:1135); decide at deployment.
- **Readable facts:** provider-held rows (Queued, `lease_until` > now(), a provider code) per class; `attempts` flat while
  `transient_failures` rises during an outage; Failed at the limit = a provider code with `transient_failures` = 10 and
  attempts < 5; log lines "job held jobId=… code=model-http … consecutive=k nextAttemptAt=…" (format of
  S/Models.scala:592-597) plus `httpStatus`; the Activity Held counts.
- **Not observable:** which 429s our own rate caused; whether an annotation timeout was content; the counterfactual; a
  job's per-attempt progress (no history table).

## 6. Tests the build would need
PostgreSQL-backed, with a stub HTTP server for transport; time controlled through the `due()` fixture or a short schedule
passed through the constructor, as T/TransientPublicationTest.scala:93-120 does.
- **PB-off:** flag off, a 429 at Annotation gives today's row (charged, claimable at once); all existing suites run
  unchanged at the default, which proves off equals today.
- **PB-hold:** flag on; a 429 at Annotation (stub server) and a timeout at Embedding each give Queued, attempt refunded,
  `error`/`failure_stage` set, count 1, `lease_until` within (base − 5 s, base]; refused while held, claimed once due,
  partials and checkpoints kept, expected log line.
- **PB-classify:** status × stage (400, 401, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504, 529; timeout; transport;
  embedding output) gives hold or charge as decided. **PB-limit:** the 10th hold fails the job with the provider code,
  attempts unchanged; `RetryJob` restarts it. **PB-progress:** accept a window, then a 429: count 1.
- **PB-ledger:** a window with r rejections, then provider failures, ends with the code of decision 3. **PB-order:** a
  held oldest job does not block its lane and, once due, is claimed before younger ones; a held large job does not block
  lane 0.
- **PB-supersede/retry/restart:** an upload supersedes a held job and the successor is unheld; `RetryJob` clears the hold;
  retry-failed skips held jobs; a new Worker or archive keeps the hold. **PB-fence:** a lease ending between read and
  write writes nothing. **PB-default:** production schedule, limit and flag default (false), asserted separately.
- **Web:** a unit case "Held … Prior: model-http" in the claim-order tests. **C:** trips after K provider failures in a
  row, not on content failures; a success resets it; no claims while open; one probe per pause; closes on success or a
  non-provider outcome; restart starts closed; pauses injected.
- **Existing suites that pin today's behaviour** stay valid with the flag off and gain flag-on variants:
  T/ContextWorkerRecoveryTest.scala:105, :113, :146, :209 (a model-timeout once, then re-claimed at once);
  T/PassageWorkerTest.scala:204; T/AnnotationContinuationTest.scala:856; T/ClaimOrderColumnsTest.scala:240-257 (failure to
  Queued keeps the order values; add "provider hold"); T/TransientPublicationTest.scala (the hold being generalised).
  No skips. Gate: `scripts/verify chronicle`.

## 7. Decisions for the owner
1. **Build what now?** (a) D1, hold and refund: saves both incidents; a full refusal over about 1.5 h still fails the jobs
   it touches. (b) D1 + C: also survives multi-hour refusals (about 1 job lost per 1.5-2 h), for about double the work and
   a new page indicator. (c) A only, hold but charged: jobs still die in a 35-min burst.
   **Recommended (a) now, C as its own unit if a long full refusal is seen:** the smallest change that saves both
   incidents, with no schema and no page change.
2. **Which failures are provider-side (held, refunded)?** (a) Narrow: 429, 502, 503, 504, 529, transport, Embedding
   timeouts. (b) Broad: (a) plus 500, 408, 401/403/404 and annotation timeouts; a content-caused 500 or timeout is then
   retried 10 times over at least 90 min instead of 5 at once. (c) (a) plus annotation timeouts held but still charged.
   **Recommended (a):** it covers both incidents, and the ambiguous codes keep today's behaviour.
3. **Limit and ledger?** (a) Fail at the 10th hold in a row (≥ 90 min), ledger kept; a window with earlier rejections may
   end `annotation-reservations-exhausted` first. (b) As (a), but a provider failure that finds the window ledger full
   records the provider code (a small change). (c) A limit of 26 (≥ 5.5 h), which helps Embedding failures only.
   **Recommended (b):** the failure is named for its cause, and the bound is unchanged.
4. **What does a held or Failed row say?** (a) The provider code (`model-http`), existing labels: no page or reply change.
   (b) The stored status (`model-http/429`): a new value in an existing field, needing an additivity proof. (c) A new code
   `provider-unavailable` at the limit: a new label. **Recommended (a):** the status is in the log line.
5. **Count provider holds in `transient_failures` with database holds?** (a) Yes: one "not the job's fault" streak, no
   migration. (b) No: a separate column (migration 034, down script, column tests).
   **Recommended (a):** both reset on progress, and neither is the job's fault.
6. **Manual `RetryJob` of a held job?** (a) Keep today's effect: hold cleared, back of the fresh class. (b) Clear the hold
   but keep its place: changes S/Database.scala:295 for every retry. (c) Refuse retry while held.
   **Recommended (a):** nothing existing changes, and D1 makes Q168-style manual retries unnecessary.
7. **Rollout?** (a) Staged: flag off first, then on with one restart, after `scripts/verify chronicle` and an ON/OFF
   acceptance run like the claim order's. (b) Flag on at the first deploy. Either way, decide the deployment base
   (STATE.md:1135). **Recommended (a):** the proven pattern, and OFF can be compared with today.

## 8. Risks, what I did not verify, effort
- **Not verified:** whether the incident-2 jobs committed answers between their 429s (no per-attempt history); how long
  the burst ran after 18:30Z; the configured model deadlines; whether 429 calls are billed; whether production runs one
  Chronicle process (C is per process); the incident numbers (from the notes, not from logs or SQL I read).
- **Risks of D1:** a misclassified content failure is retried 10 times over ≥ 90 min, so the A5 watch sees fewer, later
  failures; under full refusal every queued job gets one failed call per hold (a lower steady rate than today's hot loop,
  but more jobs touched); held rows look idle ("Retrying after" explains them); the ledger edge case (decision 3).
- **Risks of C:** false trips pause all indexing up to 15 min; the probe always lands on the oldest job; without the
  indicator the pause is invisible.
- **Effort** (unit = one focused agent task with its review loop): D1 about 3 units (code 1, tests 1.5, verify and review
  0.5); C on top about 3-4 (breaker 1, controlled-clock tests 1.5, indicator with labels and additivity proof 1-1.5);
  rollout 1 per stage.
