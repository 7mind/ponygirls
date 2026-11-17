# Test-suite triage — Chronicle dashboard, collector, CLI, protocol codecs, evaluation harness

Source: commit `f153d1ae` (worktree of `main`), 2026-11-17. Analysis only; no product code, test or Nix file was changed.
Raw timing data: `/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/reports/triage-chronicle-clients/` (git-ignored shared scratch).

Notation: **[M]** measured (command given), **[E]** estimated (derivation given), **[S]** static analysis only. ⚑UX = asserts pixel/layout/copy details that the UX workstream will rewrite — do not polish these now.

## 1. Executive summary

**The slow part of this area is not in the Nix build at all.** The routine Nix path for these suites is small; the 628 s lives in a 20-script Playwright chain that no Nix derivation runs.

| path | what runs | now | after verdicts |
|---|---|--:|--:|
| Routine (Nix package builds) | web `npm test` 147 cases; collector `npm test` 152; CLI `npm test` 145 **and again in installCheck** 133; protocol codec script 17 groups | ≈62 s sequential, 56 s critical path (CLI) **[M]** | ≈10 s **[E]**: CLI concurrent 2.4 s **[M]** + 5-case installCheck smoke ≈1 s [E] + collector 5.8 s + web 0.7 s |
| Full manual path (AGENTS.md) | the above + `npm run test:browser` (20 chained scripts, 312 scenario groups) + eval Python 172 + eval Node 29 | ≈ 666 s: browser 628.0 s serial [M] (host load avg 150–175) + 38 s other [M] | ≈ 365 s serial / ≈ 70–90 s wall with 6–8 workers [E] |
| Not runnable here | `chronicle/tests/{workflow,indexing-recovery}.test.ts`, `cuda/*`, `cli/scripts/test-server.py` need a native ELF / GPU / owned PostgreSQL | not measured | stay manual release gates |

Inventory (file-level rows; helpers/fixtures counted): 97 suites/files with cases + 35 helper/fixture files, ≈ 978 cases (browser "case" = one `PASS` scenario group), 14.2 k LOC. File-level verdicts: KEEP 93 files / 7.5 k LOC / 494 cases · REWRITE-CHEAPER 12 / 3.2 k / 353 · MERGE 13 / 1.0 k / 61 · DEMOTE 11 / 2.3 k / 56 · DELETE 3 files / 218 LOC / 14 cases, plus 11 sub-file DELETE cases and the evidence-writer/receipt machinery (section 4). Mixed files carry two verdicts; the JSON lists the sub-file items separately.

Taxonomy shape (constructive-test-taxonomy): web-node, collector (memory/sqlite, dummy/http, dummy/file dual-tests), eval scoring ≈ BA/BG — healthy. CLI and all browser tests are BG-Good (real subprocess or real Chromium + a hand-written in-process fake API, i.e. the `ChronicleFixture` dual-test dummy), with Effectual leakage (state files/permissions; 17 browser files write PNG/JSON evidence to disk). Browser tests are Whitebox-leaning: 521 CSS-class locators vs 1 178 role locators [M: `grep`], 66 `boundingBox/getBoundingClientRect` uses.

### Ten highest-value actions
1. **CLI: run `cli.test.ts` cases concurrently.** 126 cases = 27.8 s serial [M]; the same 126 pass in **2.4 s** 16-way concurrent in a scratch wrapper [M] (each case owns port 0 + temp root). Saves ≈25 s on the routine path.
2. **CLI installCheck: stop re-running 133 cases against the wrapper** (`nix/pkg/chronicle/client.nix:57-60`); a 3–5-case smoke proves the wrapper. Saves another ≈28 s routine [M for the duplicated time].
3. **Browser: one runner, one Vite server, one Chromium, N concurrent scenes.** Today 20 scripts = 20 Vite servers + 20 Chromium launches chained with `&&` (`web/package.json:12`). A single-scene file costs 3.1–3.8 s [M] ≈ almost all fixture. ≈ 45–50 s [E] fixture saving, and removes the serial chain.
4. **Replace the two real-time waits with `page.clock`:** `refresh-regression.mjs:171-174` waits the real 20 s `ARCHIVE_REFRESH_MS` (scene 21.0 s of 26.2 s [M]); `run.mjs` collector-snapshot scene waits real 4 s polls (29.2 s [M]). ≈ −39 s [E].
5. **Demote/delete ⚑UX layout groups** (tab-layout, popup-regression matrix, activity-layout, rebuild-occlusion, responsive/geometry groups in search-serp/history-find/rebuild/theme-retry/usage): ≈ 135 s of the 628 s [M group times + E] — about a fifth. Keep one contrast + no-overflow invariant sweep for the redesign.
6. **Table-drive repeated scenarios:** rebuild "invalid <field> status" ×5 (22.8 s [M]), 11 "bulk …" groups (23.9 s [M]), ux "every typed header sort" (24.7 s [M]), search-serp failure variants. ≈ −58 s [E].
7. **Delete evidence machinery:** screenshot/metrics/results writes in 17 browser files (one targets repo-level `.local/ui-evidence`), the Nix fixture-count pin + `protocol.json` receipt, `ast`/source-slicing tests in eval (`test_workflow_v3.py:266-272`, `agent_bindings.test.mjs:10-13`), CSP grep of `Http.scala` from a browser test (`theme-retry.mjs:183`).
8. **Fold `chronicle-protocol` into the web check** (same npm deps, same tsc, 0.12 s of actual test) — removes a derivation with its own `fetchNpmDeps` and a regex-over-stdout receipt.
9. **Merge duplicates:** loaded-chain refresh/prune contract asserted 3× (`ux.mjs:122-144`, `refresh-regression.mjs`), usage presentation ×2, bulk/receipt matrix ×4 (activity-tables, ui-controls, goal50, mutations.test.ts), `source-filters` (1 scene, 3.1 s). Rename `goal50*` (a historical goal label) and flatten the 3-deep fixture chain `ChronicleFixture → Goal50Fixture → History/SearchFixture`.
10. **Make the browser gate an explicit separate Nix/CI check, sharded**, and change AGENTS.md from "complete `test:browser` before every Chronicle task" to core smoke per UI change + full on release; retire the eval v2/legacy layer (10 cases now, more after owner decision, Q2).

## 2. Method and measurement conditions

- Host: 128 cores shared with ~8 other agents. `uptime` load average: 131.98 (20:43), 140–175 during browser runs, ≈150 during Node suites (files `*.uptime`, `times.tsv` `load_at_start`). All wall times are therefore inflated by an unknown factor and **noisy**; the host was never idle. Comparisons within this report (serial vs 7-way parallel of the same scripts) are the reliable signal: run.mjs 65.5 s serial vs 65.6 s in the 7-way run [M], i.e. contention was host-dominated, not self-inflicted.
- Toolchain: `nix develop .#chronicle` (Node 24.22.2, Python 3.14.10, `PLAYWRIGHT_BROWSERS_PATH` = pinned playwright-browsers store path, Chromium 1248). `node_modules` for web/collector/tests were **copied from the main checkout** (lockfiles verified identical with `diff`), `cli` via `npm ci --offline`; no unpinned installs.
- Commands [M]: web `node --experimental-transform-types --import ./tests/resolve-generated.mjs --test … tests/*.test.ts`; collector `npm run build` then `node --test dist/collector/test/*.test.js`; CLI same pattern; eval `python3 -m unittest discover -s chronicle/eval/relevance/tests -v` and `node --test tests/*.test.mjs`; codecs `tsc …` + `node scripts/codec-fixtures.mjs`. Per-case wall times from JUnit XML (`*.junit.xml`, `junit-per-file.json`). Browser: each script in `npm run test:browser` chain order via `run-one.sh` (`ser/times.tsv`, serial), a 7-way parallel run (`par/times.tsv`), and a timestamp-preload run (`ts-preload.mjs`, `groups/*.log`) for per-scenario-group timings. Browser "cases" are `PASS` lines (scenario groups), not assertions (876 source lines contain `assert.`).
- First browser attempt (a `nohup` background chain) died when its tool call ended after 3 groups; discarded and re-run with `setsid`. Vite printed ≈277 `EMFILE … watch` errors per script while `fs.inotify.max_user_instances` was 128 (host hazard, fixed 20:55Z → 8192); all 20 scripts passed regardless, and the serial timing run (20:46–20:57) pre-dates the fix. No LD_PRELOAD shim, sbt, JVM or PostgreSQL was used in this area. My worktree had no fsmonitor daemon; git commands use `-c core.fsmonitor=false`.
- Timings that include parallelism-induced and host-load effects are marked as such. Per-module Python timings are not available (`unittest` reports only the 2.8 s total).
- **Not run (cannot):** `chronicle/tests/workflow.test.ts` (timeout 240 s) and `indexing-recovery.test.ts` (360 s) need a native ELF (none present: `chronicle/target/native` absent) plus PostgreSQL/pgvector; `cuda/*` needs GPUs (opt-in, skips otherwise); `cli/scripts/test-server.py` needs a real server and owned PG; the Scala suites invoked by `test-codecs.sh` are the server triage's. These are **[S]** only.
- Which Nix derivation runs what [S, read from `nix/pkg/chronicle/*.nix`]: `web.nix` checkPhase = `npm test` (typecheck + vite build are build steps); `collector.nix` = `npm test`; `client.nix` = `npm test` plus `installCheckPhase` re-running `cli.test/transport.test/presentation.test` against `$out/bin/chronicle`; `protocol-validation.nix` = tsc + `codec-fixtures.mjs` + python receipt. `chronicle-cli` is a package (not a flake check); `chronicle-web`/`chronicle-collector` are checks. Browser tests, `chronicle/tests/**`, eval tests: **no** derivation (grep over `nix/`, `flake.nix`).

## 3. Inventory

Seconds: per-file sum of case times (Node suites, parallel across files so wall = max file), serial wall of the script (browser; load 150–175), blank = not measured. Rationale column is the first sentence only; the JSON has the full text.

### 3.1 Dashboard Node tests (`chronicle/web/tests`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `web/tests/archive-requests.test.ts` | 6 | 61 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: Archive read permit/queue invariants; ~11 ms total. |
| `web/tests/archive-search-source.test.ts` | 6 | 55 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: ArchiveSearch response validation; ~4 ms total. |
| `web/tests/baboon.test.ts` | 7 | 86 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: generated codec negotiation, version rejection; ~6 ms total. |
| `web/tests/client-deadline.test.ts` | 6 | 152 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: client read/mutation deadlines (fake clock); ~20 ms total. |
| `web/tests/connection.test.ts` | 29 | 159 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: WS heartbeat/reconnect state machine (fake timers); ~26 ms total. |
| `web/tests/evolution.test.ts` | 2 | 25 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: codec evolution i64/null; ~4 ms total. |
| `web/tests/expression.test.ts` | 9 | 73 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: expression composition + shared mode fixtures; ~8 ms total. |
| `web/tests/goal50.test.ts` | 11 | 85 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: completion/passage/MCP/usage decoders (misnamed: "goal50" is a historical goal label); ~8 ms total. |
| `web/tests/highlight.test.ts` | 5 | 30 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: UTF-8 span highlight; ~7 ms total. |
| `web/tests/infinite.test.ts` | 2 | 13 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: infinite-list merge; ~2 ms total. |
| `web/tests/message-format.test.ts` | 8 | 40 | 0.4 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: message block/inline parsing incl. 300k-char ReDoS subprocess guard; ~436 ms total. |
| `web/tests/metadata-expression.test.ts` | 3 | 17 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: metadata quick filters; ~5 ms total. |
| `web/tests/mutations.test.ts` | 8 | 88 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: typed bulk/receipt result validation; ~3 ms total. |
| `web/tests/progress.test.ts` | 2 | 16 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: byte/window formatting; ~1 ms total. |
| `web/tests/recorded-yolo-profile.test.ts` | 2 | 15 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: recorded yolo-profile claim parsing (shared JSON cases); ~3 ms total. |
| `web/tests/reindex-status.test.ts` | 3 | 23 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: reindex cohort status; ~3 ms total. |
| `web/tests/search-source.test.ts` | 7 | 67 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: search source/context validation; ~4 ms total. |
| `web/tests/session-find.test.ts` | 4 | 38 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: Find permit/page validation; ~3 ms total. |
| `web/tests/session-renewal.test.ts` | 8 | 102 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: cookie renewal scheduling (fake clock); ~44 ms total. |
| `web/tests/source-view.test.ts` | 3 | 24 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: source view identity; ~1 ms total. |
| `web/tests/table-widths.test.ts` | 4 | 28 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: table width fitting arithmetic; ~10 ms total. |
| `web/tests/theme.test.ts` | 7 | 65 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA + dual-test | KEEP | Pure-function/fake-clock contract: theme policy + shared dummy/browser contract + prepaint initializer; ~25 ms total. |
| `web/tests/tool-examples.test.ts` | 3 | 34 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: curated MCP request examples; ~6 ms total. |
| `web/tests/uuid.test.ts` | 2 | 28 | <0.1 | routine: chronicle-web package checkPhase (npm test); check chronicle-web | node only | BA | KEEP | Pure-function/fake-clock contract: UUIDv4 entropy source; ~2 ms total. |

### 3.2 Dashboard browser tests (`chronicle/web/tests-browser`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `web/tests-browser/run.mjs` | 23 | 509 | 65.5 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER | Core dashboard contracts (auth lifecycle, source pinning, reconnect, uncertain mint, ANN counts). |
| `web/tests-browser/ux.mjs` | 37 | 400 | 105.9 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER | Archive sort/relevance/infinite-list + (via activity-tables.mjs) 22 Activity/bulk groups; 38 groups, 105.9 s. |
| `web/tests-browser/activity-tables.mjs` |  | 332 |  | full only; in no Nix check | Chromium (shares ux.mjs server) | BG-Good | MERGE→ux.mjs / new bulk-mutations scenario | Imported by ux.mjs only (ux.mjs:398). 22 groups of which 11 "bulk ..." groups (23.9 s) re-test the retry/apply/receipt state machine already pinned by mutations.test.ts:19-88 and ui-controls.mjs:73-100, goal50.mjs:76-84. |
| `web/tests-browser/activity-layout.mjs` |  | 63 |  | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good, Effectual | DELETE ⚑UX | Evidence writer, not a contract: 12 scenes (6 viewports x 2 schemes) writing PNGs + metrics.json (activity-layout.mjs:25,34,39,47,62); asserts the PNG header width equals viewport*dpr (activity-layout.mjs:45 - tests Playwright, not the product); hard-codes pixel constants (USAGE_TABLE_MIN_WIDTH=720, geometry tolerance) |
| `web/tests-browser/goal50.mjs` | 38 | 265 | 61.0 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | MERGE→topical files (completion.mjs, usage.mjs, mcp-tester.mjs) ⚑UX | Misnamed historical goal label (goal50) covering 38 groups: completion/IME, usage, MCP tester, tab content. |
| `web/tests-browser/goal50-fixture.mjs` |  | 74 |  | full only; in no Nix check | n/a | helper | MERGE→fixture.mjs | Goal50Fixture extends ChronicleFixture; HistoryFixture and SearchFixture extend Goal50Fixture (history-fixture.mjs:6, search-fixture.mjs:3). |
| `web/tests-browser/history-fixture.mjs` |  | 36 |  | helper | n/a | helper | MERGE→fixture.mjs | Helper: HistoryFixture (extends Goal50Fixture). |
| `web/tests-browser/search-fixture.mjs` |  | 72 |  | helper | n/a | helper | MERGE→fixture.mjs | Helper: SearchFixture (extends Goal50Fixture). |
| `web/tests-browser/goal50.tsx` |  | 8 |  | helper | n/a | helper | MERGE→harness.tsx | goal50 harness entry; fold into harness.tsx with the fixture merge. |
| `web/tests-browser/goal50.html` |  | 1 |  | helper | n/a | helper | MERGE→harness.tsx | goal50 harness entry; fold into harness.tsx with the fixture merge. |
| `web/tests-browser/filter-table-ux.mjs` | 7 | 68 | 13.8 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER ⚑UX | 7 groups: inline shortcut composition + clear/Escape/IME are valuable behaviour; table-fit/resize/sticky/narrow-layout groups (filter-table-ux.mjs:38-67) assert pixel geometry and write metrics.json -> UX-bound. |
| `web/tests-browser/history-find.mjs` | 39 | 197 | 38.6 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP ⚑UX | Find-in-history UI: 39 groups, 38.6 s; mostly state-machine/authority fences (private draft cleared on ACL/pin/account change) - genuine security/concurrency contracts. |
| `web/tests-browser/live-archive.mjs` | 9 | 192 | 12.4 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP | Debounce/coalescing/permit contracts with controlled clock (page.clock x25); 9 groups, 12.4 s. |
| `web/tests-browser/persistent-login.mjs` | 12 | 150 | 17.1 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP | Real cookie/HttpOnly/persistent-profile behaviour (persistent-login.mjs:129-141) cannot be proven without a browser; 12 groups, 17.1 s; renewal scene (3.9 s) uses real time but short. |
| `web/tests-browser/popup-regression.mjs` | 8 | 130 | 47.2 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | DEMOTE ⚑UX | One scenario repeated over 6 viewport x theme combos (1440/1280/320 x light/dark; 6 s each, 47.2 s) = pixel hit-test grid + screenshots (popup-regression.mjs:19-50,83,88). |
| `web/tests-browser/prior-error-regression.mjs` | 8 | 39 | 3.8 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | MERGE→activity scenario file (ux/activity) | Small (3.8 s) regression: retained errors shown as provenance, not failure colour; asserts computed colour equality only (not pixel values). |
| `web/tests-browser/rebuild.mjs` | 37 | 89 | 93.9 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER ⚑UX | 37 groups, 93.9 s (largest file). Reindex-status state machine: 5 near-identical "invalid <field> status" scenes (22.8 s) -> one table-driven scene; 6 viewport/theme fit scenes (6.9 s) -> UX; core cohort/permit/uncertain-Apply/retirement-focus groups are valuable. |
| `web/tests-browser/rebuild-occlusion.mjs` | 4 | 54 | 5.4 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | DEMOTE ⚑UX | Hit-test geometry at 320/390 px x 2 themes for one fixed health chip vs Cancel button (rebuild-occlusion.mjs:21-37). |
| `web/tests-browser/refresh-regression.mjs` | 4 | 204 | 26.2 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER ⚑UX | Waits REAL 20 s for Archive poll (ARCHIVE_REFRESH_MS=20_000 src/Archive.tsx:20; loop refresh-regression.mjs:171-174; no page.clock in file): final scene 21.0 s of 26.2 s. |
| `web/tests-browser/search-serp.mjs` | 45 | 383 | 53.9 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER ⚑UX | 45 groups, 53.9 s. Many "<failure> clears excerpts without fallback" variants repeat one authority-fence scenario (search-serp.mjs:205-360); table-drive into one scene with failure matrix. |
| `web/tests-browser/source-filters.mjs` | 1 | 39 | 3.1 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | MERGE→history-find.mjs (already chained: npm run test:history) | 1 scene (3.1 s of which ~all fixture: vite+chromium start) asserting recorded-agent/profile filter composition; expression composition is already covered by expression.test.ts:40-68 + recorded-yolo-profile.test.ts. |
| `web/tests-browser/tab-layout.mjs` | 12 | 93 | 22.7 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | DELETE ⚑UX | 6 widths x 2 themes x 5 tabs (22.7 s) asserting pixel-equal gutters (tab-layout.mjs:71-75, 22/14/10 px), banner copy absence list `junk` (tab-layout.mjs:15-21,77-80), screenshots (tab-layout.mjs:78). |
| `web/tests-browser/theme-retry.mjs` | 11 | 211 | 25.2 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | REWRITE-CHEAPER ⚑UX | 11 groups, 25.2 s. Real contracts (storage denied/invalid, System follows device, CSP prepaint) keep; but (a) runs a full `vite build` inside the test (theme-retry.mjs:182) duplicating the package build -> consume dist from the build; (b) greps server source Http.scala for the CSP string (theme-retry.mjs:183) -> DELETE |
| `web/tests-browser/tool-catalog.mjs` | 6 | 129 | 8.3 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP | 6 groups, 8.3 s: tab ARIA roving focus, stale-definition replacement, authority-loss erase; narrow-viewport reflow group (tool-catalog.mjs:110-125) and screenshots are UX-bound but small. |
| `web/tests-browser/transcript.mjs` | 1 | 77 | 6.6 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP | Exact Unicode copy content, inert untrusted markup, UTF-8 highlight (6.6 s). Geometry/screenshot tail (transcript.mjs:48) UX-bound but cheap. |
| `web/tests-browser/ui-controls.mjs` | 8 | 137 | 13.7 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | KEEP | Toast/notification boundary and receipt-recovery contracts (13.7 s). Overlaps bulk groups in activity-tables (see MERGE) - make this the single owner of the receipt-recovery UI matrix. |
| `web/tests-browser/usage-presentation.mjs` | 2 | 38 | 3.7 | full only; in no Nix check | Chromium, vite dev server, hand-written ChronicleFixture | BG-Good | MERGE→goal50.mjs usage group (-> usage.mjs) ⚑UX | 2 theme scenes (3.7 s) asserting presentation of in-flight/empty/unknown/zero usage; duplicates goal50.mjs "usage exactly four purposes ... |

### 3.3 Collector (`chronicle/collector/test`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `collector/test/admission.test.ts` | 26 | 351 | 5.6 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: profile admission policy memory/sqlite dual contract, HTTP hold/replay, SQLite snapshot isolation (real worker thread + SQLITE_BUSY); 5.58 s. |
| `collector/test/cli.test.ts` | 15 | 246 | 3.2 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: collector CLI config/status/controls (spawned processes); 3.19 s. |
| `collector/test/collector.test.ts` | 8 | 201 | 1.4 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: collector engine: quiet evidence, lost-ACK restart, privacy cancel; 1.38 s. |
| `collector/test/controls.test.ts` | 25 | 268 | 3.0 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: dynamic exclusion/pause controls memory/sqlite; 2.98 s. |
| `collector/test/discovery.test.ts` | 5 | 108 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: native/yolo/subagent discovery bounds; 0.03 s. |
| `collector/test/formats.test.ts` | 2 | 47 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: three formats end-to-end; 0.02 s. |
| `collector/test/git.test.ts` | 4 | 60 | 0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: git port dummy/local contract + timeout; 0.13 s. |
| `collector/test/ingest.test.ts` | 10 | 103 | 0.2 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: HTTP ingest policy and receipts; 0.19 s. |
| `collector/test/parsers.test.ts` | 9 | 120 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BA | KEEP | Product contract: Claude/Codex/Pi parsers; 0.01 s. |
| `collector/test/privacy.test.ts` | 2 | 18 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BA | KEEP | Product contract: redaction; 0.00 s. 18 LOC; may be folded into runtime-privacy.test.ts (organisational only; no time gain). |
| `collector/test/profiles.test.ts` | 3 | 75 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: recorded yolo profile roots; 0.03 s. |
| `collector/test/progress.test.ts` | 13 | 134 | 0.8 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: progress reporting dummy/http contract; 0.78 s. |
| `collector/test/runtime-privacy.test.ts` | 18 | 149 | 0.5 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: secret reader dummy/file contract + rotation; 0.50 s. |
| `collector/test/shutdown.test.ts` | 6 | 104 | 1.5 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good | KEEP | Product contract: SIGTERM/SIGINT durability (spawned collector); 1.54 s. |
| `collector/test/spool.test.ts` | 3 | 75 | 0.2 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BG-Good / dual-test | KEEP | Product contract: spool memory/sqlite contract + crash-safe lock; 0.23 s. |
| `collector/test/status.test.ts` | 3 | 45 | <0.1 | routine: chronicle-collector package checkPhase (npm test); check chronicle-collector | node (node:sqlite, git, spawned collector for cli/shutdown) | BA | KEEP | Product contract: human status rendering; 0.02 s. |

### 3.4 CLI (`chronicle/cli/test`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `cli/test/cli.test.ts` | 126 | 494 | 27.8 | routine: chronicle-client checkPhase (npm test) AND again in installCheckPhase against installed wrapper (client.nix:57-60) | node, loopback HTTP/WS fixture per case, one spawned CLI process per invocation (69 spawns) | BG-Good + Effectual | REWRITE-CHEAPER | 27.8 s serial for 126 cases because tests in a file run serially and each spawns node. MEASURED: identical 126 cases pass in 2.4 s when run 16-way concurrent (each owns port 0 + temp root) - make them concurrent. |
| `cli/test/contracts.test.ts` | 5 | 44 | <0.1 | routine: chronicle-client checkPhase | node only | BG | MERGE→contracts.test.ts | Absorbs more-contracts.test.ts (same purpose, name is a symptom). First case contracts.test.ts:9-16 regex-parses models/chronicle.baboon and compares to operationNames; `npm run build` already runs `scripts/schema.mjs --check` which regenerates schema-data.ts from that model (schema.mjs:25-26) -> keep only the operatio |
| `cli/test/more-contracts.test.ts` | 7 | 48 | <0.1 | routine: chronicle-client checkPhase | node only | BA | MERGE→contracts.test.ts | Pure parsing/validation contracts (strict JSON, pin retargeting, bearer alphabet); valid but file split by accretion. |
| `cli/test/presentation.test.ts` | 3 | 31 | <0.1 | routine + installCheck | node, spawned CLI | BG | KEEP | Colour/presentation. |
| `cli/test/transport.test.ts` | 4 | 62 | 0.6 | routine + installCheck | node, loopback sockets | BG-Good | KEEP | Real deadline/socket-ownership assertions (0.64 s): worth their cost. |
| `cli/scripts/test-server.py` |  | 307 |  | manual only (cli/README, `npm run test:server`); wired to no Nix check; not executed here | real native server + PostgreSQL wrapper | BG-Good | DEMOTE | Real-server CLI acceptance; already outside routine path. Could not run (needs CHRONICLE_SERVER and owned PG fixture). |

### 3.5 Protocol codecs

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `scripts/codec-fixtures.mjs` | 17 | 35 | 0.1 | check chronicle-protocol (separate derivation) + test-codecs.sh | node, tsc output | BG | KEEP | Only TS<->server wire-parity assertion (17 golden groups, 0.12 s). Historical api14..api19 goldens are decoded by the CURRENT codec only (codec-fixtures.mjs:26-33), so they are shape fixtures, not compat tests; fine. |
| `scripts/test-codecs.sh` |  | 7 |  | full only (AGENTS.md) | tsc + sbt | glue | KEEP | Glue: tsc + codec-fixtures + 3 Scala suites (server area, other triage). |
| `nix/pkg/chronicle/protocol-validation.nix` |  | 48 |  | check chronicle-protocol | separate npm deps fetch + tsc + python | validation machinery | MERGE→nix/pkg/chronicle/web.nix checkPhase | Whole derivation = tsc + 0.12 s script + python regex that parses stdout and writes protocol.json receipt with a hard-coded group count (protocol-validation.nix:expectedFixtureGroups=17, checkPhase python). |

### 3.6 Native acceptance (`chronicle/tests`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `tests/workflow.test.ts` | 1 | 462 |  | manual only (README/operations.md); no Nix check; not runnable here (needs native ELF) | native ELF, PostgreSQL+pgvector, Chromium, openssl, keytool, MCP SDK; timeout 240 s | E-Good | DEMOTE | Single-case end-to-end (collector->archive->annotation->WS->MCP->ACL->restart + one Chromium probe); the only real-server dashboard test. |
| `tests/indexing-recovery.test.ts` | 1 | 231 |  | manual only (tests/README.md); not runnable here (needs native ELF) | native ELF, PostgreSQL+pgvector, loopback model server; timeout 360 s | E-Good | DEMOTE | Durability/restart/retry assertion on the real native artifact; genuinely valuable, inherently slow -> release gate only. |

### 3.7 CUDA opt-in (`chronicle/tests/cuda`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `tests/cuda/native.test.ts` | 1 | 254 |  | opt-in (CHRONICLE_CUDA=1; test-cuda.sh) - skipped otherwise | GPU endpoints, native ELF, PG | E-Good | DEMOTE | Already opt-in; keep as is. |
| `tests/cuda/endpoints.test.ts` | 1 | 48 |  | opt-in (CHRONICLE_CUDA=1) | GPU embedding endpoint | E-Good | DEMOTE | Already opt-in; real-model behaviour only measurable on GPU. |

### 3.8 Relevance evaluation, Python (`chronicle/eval/relevance/tests`)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `eval/relevance/tests/test_assess_batch.py` | 8 | 209 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | DEMOTE | Captured-batch re-assessment adapter (assess_batch.py); lineage/hash/relabel guards on one-shot tooling for already captured runs. |
| `eval/relevance/tests/test_assessment_v3.py` | 28 | 267 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG | KEEP | V3 scoring semantics (support, qualifier, ACL leak vs integrity failure, role conformance): core evaluator correctness. |
| `eval/relevance/tests/test_proposition_support.py` | 17 | 291 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | DEMOTE | proposition-support-v2 operators, unchanged beside V3 (V3_ASSESSMENT.md:5); used only by assess_batch.py. |
| `eval/relevance/tests/test_relevance.py` | 11 | 255 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG | KEEP | Retrieval metric semantics + origin/listener guards of the bridge. |
| `eval/relevance/tests/test_runner_integration_v3.py` | 11 | 223 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | REWRITE-CHEAPER | Hash/fingerprint/policy-binding machinery; 2 cases guard retired behaviour: test_historical_seed_requires_explicit_matching_legacy_policy (:136) and test_legacy_fingerprint_is_only_labelled_not_recomputed (:193) -> DELETE; rest is receipt machinery -> DEMOTE. |
| `eval/relevance/tests/test_runtime.py` | 12 | 249 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | DEMOTE | Offline clone/schedule/cleanup of the eval runtime (real file copies); harness plumbing, not product. |
| `eval/relevance/tests/test_search_diagnostics_report.py` | 16 | 252 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG | KEEP | Diagnostic ladder maths (RRF ties, budgets) against retrieval formula; guards real ranking semantics. |
| `eval/relevance/tests/test_semantic.py` | 4 | 78 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG | KEEP | Semantic task ACL/fixture semantics (small; may merge into test_relevance). |
| `eval/relevance/tests/test_source_observations_v3.py` | 23 | 260 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | REWRITE-CHEAPER | Source-observation validation (UTF-8 endpoints, pins) is valuable; 5 legacy-format cases (test_source_observations_v3.py:189-240: recorded_schema_flat_pins, unpinned_legacy_result, recorded_legacy_default..., legacy_nested_view..., legacy_revision_only) only support re-reading pre-V3 traces -> DELETE. |
| `eval/relevance/tests/test_text_presentation_v1.py` | 16 | 247 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG | KEEP | Text presentation fail-closed decoding (shares Scala renderer fixture); real contract between server text output and evaluator. |
| `eval/relevance/tests/test_workflow_v3.py` | 26 | 273 |  | manual (AGENTS.md relevance workflow); in no Nix check | python3 stdlib | BG / validation machinery | REWRITE-CHEAPER | Ingest/provision validation; test_fingerprint_scope_matches_actual_unchanged_legacy_function (:266-272) parses run_real.py with ast and compares a literal - source-text assertion -> DELETE; many fingerprint/hash-determinism cases are receipt machinery -> DEMOTE. |

### 3.9 Relevance evaluation, Node

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `eval/relevance/tests/agent_bindings.test.mjs` | 3 | 51 | <0.1 | manual (AGENTS.md); in no Nix check | node | BG / validation machinery | REWRITE-CHEAPER | agent_bindings.test.mjs:10-13 slices the TEXT of agent_probe.mjs and executes it via new Function - implementation trivia; call the exported verifyCatalogV3 (already imported) directly. |
| `eval/relevance/tests/agent_protocol_v3.test.mjs` | 6 | 88 | <0.1 | manual (AGENTS.md); in no Nix check | node | BA | KEEP | Uniform prompt/catalog/answer-schema guards. |
| `eval/relevance/tests/probe_policy_v3.test.mjs` | 3 | 43 | <0.1 | manual (AGENTS.md); in no Nix check | node | BG / validation machinery | DEMOTE | Probe policy/admission checks ahead of browser launch for the live provider workflow. |
| `eval/relevance/tests/protocol.test.mjs` | 7 | 70 | <0.1 | manual (AGENTS.md); in no Nix check | node | BA | KEEP | Evidence-gap search protocol, call pairing against recorded generated ToolResult. |
| `eval/relevance/tests/reparse.test.mjs` | 2 | 62 | 0.1 | manual (AGENTS.md); in no Nix check | node | BG / validation machinery | DELETE | reparse.test.mjs:43-52: one-shot repair of recorded historical batches (recorded-tool-pair.json), bytes-preserved assertions about a migration tool; replays frozen logs. |
| `eval/relevance/tests/text_presentation.test.mjs` | 8 | 94 | <0.1 | manual (AGENTS.md); in no Nix check | node | BA | KEEP | JS twin of text-presentation decoding (shares fixture with Python). |

### 3.10 Helpers, fixtures and harness entries (no cases of their own)

`web/tests/fakes.ts` (65 LOC, KEEP); `web/tests/theme-contract.ts` (21 LOC, KEEP); `web/tests/tool-catalog-fixture.ts` (25 LOC, KEEP); `web/tests/resolve-generated.mjs` (8 LOC, KEEP); `web/tests-browser/fixture.mjs` (336 LOC, KEEP); `web/tests-browser/table-controls.mjs` (12 LOC, KEEP); `web/tests-browser/harness.tsx` (12 LOC, KEEP); `web/tests-browser/harness.html` (1 LOC, KEEP); `web/tests-browser/catalog.tsx` (19 LOC, KEEP); `web/tests-browser/catalog.html` (1 LOC, KEEP); `web/tests-browser/live-archive.tsx` (8 LOC, KEEP); `web/tests-browser/live-archive.html` (1 LOC, KEEP); `web/tests-browser/mutations.tsx` (44 LOC, KEEP); `web/tests-browser/mutations.html` (1 LOC, KEEP); `web/tests-browser/notifications.tsx` (42 LOC, KEEP); `web/tests-browser/notifications.html` (1 LOC, KEEP); `web/tests-browser/resources.tsx` (51 LOC, KEEP); `web/tests-browser/resources.html` (1 LOC, KEEP); `collector/test/helpers.ts` (9 LOC, KEEP); `collector/test/fixtures/claude.jsonl` (5 LOC, KEEP); `collector/test/fixtures/claude-subagent.jsonl` (2 LOC, KEEP); `collector/test/fixtures/codex.jsonl` (10 LOC, KEEP); `collector/test/fixtures/codex-paginated.jsonl` (7 LOC, KEEP); `collector/test/fixtures/pi.jsonl` (9 LOC, KEEP); `tests/cuda/support.ts` (36 LOC, KEEP); `tests/cuda/fixtures.ts` (17 LOC, KEEP); `tests/archive-expression-cases.json` (42 LOC, KEEP); `tests/recorded-yolo-profile-cases.json` (126 LOC, KEEP); `eval/relevance/tests/v3_cases.py` (81 LOC, KEEP); `eval/relevance/tests/workflow_cases_v3.py` (192 LOC, KEEP); `eval/relevance/tests/data/recorded-agent-catalog.json` (74 LOC, KEEP); `eval/relevance/tests/data/recorded-native-facets-tool-content.json` (14 LOC, KEEP); `eval/relevance/tests/data/recorded-tool-pair.json` (27 LOC, KEEP); `eval/relevance/tests/data/text-presentation-v1-context.json` (1 LOC, KEEP); `eval/relevance/tests/data/proposition-source-subset.json` (437 LOC, KEEP)

### 3.11 Sub-file items (DELETE / MERGE / REWRITE evidence; counted in section 4, not in file totals)

| path | cases | LOC | s | runs-in | needs | tags | verdict | rationale |
|---|--:|--:|--:|---|---|---|---|---|
| `web/tests-browser/run.mjs:81-97` | 1 | 17 | 2.4 | full only; in no Nix check | n/a | sub-file item | DELETE ⚑UX | Asserts promotional headings are absent and exact footer/brand text (run.mjs:88-92): copy-text trivia, invalidated by redesign. |
| `web/tests-browser/goal50.mjs:27-30` |  | 4 |  | full only; in no Nix check | n/a | sub-file item | DELETE ⚑UX | `banned` regex asserting generic tutorial banner text is absent on every tab (absence-of-copy assertion). |
| `web/tests-browser/tab-layout.mjs:15-21,77-80` |  | 12 |  | full only; in no Nix check | n/a | sub-file item | DELETE ⚑UX | `junk` list of removed banner strings asserted absent (copy-text). |
| `web/tests-browser/theme-retry.mjs:183` |  | 1 |  | full only; in no Nix check | n/a | sub-file item | DELETE | Reads server Http.scala and greps for the CSP string from a browser test (source-text assertion across components); replace with a server-side header test. |
| `web/tests-browser/*.mjs (screenshot()/writeFile evidence)` |  | 0 |  | full only; in no Nix check | n/a | sub-file item | DELETE | 17 files write PNG/metrics.json/results.json evidence (grep writeFile\|screenshot; e.g. activity-layout.mjs:34,47; rebuild-occlusion.mjs:22,37,53 -> repo-level .local/ui-evidence). |
| `web/tests-browser/refresh-regression.mjs:171-174` | 1 | 4 | 19.0 | full only; in no Nix check | n/a | sub-file item | REWRITE-CHEAPER | Real-time 20 s wait for Archive poll; use page.clock.fastForward(20_000). Measured scene 21.0 s. |
| `web/tests-browser/ux.mjs:122-144 vs refresh-regression.mjs:57-124,160-203` | 1 | 23 |  | full only; in no Nix check | n/a | sub-file item | MERGE→refresh-regression.mjs (single refresh/prune scenario) | Same contract (loaded-chain refresh is atomic, authorized shrink prunes IDs, no prepend, focus/anchor preserved) asserted three times at resource-harness, Archive-table and modal level. |
| `web/tests-browser/run.mjs:157-160` | 1 | 4 | 29.2 | full only; in no Nix check | n/a | sub-file item | REWRITE-CHEAPER | Collector snapshot scene waits real 4 s polls (waitFor timeout 7000, twice); install page.clock. |
| `collector/test/admission.test.ts:77-79` | 1 | 3 | <0.1 | routine: chronicle-collector checkPhase | n/a | sub-file item | DELETE | Duplicate of decodeOrigin({kind:['native']}) assertion at admission.test.ts:58. |
| `cli/test/contracts.test.ts:9-16` | 1 | 8 | <0.1 | routine: chronicle-client checkPhase | n/a | sub-file item | DELETE | Regex-parses models/chronicle.baboon (source text) to compare operation names; `scripts/schema.mjs --check` (run by npm build/typecheck, schema.mjs:25-26) already enforces schema-data.ts == model. |
| `cli/test/cli.test.ts:424-484 (UUID family)` | 18 | 61 | 3.1 | routine: client checkPhase + installCheck | n/a | sub-file item | REWRITE-CHEAPER | 18 subprocess cases around sameUuid/validateResponse canonicalisation; test as pure functions (src/wire.ts), keep 2 end-to-end. |
| `eval/relevance/tests/test_source_observations_v3.py:189-240` | 5 | 52 |  | manual | n/a | sub-file item | DELETE | Five legacy-trace-format cases (recorded flat pins, unpinned legacy result, legacy default paging, nested view, revision-only) - only support re-reading pre-V3 captured traces. |
| `eval/relevance/tests/test_runner_integration_v3.py:136,193` | 2 | 25 |  | manual | n/a | sub-file item | DELETE | Historical-seed and legacy-fingerprint labelling cases: guard retired behaviour. |
| `eval/relevance/tests/test_workflow_v3.py:266-272` | 1 | 7 |  | manual | n/a | sub-file item | DELETE | ast-parses run_real.py and compares a literal table: source-text assertion. |
| `nix/pkg/chronicle/protocol-validation.nix (expectedFixtureGroups, protocol.json receipt)` |  | 12 |  | check chronicle-protocol | n/a | sub-file item | DELETE | Count pin (17) and python regex receipt over script stdout: tests the evidence, not the codec. |
## 4. Detailed findings

### 4.1 DELETE

| item | evidence | why junk |
|---|---|---|
| Screenshot / `metrics.json` / `results.json` writers in 17 browser files | `activity-layout.mjs:34,47,62`; `history-find.mjs:10,194,197`; `popup-regression.mjs:83,88,129`; `rebuild-occlusion.mjs:11,22,37,53` (writes to repo-level `../../../.local/ui-evidence/phase3/occlusion/<phase>`); `search-serp.mjs:74,380,382`; `tab-layout.mjs:78,92`; `theme-retry.mjs:167,177,207`; `tool-catalog.mjs:66,121,125`; … | Evidence artifacts nothing consumes (no visual comparison anywhere); cost I/O, create shared output paths, produce receipts instead of assertions. |
| `activity-layout.mjs` (63 LOC, 12 scenes, 16.9 s inside goal50) ⚑UX | `:45` asserts the PNG header width equals viewport×dpr (tests Playwright, not the product); `:25-62` constants `USAGE_TABLE_MIN_WIDTH=720`, geometry tolerance | Pixel/evidence harness; UX workstream rewrites layout. |
| `tab-layout.mjs` (93 LOC, 22.7 s) ⚑UX | `:71-75` pixel-equal gutters (22/14/10 px); `:15-21,77-80` `junk` list asserts removed banner copy is absent; `:78` screenshots | Asserts layout numbers and the absence of marketing strings. Kernel (default tab; table-options button in header) is covered by `ui-controls.mjs:101`. |
| Copy-text scenes: `run.mjs:81-97` (headings/footer/brand), `goal50.mjs:27-30` (`banned` regex), `tab-layout.mjs:15-21` | exact strings `'C·chronicle'`, `'Chronicle'` footer, banned-tutorial regex | Absence/identity of copy; changes with every wording edit. |
| `theme-retry.mjs:183` `readFile(…/Http.scala)` + `includes(csp)` | source-text assertion across components | Replace by a server-side test of the real response header (server triage). |
| `admission.test.ts:77-79` | duplicates the `decodeOrigin({kind:['native']})` assertion at `:58` | Strictly redundant. |
| `contracts.test.ts:9-16` | regex-parses `models/chronicle.baboon`; `npm run build`/`typecheck` already run `scripts/schema.mjs --check` (`cli/package.json:13-14`, `schema.mjs:25-26`) | Duplicated by the build-time generator check (keep the `operationPolicy`-keys line). |
| `reparse.test.mjs` (2 cases) | `:43-52` repairs recorded historical batches, asserts bytes preserved | One-shot migration tool for frozen captured runs. |
| `test_source_observations_v3.py:189-240` (5 cases) | `legacy_events`, "recorded_schema_flat_pins", "legacy_revision_only" | Only keeps pre-V3 trace formats readable. |
| `test_runner_integration_v3.py:136,193`; `test_workflow_v3.py:266-272` | historical-seed policy; legacy fingerprint labelling; `ast.parse(run_real.py)` literal compare | Retired behaviour; source-text assertion. |
| Nix count pin + receipt: `protocol-validation.nix` `expectedFixtureGroups = 17`, python regex over stdout writing `protocol.json` | `nix/pkg/chronicle/protocol-validation.nix` | Tests the evidence (a number printed by the script), not the codec. Policy also hard-coded in README ("17 fixture groups"). |

### 4.2 MERGE

- **Refresh/prune contract ×3** → `refresh-regression.mjs`: `ux.mjs:122-144` ("multi-page refresh prunes revoked IDs, preserves focus/anchor, no prepend") vs `refresh-regression.mjs:60-124` ("infinite chain atomic refresh, authoritative shrink, no prepend, focus/anchor continuity") vs `refresh-regression.mjs:167-203` (periodic refresh preserves DOM identity; shrink clears row and modal). Same invariants at hook-harness, table and modal level; keep the hook-harness one and one Archive end-to-end.
- **Bulk/receipt matrix ×4** → one table-driven scenario owned by `ui-controls.mjs`: `activity-tables.mjs:188-303` (11 groups, 23.9 s [M]), `ui-controls.mjs:73-100`, `goal50.mjs:76-84`, plus pure semantics already in `mutations.test.ts:19-88`.
- `activity-tables.mjs` is imported only by `ux.mjs:398` — it is part of `ux`, not a suite; `ux` = 38 groups / 105.9 s [M] (largest script with `rebuild` 93.9 s).
- `usage-presentation.mjs` (3.7 s, 2 theme scenes) → usage group of `goal50.mjs` (`goal50.mjs` "usage exactly four purposes … unknown zero N/A"); `goal50.test.ts:67` already pins the data semantics.
- `source-filters.mjs` (1 scene, 3.1 s ≈ all fixture) → history/search file; filter composition is pinned by `expression.test.ts:40-68`, `recorded-yolo-profile.test.ts`.
- `prior-error-regression.mjs` (3.8 s) → activity scenario file.
- Fixture chain `fixture.mjs` ← `goal50-fixture.mjs:5` ← `history-fixture.mjs:6`, `search-fixture.mjs:3`; `goal50.*` named after a historical goal.
- `cli/test/more-contracts.test.ts` → `contracts.test.ts` (same purpose; the name is the symptom).
- `protocol-validation.nix` → `web.nix` checkPhase (same `fetchNpmDeps` hash, same tsc).
- Test bootstrap shared by `chronicle/tests/workflow.test.ts` and `indexing-recovery.test.ts` (`port()`, `run()`, `stopProcess`, PG init, model fixture duplicated).

### 4.3 REWRITE-CHEAPER

| test | problem | cheaper vehicle |
|---|---|---|
| `cli/test/cli.test.ts` 126 cases, 27.8 s | serial in-file execution; 69 node spawns | `describe(…, {concurrency})`: 2.4 s measured (scratch copy, not committed). Safe: fixtures own port 0 + temp root. |
| CLI UUID family `cli.test.ts:424-484` (18 cases, 3.1 s) | subprocess + HTTP/WS fixture to test `sameUuid`/`validateResponse` | pure tests on `src/wire.ts`; keep 2 end-to-end. |
| `client.nix` installCheck | re-runs 133 cases on the installed wrapper | 3–5 smoke cases (help, one RPC, exit codes). |
| `refresh-regression.mjs:171-174` | real 20 s wait on `ARCHIVE_REFRESH_MS` (`src/Archive.tsx:20`); file has no `page.clock` | `page.clock.install()` + `fastForward(20_000)`. |
| `run.mjs:157-160` collector-snapshot scene (29.2 s) | real 4 s Activity polls (`src/progress.ts:10`), `waitFor({timeout:7000})` ×2; file has no `page.clock` | fake clock. |
| `ux.mjs`/`activity-tables.mjs:74` header sorts (24.7 s) | ≈ 2×N clicks, each a full round trip, to assert a column→sort-enum mapping | pure mapping test (`tests/`), 1–2 browser clicks. |
| `rebuild.mjs` (93.9 s) | 5 near-identical "invalid <field> status" scenes (22.8 s); poll scheduling and permit logic is pure in `src/reindex-status.ts` | table-driven single scene; scheduling in a node fake-clock test next to `reindex-status.test.ts`. |
| `search-serp.mjs:205-360` | ≈ 20 variants of "<failure> clears excerpts, no fallback" | one scene, failure matrix. |
| `theme-retry.mjs:182` | runs a full `vite build` inside the test | consume `dist` produced by the package build; assert CSP header via server test. |
| `agent_bindings.test.mjs:10-13` | slices *text* of `agent_probe.mjs` and runs it through `new Function` | call exported `verifyCatalogV3` directly (already imported at `:4`). |

### 4.4 DEMOTE (keep, out of the routine/mandatory path)

`popup-regression.mjs` matrix (keep 1 scene), `rebuild-occlusion.mjs`, `usage` layout, every ⚑UX geometry group until the redesign lands (`npm run test:ux-layout`, off the AGENTS.md gate); `chronicle/tests/{workflow,indexing-recovery}.test.ts`, `cuda/*`, `cli/scripts/test-server.py` (already manual); eval `test_assess_batch.py`, `test_proposition_support.py` (v2 operators, only `assess_batch.py` imports them), `test_runtime.py`, receipt/fingerprint cases of `test_runner_integration_v3.py`/`test_workflow_v3.py`, `probe_policy_v3.test.mjs`.

### 4.5 KEEP — and why (so nobody deletes these by pattern)

- Web node suite: 147 cases in 0.64 s total [M]; pure/fake-clock contracts, including genuine concurrency/deadline logic (`connection.test.ts` 29 cases, `client-deadline.test.ts` — 60 s expiry despite live heartbeats, `session-renewal.test.ts`) executed on controlled clocks: the model the browser suite should follow. The only subprocess case (`message-format.test.ts:29-34`, 300 000-char ReDoS guard, 0.43 s) is a real deadline assertion.
- Collector: 152 cases / 5.7 s wall [M]; already dual-tested (memory↔sqlite, dummy↔http, dummy↔file, dummy↔local-git) and covering durability (lost-ACK restart), privacy and signals. Real concurrency: `admission.test.ts:286` (worker thread, `SQLITE_BUSY`, 1.07 s), `shutdown.test.ts` (SIGTERM/SIGINT ×3 phases, 1.54 s). Nothing to delete beyond one duplicate.
- Authority-fence/security groups in `history-find`, `search-serp`, `live-archive`, `persistent-login` (real cookie/HttpOnly/persistent profile `persistent-login.mjs:129-141`), `tool-catalog`, `transcript`.
- `codec-fixtures.mjs` (only TS↔server wire parity), `recorded-yolo-profile`/`archive-expression-cases` shared JSON tables.
- Eval scoring semantics: `test_relevance`, `test_semantic`, `test_assessment_v3`, `test_search_diagnostics_report`, `test_text_presentation_v1` (+ Scala renderer fixture).
- `transport.test.ts` real deadline/socket-ownership.

## 5. Parallelism blockers and plan

Observed [M]: all 20 browser scripts ran **7-way concurrently and passed** (`par/times.tsv`; wall ≈ 105 s = the longest script `ux` 104.6 s, vs 628 s serial sum), so there is no hidden cross-file state in practice. Static blockers:

| blocker | where | cost to fix |
|---|---|---|
| Serial `&&` chain | `web/package.json:12` (`test:browser`) and chained sub-scripts `test:rebuild/history/popups` | replace with one runner (Node `--test` or a small pool) |
| One Vite dev server + one Chromium per file; no reuse | every `tests-browser/*.mjs` (`createServer({port:0})`, `chromium.launch`) | single shared server/browser; scenes get `newContext` (already the pattern) |
| Scenes sequential inside a file | `await group(…)`, `await scene()` loops; `errors`/`results` module-level arrays per file | give each scene its own `errors`; run scenes with bounded concurrency (cap ≈ CPU/2) — scenes already own a context + fixture instance |
| `vite build` into shared `web/dist` | `theme-retry.mjs:182` (collides with `npm run build`) | consume prebuilt `dist` |
| Fixed output dirs | `test-results/<name>/` per file (separate, safe); `rebuild-occlusion.mjs:11` → repo `.local/ui-evidence/phase3/occlusion/<phase>` (shared for same `OCCLUSION_PHASE`) | delete evidence writers |
| Env-var case filters, time-stamped dirs | `CHRONICLE_*_CASE`, `new Date().toISOString()` dirs | none needed |
| `cli.test.ts` serial within file | node:test default | `describe` concurrency; verified 126/126 pass at 16-way [M] |
| Collector admission/controls serial in file | node:test default | optional; wall is 5.7 s already (files parallel: cumulative 16.6 s [M]) |
| Eval | `unittest discover` serial, 2.8 s | no action |
| `chronicle/tests/*` acceptance | each starts its own PG on `port()`; CUDA run is `--test-concurrency=1` (`test-cuda.sh`) on shared GPU endpoints (legitimate) | parallelisable but heavy; leave manual |
| Ports | none fixed: `port: 0`, `allowedHosts: ['chronicle.test']` + host-resolver rules; fixture HTTP/WS servers listen on 0 | — |
| Nix | web, collector, client, protocol are separate derivations (already concurrent); the browser gate has no derivation | add one sharded check (`chronicle-web-browser`), N shards by file list |

Cheapest route: (1) CLI concurrency flag (minutes of work, −25 s); (2) a ≈40-line runner `tests-browser/run-all.mjs` that starts one Vite server + one Chromium and executes the existing scene functions through `node:test` `concurrency: N`; (3) shard across derivations for CI. Host note: Playwright default timeouts are 5–10 s; at load 150 a 7-way run was fine, but cap workers and keep the existing `setDefaultTimeout`s.

## 6. Projected impact

| metric | current | after verdicts | after parallelism |
|---|--:|--:|--:|
| Routine Nix tests (web+collector+CLI+protocol), seconds | ≈ 62 [M] | ≈ 10 [E] | critical path ≈ 6 [E] |
| Routine case executions (CLI counted twice) | 594 | ≈ 465 [E] | same |
| Browser serial wall | 628.0 s [M] | ≈ 350 s [E] | 7-way measured 105 s (ux-bound) → ≈ 45–60 s with shard/split [E] |
| Browser scenario groups / scripts / Vite+Chromium launches | 312 / 20 / 20 | ≈ 215 / 1 runner / 1 [E] | — |
| Full-gate total (browser + others) | ≈ 666 s [M] | ≈ 365 s [E] | ≈ 70–90 s [E] |
| Test LOC (files in this inventory) | 14.2 k | ≈ 12.9 k [E] (−tab/activity-layout/occlusion/usage, popup matrix, fixture merge, eval legacy) | — |
| Eval cases | 201 | 191 after the 10 listed deletions [S]; more if v2 is retired (Q2) | — |

Browser saving breakdown [E unless noted]: UX-bound layout groups ≈ −135 s (tab-layout 22.7 [M], popup 47.2→6, activity-layout 16.9 [M], occlusion 5.4 [M], search-serp responsive 11.7 [M], history geometry 10.7→2, rebuild fit 6.9 [M], theme visual 7.9 [M], run branding 2.4 [M], usage 3.7→1.5, other narrow-viewport groups ≈ 11); fake clocks ≈ −39; table-driving ≈ −58; shared server/browser ≈ −48. Sum ≈ −280 s. Idle-host timings would be lower for everything; relative shares should hold.

## 7. Risks of acting on these verdicts, and how to verify nothing valuable was lost

- **Coverage of regressions in merged/rewritten groups.** Before deleting a browser group, list the operations/failure codes it drives (`fixture.calls` operation classes, `Failure` codes) and assert the replacement exercises the same set; for each regression-tagged group find its introducing commit (`git log -S'<group name>'`) and keep the repro. Mutation smoke: for the five authority-fence families, temporarily disable the corresponding clear-on-denial branch in `src` and confirm the *new* suite fails (old suite is the oracle: run both on each mutant).
- **Fake clocks can hide real timer interplay** (`ARCHIVE_REFRESH_MS`, Activity poll). Keep one real-time smoke (≤5 s poll) in the demoted tier and re-run it per release.
- **Concurrent scenes under host load** can introduce flakiness; start with 4 workers, require 20 consecutive green runs, never lengthen timeouts to compensate.
- **Table-driven scenes lose failure locality**; name each row and print it on failure.
- **UX-bound deletion** removes the only contrast/overflow checks until the redesign: keep one invariant sweep (WCAG text contrast 4.5, control 3, no document overflow) across all tabs × light/dark × 320/1440 and re-derive layout tests from the new design.
- **CLI concurrency** relies on each case owning its port/root; verified 126/126 [M] once — repeat ×10 before merging.
- **Eval deletions** assume captured v2 runs are finished (Q2); if they are still re-assessed, keep `test_assess_batch.py`/`reparse`.
- **Un-run acceptance** (`chronicle/tests/*`) was not executed here; no verdict relies on its results.
- Verification of the implementation phase: run old and new suites side by side on the same commit; compare operation-coverage sets; report case counts/seconds per suite before/after with `uptime`.

## 8. Documentation and policy text that must change

- Root `AGENTS.md` "Chronicle validation": the Dashboard bullet mandates the "complete `npm run test:browser`"; the Relevance bullet mandates `unittest discover` + live-provider/held-out wording; the Protocol bullet mentions the explicit current-API check. Rewrite to the new tiers (routine / browser core / browser full / ux-layout / acceptance) and drop the evidence-recording sentences that only exist for receipts.
- `chronicle/README.md` ("Fast Nix checks and full agent verification": "17 fixture groups", "13 explicitly named … suites", the `chronicle-protocol`/`chronicle-validation` receipts) and `chronicle/web/README.md:85-105` (enumerates browser scripts with counts: "all 22 retained browser scenario groups", "34 additional", "seven controlled", sections for `goal50`, `tab-layout`, …; `:105` screenshots statement; `:119` "Goal50 selectors").
- `chronicle/cli/README.md` (`test:server`), `chronicle/tests/README.md` ("separate, older acceptance entrypoint" wording), `chronicle/docs/operations.md:172` (names `tests/workflow.test.ts`), `chronicle/eval/relevance/README.md` (unittest command; v2/legacy descriptions), `shared/retrieval-postgres/VALIDATION.md:49` ("172 cases passed" — frozen count).
- `web/package.json` scripts (`test:browser` chain, `test:goal50`, `test:tabs`, …), `client.nix` installCheck, `protocol-validation.nix`, `chronicle/tests/package.json` (`test` runs only `workflow.test.ts`; `tsconfig.json` includes only it).
- `chronicle/scripts/fast-suites.txt` and `test-fast.sh` are the server's (other triage); nothing in my area uses an allowlist, but `source.nix` hashes `web/tests`, `tests-browser` and `chronicle/tests` into the package source, so **any test edit rebuilds the web/collector packages** — moving tests to a separate source set (as `ontology/web/tests*` already is) would stop test-only edits from invalidating package builds.

## 9. Open questions (with recommendation)

1. Should the browser gate get its own sharded Nix/CI check? *Recommend yes; keep it out of the package build.*
2. Is the eval v2 layer (`proposition_support`, `assess_batch`, `reparse`, legacy trace formats) still used for captured runs? *Recommend retire after archiving results; until then DEMOTE.*
3. Delete UX-bound layout tests now or when the redesign lands? *Recommend: demote now (`test:ux-layout`, not on the AGENTS gate), delete when the new design merges.*
4. May AGENTS.md downgrade "complete browser gate on every Chronicle task" to core smoke + release-full? *Recommend yes; otherwise the 628 s chain stays mandatory.*
5. Which CLI cases form the installed-wrapper smoke? *Recommend `--help`, one bearer read, one uncertain-mutation exit code, one usage error, one presentation case.*
6. Native acceptance and `test-server.py` were not run; are their costs known? *Needed before judging the whole Chronicle full-verification path.*
7. Behaviour with no test (brief, not exhaustive) [S]: the collector's packaged wrapper (`collector.nix` has no installCheck, unlike the CLI); the server-sent CSP header (only grep'd); a built `dist` served by the real server outside the manual `workflow.test.ts`; macOS discovery (simulated `platform` parameter only); only Chromium is used though Firefox/WebKit are in the pinned browser path; `cli/scripts/test-server.py` is wired to nothing.

## Appendix: raw data

`reports/triage-chronicle-clients/`: `ser/times.tsv` (serial per-script), `par/times.tsv` (7-way), `groups/*.log` (per-group timestamps), `*.junit.xml`, `junit-per-file.json`, `eval-python.log`, `cli-conc.txt` (concurrency experiment), `*.uptime`, driver scripts `run-one.sh`, `run-ser.sh`, `run-par.sh`, `ts-preload.mjs`. Machine-readable inventory: `docs/drafts/20261117-2040-test-triage-chronicle-clients.json` (`subFile:true` rows are sub-file items; totals above use file-level rows only).
