# Chronicle browser suites on a loaded host: why they fail, and what fixes it (unit U03b)

Base: integration commit `5b23cef6` (`agent/overhaul`), pool runner `chronicle/web/tests-browser/run-all.mjs`.
Host: 128 vCPU VM, load average 150–240 during every measurement below (each run records `uptime` and PSI; raw data
under `/tmp/u03b/`, see "Data"). Evidence labels: **[M]** measured here, **[I]** inferred from measurements, **[S]** read in source.

## 1. Answer in five lines

1. The dominant failure mechanism is **in the page, not in the host scheduler**: the fixture entry `tests-browser/harness.tsx`
   configures the dashboard's connection-liveness detector with sub-second real-time limits (timer-pause threshold 400 ms, pong
   deadline 300 ms). Any main-thread task longer than ≈ 400 ms makes the app declare the socket stale, reconnect and invalidate its
   snapshot, which resets sort state, focus and loaded rows in the middle of a scenario [M].
2. Main-thread tasks of 250–770 ms are common in the dev-server mode the suite uses (React development build, ≈ 125–200 unbundled
   modules per page); the host makes them longer (the same pooled run needed 2.3× the page CPU time when host idle fell from 64 % to
   32 %) [M], but the host is not I/O- or memory-bound: the load is runnable threads, I/O and memory PSI stay below 3 % [M].
3. Serving a **prebuilt production bundle** removes most of that work (page script time ÷ 5.5, CPU of the whole run ÷ 2, wall
   −25 %) and the reconnect-induced failures disappeared in 8 pooled runs [M] — but it **exposes latent assert-before-render races**
   in two scenarios (`activity-tables.mjs:288-290` failed 6 of 8 bundle runs; it read the DOM 24–25 ms before the reply rendered in
   5 of 5 probes) [M]. Green rate: dev 7/10 (+ the runs in §4.4), bundle 1/8. So the bundle is **committed as opt-in**
   (`CHRONICLE_BROWSER_SERVE=bundle`), not as the default.
4. **The ≥ 14/15 target is not reachable without scenario edits.** The remaining causes are scenario-level (§6): the harness
   liveness constants, real-time polling windows, and waits that observe a *request* instead of the *rendered result*.
5. Once the two listed races are fixed, flip the default to `bundle` and re-measure; the mechanism data predict the reconnect
   failures go away with it.

## 2. Method

- **Host sampler** (`debug/u03b/sampler.py`, throwaway): every 1 s, `/proc/stat` (idle, `procs_running`, `procs_blocked`, context
  switches), `/proc/pressure/{cpu,io,memory}` (deltas of `total`), and for every thread of the run's process tree
  `/proc/<pid>/task/<tid>/schedstat` (on-CPU time and **run-queue delay**), grouped by process type (Node test process, Chromium
  browser/renderer/GPU/utility). "wait-frac" below = run-queue delay ÷ (on-CPU + run-queue delay): the share of the time our threads
  wanted a CPU and did not get one.
- **Launch-layer trace** (`debug/u03b/trace.mjs`, loaded with `NODE_OPTIONS=--import`, never committed): wraps `chromium.launch` and
  `browser.newContext`, records per page: navigations, load time, request count, Vite console lines, CDP `Performance.getMetrics`
  deltas every second (TaskDuration, ScriptDuration, Layout, RecalcStyle, DOM nodes), Long Tasks API entries and a 100 ms real-timer
  gap probe injected with `addInitScript`, and the Node event-loop delay of the test process. No scenario file was edited.
- **Runs**: full pooled runs of `node tests-browser/run-all.mjs` (default pool 7), solo runs of single scripts, and one single-case
  probe (a scratch copy of `activity-tables.mjs` with one extra read; deleted afterwards). Every run logs `uptime` and PSI at start
  and end; "passes" = number of `PASS` lines (313 in a fully green run).
- Comparisons are sequential, not interleaved; the bundle runs happened during a busier period (mean host idle 0.30–0.54 against
  0.43–0.57 for the dev baseline). That confound works *against* the bundle in §4.3, and does not explain its dominant failure,
  which is deterministic in solo runs (§3.4).

Measurement defect to avoid (found here): the first trace version installed a `process.on('uncaughtException')` handler, which
turns a crashing scenario into **exit 0 with missing cases**. Three traced runs looked green and were not (295/296 of 313 passes).
They are reported below by their pass counts; the handler was removed. The runner trusts exit codes, so nothing loaded into a
scenario process may install such a handler.

## 3. Measurements

### 3.1 Host state (question 2)

| Run set | Mean host idle | CPU PSI some | I/O PSI some | Memory PSI some | `procs_running` | `procs_blocked` | Context switches/s |
|---|---|---|---|---|---|---|---|
| dev baseline, 10 runs | 0.43–0.57 | 0.17–0.22 | ≤ 0.009 | ≤ 0.011 | 89–127 | 0.2–1.6 | 354–565 k |
| traced dev, 3 runs | 0.32–0.64 | 0.21–0.29 | ≤ 0.005 | ≤ 0.007 | 77–143 | 0.6–1.2 | 347–475 k |
| bundle, 7 runs | 0.30–0.54 | 0.17–0.23 | ≤ 0.025 | ≤ 0.012 | 96–139 | 0.3–5.9 | 382–505 k |

- **The load average of 150–240 is made of runnable threads, not I/O waiters** [M]: `procs_blocked` averages 0.2–6, I/O PSI stays
  below 2.5 %. `procs_running` (≈ 100) is below the CPU count and idle is ≈ 50 %, yet CPU PSI "some" is ≈ 20 %: wake-ups are
  bursty (350–565 k context switches/s), so runnable threads queue for short periods although the average CPU is half idle.
- No cgroup throttling: `cpu.max` is `max` from `user.slice` down to our scope, `nr_throttled` 0 [M].
- Correlation with failures is **weak at whole-run granularity** [M]: our wait-frac was 0.053–0.21 in red dev runs (mean 0.10)
  and 0.031–0.082 in green ones (mean 0.05); host idle overlaps completely. The failures are triggered by second-scale bursts:
  e.g. dev run `base-1` lost 4 scripts within the same second at t ≈ 58–61 s, when `procs_running` jumped to 195, host idle fell to
  0.12 and our wait-frac reached 0.41 [M].
- **Self-inflicted burst at pool start** [M]: every Node scenario process holds 224 `rolldown-worker` threads (Vite 8), i.e. ≈ 1,570
  threads for 7 scripts. In the first second of every dev run, while seven Vite servers pre-bundle dependencies, our wait-frac is
  0.16–0.58. In bundle mode the same burst comes from the runner's own build (0.25–0.89 for 1–2 s); it is before any page opens.
- **Busy host inflates the page's own CPU time** [M, cause I]: traced dev runs did the same scenarios with 44 s (idle 0.64 and 0.53)
  and 103 s (idle 0.32) of page script time; renderer wait-frac was 0.00–0.03 in the first two and 0.21 in the third. Run-queue
  delay alone does not account for the 2.3× CPU-time inflation; SMT-sibling/cache contention on a busy VM is the likely cause (the
  VM does not expose host frequency or steal: `st` = 0, 2,100 MHz constant) [I].

### 3.2 The failure mechanism (question 1)

Every `activity-tables` header-sort failure that printed the dashboard event log (its `aria-sort` diagnostics; 7 U03 logs in
`/tmp/u03-out` and 1 here) shows the same sequence [M]; the other symptom of the same check ("sort focus survives resource
replacement") prints no event log, so its cause is inferred to be the same [I]:

```text
Timer pause: 432ms  →  Socket 1: STALE (long resume)  →  Socket 2: NEW  →  Socket 2: ALIVE, snapshot generation 2
```

Observed pause lengths in those 8 logs: 404–550 ms. The code path [S]: `manager.ts` `tick()` runs every
`tickInterval`; a gap above `tickInterval + pauseThreshold` (100 + 300 = 400 ms in `harness.tsx`) calls `resume(gap >= pongTimeout)`;
with `pongTimeout` = 300 ms that is always a "long resume", which marks the live socket STALE, opens a replacement and
`invalidate()`s the snapshot. The table reloads with its default sort, focus leaves the clicked header, and the scenario sees
`aria-sort="none"`, "sort focus survives resource replacement" = false, empty rows, or a locator that never appears.
Production values are 1,000 + 2,000 ms tick/pause and 5,000 ms pong (`types.ts:51-54`).

What produces the gaps [M]: the Long Tasks API in the page reported tasks of 248–490 ms (bt-2) and up to 772 ms (bt-3) inside the
gaps; CDP `TaskDuration` showed the `activity-tables` page main thread 97–98 % busy for several seconds with 65 k–130 k DOM nodes.
Renderer main-thread run-queue delay was small in the same seconds (≤ 0.14 s/s). So the stalls are page work (React development
render, layout of large tables, module evaluation at load), lengthened by host contention, not the renderer waiting for a CPU.

Other symptoms in the dev baseline: `rebuild`, `popup-regression` and `goal50` failing in the same second of one run (10 s locator
timeouts during the host burst above), and one 7.5 s `until` window expiring (`activity-tables.mjs:231`). `goal50.html`
(`goal50.tsx:7`) uses pong 1,000 ms / stale grace 1,000 ms with production tick limits, so it is less sensitive; the
`goal50.mjs:153` failure (a second MCP read restarting at sequence 0 instead of 40) is consistent with a snapshot restart there
too [I].

The Vite dev server itself is not the bottleneck while pages are open [M]: first page load 0.3–0.4 s median (max 3.1 s, at pool
start), no slow module request after the first page of a script, Node event-loop delay p99 of per-second maxima 190–255 ms. No
Vite-initiated reload was observed: the only second Vite sockets in a page coincide with the scenarios' own `page.reload()` calls.

### 3.3 Where the page time goes: dev server versus prebuilt bundle

Same scenario set, pooled at 7, traced (dev: bt-1 313 passes; bundle: pptrace-1 309 passes) [M]:

| | dev server (bt-1 / bt-2 / bt-3) | production bundle (pptrace-1) |
|---|---|---|
| Page script time (CDP ScriptDuration, all pages) | 44 / 44 / 103 s | 8 s |
| Page main-thread task time | 84 / 70 / 184 s | 44 s |
| Page load, median / p90 | 299–392 / 378–684 ms | 122 / 161 ms |
| Gaps > 400 ms with a long task ≥ 150 ms | 1 / 5 / 60 | 1 |
| Longest long task | 331 / 490 / 772 ms | 315 ms |
| CPU of the whole run (all processes) | 645 / 593 / 879 s | 300 s |
| Node event-loop delay, max | 400–790 ms | 137 ms |

Untraced, the dev baseline used 538–701 CPU-s and 105–128 s wall; bundle runs 268–424 CPU-s and 86–100 s wall. Building the eight
bundle pages takes 4.1–4.2 s (one build per page, see §5).

### 3.4 Green rates (question 3)

| Configuration | Runs | Green | Failing scripts (count) | Wall |
|---|---|---|---|---|
| U03, dev, pool 7 (for reference, other session) | 13 | 5 | activity-tables, run, ux, goal50, … | 95–119 s |
| dev, pool 7 (`base-1…10`, unmodified behaviour) | 10 | **7** | activity-tables 3, rebuild 1, popup-regression 1, goal50 1 | 105–128 s |
| dev, pool 7, traced (`bt-1…3`) | 3 | 1 | activity-tables, ux/transcript (masked, see §2) | 115–142 s |
| production bundle, pool 7 (`pptrace-1`, `pp-1…7`) | 8 | **1** | activity-tables 6 (all at the lease case below), goal50 1 | 86–100 s |
| dev, pool 7, after the change (`final-1…5`) | 5 | see §4.4 | | |
| dev, pool 1 (`serial-1…5`) | 5 | see §4.4 | | |

Bundle-mode failure, isolated [M]: "activity truth lease cells agree with details and lease-unleased metadata filtering"
(`activity-tables.mjs:282-291`) waits until the fixture has *received* the sorted request (`until(() => fixture.calls.some(...))`)
and then reads the rows immediately. A one-case probe (scratch copy, one extra read before the assertion, 5 runs per mode) showed:
dev server — rows present at the first read in 5/5; production bundle — **rows empty at the first read in 5/5, rendered 24–25 ms
later**. A development-mode bundle (React development build, bundled) fails the same case (2/2), so the exposure comes from
bundled loading, not from React's production build [M]. The case set is otherwise identical: a green bundle run passes the same
313 `PASS` lines as a green dev run (diff empty) [M].

A multi-entry build (all pages in one `vite build`) changed the CSS cascade: the masthead measured 90 px instead of the deployed
58 px and `popup-regression`/`goal50` layout assertions failed [M]. One single-entry build per page reproduces the deployed
cascade (both scripts green, 8/8 and 38/38 cases) [M].

## 4. Root causes, with evidence strength

| # | Cause | Strength | Owner |
|---|---|---|---|
| R1 | `harness.tsx` liveness limits (400 ms timer pause, 300 ms pong, 600 ms heartbeat, 700 ms request timeout) turn any long main-thread task into reconnect + snapshot invalidation | measured (event logs of every header-sort failure; code path read) | scenario/harness content (UX workstream) |
| R2 | Long page tasks in dev mode (React development render, unbundled module evaluation, 65–130 k-node tables) | measured (Long Tasks API, CDP metrics; ÷ 5.5 script time with a bundle) | launch layer (bundle) + app |
| R3 | Host bursts lengthen those tasks (CPU-time inflation 2.3×, run-queue delay up to 0.4 of demanded time for seconds) | measured correlation per second; per-run correlation weak; SMT/cache cause inferred | host; not fixable here |
| R4 | Assert-before-render races hidden by dev-mode latency (`activity-tables.mjs:282-291`, likely `goal50.mjs:153`) | measured (probe 5/5) for the first; inferred for the second | scenario content |
| R5 | Fixed real-time windows (`until` 7.5 s, `waitForTimeout` negatives, 7 s locator timeouts on 4 s polls) | measured once (`:231` window expired); others read in source | scenario content |
| R6 | Pool-start thread storm (7 × 224 rolldown workers + dependency pre-bundling) | measured (wait-frac 0.16–0.58 in the first second) | launch layer |

### 4.4 Final measurements of the committed state

(Filled in from `/tmp/u03b/summary` after the runs; see the unit's final message for the same numbers.)

## 5. What changed

Committed (launch layer only):

- `tests-browser/run-all.mjs`: new switch `CHRONICLE_BROWSER_SERVE` = `dev` (default, unchanged behaviour) | `bundle`. In bundle mode
  the runner builds `index.html` and every `tests-browser/*.html` once — one single-entry `vite build` per page into one directory,
  because a multi-entry build changes the CSS cascade — and passes `CHRONICLE_BROWSER_BUNDLE=<dir>` to every scenario process.
  Invalid values exit 2 like the other configuration errors. Command line, other variables and exit codes are unchanged.
- `vite.config.ts`: when `CHRONICLE_BROWSER_BUNDLE` is set, a middleware serves files of that directory before Vite's transforms
  (after Vite's host validation and CORS), and dependency pre-bundling is switched off (nothing in the browser uses it then). Paths
  not in the bundle fall through to Vite (`ssrLoadModule` in `run.mjs` keeps working). Without the variable the configuration is
  identical to before; the production `vite build` (`nix build .#chronicle-web`) is unaffected.

Why opt-in and not default: it is the change that removes R2 and R6 and most of the CPU (§3.3), but with today's scenarios its green
rate is 1/8 against 7/10, entirely because of R4. Flip the default (one line, `serveMode()`) after the two R4 fixes in §6 land, then
run 15 pooled runs.

Not changed, and why:

- **Chromium flags** (`--disable-gpu`, `--renderer-process-limit`, raster thread counts, `--disable-dev-shm-usage`): GPU processes used
  5 % of our CPU and renderer main threads had ≤ 3 % run-queue delay except in host bursts [M]; the stalls are main-thread work, which
  these flags do not shorten. `/dev/shm` is a 788 GB tmpfs, 20 MB used [M]. Not run for a green rate (time); expected effect small [I].
- **Shared browser with a context per script**: needs every scenario to accept an injected browser (scenario edit); the plan's
  "one server and one browser per shard" shape belongs to the UX rewrite.
- **`nice` / CPU affinity**: raising priority needs privileges; lowering it hurts us; affinity cannot keep other tenants' threads off
  the chosen cores. Not attempted.
- **Pool size / ordering**: U03 measured pool 4–6 not reliably green either (`/tmp/u03-out/exp.summary`: 5 of 10 runs at pool 4–6
  red); failures are triggered by in-page thresholds, not by our own CPU share (our mean demand 4–7 cores of 128). Not changed.
- **Shared pre-warmed dependency cache**: in bundle mode the dependency optimiser is off entirely, which subsumes it. In dev mode the
  startup burst (R6) is real but the failing waits happen 20–70 s later; not measured separately.

## 6. Scenario-level causes for the dashboard units (question 4)

Paths relative to `chronicle/web/tests-browser/`. None of these was edited here.

| # | Location | Wait / value | Why it is fragile | Robust form |
|---|---|---|---|---|
| 1 | `harness.tsx:7-11` | `pongTimeout 300`, `heartbeatInterval 600`, `tickInterval 100` + `pauseThreshold 300`, `staleGrace 900`, `requestTimeout 700`, `connectTimeout 500` | A ≥ 400 ms main-thread task or a 300 ms reply delay reconnects and invalidates every loaded table (R1, measured). Used by `activity-tables`, `persistent-login`, `refresh-regression`, `run`, `theme-retry`, `ux`, `ui-controls`. | Default page uses production `connectionConfig`. Scenarios about liveness install `page.clock` and drive pauses with `clock.pauseAt` / `fastForward` / `runFor` (as `activity-tables.mjs:119,129` and `live-archive.mjs` already do), or use a dedicated liveness page. `theme-retry.mjs:119,125,135` rely on the real 600 ms heartbeat and must move to the clock as well. |
| 2 | `goal50.tsx:7` | `pongTimeout 1000`, `staleGrace 1000`, `connectTimeout 500` | Same mechanism, wider margin; `goal50.mjs:153` failure (second MCP read from sequence 0) is consistent with it [I]. | As item 1. |
| 3 | `activity-tables.mjs:288-290` | `until(request observed)` then immediate `rowIds` | Waits for the *request*, asserts the *rendered result*; empty in 5/5 bundle probes, 24–25 ms before render (R4, measured). Blocks making the bundle the default. | Wait for the result: `await until(async () => JSON.stringify(await rowIds(page, '.activity-job-row')) === JSON.stringify([id]), …)` or the table's `aria-busy="false"`, as `:97-98` already do. |
| 4 | `goal50.mjs:153` | reads `fixture.calls` for `ReadMcpTest` right after the UI step | Same request-versus-render pattern; failed once in bundle mode [M]. | Wait until the expected second read exists (`fixture.waitCall`-style helper, as `filter-table-ux.mjs:67` uses). |
| 5 | `activity-tables.mjs:8`, `ux.mjs:37`, `live-archive.mjs:22` | `until`: 150 × 50 ms (7.5 s), 100 × 50 ms (5 s) real-time polling | Real-time budget; `:231` expired once in the dev baseline. | Event-driven: have the fixture resolve a promise when the expected call arrives (`fixture.waitCall`), or `page.waitForFunction` on page state with the suite-wide default timeout; under `page.clock`, advance time explicitly. |
| 6 | `run.mjs:462` | `dispatchEvent('resume')`, `waitForTimeout(300)`, then `sockets.length > count` | Positive assertion after a fixed 300 ms: fails whenever the replacement socket takes longer. | Wait for the condition (`waitForCalls`-style loop on `fixture.sockets.length`), no fixed sleep. |
| 7 | `run.mjs:453,459`; `live-archive.mjs:33,83` | `waitForTimeout(1200 / 1000 / 500 / 50)` then "nothing happened" | Negative assertions on real time: pass vacuously when the page is slow, so they lose power under load rather than fail. | Install `page.clock`, `runFor` past the relevant timer, then assert absence. |
| 8 | `activity-tables.mjs:180,186`; `ux.mjs:99,151,158,357`; `live-archive.mjs:70,141,179`; `run.mjs:272,378`; `refresh-regression.mjs:171` | `waitForTimeout(100–400)` "let it settle" before reading state | Settling time is load-dependent; under load the read races the render. | Wait for the specific state that "settled" means (row ids, `aria-busy`, a counter). |
| 9 | `refresh-regression.mjs:184`; `run.mjs:157-160` (7 s locator timeouts on 4 s polls) | real 20 s `ARCHIVE_REFRESH_MS`, real 4 s polls | Real time is the floor of the script and leaves 3 s margin per poll. | `page.clock.install()` + `fastForward(ARCHIVE_REFRESH_MS)` (plan W6). |
| 10 | `run.mjs:76`, `search-serp.mjs:313` | 10 s busy-wait loops on fixture calls | Same as item 5. | Same as item 5. |

## 7. Rules for every browser check in this repository (Chronicle, Haystack, Manure, shared account views)

1. **No real-time liveness limits in test pages.** Run the app with its production timing constants; test timing behaviour with a
   controlled clock (Playwright `page.clock`). A sub-second deadline in a test build converts host noise into application state
   changes, and the failure then looks like a product defect.
2. **Wait for the rendered result, not for the request.** After an action, wait on the DOM state you will assert (locator assertion,
   `waitForFunction`, `aria-busy="false"`), never on "the fixture saw the request" or on a fixed sleep.
3. **Negative assertions use the clock.** "Nothing happens within N ms" is only meaningful when the test advances time itself.
4. **Polling windows are event-driven or suite-wide.** No per-call 5–7.5 s loops; one default timeout per suite, and fixtures expose
   promises for calls they receive.
5. **Serve built assets in the browser suites.** A prebuilt bundle per page halves the CPU of a Chronicle run and removes
   per-script dependency pre-bundling; per-page builds keep the deployed CSS cascade. Keep the dev server for interactive debugging.
6. **Nothing loaded into a scenario process may catch `uncaughtException`/`unhandledRejection`**, and runners should count executed
   cases, not only exit codes: a swallowed exception exits 0 with cases missing (observed here).
7. **Measure before tuning**: record `uptime`, PSI, `procs_running`/`procs_blocked` and per-thread run-queue delay with every
   timing; on this host load ≈ 200 means ≈ 100 runnable threads with ≈ 50 % idle CPU and bursty contention, not I/O.
8. **Accept a configuration by repeated pooled runs** (≥ 15 for a default change), and compare case sets (`PASS` lines) between
   modes; a faster harness can expose races a slower one hid.

### How to write a browser check that survives this host

- Start the app with production timing; install `page.clock` before navigation when the scenario involves timers.
- After every action, wait for the exact DOM state you assert next; prefer role/label locators with Playwright's auto-waiting.
- Let the fixture resolve promises (`waitCall(operation, count)`) instead of polling arrays with sleeps.
- No `waitForTimeout` except as an explicitly justified real-time test, and then assert with margins measured under load.
- One browser and one server per process; contexts per scene; no files written by scenes.
- Run it 15× pooled at load before declaring it stable; report green count, wall time, `uptime` and PSI.

## Data

`/tmp/u03b/` (local to this host, not committed): `summary` (one line per run: exit, passes, wall, load), `<run>/run.log`,
`<run>/samples.jsonl` (sampler), `<run>/trace/*.jsonl` (traced runs), `solo/`, `lease-*.log` (race probe), `analyze.py`,
`hostcorr.py`. Diagnostic scripts: `debug/u03b/` in the unit's worktree (git-ignored, not committed).
