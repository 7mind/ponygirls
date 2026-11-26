# Chronicle indexing: back-off after model-provider failures — design note, REVISION 2 (DRAFT, nothing built)

Rev 1 2026-11-26 18:45Z; rev 2 ~19:30Z after review 1 (reports/backoff/REVIEW-1.md) and the 19:00Z production
measurements quoted there. Base `main` a2eae616; design only (no code, tests or production access). `S/` =
`chronicle/server/src/main/scala/chronicle/`, `T/` = `chronicle/server/src/test/scala/chronicle/`, `MH` =
`shared/model-http/src/main/scala/ponygirls/retrieval/ModelHttp.scala`, `AUTH/` =
`shared/service-auth/src/main/scala/ponygirls/auth/`. Code references read in this tree; incident facts cited from the
notes (retry-all REPORT.md, retry-followup ALERTS.txt, STATE.md, REVIEW-1.md).

## 0. In short (what changed in revision 2)
- **A per-job hold is not a queue bound.** D1 protects each job's attempts, but the claim filters held rows out
  (S/ClaimOrder.scala:76). The lanes simply go on to new jobs at about today's call rate, and new uploads create
  successors that are not held (S/Database.scala:311-318). A queue-wide bound needs a gate on new claims.
- **New recommendation for decision 1:** D1 plus a minimal admission gate per upstream (§3.4). **Also changed:** only
  explicit refusals are refunded (§2); decisions 3-6 are restated; §6 covers what the owner can do tonight without a
  code change; §10 gives the disposition of review findings 1-9.
- **Confirmed:** `failAt` (S/Database.scala:968-984) re-queues a failed job at once, charged, `waiting_since` kept; the
  lane sleeps 2 s (S/Models.scala:569, :679). Measured: 7fc785e8 spent five attempts in 62 s on one window.

## 1. Current behaviour, traced (corrected per review finding 8)
**Per call: no retry.** A non-2xx answer raises `model-http` "model returned HTTP n" (MH:67). The deadline raises
`model-timeout` (MH:73); it covers the whole call, including reading and decoding (MH:66-73). Any other error raises
`model-transport` (MH:76), including read failures after the response has started. `Retry-After` is never read, and
Chronicle re-raises the code unchanged (S/Models.scala:83-88). The status survives only in the error text, which the log
parses (S/Models.scala:137-139); the row keeps the code alone (S/Database.scala:982).

**Per attempt.**
- **Ledger rows.** Annotation reserves a window-ledger row before each dispatch (S/Models.scala:80;
  S/AnnotationAttempts.scala:92-95). The row holds job, run, epoch, window, attempt, input hash and fence
  (chronicle/migrations/015_annotation_attempts.sql:2-11), plus a rejection reason, kept hash or acceptance
  (S/AnnotationAttempts.scala:118-152). It records no time, no status and no "answered" flag.
- **Rejections.** A rejection re-asks within the same attempt (S/Models.scala:234-240, 292-294, 311-317); the 5th ends
  the job `annotation-attempts-exhausted`.
- **Ledger full.** A window has 10 rows per epoch (S/AnnotationAttempts.scala:36-37). When they are full, the next
  reservation is refused before dispatch and the job ends `annotation-reservations-exhausted` (:81, :109;
  S/Models.scala:216-217).
- **Other errors** end the attempt (S/Models.scala:241, :295, :343).
- **Reuse.** Accepted work is reused, and reuse records no progress (S/Models.scala:174-181; S/Database.scala:699-704).
  Publication calls no model (S/Models.scala:346-347).
- **Charging.** Every claim charges one attempt, except the reclaim of a policy-invalidated claim
  (S/ClaimOrder.scala:192; S/Database.scala:558). Only jobs with attempts < 5 are claimable (S/Database.scala:284-285).

| code | charged | row afterwards | next |
|---|---|---|---|
| `model-http` (any), `model-timeout`, `model-transport`, embedding `model-output`, `worker-fault`, `invalid` | yes | `failAt`: Queued, `lease_until` NULL, `error`=code, `failure_stage`, `transient_failures`=0; fence/`waiting_since`/`bulk` kept; Failed at attempts ≥ 5 (S/Database.scala:982) | eligible at once, still oldest of its class; lane kind, size and locks decide which job a lane takes next |
| `annotation-*-exhausted`, `-input-changed`, `index-budget-exceeded` | — | Failed whatever the attempts (:969, :982) | retry only |
| `database-transient`, leftover staging (S/Models.scala:690-693) | refunded | HELD: Queued until `lease_until`, `transient_failures`+1, Failed at the 10th (S/Database.scala:1003-1009); the count restarts when progress is recorded at renewal or at the hold (:735, :997) | at `lease_until` |
| `stale-claim` | yes | authority lost (lease ended, fence/run changed): no write (`validJob`, :588-590); owner no longer admits the claim: parked, refunded (:971-977); live lease but newer head (prefix check, :608-611): superseded, or at attempts ≥ 5 Failed `stale-claim` (:978-982) | per row |
| lease end | at reclaim | Running, lease ended; `lease-exhausted` at attempts ≥ 5 (:540-545) | waiting order: any lane; source-id: a recorded large job needs the permit (:546-553) |
| record failed (DB down) | yes | keeps its lease (S/Models.scala:603-607); `internal`/`config`/`model-telemetry-invariant` instead stop the worker (:557, :675) | after lease |

**Holds today.**
- Large-job deferral is not a hold: it sets `total_windows` and leaves `lease_until` NULL (S/Database.scala:719-729).
- `Jobs.claimable` excludes Queued rows with a future `lease_until` (S/Database.scala:284-285). Both claim orders apply
  it as a filter (S/ClaimOrder.scala:76; S/Database.scala:551), so a held head is skipped, not waited for.
- A hold keeps `waiting_since`/`bulk` (claim-order spec docs/drafts/20261124-2138-indexing-claim-order-spec.md:135) and
  survives a restart (chronicle/migrations/001.sql:19-21 touches only older revisions); a restart reclaims Running
  claims after their lease and charges them once more.

## 2. Failure classes (proposed default for decision 2; finding 7)
- **Held and refunded** (an explicit "not now"): `model-http` 429, 503, 529.
- **Held but charged** (ambiguous): `model-http` 500, 502, 504, 408; `model-timeout`, whose deadline also covers
  processing the response (MH:66-73); `model-transport`, which also covers read failures (MH:76). Any of these can be
  the infrastructure. They can also be one request that is slow or breaks the server: a window may ask for up to 65,536
  response tokens (S/Models.scala:102).
- **Unchanged** (charged at once): other 4xx, `model-output`, terminal codes. 401/403/404 are configuration errors, not
  transient refusals. They stay charged and get a distinct "configuration-like status" log line for alerting.
- **Limits.** Known: status, stage (S/Models.scala:160, :555). Unknown: connect vs slow; our rate vs others'.

## 3. Options and their exposure
Rates use the measured attempt: about 14 s to fail plus about 2 s to be re-claimed. With 4 lanes (lane 0 large, 1 bulk,
2 fresh; REPORT.md:33) that is about 15 attempts/min, so a FULL refusal gives about 900 failed calls/h. **3.1 Today:**
about 180 jobs lost/h, each within about a minute, the oldest first.

**3.2 A — hold, still charged.** `failAt` also sets `lease_until` = now + d(attempts), d = 1, 2, 4, 8 min. Changes:
S/Database.scala:982 and classification at S/Models.scala:556-569; no schema change. Same call rate, because the lanes
move on. A job's 5 charges spread over ≥ 15 min; after that, losses run at about today's rate.

**3.3 D1 — hold and refund,** through `holdTransient` (S/Database.scala:989-1017), generalised to a code and a schedule.
- **Schedule.** Refunded classes are held 1, 2, 4, 8, then 15 min. Held-but-charged classes get the same hold but keep
  the charge. A job is Failed at the 10th hold in a row, keeping its provider code. A checkpoint, kept answer or
  acceptance (S/Database.scala:670, :681, :697) restarts the count when recorded at renewal or at the hold (:735, :997).
  Replay does not.
- **Fenced semantics (finding 6).** When the owner no longer admits the claim, `holdTransient` returns Ended
  (S/Database.scala:579-580, :989-993), while `failAt` parks the job refunded (:971-977). D1 must park. Renewal has
  stopped before the record runs (`IO.race`, S/Models.scala:554). The record is retried only until near the lease end
  (:583-590). A record that never commits leaves the claim's charge. The job is reclaimed after the lease (one more
  charge) or ends `lease-exhausted` (S/Database.scala:540-545), as a database hold does today.
- **Changes.** A classifier next to `Worker.transient` (S/Models.scala:690) and a case before the generic branch (:558);
  `recordedTransient` matched by code (S/Database.scala:1014-1017); the trait (S/Core.scala:365); the setting (§5). No
  migration under decision 5(b).
- **Exposure.** Ten holds in a row take ≥ 90 min (nine waits). That is one job's streak, not an outage threshold. Under
  a sustained full refusal, losses approach failures ÷ 10, about 90 jobs/h once streaks mature. Windows with a partly
  full ledger go earlier. The call rate stays near today's: held rows are skipped, and new jobs are claimed, including
  the unheld successors of superseded ones.

**3.4 Gate — D1 plus a minimal admission gate per upstream (recommended).**
- **State.** Memory only, in a small class built with `Worker` (S/Models.scala:122-124). There are two independent
  gates, annotation and embedding; a failure's stage names its upstream.
- **Trip.** K = 4 provider-class failures (§2, refunded or charged) from one upstream, with no positive signal from it
  in between. A positive signal is any 2xx from that upstream to an indexing call. For annotation that is an answer
  delivered, even one rejected afterwards (S/Models.scala:220-226, :234, :292); for embedding, a returned part
  (:333-335). The other upstream never counts.
- **While tripped.** No lane starts a claim except the single probe. The check sits before the claim in
  `laneIteration`/`iteration` (S/Models.scala:612-634) and before `admission.largeJob` (:613), so a waiting lane holds
  no permit. Lane 0 of the waiting order keeps its lifetime permit (S/Models.scala:636) and may take the probe token, so
  a sized large job can be the probe. Claims already in flight run on: their failures are held (D1) and their 2xx
  answers count. At most L − 1 failures can follow a trip.
- **Probe.** One token per process. After a pause of 1, 2, 4, 8, then 15 min, the first lane to wake takes it and claims
  normally. Only a 2xx from the tripped upstream reopens the gate, whether from the probe or from an in-flight claim. A
  provider-class failure from that upstream returns the token and doubles the pause. A probe that never calls that
  upstream is neutral: it releases the token and leaves the pause unchanged. Examples: a deferral
  (S/Models.scala:490-500), a refused reservation (:216-217), a content failure, an attempt that only reuses.
- **Restart and processes.** A restart opens both gates (at most K + L − 1 failures until they trip again; nothing needs
  to persist). The gate is per process, so the bound multiplies with the processes; whether two Chronicle processes ever
  overlap, even in a rollout, is not verified.
- **Bound under a full refusal.** At most K + (L − 1) failures at the trip, then one per pause: about 14 in the first
  hour and at most 4/h after that, against about 900/h today. Jobs lost are at most the number of failures, in the worst
  case where each failure completes a job's ledger or streak; usually far fewer. Probes favour the oldest unheld job.
- **No page or reply change is needed.** Log lines carry upstream, stage, status and counts: "indexing claims paused
  upstream=… failures=K pauseSeconds=…", "indexing probe started upstream=… jobId=…", "indexing claims resumed
  upstream=…". Optional later indicator (labels to confirm): "Indexing paused — the <annotation|embedding> model is
  refusing requests" · "since HH:MM" · "next probe HH:MM" · "last failure: <code> <status>" · "Indexing resumed HH:MM".

**3.5 Lane cool-down — the smallest variant that still bounds (option c).** After a provider-class failure, the lane
sleeps 1, 2, 4, 8, then 15 min instead of 2 s (S/Models.scala:569). Its level resets only when one of its later attempts
gets a 2xx from the upstream that failed. One counter per lane, in memory. Bound: at most L failures per pause, about 32
in the first hour and at most 16/h after: four times looser than the gate. No single probe, and it needs D1: without it
the head job's attempts still burn across lanes.

**3.6 Incident 1** (embedding pod not Ready, 09:02-09:13Z; qualified per finding 4).
- The report establishes the end state, five jobs at five charged `model-timeout` attempts (REPORT.md:30-32, :52-56),
  not that all 25 failures fell inside those 11 min.
- Default classes (embedding timeouts held but charged). A or D1: at most 4 failures per touched job by 09:13 (an upper
  bound, if every record commits); one earlier charge makes the 4th terminal, and the lanes spread charges over more
  jobs. Gate: it trips after about 4 failures (≤ 3 more in flight), probes at about +1, +2, +4 min, and the first probe
  after 09:12:42 reopens it: about 10 charged failures over the oldest unheld jobs. With decision 2(b) (embedding
  timeouts refunded) D1 alone avoids the charges.

**3.7 Incident 2 with the measured numbers** (throttling at about half pace, 17:50-19:00Z).

Measured: 429s per 10 min from 17:50 were 10, 7, 0, 31, 28, 17, 6, plus 529 ×6, 504 ×1 and 502 ×1. Windows were still
accepted at 2-7 per 10 min. 14 jobs Failed in about an hour (9 fresh, 5 cohort including a 195-window large job), all at
Annotation. 7fc785e8 failed at 17:57:54, :58:10, :58:24, :58:40 and :58:56; 191d630e failed five times from 18:23:20 to
18:25:28. Today each lost job burnt its 5 attempts in 1-2 min inside one 429 cluster.

By option:
- **A.** 7fc785e8 would retry at about 17:59, 18:01, 18:05 and 18:14. The last is in 18:10-18:20, which had no 429s, so
  it probably survives on its 5th attempt. 191d630e's retries (about 18:24, 18:26, 18:31, 18:39) all fall in the two
  densest periods, with 31 and 28 429s, so it is probably lost. Fewer than 14 lost but not zero, at an unchanged call
  rate.
- **D1.** No job reaches 10 consecutive 429s in a 63-min burst, because the 10th comes at least 90 min after the first.
  What is still lost is any job whose failing window already held r rows this epoch (rejections, kept answers,
  unanswered calls). A job first failing after 18:20 collects up to about 6 provider rows before 19:00 (about :20, :21,
  :23, :27, :35, :50). With r ≥ 4, its next reservation is refused and it ends `annotation-reservations-exhausted`.
  Example: 4 kept answers and 1 unanswered call leave 5 rows, which fill after about 30 min of waits. r for the 14
  windows is unknown: the ledger was not read, and it has no times. The 429 count does not fall, more jobs are touched,
  and held jobs finish up to 15 min after the burst.
- **D1 + gate.** In the dense clusters (18:20-18:50), four annotation 429s with no 2xx in between pause new claims until
  a 2xx arrives. That means fewer of our calls, fewer ledger rows used and fewer ledger-fill losses. Throughput may drop
  below half pace unless our own rate drives the throttle; the data cannot tell. No option guarantees survival. A
  partial refusal, or a burst under 90 min, removes only the streak path.

**3.8 Interplay (D1 and the gate).**
- **Order.** A held row is skipped (S/ClaimOrder.scala:76) and returns to its old place (spec :135); the D-c limit still
  applies (spec :150-152).
- **Large jobs.** A hold clears `total_windows` (S/Database.scala:1008), so the job is sized and deferred again
  (refunded, no call; S/Models.scala:490-500) before lane 0 takes it.
- **Uploads.** An upload supersedes a held job (S/Database.scala:311). The successor inherits age and class (:318) but
  not the hold, and starts with a fresh ledger and 0 attempts. The gate covers it; D1 alone does not.
- **Retries, checkpoints.** `RetryJob` clears the hold, count, epoch and partials (S/Database.scala:295-297).
  Retry-failed touches only Failed rows (S/RetryFailedJobs.scala:88-90). Checkpoints and partials survive a hold; only
  supersession and retry delete them (S/Database.scala:274-277, :297).

## 4. Interface (finding 9)
- **When Held shows.** Only when the job is current, its owner's indexing is on and its profile is run; those other
  reasons take precedence (S/Activity.scala:99-112).
- **Text.** Today: "Held" (chronicle/web/src/activity/claim-order.ts:106), "Retrying after HH:MM (back-off)", "Prior:
  <error> · rejoins <queue> at HH:MM", where `<queue>` follows the class: bulk, fresh or claim order (:121-122, :143).
  "Retrying after" over-promises: the job only becomes eligible, and a large job must first be sized and deferred again.
  Proposed (decision 4): "Eligible after HH:MM (back-off)" and "Prior: <error> · then joins <queue>".
- **Compatibility.** Schemas do not change, but values do: Queued with a future lease, refunded attempts. `error` is
  optional text (cli/src/schema-data.ts:832-834; S/Activity.scala:478), so the claim is not byte-identity. Acceptance:
  an older CLI (fe4f69f7) decodes `jobs` replies over real provider-held rows, setting off and on. The gate changes no
  reply (§3.4).

## 5. Configuration and rollout
- **Setting.** `indexing.providerBackoff` = `off` (default, exactly today) | `hold` (D1) | `gated` (D1 + gate). It is
  read at start; a wrong value is a named start failure, like the other indexing keys (S/Core.scala:84-90). Constants:
  the database hold's 60 s doubling, 15-min cap and limit 10 (S/Database.scala:268-269); K = 4. Tests inject short
  values through the Worker constructor, as `FailureBackoff` is (S/plugins/ChroniclePlugin.scala:35-40).
- **Switching off while rows are held.** Held rows wait out `lease_until` (≤ 15 min). After that, today's rules apply: a
  provider failure is charged and `failAt` resets the count (S/Database.scala:982). Refunded attempts and spent ledger
  rows stay. Under 5(b) a later database hold starts at 1; under 5(a) it would inherit the provider count.
- **Staging.** Stage 0 `off`, stage 1 `gated`. Each restart interrupts the claims in flight; reclaiming them charges up
  to L jobs once more (S/ClaimOrder.scala:192). The base is decided at deployment: main carries another session's
  commits beyond production 1878c823 (STATE.md:1135).
- **Readable:** held rows per class (Queued, `lease_until` > now(), a provider code); `attempts` flat while
  `transient_failures` rises; Failed rows with a provider code and attempts < 5; the hold and gate log lines. **Not
  readable:** whether our own rate caused the 429s, and per-attempt progress: the ledger and the checkpoints carry no
  times (chronicle/migrations/010_index_checkpoints.sql:6-15).

## 6. What the owner can do tonight without any change (facts; unverified parts marked)
**Per-owner indexing switch.**
- **What it is.** Each (service, owner) row holds `user_choice`, `admin_override` and `epoch`
  (AUTH/IndexingPreferences.scala:40-43). The override wins over the choice, and the choice over the default
  (AUTH/IndexingPolicy.scala:13-14). Changing whether indexing is enabled increments the epoch
  (AUTH/IndexingPreferences.scala:104-111).
- **Who can change it, and where.** The owner: POST `/api/account/v1/indexing {choice}` (AUTH/IndexingAccount.scala:8-9;
  S/Http.scala:150-152, :534). In the shared account UI this is the `set-indexing` control
  (shared/account-web/account-client.js:143, :440). It works only if the policy permits opt-out and no admin override is
  set (AUTH/ImperativeAccounts.scala:410-418; AUTH/IndexingPolicy.scala:17-18). An admin, for any user: POST
  `/api/account/v1/admin/indexing {userId, override, currentPassword}`, with a fresh password proof
  (AUTH/ImperativeAccounts.scala:436-447; account-client.js:145, :441). The Chronicle CLI has no command for it
  (chronicle/cli/src/commands.ts).
- **The owner's Queued jobs** are not claimed: the claim takes only owners who allow indexing
  (S/ClaimOrder.scala:122-123; S/Database.scala:533). Activity shows "Indexing off" (S/Activity.scala:102).
- **The owner's Running jobs** fail their next authority check: renewal (every 30 s), dispatch authorisation or a
  checkpoint write (S/Database.scala:579-580, :601-605). `failAt` then parks them: Queued, attempt refunded, fence+1,
  `waiting_since` kept (:971-977). A call in flight is wasted: cancelled when a failed renewal wins the race
  (S/Models.scala:554), or its answer cannot be checkpointed; at Annotation its ledger row stays unanswered.
- **Other owners** are unaffected. The freed lanes run their jobs, which then meet the same 429s, so stopping the burn
  means switching off every owner with queued work.
- **Switching back.** Clear the choice or the override; the epoch increments again. Parked jobs return with their
  refunded attempts and their places: T/ClaimOrderColumnsTest.scala:240 asserts that preference and override changes
  keep the order values. Retries are refused while indexing is off (S/RetryFailedJobs.scala:60, :73;
  S/Database.scala:290).
- **Not verified:** the production policy (default, opt-out), which owners have queued jobs, the UI on this host.

**`indexing.annotationSessions`.** Default 4 (S/Core.scala:83), range 1-8 (:62); the waiting order needs L ≥ 3 and
`bulkLanes` ≤ L − 2 (:67-69). It sets the number of lanes (S/Models.scala:656-657) and the concurrent annotation calls
(S/ModelAdmission.scala:20-21). It is read at start, so changing it needs a restart, and that restart charges the claims
in flight once more. Per-job burn does not depend on it: a failed job is eligible at once, and even a single lane
re-claims it after 2 s. Fewer lanes mean fewer concurrent calls and fewer jobs exposed at a time; whether that lowers
the 429 rate is unknown.

## 7. Tests the build would need
All tests are PostgreSQL-backed with a stub HTTP upstream. Per AGENTS.md: inject short intervals or use a controlled
clock, assert the production defaults separately, and never lengthen a timeout. `due()` tests filtering, not elapsed
time.
- **Off.** A 429 gives today's row; existing suites pass unchanged.
- **Hold rows.** In both annotation modes and both claim orders, a 429 at Annotation and a 504 or timeout at Embedding
  each give the right class (refund or charge), with `lease_until` in (interval − 5 s, interval]. The job is refused
  while held and claimed when due, keeps its partials and checkpoints, and logs status and stage.
- **Classification.** The §2 status × stage table. 401/403/404 are charged and get the configuration line.
- **Streak.** The 10th hold in a row fails the job with the provider code. A recorded checkpoint restarts the count;
  reuse or replay does not. Under 5(b), a database hold after a provider hold starts at 1.
- **Ledger.** A provider failure on the 10th reservation is handled per decision 3; include r earlier rows; both modes.
- **Fenced record (finding 6).** A denied write; a lost commit acknowledgement (exactly one refund); a policy change
  before the record (parked, not Ended); the lease ending before the record, then reclaim and `lease-exhausted` at the
  limit; an upload over a held job (the successor is unheld).
- **Gate** (injected pauses). It trips at K failures from one upstream, not on content failures. The other upstream's
  2xx does not reopen it; the tripped upstream's 2xx does. There is one token at a time, and neutral probes (deferral,
  refused reservation) release it. Claims in flight continue; lane 0 can probe with a large job; a restart opens it.
- **Off after on.** Switch off with real held rows and spent reservations, restart, and compare with an all-off
  baseline.
- **Retry, web, CLI.** `RetryJob` clears a hold, and retry-failed skips held jobs. The web shows the decision-4 labels.
  An older CLI decodes provider-held rows.
- **Existing suites** stay valid with the setting off and gain variants with it on:
  T/ContextWorkerRecoveryTest.scala:105, :113, :146, :209; T/PassageWorkerTest.scala:204;
  T/AnnotationContinuationTest.scala:856; T/ClaimOrderColumnsTest.scala:240-257; T/TransientPublicationTest.scala. Gate
  for the build: `scripts/verify chronicle`.

## 8. Decisions for the owner
1. **What to build now?** (a) D1 alone. No job dies of a streak, but the queue keeps today's call rate. Under sustained
   refusal losses approach about 90 jobs/h, and ledger fills still lose jobs. (b) D1 plus the per-upstream gate.
   Provider failures are bounded to about 14 in the first hour and at most 4/h after that, with no page change, for
   about 2.5 more units. (c) D1 plus a lane cool-down. A looser bound (about 32, then at most 16/h) for about 1.5 units.
   **Recommended: (b).** It is the only option that bounds the queue and reopens on evidence from the right upstream. D1
   alone does not reduce our call rate during the throttling we see.
2. **Classes.** (a) Refund 429/503/529. Hold but charge 500/502/504/408, timeouts and transport errors. Leave the rest
   unchanged, plus an alert line for 401/403/404. (b) As (a), but also refund embedding timeouts and transport errors.
   This saves incident 1 without the gate, but a slow batch gets 10 tries. (c) Refund 429 only. **Recommended: (a).**
   Ambiguous codes keep their charge, and the gate bounds them.
3. **Window ledger.** A row names job, run, epoch, window, attempt, fence and rejected/kept/accepted; not when, which
   status, or why it is unanswered. (a) Keep `annotation-reservations-exhausted` as today. (b) When a classified
   provider failure used the window's 10th reservation (the worker knows the attempt number at that moment,
   S/Models.scala:201, :219-226), record Failed with the provider code at once, in the same fenced record. (c) Hold, and
   let the next claim end the job `reservations-exhausted` without a call. **Recommended: (b).** It names the event that
   filled the window. Test it in both annotation modes.
4. **Labels.** (a) Keep today's strings. (b) "Eligible after HH:MM (back-off)" and "Prior: <error> · then joins
   <queue>", for all holds including database holds. (c) As (b), and also store the HTTP status in `error`, which needs
   a compatibility proof. **Recommended: (b).** Two strings, and they stop promising a retry.
5. **Provider streak and database streak.** (a) Share `transient_failures`. Mixed failures share one budget, and after
   switch-off a database fault inherits the provider count. (b) Same column, counted per kind: a hold of the other kind
   (read from the row's `error`) restarts the count at 1. This keeps today's database semantics, since any charged
   failure already resets the count (S/Database.scala:982). No migration. Alternating kinds are then bounded only by the
   ledger and the gate. (c) A separate `provider_failures` column: migration 034, a down script, column tests. Each
   streak is bounded independently; both reset on progress, a charge, a retry or a rebuild. **Recommended: (b);** (c) if
   each streak needs its own bound.
6. **Manual `RetryJob` on a held job.** It is an explicit override: it clears the hold, count, epoch (a new ledger
   budget) and partials, and moves the job to the back of the fresh class (S/Database.scala:295-297). (a) Keep it as is.
   (b) Keep the job's place, for held rows only. (c) Refuse it while the job is held. **Recommended: (a):** a deliberate
   operator act, needed less under D1 but still needed.
7. **Rollout.** (a) Staged: `off`, then `gated`, after `scripts/verify chronicle`, older-CLI decoding on held rows and
   the off-after-on test, counting what each restart charges to claims in flight. (b) `gated` at the first deploy.
   Either way, decide the base (STATE.md:1135). **Recommended: (a).** It follows the claim-order pattern.

## 9. Risks, not verified, effort
- **Not verified:** the ledger rows per window and the per-attempt progress for the 14 lost jobs; the deadlines; whether
  429 responses are billed; the number of Chronicle processes; the production indexing policy; whether our own call rate
  drives the throttle; the incident numbers, which come from the notes and REVIEW-1, not from logs or SQL I read.
- **Risks:** the gate pauses new claims during refusal clusters, which costs throughput; gate state is per process and
  lost at restart; a misclassified content failure gets up to 10 tries over at least 90 min; alternating failure kinds
  under 5(b).
- **Effort** (unit = one agent task with review): D1 ~3 (with finding-6 cases); gate ~2.5; cool-down ~1.5; labels 0.5;
  5(c) +0.5; rollout 1 per stage.

## 10. Review 1 — disposition
| # | verdict | reason (lines read) | changed in |
|---|---|---|---|
| 1 | accepted | holds are filtered (S/ClaimOrder.scala:76); successors start unheld (S/Database.scala:311-318); 90 min is one job's streak | §0, §3.3-3.4, dec. 1 |
| 2 | accepted | the other upstream's answers, deferrals (S/Models.scala:490-500) and refused reservations (:216-217) could close rev 1's C; C-alone and one-job estimates removed | §3.4 |
| 3 | accepted | a full ledger refuses the next reservation before dispatch; rows carry no status (015:2-11); 3(b) tied to the reservation that filled the window | dec. 3 |
| 4 | accepted | the report gives end states; alerts are sampling times; ledger fill can end a job about 30 min in | §3.6, §3.7 |
| 5 | accepted | a shared count crosses kinds (S/Database.scala:997-1009) and survives switch-off | §5, dec. 5 |
| 6 | accepted | Ended vs parked (S/Database.scala:971-977 vs :989-993); record loop (S/Models.scala:554, :583-590) | §3.3, §7 |
| 7 | accepted | transport/timeout also cover reading and processing the response (MH:66-76) | §2, dec. 2 |
| 8 | accepted | eligible ≠ claimed; invalidated reclaim free (S/ClaimOrder.scala:192); source-id permit (S/Database.scala:546-553); live stale-claim (:978-982) | §1 |
| 9 | partly | accepted: precedence (S/Activity.scala:99-112), "eligible after", decoding proof, retry as override, off-after-on, `due()`; rejected "wrong for bulk": the page is class-aware (claim-order.ts:121-122); only rev 1's hard-coded "fresh" was wrong | §4, §7, dec. 4/6/7 |
