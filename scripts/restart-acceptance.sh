#!/usr/bin/env bash
# Restart acceptance of Chronicle, Haystack and Manure (docs/drafts/20261123-0055-restart-robustness-spec.md §9), on
# demand, not part of verify. The three service packages of the tree under test (`.#chronicle`, `.#haystack`, `.#manure`:
# the executables of the OCI images) against ONE PostgreSQL 18 + pgvector cluster that the run creates itself under a
# private short temporary root (/tmp/restart-acc.XXXXXX; nix/postgres/provider.py's init and provisioning): max_connections
# 64, superuser_reserved_connections 8, roles with CONNECTION LIMIT 12/8/8 and role settings statement_timeout 30 s,
# lock_timeout 35/5/5 s, idle_in_transaction_session_timeout 60/30/30 s, work_mem 4MB (spec §9); the services' fixture
# databaseLimits (the example configurations' values, maxConnections = the role limit: queue 5 s, connect 5 s, statement
# 30 s, lock 35/5/5 s, idle 60/30/30 s, socket 35/40/40 s; no claim of parity with the chart); Haystack authReloadMs 2000;
# Chronicle's stub models (the STUB of chronicle/scripts/upload-bounds.py, read from the tree); synthetic data only;
# loopback ports the run allocated. It refuses anything it does not own: a directory outside its root or under another
# run's marker, a data directory it did not initialize, a postmaster.pid naming another data directory or port, a
# PostgreSQL port someone else listens on; it sends credentials and probes only to a port that the process it started
# holds alone, checked from /proc right before each request; PostgreSQL tools and the provider run without inherited PG*
# or PONYGIRLS_* variables. Every process it starts is signalled only through a pidfd taken at its start (TERM, then
# KILL, bounded) on exit, also on TERM/INT/HUP. pg_ctl only starts PostgreSQL; every signal to the postmaster (fast or
# immediate shutdown, restart, promote, the final KILL) and every role password sent to its port go through the pidfd of
# the postmaster taken when pg_ctl started it (its command line names this run's configuration; the port held by it);
# without that identity nothing is signalled, the incomplete cleanup is reported and the root kept; otherwise the root is
# removed. A SIGKILL of the script itself cannot be trapped: run it under a TERM-sending timeout. Each case starts its own three processes and stops them at its end. Runtime ≈ 15-40 min.
#
# Pass rules (fixed before any run; spec §9 verbatim; a case that does not exercise its path is INVALID, not PASS):
#   1. Before PostgreSQL: cluster stopped, start the three, start PostgreSQL after 10 s → one `database-wait
#      code=jdbc-08001` line each, ready within 30 s of the PostgreSQL start.
#   2. During 57P03: standby with `hot_standby=off`, promote after 15 s → one `code=jdbc-57P03` line each, ready within
#      30 s after promote. 2b: never promote, `startWaitMs` 10000 → exit 1 within 10–11 s, one `stage=database-wait` line.
#   3. Restart under indexing load, publication slower than requests: 20 synthetic sessions; `statementTimeoutMs` 2000,
#      `publicationStatementTimeoutMs` 10000; trigger on `ch_search_chunks` 3 s per statement, 12 s for 2 min (57014); in
#      that window `pg_ctl restart -m fast` twice, `-m immediate` once → 0 Failed of the 20, all Complete within 20 min
#      after the last restart, ≥ 1 `job held` line (else INVALID), PIDs unchanged, all three 200 afterwards.
#   4. Terminate, fence, unfence: terminate all three roles' sessions; then per role the §10 fence procedure for 30 s,
#      then `LOGIN` → while fenced: REST/HTTP 503 (Chronicle REST, Haystack, Manure), Chronicle WS `unavailable`, MCP tool
#      error `unavailable` (or bearer phase 503), each within queueTimeout + connectTimeout + 1 s; 200 within 15 s after
#      `LOGIN`; PIDs unchanged.
#   5. Occupied port: a listener on each port → exit 1 within 60 s, one `stage=bind code=address-in-use … port=<p>` line.
#   6. Connections per 1,000 transactions (SMALL baseline, POOL): workers idle; 1,000 requests per service (Chronicle MCP
#      `ingest_status`, Haystack item GET, Manure list); SMALL's `pg_stat_database.sessions` delta calibrates the
#      transaction count T; report cold and warm runs separately, sessions × 1000 / T and TIME_WAIT to the PostgreSQL port.
#      POOL pass: warm delta 0, cold ≤ P (10/6/6), backends per role ≤ P at every 1 s sample, no 53300.
# Rule set r5 (focused reviews r1-r4 and a SCOPE CHANGE; before any counted run; history in the ACC bundle's
# PASS-RULES.md): case 4's fenced response contract (503 / WS / MCP unavailable within the bound) is judged on POOL only;
# on SMALL those answers are recorded; termination, fencing, recovery and unchanged PIDs are judged on both sets. SCOPE
# CHANGE (orchestrator, ORCH-REPLY-0430Z item 3): SMALL ships R-a reduced (no reclaim/exhaustion graces, paid-write retry,
# drain/abort: deferred to R-a2 after POOL), so SMALL's case 3 guarantee is 3a and 3b below; rule 3 (the full design) is
# judged on the POOL/R-a2 run. Default cases: SMALL 1 2b 2 5 6 4 3a 3b; POOL 1 2b 2 5 6 4 3a 3b 3.
# How the rules are judged (verdict: INVALID if a mechanics condition failed, i.e. the case did not exercise its path;
# else FAIL if a pass condition failed; else PASS; case 3 is INVALID instead of PASS without its late mechanics; case 6 on
# SMALL is BASELINE, a measurement that POOL judges). Times are monotonic, from the script's spawn of each process and the
# arrival of each output line; "ready" = the service's ready line (`chronicle listening`, `haystack: ready`,
# `MANURE_READY`); "a line" = a complete stdout or stderr line in the spec's format (§1, §3, §4), every field validated,
# optionally behind Chronicle's logger prefix (its columns padded by any number of spaces) and with its `label=name=value` rendering of R-b/R-a fields, counted per
# process. A probe is "ok" only for its decoded success branch (the request's own id where the protocol has one) and
# "unavailable" only for the decoded structured code (HTTP 503 + Failure `unavailable`; Manure `Unavailable` with the
# request's or the nil id; MCP tool error `unavailable`; WS Error `unavailable`, close 1013 or a 503 upgrade).
#   1  mechanics: the cluster is stopped and its port refuses connections when the services start; pg_ctl start at +10 s
#      succeeds and a login works. Pass: per service exactly one `<svc> database-wait code=…` line, its code
#      jdbc-08001; ready after PostgreSQL logged `ready to accept connections` and ≤ 30 s after the start (r5).
#   2b mechanics: the cluster runs as a standby with hot_standby=off and answers a new login with 57P03 before and after.
#      Pass: per service exit code 1 at 10.0–11.0 s after its spawn; exactly one `<svc> failure stage=database-wait` line.
#   2  mechanics: 57P03 before the start and at +15 s; the promotion at +15 s (promote file + SIGUSR1 through the pidfd)
#      leaves recovery and a login works. Pass: exactly one `database-wait code=…` line per service, its code jdbc-57P03;
#      ready after recovery ended (`ready to accept connections` logged) and ≤ 30 s after the promotion (r5).
#   5  mechanics: the run's own listener holds each port throughout. Pass: exit 1 ≤ 60 s after spawn; the process's only
#      failure line is `<svc> failure stage=bind code=address-in-use … port=<its port>`.
#   6  mechanics: all start; no Chronicle job Queued/Running; every request's decoded success; backends sampled every 1 s
#      from before the start; a 30 s idle window. Raw pg_stat_database (sessions, xact) and TIME_WAIT snapshots: before
#      the start, at ready (+11 s flush), after the idle window, after the cold and the warm run (+11 s each). Background
#      sessions/s from the idle window; request sessions = delta − background. T = SMALL's request sessions per run kind;
#      a POOL run needs RESTART_ACC_CALIBRATION = a SMALL report.json whose case 6 is a BASELINE of the same workload with
#      positive T (else usage error, before anything starts). POOL pass: warm sessions delta 0; cold = sessions from
#      before the start through the cold run ≤ P + 1 (R-b's start probe precedes the pool, spec §3); backends per role ≤ P
#      at every sample; no 53300 (server log, service output).
#   4  mechanics: every probe ok first; "terminate": every role's database latched (a superuser transaction holding
#      ACCESS EXCLUSIVE on its tables) so a probe of each service waits with a live backend, every backend of the roles
#      terminated (pg_terminate_backend true for each latched one) and gone, latches released; per role the §10 fence:
#      latch, NOLOGIN, terminate until none remains (≤ 30 s), release, a new login refused 28000. Probes every 1 s for the
#      30 s from NOLOGIN's confirmed commit (rolcanlogin read back false): Chronicle REST = GET /api/ingest/uploads (Ingest bearer), MCP = tools/call ingest_status, WS = a
#      new /api/ws socket (Hello, IngestStatus); Haystack item GET = POST /api/v1/get of a seeded item; Manure =
#      ListArtifacts. Pass (SMALL and POOL): every probe ok ≤ 15 s after the terminations and ≤ 15 s after each LOGIN; the
#      three processes alive with their PIDs at the end. Pass (POOL only): every fenced answer unavailable within
#      queueTimeout + connectTimeout + 1 s of the process's own configuration (11 s here).
#   3a, 3b, 3 share the workload: Chronicle request statement timeout 2 s, publication 10 s; triggers (function-scoped
#      log level) log each publication statement's start, 57014 cancellation and completion with its sessions, sleep and
#      statement_timeout on ch_search_chunks (sleep = control table: 3 s, 12 s in case 3's window), and each ingest's
#      statement_timeout on ch_revisions; 20 sessions ingested, cohort = their receipts' jobs; every cohort ingest ran
#      with 2 s (mechanics). A restart = the shutdown request through the pidfd, then pg_ctl start; it counts when the old
#      postmaster logged `received <mode> shutdown request` and a new one readiness; it interrupted a sampled cohort
#      publication when that backend, sleeping in the trigger when sampled, logged no cancellation, completion, ERROR or
#      FATAL and no exit of it was reported between its start and the shutdown request (after it, a fast shutdown's FATAL
#      explains its end), and no cancellation or completion of it at all until the restart ended (r5). Common pass: no cohort job Failed; all 20 Complete ≤ 20 min after the last restart; every cohort
#      publication statement ran with statement_timeout 10 s; PIDs unchanged; Chronicle REST, Haystack item GET, Manure
#      list ok afterwards; a new ingest still runs with 2 s. Late mechanics: every Complete job's session completed a 3 s
#      sleep under 10 s and has search rows.
#   3a (SMALL scope) one `restart -m fast` right after the ingest, the database up afterwards; the trigger sleeps 12 s until
#      the first cohort publication after the readiness is cancelled (57014 under 10 s), then 3 s; mechanics: the restart's
#      markers, that observed cancellation. Pass: common + every cohort job's attempts = 1 (0 charged) + every cancelled
#      job held for it (`job held`, stage Publication, 57014, ≤ 30 s after) and later published at 3 s under 10 s (r5).
#   3b (SMALL scope, r5 wording: a restart that ends ≥ 10 s before the in-flight job's lease ends charges no attempt; longer
#      outages charge one attempt through reclaim and can lose one paid answer; crashed jobs resume as today) one `restart
#      -m immediate` within 30 s of the first cohort publication, when one sleeps in the trigger (3 s); measured: the restart
#      (shutdown request to readiness) and each Running job's margin = lease_until (sampled right before) − readiness.
#      Mechanics: the markers, a sampled cohort publication interrupted, ≥ 1 interrupted job with margin ≥ 10 s (else
#      INVALID; or a cohort job already Failed). Pass: common + attempts = 1 for every cohort job except Running ones with
#      margin < 10 s (out of scope) + every in-scope interrupted job held for its publication (a fully parsed `job held`
#      line of it, stage Publication, sqlState 08xxx or 57P01-57P03, between the shutdown request and readiness + 30 s).
#   3  (full design, the POOL/R-a2 run) the window of 12 s sleeps opens at the first cohort publication; restarts fast in
#      [20, 45] s, immediate in [50, 80] s, fast in [85, 110] s of the 120 s window, each when a cohort publication sleeps;
#      mechanics: each restart's markers inside the window, a sampled cohort publication interrupted (or a cohort job
#      already Failed), ≥ 1 cohort publication cancelled by 57014 at 12 s inside the window. Pass: common. Late mechanics:
#      a correlated hold — a fully parsed `job held` line of a cohort job, stage Publication, sqlState 57014, ≤ 30 s after
#      its session's 57014 at 12 s under the 10 s publication timeout.
# Case order: 1, 2b, 2, 5, 6, 4, 3a, 3b, 3 (6 before the 3s: idle workers). A named case outside the set's defaults runs
# but does not count for that set. A harness error (an
# unexpected answer of the run's own setup, e.g. an ingest refused) makes that case INVALID and the run continues.
#
# From the repository root of the tree under test (a counted run runs all cases; the order is fixed):
#
#   nix develop .#chronicle --command bash -c '
#     RESTART_ACC_CHRONICLE=$(nix build --no-link --print-out-paths .#chronicle) \
#     RESTART_ACC_HAYSTACK=$(nix build --no-link --print-out-paths .#haystack) \
#     RESTART_ACC_MANURE=$(nix build --no-link --print-out-paths .#manure) \
#     RESTART_ACC_OUT=/absolute/new/directory \
#     timeout --signal=TERM --kill-after=300 3600 scripts/restart-acceptance.sh SMALL|POOL [CASE...] 2>&1 | tee "$RESTART_ACC_OUT.log"'
#
# RESTART_ACC_OUT receives report.json (verdicts, checks, measurements), postgres.log, every service process's output
# (case<id>-<service>.log, seconds since the run's start) and case 3's 1 s timeline. RESTART_ACC_CALIBRATION=<a SMALL
# run's report.json> gives a POOL run SMALL's T for case 6 (required there). Exit 0: every case PASS (or BASELINE);
# 1: a case FAILed; 3: a case INVALID and none FAILed; 2: usage. `scripts/restart-acceptance.sh self-check` runs the
# interlock refusals, the environment sanitizing and the line patterns against the spec's formats and near misses (no
# packages, no cluster, seconds). `scripts/restart-acceptance.sh reparse RUN-DIR` re-evaluates a stored run's log-derived
# checks with e66d4736's patterns and the current ones (offline; database data only as report.json recorded it).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ${1:-} != self-check && ${1:-} != reparse ]]; then
  : "${PG_BIN:?run inside nix develop .#chronicle (PostgreSQL 18 with pgvector)}"
  : "${RESTART_ACC_CHRONICLE:?set RESTART_ACC_CHRONICLE to the .#chronicle package of this tree}"
  : "${RESTART_ACC_HAYSTACK:?set RESTART_ACC_HAYSTACK to the .#haystack package of this tree}"
  : "${RESTART_ACC_MANURE:?set RESTART_ACC_MANURE to the .#manure package of this tree}"
  : "${RESTART_ACC_OUT:?set RESTART_ACC_OUT to a new absolute directory for the report of the run}"
fi
exec python3 scripts/restart-acceptance.py "$@"
