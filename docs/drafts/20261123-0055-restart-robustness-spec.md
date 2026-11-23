# Restart robustness: Chronicle, Haystack, Manure (R-a, R-b, R-c summary, R-d) — r4

Status: r4 (2026-11-23 ≈02:10Z) after reviews r1 (B1–B9, A1–A2), r2 (N1–N5, A1–A2) and r3 (P1–P3, a–d) and the orchestrator's decisions
D1–D5 (ORCH-REPLY 0118Z); mapping in `reports/robust/SPEC/report.md` "r2/r3/r4 changes". Base ponygirls `main`
dca197e2 (`chronicle/ haystack/ manure/ shared/` identical to production d30a6ff5); all `path:line` refer to it. Probes P1–P20 ran on PostgreSQL 18.7,
pgjdbc 42.7.14, HikariCP 7.1.0, GraalVM CE 25.5.5 JDK; scripts, outputs and source excerpts in
`.local/overhaul-20261117/reports/robust/SPEC/evidence/` (README there). Landing order on one branch: SMALL (R-c, R-b,
R-a) → OPS (R-f) → ANNOT (R-g) → POOL (R-d); R-f and R-g are specified elsewhere.

## 1. Mechanisms confirmed in code

**Shared runtime.** `JdbcTransactionEngine.transaction` (shared/service-runtime/src/main/scala/ponygirls/runtime/
JdbcTransactionEngine.scala:22-51) opens one DriverManager connection per transaction (`connect()` :79-90; password file
read per open :84; connect/login/socket timeouts in whole seconds rounded up, `tcpKeepAlive` :80-88), runs `configure()`
(:64-77: one autocommit `set_config(name, least(current,bound), false)` over `pg_settings` for statement/lock/idle
timeouts, tighten-only), then `setAutoCommit(false)`, callback, commit/rollback; every `SQLException` becomes
`JdbcFailure("database-unavailable", sqlState)` (:49,:58-62; JdbcDatabase.scala:10). Facades: `JdbcDatabase`
(JdbcDatabase.scala:16-27, async `Admission`, Admission.scala:22-58) and `BlockingJdbcDatabase` (BlockingJdbcDatabase.
scala:10-53, fair semaphore; `admission-full|admission-timeout|runtime-closed`). `JdbcLimits` (JdbcConfig.scala:9-26: 8
required fields) is parsed by each service: Chronicle Core.scala:191-200, Haystack Config.scala:55-57, Manure
Config.scala:160-165, rites Config.scala:117, ontology ConfigDecoder.scala.

**R-a.** `Jobs.attemptLimit=5` (chronicle/server/src/main/scala/chronicle/Database.scala:134); `claimHead` (:325-360)
claims `attempts<5 AND (Queued OR expired Running)` (:346,:352), `attempts+1`, lease 300 s (:351; Models.scala:107);
expired Running with `attempts>=5` → `lease-exhausted` (:335-340); `failAt` (:656-664) requeues at once with
`lease_until=NULL` (:662), older revisions end superseded (:660-661). Worker (Models.scala:106-457): non-`DomainError` →
`worker-fault` (:112); publication errors → `StagedFailure(Publication)` (:140,:395); renewal fiber every 30 s whose
first failure ends the attempt (:406-407); recording failure only logged, lease kept (:416-429); lane pause
`FailureBackoff.production=2s` (:421,:471-474). Every model call follows a database transaction: annotation after
`reserveAnnotation` (:171; Database.scala:394-399), embedding after `windowWork` (:150-153); the paid answer is
checkpointed by a separate transaction (:153; Database.scala:406-422). Publication `publishProblems` (Database.scala:
474-486): P0 `stage` (:509-519, locks the job row :381), P1/P2/P3 batches in `staging` transactions (:460-467: lock only
the run's `ch_staged_generations` row), P3 `writeSearchRows` (:586-608; ≤ `PassageStorage.searchRowWriters=4` writers,
PassageStorage.scala:26) running the `INSERT INTO ch_search_chunks … SELECT` cancelled by 57014 in deploy5
(PassageStorage.scala:339-340), then the `switch` (:613-644). Visibility: `JobInfo` (models/chronicle.baboon:92),
`ActivityJob.leaseExpiresAt` = `lease_until` for every state (Activity.scala:266-270), `chronicle jobs`
(cli/src/commands.ts:82-84), dashboard (web/src/activity/Jobs.tsx:42,63-75).

**R-b.** No service checks the database before first use: Haystack `Main.run` (haystack/server/src/main/scala/haystack/
Main.scala:24-35; first connection in `Migrations.initialize` :30); Manure `buildResources` (manure/backend/src/main/
scala/manure/Main.scala:92-160: root claim/lease first :93,:86-89, `JdbcDatabase.resource` :97, first use :113);
Chronicle `Main.run` (chronicle/server/src/main/scala/chronicle/Main.scala:20-38; `migrate` :20-24; graph +
`initialize` :26-35). pgjdbc: `loginTimeout` is fractional seconds and abandons a late attempt, cleaning it up
(org/postgresql/Driver.java:294-311,374-387,728-739); `connectTimeout`/`socketTimeout` whole seconds
(PGProperty.java:211-214,752-755); `setNetworkTimeout` milliseconds (P13).

**R-d.** P9: 1,000 transactions = 1,000 sessions today. Production `maxConnections` = role CONNECTION LIMIT (chart:
chronicle 12, haystack 8, manure 8; `max_connections` 64, `superuser_reserved_connections` 8; NixOS provider
nix/postgres/provider.py:266, options.nix:49). Session state (inventory: evidence/grep-session-state.txt):
`setTransactionIsolation(REPEATABLE_READ)` in 19 Chronicle sites and Manure RootIdentityMigration.scala:40; `setReadOnly`
(Auth.scala:274; RootIdentityMigration.scala:40,67); session GUCs only in `configure()`; all other GUCs transaction-local;
temp tables `ON COMMIT DROP`; no `SET ROLE`/`search_path`/LISTEN/NOTIFY. Advisory locks are all transaction-scoped
except rites' coordinator (`pg_try_advisory_lock`, rites/server/src/main/scala/rites/PostgresStore.scala:46) on its own
DriverManager connection outside the runtime: pooling changes no lock semantics; that connection stays outside the pool.
No SLF4J provider is locked (deps.lock.json), so HikariCP's log lines (raw driver messages) go to the NOP logger.

### R-c summary (unit RC, briefs/robust/RC.md)
A shared classifier (`StartFailure.scala`) walks cause and suppressed exceptions and picks the most specific known cause
(`BindException` → `address-in-use`; `JdbcFailure` → `jdbc-<sqlstate|unknown>` with its fixed code as message;
`RuntimeFailure` → its code; fixed-text domain errors; else `internal`/Manure `wiring`). Each Main names stages locally
(`config`, `database`, `migrate`, service steps, `bind`, `serve`) and prints one stderr line `<service> failure stage=<s>
code=<c> error=<Class> message="<fixed text>"` (+ `port=<p>` on bind); exit codes and ready lines unchanged. **R-b
inserts stage `database-wait`** before the first database use (Haystack before `migrate`; Manure after the root claim;
Chronicle before the graph for `serve`, `serve-standby`, `migrate`). No defect found.

## 2. Probes (evidence/out-*.txt)
| # | Result |
|---|---|
| P1 | smart shutdown and standby with `hot_standby=off` answer 57P03; closed port 08001; `pg_ctl promote` → accepts |
| P2 | Hikari hands out a backend terminated < 500 ms earlier (alive-bypass); first statement 57P01, then evicted |
| P3 | `NOLOGIN`: new logins 28000, pooled sessions keep working; after terminate: borrow fails 28000; after `LOGIN`: recovers |
| P4 | `pg_ctl restart -m fast` under an idle pool: 57P01/08006 once per dead connection, then recovery |
| P5/P16 | pgjdbc flushes its statement cache on `DISCARD ALL` (QueryExecutorImpl.java:2505-2508); through one pooled connection: 10 executions → 1 server-prepared statement, `DISCARD ALL` → 0, re-prepared and correct, 3 borrows |
| P6 | Hikari resets isolation, read-only, network timeout; session `set_config`, `search_path`, session locks leak; `DISCARD ALL` clears all |
| P7 | `set_config('statement_timeout','300000',true)` under a 30 s role setting: allowed, local |
| P8 | per-transaction connects at exactly the role limit: 0 × 53300 in 4,000 |
| P9 | sessions per 1,000 transactions: 1,000 (per-transaction) vs 2 (pool of 4) |
| P10 | pool borrow while the server is down: 08001 after the timeout |
| P11 | client socket timeout < statement: client 08006, backend keeps running; at limit 2 a new login gets 53300 |
| P12 | killed client: backend keeps running; with `client_connection_check_interval` it ends (also P14: 0 left after 0.6 s) |
| P13 | black-hole listener, `loginTimeout=1.5` → 08001 after 1,536 ms; stalled `SELECT` under `setNetworkTimeout(700)` → 08006 after 708 ms, connection closed |
| P14 | `HikariPool.getConnection(300)` on an exhausted pool (configured 30 s) → timeout after 316 ms, SQLSTATE null; engine-style deadline 3 s with reset capped at 1 s: all connections stalled → `connection-unavailable` 08006 after 2,260 ms; first stalled → acquired after 1,031 ms (reset uncapped: the first stall ate the whole budget) |
| P15 | `com.zaxxer.hikari.aliveBypassWindowMs` large: a terminated connection is handed out after 1.5 s idle; the reset evicts it, retry acquires in 25 ms |
| P17 | per-transaction latency, same host (load 54–92): per-transaction connect p50 8.7–9.2 ms / p95 10.7–13.5; pool + configure 0.78–0.95 / 1.22–1.37; pool + `DISCARD ALL` + configure 1.03–1.07 / 1.45–1.54 |
| P18 | a DELETE of a parent row waits for a running transaction that inserted a referencing child; its own 1 s statement timeout ends it (57014 after 1.02 s); after commit it succeeds in 0.02 s |
| P19 | r3 acquisition (§5): budget 1 s, 20 borrows after 600 ms idle (Hikari validates each): all acquired, worst 23 ms; one-execution `DISCARD ALL; configure` with bound parameters applied (statement_timeout 30s); budget 2 s, every reset stalled → `connection-unavailable` 08006 after 1,254 ms; first reset stalled → acquired after 541 ms |
| P20 | watchdog `Connection.abort` (pgjdbc PgConnection.java:1774-1786, through Hikari's proxy) at 500 ms ends a stalled multi-statement execution despite a 30 s network timeout: 08006 after 515 ms, connection closed, next borrow 27 ms, no backend left |

## 3. R-b — wait for the database at start
- **Where.** `ponygirls.runtime.DatabaseWait.await(config: JdbcConfig, bound: FiniteDuration, report: String => Unit)`
  (+ a test overload with `JdbcConnectionFactory`, monotonic clock, sleeper). Its own stage before the first database use:
  Haystack before `JdbcDatabase.resource` (Main.scala:29); Manure in `buildResources` after `RootDirectories.resource`
  (:93) and before `JdbcDatabase.resource` (:97) — root claim/lease stay first; Chronicle before `ModelHttp.client`/graph
  (Main.scala:26-27) and before `new Database` in `migrate` (:21-22). Not for operator commands (`check-config`,
  `check-casefold`, `password-hash`, `plan-root-identity`, `migrate-root-identity`).
- **One monotonic deadline** `D = start + bound` bounds every phase. Per attempt with `r = D − now`: login through the
  production property set and password file with `loginTimeout = min(connectTimeoutMs, r)` as fractional seconds
  (abandoned late attempts clean up themselves, P13) and `connectTimeout`/`socketTimeout` = ⌈min(configured, r)⌉ s (bounds
  that abandoned thread); then `setNetworkTimeout(D − now ms)` and `SELECT 1`; close. Between attempts sleep
  `min(DatabaseWait.interval = 1 s, D − now)`. At `D`: throw. So the wait ends at the bound (± scheduling and one close),
  never "bound + connect timeout". No value is ever rounded to a driver's "unlimited" 0 (r2 review A2): an attempt starts
  only with `r ≥ DatabaseWait.minimumAttempt` = 100 ms (`loginTimeout` written with millisecond precision, ≥ 0.100 s;
  pgjdbc parses it as float seconds, Driver.java:728-739), integer-second properties are ⌈⌉ ≥ 1, and the query runs only
  with ≥ 1 ms left (else the attempt counts as timed out); below 100 ms the wait sleeps to `D` and throws.
- **Accepts queries** = authenticated new connection + `SELECT 1` returns a row. **Waited out:** class 08, 57P01, 57P02,
  57P03, 53300 (one predicate `JdbcTransient.connection(sqlState)`, reused by R-a/R-d). **Fail fast:** 28P01, 28000,
  3D000, 42501, `RuntimeFailure("credential-file")`, config errors, any other SQLSTATE (configuration cannot be waited out;
  Kubernetes restarts re-read files).
- **Lines (stderr, no config values).** First waited-out failure only: `<service> database-wait code=jdbc-57P03`; success
  after a wait: `<service> database-wait ready seconds=<n>`. At `D`: `JdbcFailure("database-wait-timeout", last)` → R-c
  line `<service> failure stage=database-wait code=jdbc-57P03 error=JdbcFailure message="database-wait-timeout"`, exit 1;
  fail-fast: `JdbcFailure("database-unavailable", state)` at once.
- **Key** (optional, default `DatabaseWait.defaultBound` 120 s, valid 1,000..3,600,000 ms, so the first attempt always
  runs): Chronicle `databaseLimits.startWaitMs`,
  Haystack/Manure `database.limits.startWaitMs`, parsed into each service `Config` (`JdbcLimits` unchanged in SMALL).
- **With R-d.** The probe connection exists only before the pool is created: never concurrent with pooled connections.

## 4. R-a — publication after a database restart

**SMALL amendment (2026-11-23 ≈05:30Z; unit RA-S; orchestrator ORCH-REPLY-0430Z and its acceptance of the record
tries, lead addition ≈04:40Z).** R-a ships in two parts. **SMALL** (with R-c and R-b) contains exactly:
- migration 029 + `down-029` (below); the transient class `JdbcTransient.job` (57014, class 08, 57P01/02/03, 53300,
  `RuntimeFailure` `admission-timeout`/`admission-full`) plus the **leftover rule** below; refund, holds 1, 2, 4, 8,
  15 … min, `database-transient` at the 10th consecutive one, the count restarted by committed progress
  (`transient_range`), a retry or a rebuild; claims skip held jobs (all 23 paths of evidence/claim-paths.md, re-verified
  in the RA-S report). No reclaim or exhaustion grace: a Running job is claimable once its lease ended and
  `lease-exhausted` is unchanged (rows 6–8, 11 of claim-paths.md keep today's lease conditions).
- **Recording:** the hold is written by the failure record's fenced transaction (`holdTransient`, the transient branch of
  `failAt`: head, `lockJob`, `claimedJob` with a valid lease, all inside the transaction). Refund and hold are one UPDATE
  that matches only the claim's Running row, so a try after an uncertain commit writes nothing and reports the recorded
  hold (same fence and run). While the database refuses the record (`JdbcTransient.job`), the worker tries it again every
  `Worker.FailureBackoff` (2 s) while the attempt's lease has time left as the worker tracks it (its monotonic clock
  from before the claim or the last successful renewal, + 300 s − 5 s skew margin); then, as today, "job failure not
  recorded" and the job keeps its lease. (r2, gate r1 F1; replaced by M1's `transactionWithin(D)` below) Every try is `BlockingJdbcDatabase.boundedTransaction(b)` with
  b = min(`Worker.Leases.recordTry` 5 s, the tracked lease left): admission wait, login (login, connect and socket
  timeouts), each statement's lock wait and execution (transaction-local `statement_timeout`/`lock_timeout` tightened to
  b) and each network read end within b; a try that ran out of b on a lock wait (55P03) is tried again too. Each try
  re-checks the claim's ownership inside its transaction (a claim reclaimed, retried or superseded meanwhile writes
  nothing); cancellation (server stop) schedules no further try and the one in flight ends within b; no model call is
  made or repeated meanwhile (the lane does nothing else). (r2, F2) Only a row the fenced UPDATE returns is reported
  held or failed: a lease that ends between the record's read and its write leaves the job as it was ("not held", the
  job keeps its lease). (r2, F3) Without a new stopping range and without committed progress (e.g. P0 met a leftover),
  the hold keeps the job's `transient_range`. A renewal's transient failure still ends the attempt (today), which is then
  held by this record.
- **Leftover rule (55P03).** P3 writers keep today's failure handling: the first failing writer's error is reported while
  siblings may still run their statements (up to the publication timeout), so the next attempt can meet them. Every
  staging transaction (P1–P3, `rewritePieces`) takes the job's advisory staging lock (`staging:<job id>`, 64-bit
  `hashtextextended`) shared as its first statement and holds it to its end; P0 (`stage`) takes it exclusively as its first
  statement, before any other lock (no job-row or source-row lock held while it waits), under the configured lock
  timeout. P0 runs before any staging transaction of its attempt, and a later attempt exists only once this claim is
  stale; so what P0 can wait for is a staging transaction of an EARLIER attempt of the same job still in PostgreSQL (a
  held attempt's sibling, or a killed process's statement). A lock timeout (55P03) of that statement is
  `JdbcFailure("leftover-staging", 55P03)`, transient: held, not charged (if the claim went stale meanwhile, the record
  matches no row). Every other 55P03 — a staging or request statement waiting for any other transaction's lock, e.g. a
  live writer of another party on the job's staged rows — is charged as today. (If the lock timeout exceeds the
  statement timeout, P0's wait ends with 57014, also transient.) Not covered: phase W's rare `discardCheckpoints`
  (embedding batch size changed) meeting a leftover is charged.
- the publication timeout (staging transactions only, `extendedTransaction`, transaction-local, network timeout = timeout
  + socket timeout); the control connection (renewals only; 1 of `databaseLimits.maxConnections` ≥ 2; one admission for
  everything at 1); P3 writers ≤ the ordinary connections; the visible hold, logs, CONTRACT/README/operations docs.

**Deferred to R-a2** (own spec and deterministic interleaving tests, after POOL; starts from branch
`keep/robust-ra-full`): the reclaim grace (180 s) and exhaustion grace (15 min), the owner deadline, the paid-write
retry and cutoff (`transactionWithin`, `loginWithin`, the login-helper bound, the watchdog), the classes
`connection-unavailable`, `login-helpers-full` and `LeaseLost`, a failure record after the lease, drain-then-abort of
the P3 writers, and the `client_connection_check_interval` tightening. The bullets below marked "R-a2" describe them.

**SMALL's guarantee:** a PostgreSQL restart that ends at least 10 s before the in-flight job's lease ends charges no attempt, provided the hold's write obtains a connection and the row lock within that margin; longer outages charge one attempt through reclaim and can lose one paid model answer; crashed jobs resume as today. Why 10 s: the worker stops trying 5 s (skew margin) before the stored lease end, and
a try needs up to 5 s (its bound); a database back ≥ 10 s before the lease end leaves ≥ 5 s of tracked lease, i.e. at
least one try after it (tries come every 2 s and fail at once while PostgreSQL refuses connections: 08001/57P03). A
database back inside the last 10 s may still be recorded; inside the last 5 s it is charged as today. Slow statements
while the database is up (the deploy5/deploy6 cold window: 57014 on P3) are held, not charged, and publish once a
statement fits the 5-min publication timeout. As today, a model answer whose uncommitted checkpoint write the outage
cuts is lost whatever the outage's length (its window's reservation stays charged, at most one per lane; the next
attempt calls the model again; a committed but unacknowledged one is reused).
**SMALL's shutdown bound:** the recorder stops scheduling at once; an in-flight recording try ends within about 10 s
(each of its waits is bounded separately). One deadline per try (remaining = deadline − now before each step) and a test of
cancellation across admission then SQL wait are a REQUIRED item of R-a2 (orchestrator decision 2026-11-23 06:11Z).

**R-a2 M1 amendment (2026-11-23; reports/robust/RA2-SPEC/section-r5.md, orchestrator ORCH-REPLY-1507Z/1536Z/1556Z;
supersedes SMALL's guarantee, its shutdown bound and `boundedTransaction` above; M2–M4 of R-a2 are not built).**
- *One deadline per try.* The worker computes D = min(now + `Worker.Leases.recordTry` 4.5 s, the tracked lease end T) and
  passes it unchanged: `SessionArchive.holdTransient(claim, stage, D)` → `Database.transactionWithin(D)` → the background
  view's `transactionWithin(D)` (never the renewal permit) → the engine. No try starts with less than
  `BlockingJdbcDatabase.minimumTry` (100 ms) left to T (worker) or to D (`admission-timeout`, before the admission). The
  admission waits ≤ min(queueTimeout, D − now), read right before its semaphore; the acquisition ends by min(D, its
  start + A) (a remainder below 1 ms makes one non-waiting borrow, the last), a reset by min(that, its start + cap); a
  transaction watch armed at the handoff aborts the connection at D; D is checked before the setup, the callback, every
  statement the callback creates or executes (M1 gate r1) and COMMIT; the setup tightens statement and lock timeouts to
  D − now; after D or the abort no ROLLBACK or other I/O, the connection is evicted. The engine raises
  `JdbcFailure("deadline-expired", sqlState)` exactly for a refusal at a boundary or a connection error (class 08, no SQLSTATE) caught after the watch aborted; the recorder retries
  it (`JdbcTransient.deadline`) as it retries `JdbcTransient.job` and 55P03; every other error keeps its classification
  also when delivered after D (a P0001 is reported at once). A COMMIT cut at D has an unknown outcome: the next try reads
  the job under the claim's fence (`recordedTransient`) and reports a committed hold without writing it again, so the
  refund and the count happen once.
- *Guarantee (ORCH-REPLY-1536Z, option A):* a PostgreSQL restart that ends at least 45 s before the in-flight job's lease
  ends charges no attempt, provided no other transaction holds that job's rows; longer outages charge one attempt through
  reclaim and can lose one paid model answer; crashed jobs resume as today.
- *Derivation.* With E the stored `lease_until` and R the new postmaster's readiness, the record must commit by the
  tracked end T = E − 5 s − δ (δ: the claim's or last renewal's own SQL time, ms when healthy). The recorder is reached at
  once and tries through the outage; each try waits in the pool's bag until its D, followed by the 2-s post-failure sleep.
  Logins fail fast before readiness, so the pool's adder sleeps at most 5 s after a failed login (a cap, not a measured
  time); its next login starts ≤ 5 s after R; a waiting try takes that connection at once, or the next try follows after
  the 2-s sleep; the login plus the record take < 1 s. So the record commits by R + 5 + 2 + 1 s ≤ T when E − R ≥ 5 + 5 +
  2 + 1 ≈ 13 s. If the outage cut the reply of a renewal whose COMMIT took effect, the worker tracks the previous end, up
  to one 30-s renewal interval earlier: ≥ 43 s; hence 45 s (≈ 2 s left for δ, the 100-ms try floor and scheduling).
- *Assumptions (stated with their reasons, not provisos):* (i) PostgreSQL runs in the same pod: logins before readiness
  fail fast (refused, 57P03) and stale sockets fail at once; a login that hangs against a remote or black-holed database
  is outside the guarantee (with black-holed sockets each stale connection can stall a reset cap, RD-CORE's stated limit).
  (ii) Shared admission: right after a restart the publication gate is empty, because the interrupted publications are
  themselves held for ≥ 1 min, so records (ms each) do not queue behind long work on the shared background permits.
- *Shutdown:* cancellation schedules no further try and ends a post-failure sleep at once; the try in flight ends by its
  D plus the abort (≤ 0.5 s), i.e. within 5 s of its start (4.5 s + 0.5 s). The job keeps its lease.

**Full R-a design** (SMALL above is the part that ships first; the R-a2 parts are marked).
**Decision (D1 confirmed):** transient database failures are not charged to `attempts`; they hold the job with back-off;
10 consecutive ones end it `database-transient`. Charging cannot meet the rule for jobs with earlier charged attempts.
- **Transient class** (SMALL: without `connection-unavailable` and `LeaseLost`, with the leftover rule above)
  `JdbcTransient.job(error)`: `JdbcFailure` with SQLSTATE 57014 (no code cancels statements:
  evidence/grep-session-state.txt), class 08, 57P01/02/03, 53300, or code `connection-unavailable` (R-d, any SQLSTATE incl.
  28000); `RuntimeFailure("admission-timeout"|"admission-full")`; the worker's `LeaseLost` (below). Any stage. Not:
  55P03, 40001/40P01, `DomainError`, model errors (charged as today).
- **Storage: migration 029** `chronicle/migrations/029_transient_failures.sql`: `ALTER TABLE ch_jobs ADD COLUMN IF NOT
  EXISTS transient_failures integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS transient_range integer` (both
  metadata-only; `transient_range` = first ordinal of the P3 search-row range whose statement failed at the last transient
  failure, NULL otherwise), registered after 028 (Database.scala:58); down `chronicle/scripts/down-029-transient-failures.sql`
  (drop both columns, clear Queued holds); `chronicle/docs/operations.md` section. Next attempt time = `lease_until` of
  the Queued job (D2: no protocol change). Migration numbers: 029 RA, 030 R-f (SPEC-F), R-g later.
- **Recording** (`failAt` transient branch; fenced by `claimedJob` = id/session/revision/profile/fence/run/Running,
  Database.scala:378): k = 1 if this attempt made progress (below) else `transient_failures+1`. Older revision → superseded
  (unchanged). k ≥ L → `Failed`, `error='database-transient'`, stage kept. Else `Queued`, `attempts=attempts-1` (refund
  of the claim's charge, as `defer` :443), `transient_failures=k`, `transient_range` (the failing P3 range or NULL),
  error, stage, `lease_until=clock_timestamp()+delay(k)`, progress reset. A non-transient failure is charged exactly as
  today and sets `transient_failures=0`, `transient_range=NULL`; `Jobs.retry` (:146), `RetryFailedJobs.apply`
  (RetryFailedJobs.scala:84) and the rebuild upsert (ReindexCohort.scala:64) reset both.
- **Progress reset (D1c, r2 N2).** An attempt got past the failing statement when it commits (a) new durable progress —
  a window checkpoint (`accepted` writes only work not yet accepted, Models.scala:148-155), a staged resume step advance
  (P1/P2, `PassageStorage.resume`, Database.scala:536,578) or the switch — or (b) the P3 range recorded in
  `transient_range` (the claim returns it; a priority hint only when the staged generation and its 500-row range grid
  are unchanged: that range is written and committed alone before the other ranges are dispatched, Database.scala:
  586-600; every range is still required before the switch, the only publication point; accounting counts committed
  ranges reported to the attempt). Then k restarts at 1, written by the attempt's next job-row
  transaction (renewal or failure record; staging keeps not locking the job row, :455-459). Replayed P3 ranges other
  than the recorded one never count: a job timing out on one range climbs to L; a job moving forward range by range
  stays at 1.
- **Back-off** `Jobs.TransientBackoff(base 60 s, factor 2, cap 15 min, L 10)`, no jitter (≤ 8 lanes); delays 1, 2, 4,
  8, 15, 15, 15, 15, 15 min. **Proof:** exhaustion by this rule needs 10 consecutive recorded failures with ≥ delay(k)
  between failure k and k+1 (claims refuse holds), i.e. ≥ Σ_{k=1..9} = 90 min > 15 min; refunds keep `attempts`
  unchanged; the lease path is covered by the grace below. Cold window (≈5 min): failures at 0, ≈1, ≈3 min → publishes ≈7 min.
- **Claims honour the hold (D2).** (SMALL: without `−reclaimGrace`, i.e. Running when `lease_until<clock_timestamp()`.) Both claim predicates (:346,:352) become `((state='Queued' AND (lease_until IS NULL OR
  lease_until<=clock_timestamp())) OR (state='Running' AND lease_until<clock_timestamp()-reclaimGrace))` (index `ch_jobs_claim`,
  migrations/001.sql:15). All 23 paths that read or write job state/lease are listed with their effect on a held job in
  evidence/claim-paths.md (supersede, retry, defer, rebuild, profile switch, staged sweep, Activity, start sweep): every
  other path either ignores Queued jobs' leases or clears them. The previous binary claims a held job at once (harmless).
- **R-a2 — One fenced owner deadline (B1, B2, r2 N1).** Per attempt `ownerDeadline = lease end + Jobs.reclaimGrace` (180 s),
  tracked on the worker's monotonic clock from the remaining lease that the claim and `renew` return (DB clock, minus
  a 5 s skew margin). Database side: (i) `claimHead` reclaims an expired Running job (attempts < 5) only when
  `lease_until < clock_timestamp() − reclaimGrace` (:346,:352); (ii) `renew` and the paid writes (the checkpoint of a
  model answer, Models.scala:153, and `rejectAnnotation`, :176) accept `claimedJob AND lease_until > clock_timestamp() −
  reclaimGrace` — after an outage the owner re-extends its own lease; nobody else can have claimed it; a grace-authorized
  paid write renews the lease in the same transaction (r3 P2), so any outcome it produces (e.g. the fifth rejection →
  `annotation-attempts-exhausted`) is recorded under a valid lease by the ordinary failure update. The grace only stops
  automatic reclaim of the current head: supersession by a newer revision (:317-323), explicit retry (:146), rebuild and
  profile switch still bump the fence at once, after which the old owner's writes match no row; (iii) the transient
  failure record accepts `lease_until > clock_timestamp() − Jobs.exhaustionGrace` (15 min) and lease-exhausted
  (attempts ≥ 5, :335-340) applies only after that. Reservations, `windowWork` reads, staging and the switch keep
  `validJob`: no model call and no publication step on an expired lease. Worker side: transient renewal failures never
  end the attempt; the renewal fiber ends it (transient `LeaseLost`) only at `ownerDeadline`, or on `stale-claim`; a
  `stale-claim` raised by the work after the tracked lease end that followed a transient renewal failure is classified as
  `LeaseLost` too (the lease lapsed because of the database, not because another claim took over). A paid
  answer's write is retried in place, answer in memory, every `failureBackoff.delay` until the cutoff `min(answer time +
  Worker.paidWriteRetry (150 s, ≥ R-b's 120 s), ownerDeadline)`; each try is `BlockingJdbcDatabase.transactionWithin(
  cutoff)`: ONE absolute deadline through admission (queue wait ≤ remaining), acquisition (SMALL: login timeout;
  POOL: the §5 acquisition loop with `D = min(D, cutoff)`), setup, statements and commit (transaction-local statement
  timeout and network timeout from the remaining time) plus a watchdog that aborts the physical connection at the
  cutoff (P20; a pooled connection is then evicted); no try starts with < 100 ms left. A commit cut by the abort is
  uncertain; the checkpoint/rejection write is idempotent (`INSERT … ON CONFLICT DO NOTHING`, IndexCheckpoints.scala:73-76; rejection `UPDATE` of its own
  reservation, AnnotationAttempts.scala:46-50), so
  a committed one counts on the next read and an uncommitted one is lost. No new model call meanwhile:
  the lane does not advance and every call starts after a database transaction (§1). A transient recording failure is
  retried the same way until `lease end + exhaustionGrace − 60 s`.
- **R-a2 — Exact residual (owner, DEPLOYMENT.md).** A paid answer is kept iff a fenced write COMMITS before the cutoff;
  otherwise it is lost and its reservation stays charged. Renewals succeed every 30 s while the database answers, so for
  an outage starting at t₀, `lease_until ≥ t₀ + 270 s` and `ownerDeadline ≥ t₀ + 445 s`: the retry budget is 150 s after
  the answer, and the answer survives only if one of its tries (every 2 s) commits before that cutoff. Under healthy
  conditions a try takes well under 1 s, so a database back about 3 s before the cutoff is an estimate of the margin
  needed, not a guarantee. A lost answer costs ≤ one per lane (`indexing.annotationSessions`). Crash loops end `lease-exhausted` 15 min later than today; a dead
  process's Running jobs are reclaimed 180 s later than today (≤ 8 min after their last renewal). Renewals run in the
  control reserve (§5) and P3 never locks the job row, so the lease cannot lapse during one publication statement (D3).
- **Logs (D1b).** Every hold: `job held jobId=<id> code=database-transient sqlState=<s|none> class=<simple class>
  stage=<stage> consecutive=<k> nextAttemptAt=<ISO>`; terminal: `job failed jobId=<id> code=database-transient
  sqlState=<s|none> class=<…> stage=<stage> consecutive=<L> nextAttemptAt=none` (warn; ids and codes only).
- **Visible state (D2, A1).** Held job: `Queued`, `error="database-transient"`, `failureStage`,
  `ActivityJob.leaseExpiresAt` = next attempt, `leaseActive=false`; lease filter value stays `inactive` (Activity.scala:97;
  no expression change). Dashboard (Jobs.tsx:42,63-75): Lease cell "Waiting" for Queued rows with `leaseExpiresAt`, title
  "Next attempt <time>"; column heading "Lease expiry / next attempt". CONTRACT.md documents code, hold and filter
  semantics (no schema change, 1.9.0 stays). The RA report shows the rendered DOM text (browser suite row, §7).
- **Publication timeout (D3).** `indexing.publicationStatementTimeoutMs`, optional, default 300,000, valid
  `databaseLimits.statementTimeoutMs`..3,600,000, only for `staging` transactions (P1–P3, `rewritePieces`; Database.scala:
  460-467) through `BlockingJdbcDatabase.extendedTransaction(timeout)(f)`: after `configure()`/`setAutoCommit(false)` the
  engine sets `statement_timeout` transaction-locally (P7; deliberately above the role's 30 s) and `setNetworkTimeout(
  timeout + socketTimeout)` (P11). Lock (35 s) and idle-in-transaction timeouts unchanged. (R-a2:) `configure()` also tightens
  `client_connection_check_interval` to 5 s (P12/P14). P0, switch, retire and request paths keep 30 s.
- **Purge vs publication (B3): no interlock; known limit, proven by a test.** P18: purge (Auth.scala:369-374) deletes
  chunks/generations of the source; a running P3 statement of the same source holds FK key-share locks
  (migrations/002.sql:3-6) and the staged row (026:11-14), so purge waits and its unchanged 30 s statement timeout ends it
  with `unavailable` (no hang); it succeeds once that statement ends (≤ 5 min). Interlocks were rejected: deferred
  physical purge changes Purge semantics (Auth.scala, also R-f's), and cancelling publication backends needs backend-pid
  bookkeeping; the exposure is one purge of a source whose publication is mid-statement.
- **Previous binary (D1a).** From code, d30a6ff5 has no newer-schema refusal (Database.scala:19-58; claim-paths.md). The
  RA unit proves it (§7 A10): the real previous Chronicle package must start and index on a database migrated to 029. If
  it refuses, `down-029` becomes the documented way back and is tested.
- **Warm-up:** none in the application (D7; the chart-level warm-up is a separate unit).

## 5. R-d — one bounded pool per process
- **Library:** HikariCP 7.1.0 (newest release, Maven metadata 2026-06-14, checked 00:34Z; Apache-2.0; one jar, no parent
  POM, slf4j-api 2.0.17 already locked; Java 11 bytecode; pre-generated proxies, no runtime codegen). Used as
  `config.validate(); new HikariPool(config)` (public API, HikariPool.java:52,88): per-call `getConnection(hardTimeout)`
  (:152), `evictConnection` (:262), `shutdown` (:201) — no `HikariDataSource(HikariConfig)` (reflective field copy,
  HikariConfig.java:1021-1026, unsafe in the native images). A hand-written pool would re-create validation, eviction,
  keepalive, lifetime, refill and dirty-bit resets.
- **Data source:** adapter over `JdbcConnectionFactory` + production properties: one password-file read per physical
  connection (rotation: new connections use the new file; existing ones stay authenticated until retired).
- **Settings (named constants):** `maximumPoolSize = P`; Partitioned: fixed (`minimumIdle = P`), Compatible: lazy
  (`minimumIdle = 0`, `idleTimeout` 10 min, so out-of-scope consumers open nothing until used and shrink when idle);
  `maxLifetime` 30 min (Hikari retires each connection between 22.5 and 30 min, variance factor 4, HikariPool.java:64,493);
  `keepaliveTime` 2 min (server `idle_session_timeout` must be 0 or ≥ 3 min); `validationTimeout` V = max(250 ms,
  min(1 s, A/4)) with A from the acquisition deadline below; leak detection off; `initializationFailTimeout -1`; Hikari's
  configured `connectionTimeout` = max(250 ms, A) (unused by borrows, which pass their own timeout); refill after
  failures backs off 10 ms → 5 s (:745-765).
- **Sizing (B8).** Two policies. *Compatible* (default constructors; rites, ontology, every existing fixture): P = R =
  `maxConnections`, B = 0 (the background view shares the request admission) — today's capacity exactly. *Partitioned*
  (Chronicle, Haystack, Manure pass their config's `JdbcPoolSizing`): keys omitted and `maxConnections ≥ 8` → P =
  `maxConnections − 2`, B = ⌊P/2⌋, R = P − B; keys omitted and `maxConnections < 8` → Compatible sizing (development and
  test budgets; production renders 8/12); keys set → R ≥ 1, B ≥ 0, R + B ≤ `maxConnections − 2`; **Chronicle,
  Partitioned: B ≥ 3** (gate L ≥ 1 plus the 2-permit control reserve), else a `config` error naming
  `backgroundConnections` (defaults give B ≥ 3 whenever P ≥ 6). No other new validation (all previously valid connect
  timeouts stay valid). Single-session pools (P = 1) remain possible for tests. *Compatible limits (Chronicle in a
  budget < 8, rites, ontology):* one shared admission of `maxConnections`; Chronicle's gate L = 1; no control reserve
  — today's behaviour, where a long statement also holds one of the shared permits; not a production budget.
- **Partition and control reserve (B5).** Request and background admissions over one pool (R + B = P), each with the
  existing `maxQueued`/`queueTimeout`. Background users: Chronicle `Worker`'s `PostgresArchive` over `Database.background`
  (plugins/ChroniclePlugin.scala:35) and `EpochMaintenance` (:58); Haystack `HaystackRetrieval.worker` (HaystackRetrieval.
  scala:71-73); Manure `SearchWorker` (Search.scala:126-129) and the sweeper (`Artifacts.sweep` through
  `RuntimeTransactions.background`, ManurePlugin.scala:14; Main.scala:184). Haystack's auth reload (Main.scala:63) stays on
  request admission (fail-closed auth must not depend on background load) and is counted there. Chronicle adds a
  publication gate inside B: `staging` transactions and `EpochMaintenance` take one of L = B − 2 permits (Compatible:
  L = 1) BEFORE background admission (bounded wait: the publication timeout; P3 writers are effectively min(4, L)), so
  queued long work never occupies admission slots, so renewals, failure records, checkpoints,
  claims, P0 and switch always have ≥ 2 background permits (control reserve) whatever the long work holds. Under the
  assumed four lanes their short transactions and renewals share those permits (D7 proves timely renewals and failure
  records with the gate full); under a degraded database correctness does not depend on renewal timeliness (§4 owner
  deadline).

| service | role limit = maxConnections | P | R | B | publication gate L / control reserve | headroom |
|---|---|---|---|---|---|---|
| Chronicle | 12 | 10 | 5 | 5 | 3 / 2 | 2 |
| Haystack | 8 | 6 | 3 | 3 (worker + heartbeat + spare) | — | 2 |
| Manure | 8 | 6 | 3 | 3 (worker + heartbeat + sweeper) | — | 2 |
  Pools sum to 22 ≤ role limits 28 ≤ 56 non-superuser slots; headroom is a margin (one exiting backend during a Hikari
  replacement, one operator/rollback session), not a guarantee. **Assumed production indexing concurrency** (D4):
  Chronicle `indexing.annotationSessions` = 4 (default, IndexingCapacity.defaults Core.scala:65): ≤ 4 lane transactions +
  4 renewals, all short, on ≥ 2 control permits; Haystack/Manure one indexing loop each. DEPLOYMENT.md verifies the live
  Chronicle `indexing` block; more lanes need a larger `backgroundConnections`.
- **Acquisition deadline (B6, r2 N4).** Budget A = `connectTimeoutMs` rounded up to whole seconds — today's effective
  login bound (JdbcTransactionEngine.scala:80,85-86), so A ≥ 1 s and no previously valid configuration gets a shorter
  bound. After admission `D = now + A` (monotonic) bounds acquisition, Hikari's validation, the reset and retries. Loop
  ≤ P+1 times: `r = D − now`; stop if `r ≤ V`; `pool.getConnection(r − V)` (≤ r including Hikari's own validation,
  P14); the reset is ONE execution of `DISCARD ALL; <configure SELECT>` with bound parameters (P19) under
  `setNetworkTimeout(c)` and a watchdog that aborts the physical connection (`Connection.abort`, P20) at the same instant c =
  min(D, now + resetCap), resetCap = max(250 ms, A/4) — so every read of the reset ends by c. The watchdog owns the
  connection until disarmed: disarm (handoff to the caller) and abort are mutually exclusive (one atomic state
  armed → disarmed | aborted); if abort won, the connection is evicted and never handed out; any reset failure →
  `evictConnection`, remember SQLSTATE, retry; after a successful reset re-check `D`: if passed, return the connection
  and fail; else set the transaction's own network timeout and enter the callback. Failure: `JdbcFailure(
  "connection-unavailable", lastSqlState: Option)` (distinct code; P14 shows no SQLSTATE on pool exhaustion). Bound
  before the callback: `queueTimeoutMs` + A + one abort/close. P19: A = 1 s healthy borrows take ≤ 23 ms; at A = 2 s one
  stalled reset costs ≤ 0.5 s and the retry succeeds (541 ms); all stalled → failure at 1.25 s. Production A = 5 s: V 1 s,
  resetCap 1.25 s. A connection that dies during the callback fails it with `database-unavailable` 57P01/08006.
- **Per-borrow reset (D4).** `DISCARD ALL; configure` in one execution: resets role/session authorization, all session GUCs incl.
  `search_path`, temp tables, session locks, LISTEN, cursors, prepared statements (P6); pgjdbc re-prepares (P5/P16);
  Hikari resets isolation/read-only/auto-commit/network timeout on return. Added cost ≈ +0.1–0.25 ms p50 per transaction
  at JDBC level (P17); the RD unit measures a hot request path before/after (§7 D11).
- **Errors and HTTP (B7).** Bounded waits only; named failures: `RuntimeFailure(admission-full|admission-timeout|
  runtime-closed)`, `JdbcFailure("connection-unavailable", _)`. Haystack (haystack http/Http.scala:66-89) and Manure
  (Http.scala:127-133, Retry-After 5) already answer 503 `unavailable` for these. Chronicle REST `handle` (Http.scala:
  305-307) answers 500 today; R-d maps those failures and connection-class SQLSTATEs (08xxx, 57P01-03) to 503
  `unavailable` + Retry-After 5 — 28000 included through `connection-unavailable`. WS operations already answer
  `unavailable` (Http.scala:373,400). MCP keeps its transport contract: the bearer phase runs in `handle` (Http.scala:
  271-279) → 503; a tool call's failure stays a JSON-RPC result with tool error `unavailable` in HTTP 200
  (Mcp.scala:115-125), as MCP clients expect for tool errors.
- **Fenced role over time (D5).** `NOLOGIN` alone: pooled sessions keep working (P3) until retired (22.5–30 min); Hikari
  retries logins every ≤ 5 s (one FATAL 28000 per attempt in the server log); borrowers get 503 within
  `queueTimeout + connectTimeout` once no pooled session is left. With termination: immediately. After `LOGIN`: the next
  refill attempt (≤ 5 s) succeeds; no restart. Hence §10's procedure. POOL is not deployable until the lead's paddock
  inventory of NOLOGIN fencing is settled (no paddock change here).
- **Shutdown and hygiene.** Close: admissions drain, then `pool.shutdown()`. Exception texts are sanitized to
  `JdbcFailure`; a future SLF4J provider must silence `com.zaxxer.hikari`.
- **53300 today (requirement 5).** Admission ≤ role limit and exiting backends free slots before new logins (P8: 0 in
  4,000). 53300 needs a backend outside admission while it is saturated: (a) after a kill/restart the old process's
  statements run until their timeout (P11/P12) — the new process's start can hit 53300 (today: exit; now: R-b waits it
  out, `client_connection_check_interval` ends them in ≤ 5 s); (b) external sessions as the role (NixOS Haystack backup
  `pg_dump -U haystack`, nix/nixos/haystack.nix:283-290; a `migrate` beside `serve`; operator psql); (c) a client socket
  timeout shorter than a statement (not in today's config; prevented for R-a by the network-timeout rule). With the pool,
  (b)/(c) fit the 2-slot margin; Hikari refills in the background.

- **Deviations (orchestrator-accepted, 2026-11-23, RD gate r1; reasoning: reports/robust/RD/gate-core-r1.md advisories).**
  (A) *Renewal permit.* Chronicle's background partition (12 → B 5) is a background admission of B − 1 = 4, which the
  publication gate (L = B − 2 = 3) is taken before, plus a 1-permit renewal-only admission over the same pool; short work
  (claims, checkpoints, failure records, P0, switch) keeps ≥ 1 permit, renewals their own. Budgets < 8 keep SMALL's
  max − 1 shared + 1 renewal permit, one admission at max = 1. Why: a shared 2-permit reserve can be taken entirely by
  slow claims; SMALL's renewal isolation stays, and gate holders never reacquire admission (no permit cycle). Limit: the
  one short-work permit can still be held past `queueTimeout` by a slow claim or a P0 waiting on an earlier staging
  transaction. Test D7 (RD-WIRE): full gate latched, excess staging queued outside admission, four lanes' short work and
  renewals progress independently. (B) *`connection-unavailable` is a transient job failure*, with or without a
  SQLSTATE, in the initial failure and in the failure record's retries (`JdbcTransient.job`). Why: a pool wait can end
  before the pool records a failed login; else a restart could charge a job or stop its recorder although PostgreSQL
  recovers within the lease margin. `DatabaseWait`'s start rules and every other SQL classification are unchanged. Test
  (RD-CORE): TransientPublicationTest "connection-unavailable without a SQLSTATE …" (no-SQLSTATE pool timeouts in the
  work and a record try, then recovery: fenced hold, one refund).
  (C) *No validation on borrow* (RD-CORE gate r1 blocker 1; r2 scope; RD-WIRE step 0). Supersedes "stop if `r ≤ V`;
  `pool.getConnection(r − V)` (≤ r including Hikari's own validation)" above and D5 (a)'s "Hikari validates": a borrow
  waits at most the remainder `r` (a remainder below Hikari's millisecond borrows without waiting, so every positive
  budget reaches the pool), and the reset is the only liveness check; V stays the keepalive's background validation. A
  reset that ends after its cap `min(D, start + resetCap)` is never handed out (evicted and retried within D, or returned
  when D passed), also when the watchdog's alarm is delivered late. Hikari skips borrow validation through its JVM-global
  `com.zaxxer.hikari.aliveBypassWindowMs`, which the engine sets only while it builds a pool, under one lock, and restores
  afterwards (Hikari 7.1.0 reads it into the pool instance): sound for every pool built by the engine; a Hikari pool built
  elsewhere in the same process at that moment would lose its own borrow validation (none exists). One pool per process
  is the production target, enforced at each service's production wiring (RD-WIRE: a second claim fails
  `pool-already-open`). Limit: after a restart with black-holed sockets each stale connection can stall a full reset cap,
  so the first borrow is not guaranteed to recover within one budget; later borrows do (restart acceptance judges it).

## 6. Configuration keys (all optional; existing files keep working; chart unchanged)
| key | services | default | valid | item |
|---|---|---|---|---|
| `databaseLimits.startWaitMs` / `database.limits.startWaitMs` | C / H, M | 120000 | 1000..3600000 | R-b |
| `indexing.publicationStatementTimeoutMs` | C | 300000 | statementTimeoutMs..3600000 | R-a |
| `databaseLimits.requestConnections` / `database.limits.requestConnections` | C / H, M | §5 sizing | ≥ 1 | R-d |
| `databaseLimits.backgroundConnections` / `…limits.backgroundConnections` | C / H, M | §5 sizing | ≥ 0 | R-d |
- The eight existing `databaseLimits` fields stay required (shared/service-runtime/README.md:103-106); new keys are
  optional with named defaults in one place each (`DatabaseWait.defaultBound`, `JdbcPoolSizing`, `IndexingCapacity`),
  like Chronicle's optional `indexing` keys (Core.scala:180-190); README updated. rites/ontology decoders unchanged.
- NixOS/HM modules (nix/lib/jdbc-limits-options.nix; nix/nixos/chronicle.nix:32; nix/hm/chronicle-server.nix:28)
  unchanged; defaults apply (rendered `maxConnections` 8 → P 6). Override options are a follow-up.

## 7. Tests (fail before for the stated reason; real PostgreSQL; no test sleeps: short intervals via configuration or injected clocks, production defaults asserted — AGENTS.md Timing rule)
SMALL (RA-S) runs A1, A2, A3, A6, A9, A10 and its own cases: control connection (with one-connection mode), 55P03
leftover vs live writer, the leftover barrier keeping the range, the record's tries (refused then taken, claim taken
over, recovery in the final lease interval, cancellation during a record blocked in PostgreSQL), a lease ending between
the record's read and write, down-029.
A4 and A5 belong to R-a2; A7 (the purge limit stays documented) and A8 (covered by A1's network-timeout check) are not
run in SMALL.
| id | where | asserts | fails before because |
|---|---|---|---|
| B1 | shared `DatabaseWaitSuite` (new); `startWaitMs` 1000 (smallest accepted) against a healthy database → returns after one attempt, 0 sleeps; 999 rejected (r3 P3) | virtual clock/sleeper: 57P03, 08001, 53300 then real login → returns, wait + ready lines, sleeps never exceed the remaining time, no attempt starts below 100 ms and no driver timeout is 0 (r2 A2); always 57P03 → `database-wait-timeout` exactly at the bound; 28P01, 3D000 → 0 sleeps; real 2 s bound with an authenticated connection whose `SELECT 1` stalls server-side (factory proxy, `pg_sleep`) → ends within bound + 0.3 s; defaults 120 s / 1 s | API absent |
| B2 | Haystack StartupConfigTest, Manure WiringDiagnosticSuite, RC's Chronicle start test | closed local port, `startWaitMs` 1000 (smallest valid): one wait line, then `stage=database-wait code=jdbc-08001 … message="database-wait-timeout"`, exit 1, elapsed ≥ 1000 ms | no wait line, stage `database`/`migrate` |
| A1 | chronicle `TransientPublicationTest` (new) | timeout isolation: request statement 1 s, publication 4 s, trigger on `ch_search_chunks` sleeps 2 s → publication completes; trigger saw `statement_timeout` 4s, a request transaction 1s | base applies 1 s: 57014, `worker-fault` |
| A2 | same | forced timeout (statement = publication = 1 s, trigger 2 s): Queued, attempts unchanged, `database-transient`, Publication, `transient_failures` 1, `lease_until − now ∈ (55, 60] s`, claim refuses, ActivityJobs `leaseExpiresAt` = hold and filter `lease:inactive` matches it; hold and terminal log lines with all D1b fields, the terminal one with `nextAttemptAt=none` (capturing `LogSink`, as ContextWorkerRecoveryTest.scala:28); `transient_failures` set to L−1 → Failed; trigger dropped → Complete | base: Queued at once, attempts charged, no hold |
| A3 | same; parallel path: 4 writers, the recorded range committed alone first, then the rest dispatched; a changed range grid ignores the marker; the switch still needs every range (r3 b) | D1c/N2 (`searchRowsPerStatement` injected 2, production 500 asserted; a row trigger sleeps 2 s on the first row of the ranges named in a control table; publication timeout 1 s): slow range A → `transient_failures` 1, `transient_range` A; next attempt A fast, B slow → A committed first, then 57014 on B → count 1 (reset), range B; slow A every time → 1, 2, 3 …, at L → Failed; a P2 resume advance resets; a deterministic non-transient failure (trigger raising P0001) is charged as today (attempts+1, no hold, Failed at 5) | no counter/marker |
| A4 | same | B1: attempts 4 → claim; renewal and recording fail transiently (archive wrapper); stored lease moved 5 min into the past; another lane's claim neither reclaims nor exhausts; recording heals → Queued, attempts 4, held; the recorder gives up at lease end + exhaustion grace − 60 s (injected clock); lease 16 min past with nobody recording → `lease-exhausted`; defaults 15 min / 60 s / 2 s | base exhausts at once |
| A5 | chronicle `WorkerFailureServeTest` (cases); (d) r3 P1: a try blocked in admission (background admission held) and one blocked in a statement (trigger) both end at the cutoff, not later; healing after the last eligible poll → answer lost, no further call; (e) r3 P2: fifth rejection recorded inside the grace before any renewal → lease renewed in that transaction, job Failed `annotation-attempts-exhausted`, not `lease-exhausted`; (f) r3 a: append (newer revision) and explicit retry during the grace → old owner's writes match no row | N1 (lease 2 s, renewal 200 ms, reclaim grace 1.5 s, paid-write window 1 s, backoff 50 ms injected; production 300 s / 30 s / 180 s / 150 s / 2 s asserted): window with 9 reservations → the attempt reserves the 10th and calls the model once; (a) checkpoint write and renewals fail until 0.8 s after the answer, stored lease ending 0.2 s after it → written inside the grace, renewal re-extends, reservations 10, model calls 1; (b) failures past 1 s → transient hold, reservations 10, model calls 1, no further call; (c) another lane does not reclaim the expired job before `lease_until` + grace and does after it | base: no retry, immediate reclaim |
| A6 | same file as A1 | D3: lease 2 s / renewal 200 ms injected, publication 4 s, trigger 3.5 s (just under the timeout): `lease_until` sampled every 100 ms stays in the future, job Complete; defaults 300 s / 30 s | regression guard (passes on base: P3 never locks the job row); must keep passing with the gate and control reserve |
| A7 | chronicle purge test (new case) | B3 on the actual path: the WS `Purge` operation (Auth.scala:369-374) during a 3 s P3 statement of the same source (statement timeout 1 s) → error `unavailable` within 1.5 s, nothing purged; after the statement ends the same `Purge` succeeds (source tombstoned, chunks gone) | documents the limit |
| A8 | shared PostgresSuite (case) | `extendedTransaction(2s)` under a 100 ms role setting: 2s and network 2s+socket inside, configured values after; `client_connection_check_interval` 5s | API absent |
| A9 | chronicle/web node test + tests-browser/activity.mjs row | held row: Lease "Waiting", title "Next attempt …"; report quotes the DOM text | label absent |
| A10 | RA gate step (not a suite) | `git worktree add $T/prev d30a6ff5`, `nix build $T/prev#chronicle`; on a database the new binary migrated to 029 with one held and one ordinary job, the old binary starts, claims both and indexes a synthetic session to Complete (stub models); the new binary then starts on it again | — |
| D1 | shared `PoolSuite` (new; Compatible, `maxConnections` 1) | borrower A sets RR, read-only, network timeout, session `statement_timeout`, `SET LOCAL hnsw.ef_search`/`work_mem`, extended timeout, `search_path`, `SET ROLE` (test role), session advisory lock; borrower B on the same pid sees defaults | base: new pid |
| D2 | PoolSuite | A2 of review: exactly 1,000 controlled transactions through a counting factory: cold run ≤ P opens, warm run 0 | base 1,000 |
| D3 | PoolSuite | P15 forced in the fixture (`aliveBypassWindowMs` large): terminated pooled backend → reset evicts, retry, callback never sees 57P01 | API absent |
| D4 | PoolSuite | test role: password rotated (role + file) → existing session works, new connection uses the new file; NOLOGIN + terminate → `connection-unavailable` 28000 within queue + connect timeout; LOGIN → next transaction succeeds, same runtime | regression guard |
| D5 | PoolSuite; (e) r3 d: watchdog abort and handoff raced deterministically (latch in the test factory) → exactly one wins; abort-won connection evicted, next borrow gets a fresh pid | N4: (a) `connectTimeoutMs` 1000, 20 borrows each after > 500 ms idle (Hikari validates) → all succeed; (b) A = 2 s, factory proxy stalls the reset statement (`configure` part) of every connection → `connection-unavailable` within 2 s + 0.3 s; (c) only the first stalls → success after ≈ 0.5 s; (d) defaults: A 5 s → V 1 s, resetCap 1.25 s | API absent |
| D6 | PoolSuite | explicit keys R 1 / B 1 (`maxConnections` 4): latched background → request succeeds, second background → `admission-timeout`; after close no pool backend, `runtime-closed` | API absent |
| D7 | chronicle (new case); extra staging writers queued outside the full gate hold no admission slot while control progress is checked (r3 c) | N3: production sizing (`maxConnections` 12 → R 5 / B 5 / L 3): 2 staging transactions and 1 maintenance transaction latched in the gate, 4 lanes looping short control transactions (checkpoint writes) with their renewal fibers: every renewal and one transient failure record per lane complete, none hits `admission-timeout`, over 20 renewal rounds (renewal 100 ms injected); explicit B = 2 for Chronicle → `config` error | API absent |
| D8 | Haystack, Manure, Chronicle wiring cases | background saturated: Haystack/Manure worker `once` reports `admission-timeout` while a request read succeeds; Manure sweep waits on background; Chronicle `Worker.once` returns false and the job stays Queued with attempts 0 | API absent |
| D9 | chronicle Http/WS/MCP (new case) | factory refuses 28000 (fence) and admission saturated: REST 503 + Retry-After, WS `unavailable`, MCP bearer phase 503 / tool error `unavailable` in 200; after recovery 200 | REST 500 |
| D10 | shared ConfigSuite + decoder tests | sizing: 12 → 10/5/5, 8 → 6/3/3, 4 (keys omitted) → 4/4/0, rites/ontology Compatible; a Compatible pool opens no connection before first use (footprint); explicit R+B > max−2 rejected; Chronicle explicit B < 3 rejected; Manure `check-config` with `maxConnections` 1 still valid | keys absent |
| D11 | RD unit measurement (report) | hot request path (Haystack item GET; Chronicle MCP `ingest_status`): 2,000 requests after 200 warm-up, p50/p95 before (SMALL) and after (POOL), same host, load recorded | — |
- Existing tests that change with POOL: Chronicle SQL-observation tests count `Fixtures.runtimeSetupSql` per connection
  (McpSourceBoundaryTest.scala:171-173, OwnerReindexActionsTest.scala:199, RetryFailedActionsTest.scala:95, Fixtures.
  scala:56) → per transaction, plus `DISCARD ALL`; PostgresSuite.scala:35-45 needs a new runtime after `ALTER ROLE`. The
  concurrent migration test (PostgresSuite.scala:104) keeps proving `pg_advisory_xact_lock` on the pool.

## 8. Unit plan
| unit | set | after | owns | gate (worktree root) |
|---|---|---|---|---|
| RB | SMALL | RC approved | shared `DatabaseWait.scala`, `JdbcTransient.scala` (new), `DatabaseWaitSuite.scala`, README; haystack `Main.scala`, `Config.scala`, StartupConfigTest; manure `Main.scala`, `Config.scala`, WiringDiagnosticSuite, README; chronicle `Main.scala`, `Core.scala` (:191-200 region), RC's start test, CONTRACT/README config lines | `nix develop .#chronicle --command shared/scripts/test.sh jvm`; same with `haystack/scripts/test.sh jvm`, `manure/scripts/test.sh jvm`, `chronicle/scripts/test.sh backend` |
| RA | SMALL | RB | shared engine, `BlockingJdbcDatabase.scala`, `JdbcTransient.scala`, PostgresSuite (A8), README; chronicle `Database.scala`, `Models.scala` (Worker), `Core.scala` (IndexingCapacity), `RetryFailedJobs.scala`, `ReindexCohort.scala`, `plugins/ChroniclePlugin.scala`, `migrations/029_…`, `scripts/down-029-…`, `docs/operations.md`, `CONTRACT.md`, `README.md`, `web/src/activity/Jobs.tsx`, web node test, `tests-browser/activity.mjs`, A1–A7 tests, `Fixtures.scala` | RB's four + `chronicle/scripts/test.sh web browser`; A10 step |
| SMALL-V | SMALL | RA | — | verification rule below |
| ACC | after SMALL | RA | `scripts/restart-acceptance.sh` + helper (§9) | focused review before results count; run on SMALL and on POOL |
| RD-CORE | POOL | ANNOT merged | `build.sbt` (:81-94), `deps.lock.json`, shared runtime (engine, facades, `Admission.scala`, `JdbcConfig.scala` + `JdbcPoolSizing`, PoolSuite, ConfigSuite, PostgresSuite fix, README); chronicle/haystack/manure config decoders (+`Fixtures.scala`, `TestSupport.scala`) | `nix run .#chronicle-update-sbt-lock -- "$PWD/deps.lock.json"` (diff: HikariCP jar + pom); four test.sh; `nix build .#onDemand.backend-coassembly` |
| RD-WIRE | POOL | RD-CORE | chronicle `Database.scala` (background view, publication gate), `plugins/ChroniclePlugin.scala`, `EpochMaintenance.scala`, `Http.scala` (:305-307), D7–D9, SQL-observation tests; haystack `Main.scala`, `HaystackRetrieval.scala`; manure `plugins/ManurePlugin.scala`, `Metadata.scala` (JdbcTransactions.background), `Artifacts.scala` (sweep); D11 | four test.sh; `scripts/verify all` on the settled POOL commit (native suites prove Hikari in the native images); ACC rerun |
- **Verification rule (orchestrator), for every landing set (SMALL, OPS, ANNOT, POOL):** `scripts/verify all` once, on
  the settled commit (never in the step that produces it), with the other heavy jobs paused, load average recorded
  before and after; a failure is reported with its failing script and `nix log`; at most one diagnosed rerun.
- RB and RA are sequential (both edit chronicle `Core.scala`, the shared README, `JdbcTransient.scala`).
- **Overlaps with R-f (OPS):** chronicle `Core.scala` (RB, RA, RD-CORE), `Http.scala` (RD-WIRE), `CONTRACT.md`,
  `README.md` (RB, RA), `web/src/activity/Jobs.tsx` (RA), `Database.scala` `Jobs.retry` :140-147 (RA), `Auth.scala` (none:
  B3 is test-only). **Overlaps with R-g (ANNOT):** `Models.scala` — RA changes `Windows.accepted` (:148-155,
  checkpoint retry), `annotate` (:171-186, rejection retry), `process`/renewal/failure recording (:404-433) and the
  Worker constructor (lease/retry policies); `Database.scala` `renew` (:447-452), `failAt` (:656-664), `claimHead`
  (:335-352), `writeSearchRows` (:586-608, range order and reporting) and the owner-grace authority of `rejectAnnotation`
  and the checkpoint write (:400-416, next to R-g's `reserveAnnotation`). RA does not edit `AnnotationAttempts.scala`, `IndexCheckpoints.scala` or `ProblemPassages.scala`; R-g
  rebases on RA. RD-WIRE builds the Worker's archive over the background view (ChroniclePlugin), no Models.scala edit.
- Commits `R-b:`, `R-a:`, `R-d:`; failing-before evidence from a scratch worktree at the unit's base.

## 9. Restart acceptance (unit ACC; `scripts/restart-acceptance.sh` next to scripts/haystack-native-acceptance.sh)
Own PostgreSQL 18 + pgvector cluster in a private temp root, three roles with CONNECTION LIMIT 12/8/8 and the chart's
role settings, the shipped `.#chronicle`, `.#haystack`, `.#manure` executables, synthetic data, Chronicle stub models
(chronicle/scripts/upload-bounds.py's stub), Haystack `authReloadMs` 2000 (its auth reload is a fail-closed database
transaction, AccountService.scala:45). Pass rules (fixed before any run; a case that does not exercise its path is
INVALID):
1. **Before PostgreSQL:** cluster stopped, start the three, start PostgreSQL after 10 s → one `database-wait code=jdbc-08001`
   line each, ready within 30 s of the PostgreSQL start.
2. **During 57P03:** standby with `hot_standby=off`, promote after 15 s → one `code=jdbc-57P03` line each, ready within
   30 s after promote. 2b: never promote, `startWaitMs` 10000 → exit 1 within 10–11 s, one `stage=database-wait` line.
3. **Restart under indexing load, publication slower than requests:** 20 synthetic sessions; `statementTimeoutMs` 2000,
   `publicationStatementTimeoutMs` 10000; trigger on `ch_search_chunks` 3 s per statement, 12 s for 2 min (57014); in
   that window `pg_ctl restart -m fast` twice, `-m immediate` once → 0 Failed of the 20, all Complete within 20 min after
   the last restart, ≥ 1 `job held` line (else INVALID), PIDs unchanged, all three 200 afterwards.
4. **Terminate, fence, unfence:** terminate all three roles' sessions; then per role the §10 fence procedure for 30 s,
   then `LOGIN` → while fenced: REST/HTTP 503 (Chronicle REST, Haystack, Manure), Chronicle WS `unavailable`, MCP tool
   error `unavailable` (or bearer phase 503), each within queueTimeout + connectTimeout + 1 s; 200 within 15 s after
   `LOGIN`; PIDs unchanged.
5. **Occupied port:** a listener on each port → exit 1 within 60 s, one `stage=bind code=address-in-use … port=<p>` line.
6. **Connections per 1,000 transactions (SMALL baseline, POOL):** workers idle; 1,000 requests per service (Chronicle MCP
   `ingest_status`, Haystack item GET, Manure list); SMALL's `pg_stat_database.sessions` delta calibrates the transaction
   count T; report cold and warm runs separately, sessions × 1000 / T and TIME_WAIT to the PostgreSQL port. POOL pass:
   warm delta 0, cold ≤ P (10/6/6), backends per role ≤ P at every 1 s sample, no 53300.

## 10. Deployment notes (input for reports/robust/DEPLOYMENT.md)
- **Migrations:** SMALL adds Chronicle 029 (additive, metadata-only, applied at start); POOL none. Way back from SMALL:
  previous image, no down-script needed if A10 passes (else `down-029` with the server stopped).
- **Config:** none required; defaults apply. Chart/ConfigMap unchanged.
- **Before POOL (read-only, live):** role limits (`pg_roles.rolconnlimit` 12/8/8 ≥ P+2), `max_connections` 64,
  `superuser_reserved_connections` 8, `idle_session_timeout` (0 or ≥ 3 min), `tcp_keepalives_idle`; Chronicle
  `indexing.annotationSessions` ≤ 4 (else raise `backgroundConnections`); kubelet probes allow ≥ 120 s + start.
- **Fence/rollback procedure (POOL):** 1) `ALTER ROLE <r> NOLOGIN` (committed); 2) terminate the role's sessions;
  3) verify `SELECT count(*) FROM pg_stat_activity WHERE usename='<r>'` = 0, repeating 2–3 until it is (orphaned
  statements end within ~5 s); 4) roll back; 5) `ALTER ROLE <r> LOGIN` only after the verification. POOL is not
  deployable until the paddock inventory of NOLOGIN fencing (lead/owner) is settled.
- **SMALL residuals:** §4 "SMALL's guarantee"; the purge limit below; with `maxConnections` ≥ 2 one connection serves
  renewals only (production 12 → 11 for everything else). The paid-answer, `lease-exhausted` and reclaim residuals in
  the next item belong to R-a2.
- **Residuals for the owner:** a paid answer is lost (its reservation stays charged) unless a fenced write commits
  within the 150 s retry budget after the answer and before `lease_until + 180 s` (§4 exact residual; the ~3 s margin
  before the cutoff is a healthy-conditions estimate only); purge of a source whose publication is mid-statement fails with `unavailable` until that statement ends
  (≤ 5 min); crash-looping jobs end `lease-exhausted` 15 min later than today; a dead process's Running jobs are
  reclaimed 180 s later than today.
- **Watch after the next pod restart:** Haystack restarts 0 (a `database-wait` line instead); 57014 and `job held …`
  lines (all cleared within ~15 min, 0 `worker-fault` 57014 failures); after POOL: TIME_WAIT to 5432 (423 → ≈ 0),
  backends per role ≈ P, 0 × 53300, 503 rate, FATAL 28000 lines (only during fencing).
- **Rollback POOL (r2 N5):** the last verified pre-POOL image, i.e. the settled verified commit of the landing set
  deployed before POOL (ANNOT, which contains SMALL and OPS); POOL itself has no schema or config change to undo. Going
  back further crosses landing sets and needs each one's own procedure: ANNOT and OPS (migration 030) per their specs
  (SPEC-G, SPEC-F), SMALL per A10 (`down-029` only if the previous binary refuses 029).
