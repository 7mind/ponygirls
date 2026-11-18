# Chronicle browser suites on a loaded host: why they fail, and what fixes it (unit U03b)

Base: integration commit `5b23cef6` (`agent/overhaul`), pool runner `chronicle/web/tests-browser/run-all.mjs`.
Host: 128 vCPU VM, load average 145–240 during every measurement (each run records `uptime` and PSI; raw data under
`/tmp/u03b/`, see "Data"). Evidence labels: **[M]** measured here, **[I]** inferred from measurements, **[S]** read in source.

## 1. Answer

Four independent mechanisms make the suite red; none of them is "the host has no CPU left".

| # | Mechanism | Symptom in the logs | Evidence | Fixable at launch level? |
|---|---|---|---|---|
| A | `tests-browser/harness.tsx` runs the dashboard's connection-liveness detector with sub-second limits (timer pause > 400 ms, pong 300 ms). A main-thread stall of > 400 ms makes the app reconnect and invalidate its snapshot, which resets sort, focus, columns and rows mid-scenario. | `activity-tables`/`ux`: "sort focus survives resource replacement", `aria-sort` `none`, "rows did not match", header locator timeouts | [M] app event log `Timer pause: 404–550 ms → STALE (long resume) → snapshot generation 2` in every failure that prints it; probe gap 517 ms = app's `Timer pause: 517ms`, with 725 ms of long tasks in that window | No: the limits are fixture content (§6 item 1). A bundle makes stalls rarer (B). |
| B | Dev-server pages do 5× more main-thread script work than the production bundle (React development build, ≈ 180–200 unbundled modules per page) | long tasks 250–770 ms in dev, ≤ 315 ms in the bundle | [M] CDP and Long Tasks API, §3.3 | Yes: `CHRONICLE_BROWSER_SERVE=bundle` |
| C | Docker on this host creates and deletes `veth` interfaces; Chromium's network-change notifier then aborts every in-flight request with `net::ERR_NETWORK_CHANGED`. A page that loses one ES module never mounts (31 DOM nodes, no navigation). | "waiting for … 'Main navigation' … 'archive'" for 10/30 s | [M] 3 of 3 traced "navigation missing" failures had `ERR_NETWORK_CHANGED` on their `/@fs/…` module requests; every traced page with the error failed; `ip monitor` shows a `veth` deletion in the same second as an abort | Yes: `CHRONICLE_BROWSER_NETNS=1` (private network namespace); Nix sandboxes are isolated already |
| D | Scenario races hidden by dev-mode latency: waits that observe the *request*, then read the *rendered result* immediately | bundle mode: `activity-tables.mjs:288-290` `filteredIds: []` | [M] probe: rows empty at the first read in 5/5 bundle runs, rendered 24–25 ms later; present in 5/5 dev runs | No (§6 items 3–4) |

Host contention amplifies A–C (the same scenarios needed 2.3× the page CPU time when host idle fell from 64 % to 32 %) but does
not explain them: failures happened at host idle 0.63 with 2 % run-queue delay, and in serial runs (pool 1) at the same rate as
pooled. The load average of 150–240 is runnable threads, not I/O waiters (I/O and memory PSI < 3 %, `procs_blocked` ≈ 1).

**Green rates (full runs, 313 cases each when green):** dev server pool 7: 8/15 untraced (+ 2/7 traced); dev pool 1: 2/5;
production bundle pool 7: 1/8 (all but one failure = race D); **dev + private network namespace pool 7: 8/10, both failures
mechanism A**. The best configuration without scenario edits is therefore `CHRONICLE_BROWSER_NETNS=1` (dev serving).
**The ≥ 14/15 target was not reached and is not reachable without scenario edits**: A and D are scenario/fixture content.
The launch-level switches added here remove B and C; they are opt-in because D makes the bundle worse today and the namespace
needs host tools that the pinned dev shell does not provide (and Nix sandboxes are already isolated).

## 2. Method

- **Host sampler** (`debug/u03b/sampler.py`, throwaway): every 1 s, `/proc/stat` (idle, `procs_running`, `procs_blocked`, context
  switches), `/proc/pressure/{cpu,io,memory}` deltas, and per thread of the run's process tree `/proc/<pid>/task/<tid>/schedstat`
  (on-CPU time and run-queue delay), grouped by process type. "wait-frac" = run-queue delay ÷ (on-CPU + run-queue delay): the share
  of time our threads wanted a CPU and did not get one.
- **Launch-layer trace** (`debug/u03b/trace.mjs`, `NODE_OPTIONS=--import`, not committed): wraps `chromium.launch` and
  `browser.newContext`; per page records navigations, load time, request count, failed requests and HTTP ≥ 400, console errors and
  Vite lines, CDP `Performance.getMetrics` deltas per second (task, script, layout, style, DOM nodes), Long Tasks API entries and a
  100 ms real-timer gap probe (`addInitScript`), connection-widget state and presence of the main navigation; Node event-loop delay.
- **Network monitor**: `ip -timestamp monitor all` during traced runs.
- **Runs**: full runs of `node tests-browser/run-all.mjs` (pool 7 unless stated), solo scripts, and a one-case probe (scratch copy of
  `activity-tables.mjs` with one extra read, deleted afterwards). No scenario file was edited. "passes" = `PASS` lines.
- Runs are sequential, not interleaved: bundle runs met a busier host (mean idle 0.30–0.54 against 0.43–0.57); this works against
  the bundle, but its dominant failure (D) is deterministic in solo runs.
- **Measurement defect found and corrected**: the first trace version installed `process.on('uncaughtException')`; scenarios that
  crashed then exited 0 with cases missing (three "green" traced runs had 295/296 of 313 passes). They are counted as red here.
  Nothing loaded into a scenario process may install such a handler; runners should count cases, not only exit codes.

## 3. Measurements

### 3.1 Host state (question 2)

| Run set | Mean idle | CPU PSI some | I/O PSI some | Mem PSI some | `procs_running` | `procs_blocked` | Ctx switches/s | Our wait-frac |
|---|---|---|---|---|---|---|---|---|
| dev, pool 7, 15 untraced | 0.36–0.66 | 0.17–0.23 | ≤ 0.009 | ≤ 0.031 | 75–127 | 0.2–1.6 | 339–641 k | 0.031–0.119 |
| dev, pool 7, 7 traced | 0.32–0.64 | 0.19–0.29 | ≤ 0.014 | ≤ 0.012 | 77–143 | 0.3–1.7 | 333–475 k | 0.018–0.21 |
| dev, pool 1, 5 | 0.45–0.62 | 0.24–0.51 | ≤ 0.006 | ≤ 0.001 | 92–111 | 0.4–0.9 | 264–354 k | 0.024–0.081 |
| bundle, pool 7, 8 | 0.30–0.54 | 0.17–0.23 | ≤ 0.025 | ≤ 0.012 | 96–139 | 0.3–5.9 | 382–505 k | 0.050–0.307 |
| dev + netns, pool 7, 10 | 0.39–0.70 | 0.19–0.39 | ≤ 0.014 | ≤ 0.008 | 80–152 | 0.0–1.2 | 240–452 k | 0.015–0.094 |

- **Load is runnable threads** [M]: `procs_blocked` 0.2–6, I/O PSI ≤ 2.5 %; `procs_running` ≈ 100 on 128 CPUs with ≈ 50 % idle and
  CPU PSI "some" ≈ 20 %: bursty wake-ups (300–650 k context switches/s), short queues, half-idle averages. No cgroup throttling
  (`cpu.max` = `max` from `user.slice` down, `nr_throttled` 0) [M].
- **Whole-run host metrics do not separate red from green** [M]: red dev runs had wait-frac 0.018–0.21, green ones 0.024–0.082;
  `dt-1` and `dt-2` failed at idle 0.63 and wait-frac ≈ 0.02. Second-scale bursts do coincide with clusters (run `base-1` lost 4
  scripts in one second at `procs_running` 195, idle 0.12, wait-frac 0.41) [M].
- **Pool start is a self-inflicted burst** [M]: each Node scenario process holds 224 `rolldown-worker` threads (Vite 8), ≈ 1,570 for
  seven scripts; in the first second of a dev run, while seven Vite servers pre-bundle dependencies, wait-frac is 0.16–0.58. In one
  run this coincided with a host burst and two first `page.goto` calls exceeded 10 s (`et-1`). In bundle mode the burst comes from
  the runner's own build (1–2 s, before any page opens).
- **A busy host inflates page CPU time** [M, cause I]: identical traced runs used 44 s (idle 0.64/0.53) and 103 s (idle 0.32) of page
  script time; renderer run-queue delay was 0.00–0.03 and 0.21. Queueing alone does not explain a 2.3× CPU-time increase; SMT
  sibling and cache contention in the VM is the likely cause (host frequency and steal are not visible: `st` 0, 2,100 MHz) [I].
- `/dev/shm` is a 788 GB tmpfs (20 MB used); GPU processes are ≈ 5 % of our CPU [M].

### 3.2 Mechanisms A and C in detail (question 1)

**A.** Code path [S]: `src/transport/manager.ts` `tick()` runs every `tickInterval`; a gap above `tickInterval + pauseThreshold`
(100 + 300 = 400 ms in `harness.tsx`) calls `resume(gap >= pongTimeout)`, always "long" with `pongTimeout` = 300 ms, which marks the
live socket STALE, opens a replacement and `invalidate()`s the snapshot. Production values: tick 1,000 ms, pause 2,000 ms, pong
5,000 ms (`types.ts:51-54`). Every `activity-tables` failure that printed the event log (8: 7 in U03's `/tmp/u03-out`, 1 here, plus
3 pauses in `dt-1`) shows `Timer pause: 404–550 ms` followed by the reconnect [M]. The trace probe saw the same 517 ms gap, inside
which the Long Tasks API reported 725 ms of tasks (longest 292 ms); a 436 ms gap in the same page had no long task, i.e. scheduling
delay alone can cross 400 ms [M]. CDP showed that page's main thread 97–98 % busy for seconds with 65 k–130 k DOM nodes [M].
`goal50.tsx:7` uses pong 1,000 ms and production tick limits: same mechanism, wider margin.

**C.** In the traced runs `dt-2` and `dt-4`, all three "Main navigation never appeared" failures (`rebuild`, `run`, `history-find`)
have, on the failing page, 6–19 aborted `/@fs/…` module requests with `net::ERR_NETWORK_CHANGED` within ≈ 100 ms of load, after
which the page stays at 31–34 DOM nodes with ≈ 0 script time until the 10/30 s locator timeout [M]. Across all traced runs that
recorded failed requests (`dt-1…4`, `et-1`), 4 pages had the error and each was the page on which its script failed (the fourth:
`tool-catalog` in `et-1`, "MCP tools" group never visible); no page with the error passed [M]. During run `et-1`, `ip monitor` recorded `[LINK] Deleted … veth… master docker0` at 03:52:34 and the trace
recorded the abort in the same second [M]. The navigation renders only after `Whoami` (`App.tsx:72` `{user && <nav …>}`) [S], so a
failed module import means "navigation never appears". This symptom accounts for 12 of the 26 classified dev-mode script failures
in §3.4 (all pools; 5 of 9 in serial runs) [M]. In bundle mode a page makes ≈ 7 requests instead of ≈ 180, which shrinks the
exposure window; no bundle run showed the symptom (8 runs) [M].

### 3.3 Where the page time goes: dev server versus prebuilt bundle

Pooled at 7, traced. Dev: `bt-1…3`, `dt-1…4` (295–313 passes); bundle: `pptrace-1` (309 passes) [M]:

| | dev server (7 runs) | production bundle |
|---|---|---|
| Page script time (CDP ScriptDuration, all pages) | 38–103 s | 8 s |
| Page main-thread task time | 70–184 s | 44 s |
| Page load, median / p90 | 294–392 / 378–684 ms | 122 / 161 ms |
| Gaps > 400 ms with a long task ≥ 150 ms | 1–60 | 1 |
| Longest long task | 331–772 ms | 315 ms |
| CPU of the whole run (all processes) | 560–879 s | 300 s |
| Node event-loop delay, max | 356–790 ms | 137 ms |

Untraced: dev 103–128 s wall and 526–701 CPU-s; bundle 86–100 s wall and 268–424 CPU-s. Building the eight pages takes 4.1–4.2 s.

### 3.4 Green rates (question 3)

| Configuration | Runs | Green | Script failures by class | Wall |
|---|---|---|---|---|
| U03, dev, pool 7 (other session, for reference) | 13 | 5 | | 95–119 s |
| dev, pool 7, untraced (`base-1…10`, `final-1…5`) | 15 | **8** | A 4, C 4, other 5 | 103–128 s |
| dev, pool 7, traced (`bt-1…3`, `dt-1…4`) | 7 | 2 | A 1, C 3 (`dt`); `bt-2/3` masked, see §2 | 103–142 s |
| dev, pool 1 (`serial-1…5`) | 5 | **2** | A 1, C 5, other 3 | 534–711 s |
| production bundle, pool 7 (`pptrace-1`, `pp-1…7`) | 8 | **1** | D 6, MCP read restart (`goal50.mjs:153`) 1 | 86–100 s |
| dev + `CHRONICLE_BROWSER_NETNS=1`, pool 7 (`ns-1…10`, consecutive) | 10 | **8** | A 2 | 91–139 s |

The namespace runs met a somewhat calmer host (wait-frac 0.015–0.094 against 0.031–0.119), so part of the difference may be
host variation; the class counts are the stronger evidence: C went from 4 script failures in 15 runs (12 of 26 across all dev runs)
to 0 in 10, and the remaining failures are A, which the namespace cannot affect. Combining `NETNS=1` with `SERVE=bundle` was not
measured. The `base-1…10` runs used the runner before this unit's first commit, `final-1…5` the committed runner in its default
(`dev`) mode, whose behaviour is identical; one more default-mode run after the namespace option was added (`check-1`) was green
(313 passes, 110 s). Classes: A = reconnect symptoms in `activity-tables`/`ux`; C = "Main navigation"
never appeared; "other" = locator/`page.goto` timeouts and assertions without trace data.

Bundle-mode race D, isolated [M]: "activity truth lease cells agree with details and lease-unleased metadata filtering"
(`activity-tables.mjs:282-291`) waits until the fixture *received* the sorted request, then reads rows. One-case probe, 5 runs per
mode: dev — rows present at the first read 5/5; production bundle — empty 5/5, rendered 24–25 ms later. A development-mode bundle
(React development build, bundled) fails the same case 2/2, so the exposure comes from bundled loading, not React's production
build. A green bundle run passes the same 313 `PASS` lines as a green dev run (diff empty).

A multi-entry build (all pages in one `vite build`) changed the CSS cascade (masthead 90 px instead of the deployed 58 px;
`popup-regression` and `goal50` layout assertions failed) [M]; one single-entry build per page reproduces it (8/8 and 38/38) [M].

## 4. Root causes, with evidence strength

| # | Cause | Strength | Owner |
|---|---|---|---|
| R1 (A) | Sub-second liveness limits in `harness.tsx` (and `goal50.tsx`) | measured (event logs, probe, code path) | fixture content (UX workstream) |
| R2 (B) | Long page tasks in dev mode | measured (Long Tasks, CDP; ÷ 5 script time with a bundle) | launch layer (bundle) + app |
| R3 (C) | Host network-interface churn aborts in-flight module loads (`ERR_NETWORK_CHANGED`) | measured (3/3 traced failures; same-second `veth` deletion once) | launch layer (network namespace); absent in Nix sandboxes |
| R4 (D) | Assert-before-render races exposed by faster loading | measured (probe 5/5) for `activity-tables.mjs:288-290`; inferred for `goal50.mjs:153` | scenario content |
| R5 | Host bursts lengthen tasks and add queueing (2.3× CPU time; wait-frac up to 0.41 for seconds) | measured per second; weak per run; SMT/cache cause inferred | host |
| R6 | Pool-start thread storm (7 × 224 rolldown workers, dependency pre-bundling) | measured (wait-frac 0.16–0.58 in the first second) | launch layer (bundle removes the per-script part) |
| R7 | Fixed real-time windows (`until` 5–7.5 s, `waitForTimeout` before reads, 300 ms positive waits) | one expiry measured (`activity-tables.mjs:231`); others read in source | scenario content |

## 5. What changed

Committed (launch layer only; command line, existing variables and exit codes unchanged):

- `tests-browser/run-all.mjs`
  - `CHRONICLE_BROWSER_SERVE` = `dev` (default, unchanged) | `bundle`: the runner builds `index.html` and every
    `tests-browser/*.html` once (one single-entry `vite build` per page, which keeps the deployed CSS cascade) and passes
    `CHRONICLE_BROWSER_BUNDLE=<dir>` to every script.
  - `CHRONICLE_BROWSER_NETNS` = `0` (default) | `1`: every script runs under
    `unshare --user --map-root-user --net -- sh -c 'ip link set lo up && exec …'`, so it sees only loopback and no host interface
    events. A probe runs first; if the namespace cannot be created the runner exits 2.
  - Invalid values of either variable exit 2.
- `vite.config.ts`: with `CHRONICLE_BROWSER_BUNDLE` set, a middleware serves that directory ahead of Vite's transforms (after host
  validation and CORS) and dependency pre-bundling is off; unknown paths fall through to Vite (`run.mjs` `ssrLoadModule` works).
  Without the variable the configuration is identical to before; `nix build .#chronicle-web` is unaffected.

Recommended now, without scenario edits: run the suite on this host with `CHRONICLE_BROWSER_NETNS=1` (8/10 against 8/15).

Why both are opt-in:
- `bundle`: 1/8 green today against 8/15 for dev, entirely because of race D. Flip the default (`serveMode()`, one line) after §6
  items 3–4 land, then accept it with 15 pooled runs.
- `netns`: needs `unshare` (util-linux) and `ip` (iproute2) on `PATH`; on this host they come from the user profile and `/usr/sbin`,
  not from the pinned `.#chronicle` dev shell, and Nix sandboxes (U05's `chronicle-browser` check) already have a loopback-only
  network namespace, so the check gains nothing from it. Requested Nix change, if the owner wants it as the developer default: add
  `util-linux` and `iproute2` to the `chronicle` dev shell; then the default can become `1` outside Nix.

Not changed, and why:
- **Chromium flags** (`--disable-gpu`, `--renderer-process-limit`, raster threads, `--disable-dev-shm-usage`): GPU ≈ 5 % of our CPU,
  renderer run-queue delay ≤ 3 % outside host bursts; the stalls are main-thread work these flags do not shorten [M/I]. Chromium has
  no switch to ignore host interface changes [I]; the namespace does it from outside. Not run for a green rate.
- **One shared browser, context per script**: requires every scenario to accept an injected browser (scenario edit).
- **`nice` / affinity**: raising priority needs privileges, lowering it hurts, affinity cannot keep other tenants off our cores.
- **Pool size / order**: pool 1 was no greener than pool 7 (2/5 versus 8/15) and U03 saw 5 of 10 pool 4–6 runs red; our mean demand
  is 4–7 cores of 128. Not changed.
- **Pre-warmed shared dependency cache**: subsumed by the bundle; in dev mode the pool-start burst is real but the failing waits
  are mostly 10–70 s later.

## 6. Scenario-level causes for the dashboard units (question 4)

Paths relative to `chronicle/web/tests-browser/`. Nothing here was edited by this unit.

| # | Location | Wait / value | Why it is fragile | Robust form |
|---|---|---|---|---|
| 1 | `harness.tsx:7-11` | `pongTimeout 300`, `heartbeatInterval 600`, `tickInterval 100` + `pauseThreshold 300`, `staleGrace 900`, `requestTimeout 700`, `connectTimeout 500`, `maxAttempts 3` | Any ≥ 400 ms main-thread stall (or ≥ 300 ms reply delay) reconnects and invalidates all loaded state (A, measured). Used by `activity-tables`, `persistent-login`, `refresh-regression`, `run`, `theme-retry`, `ux`, `ui-controls`. | Default fixture page with production `connectionConfig`; liveness scenarios install `page.clock` and use `pauseAt`/`fastForward`/`runFor` (as `activity-tables.mjs:119,129`, `live-archive.mjs` already do), or a dedicated liveness page. `theme-retry.mjs:119,125,135` depend on the real 600 ms heartbeat and must move to the clock too. |
| 2 | `goal50.tsx:7` | `pongTimeout 1000`, `staleGrace 1000`, `connectTimeout 500`, `maxAttempts 3` | Same mechanism, wider margin; `goal50.mjs:153` (second MCP read restarting at sequence 0) is consistent with a snapshot restart [I]. | As item 1. |
| 3 | `activity-tables.mjs:288-290` | `until(request observed)`, then immediate `rowIds` | Waits for the request, asserts the rendered result: empty in 5/5 bundle probes (D, measured). Blocks the bundle default. | `await until(async () => JSON.stringify(await rowIds(page, '.activity-job-row')) === JSON.stringify([id]), …)` or wait for `aria-busy="false"`, as `:97-98` do. |
| 4 | `goal50.mjs:153` | reads `fixture.calls` for `ReadMcpTest` right after the UI step | Same request-versus-result pattern; failed once in bundle mode. | Wait until the expected second read exists (a `fixture.waitCall`-style promise, as `filter-table-ux.mjs:67` uses). |
| 5 | `activity-tables.mjs:8`, `ux.mjs:37`, `live-archive.mjs:22` | `until`: 150 × 50 ms (7.5 s), 100 × 50 ms (5 s) | Real-time budget; `activity-tables.mjs:231` expired once (R7). | Fixture resolves a promise when the expected call arrives; or `page.waitForFunction` on page state with one suite-wide timeout; under `page.clock`, advance time explicitly. |
| 6 | `run.mjs:462` | `dispatchEvent('resume')`, `waitForTimeout(300)`, then `sockets.length > count` | Positive assertion after a fixed 300 ms. | Wait for the condition (poll `fixture.sockets.length` with the suite timeout). |
| 7 | `run.mjs:453,459`; `live-archive.mjs:33,83` | `waitForTimeout(1200/1000/500/50)` then "nothing happened" | Negative assertions on real time lose power when the page is slow. | `page.clock`: `runFor` past the timer, then assert absence. |
| 8 | `activity-tables.mjs:180,186`; `ux.mjs:99,151,158,357`; `live-archive.mjs:70,141,179`; `run.mjs:272,378`; `refresh-regression.mjs:171` | `waitForTimeout(100–400)` "let it settle" before reading | Settling time depends on load. | Wait for the state "settled" means (row ids, `aria-busy`, a counter). |
| 9 | `refresh-regression.mjs:184`; `run.mjs:157-160` | real 20 s `ARCHIVE_REFRESH_MS`; real 4 s polls with 7 s locator timeouts | Real time sets the script's floor; 3 s margin per poll. | `page.clock.install()` + `fastForward` (plan W6). |
| 10 | `run.mjs:76`, `search-serp.mjs:313` | 10 s busy-wait loops on fixture calls | As item 5. | As item 5. |
| 11 | every scene | first `page.goto`/navigation wait at pool start (10 s default timeouts) | With the dev server, the first page of each script waits for dependency pre-bundling during the pool-start burst (R6); two `goal50.html` loads exceeded 10 s in `et-1`. | Bundle mode (launch) removes it; scenarios should not set per-call timeouts below the suite default for page loads. |

## 7. Rules for every browser check in this repository (Chronicle, Haystack, Manure, shared account views)

1. **No real-time liveness limits in test pages.** Run the app with production timing constants; test timing behaviour with a
   controlled clock (`page.clock`). A sub-second deadline in a test build converts host noise into application state changes that
   look like product defects.
2. **Wait for the rendered result, not for the request.** After an action, wait on the DOM state you assert next (locator
   assertions, `waitForFunction`, `aria-busy="false"`), never on "the fixture saw the request" or a fixed sleep.
3. **Negative assertions use the clock.** "Nothing happens within N ms" only means something when the test advances time.
4. **Event-driven waits, one suite-wide timeout.** Fixtures expose promises for calls they receive; no per-call 5–7.5 s loops.
5. **Serve built assets.** One build per page keeps the deployed CSS cascade; a page then makes ≈ 7 requests instead of ≈ 180,
   does ⅕ of the script work and is not exposed to per-module failures. Keep the dev server for interactive debugging.
6. **Isolate the browser's network on shared hosts.** Container churn (`veth` add/delete) makes Chromium abort in-flight requests
   with `ERR_NETWORK_CHANGED`. Run browser checks in a loopback-only network namespace (Nix sandboxes already are; outside Nix use
   `CHRONICLE_BROWSER_NETNS=1` or the equivalent `unshare -rn`). Use `127.0.0.1`/host-resolver rules, never external names.
7. **Nothing in a scenario process may catch `uncaughtException`/`unhandledRejection`, and runners should count executed cases**:
   a swallowed exception exits 0 with cases missing (observed here).
8. **Measure before tuning**: record `uptime`, PSI, `procs_running`/`procs_blocked` and per-thread run-queue delay with every timing;
   on this host load ≈ 200 means ≈ 100 runnable threads, ≈ 50 % idle CPU and bursty contention, not I/O.
9. **Accept a configuration by repeated runs** (≥ 15 pooled for a default change) and compare case sets between modes: a faster
   harness exposes races a slower one hid.

### How to write a browser check that survives this host

- Production timing in the page; `page.clock.install()` before navigation whenever timers matter.
- After every action, wait for the exact DOM state you assert next; prefer role/label locators with Playwright's auto-waiting.
- Fixtures resolve promises (`waitCall(operation, count)`) instead of being polled with sleeps.
- No `waitForTimeout`, except in an explicitly real-time test whose margins were measured under load.
- One browser and one server per process, a context per scene, no files written by scenes, served from a prebuilt bundle,
  inside a loopback-only network namespace.
- Run it 15× pooled on the loaded host before declaring it stable; report green count, wall time, `uptime` and PSI.

## Data

`/tmp/u03b/` (local to this host, not committed): `summary` (one line per run: exit, passes, wall, load), `<run>/run.log`,
`<run>/samples.jsonl` (sampler), `<run>/trace/*.jsonl` (traced runs: `bt-*`, `dt-*`, `et-1`, `pptrace-1`), `ipmon.log`, `solo/`,
`lease-*.log` (race probe), `analyze.py`, `hostcorr.py`. Throwaway diagnostic scripts: `debug/u03b/` in the unit's worktree
(git-ignored, not committed).
