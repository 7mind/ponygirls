# Chronicle tab consistency and copy review

Base: `ea7de16d`. Requested scope: normalize all tab workspaces to Archive's width/gutters and remove redundant page headings, self-description and tutorial prose. No API/controller, search semantics, authorization or mutation behavior changes. No publication, downstream pin update or activation is implied.

## Plan and checks

1. Audit all tabs; remove or relocate redundant copy → browser assertions reject the reported banners while retaining functional labels, errors, confirmations and recovery.
2. Centralize page layout around the existing Archive policy → rendered content edges match Archive at 1920/1440/850/768/390/320px; no document-level horizontal overflow in either palette.
3. Inspect rendered screenshots with synthetic fixtures and verify controls → no private transcript capture, external model calls or production mutations.
4. Run full backend/PostgreSQL, protocol, dashboard Node/browser, collector and relevance checks. Record source identity, counts and failures; preserve preliminary reports separately. Merge without overwriting concurrent work, verify integration, remove task worktrees.

## Ownership

- Layout, cross-tab browser contracts and integration: `.worktrees/wt-ponygirls-chronicle-tab-layout`.
- Copy audit and affected tab components: `.worktrees/wt-ponygirls-chronicle-copy-trim`.

## Verification

Source inspection observed independent 1100/1200/1300/1500px width caps plus different outer gutters across tabs. Codegraph failed with a foreign-PID-namespace ownership refusal; direct source inspection used instead.

### Reproductions and implementation

- Fail-first `test:tabs`: Search's content left edge was 434px versus Archive's 22px at 1920px. Removing a remaining Archive cap was also necessary; the first candidate exposed a 258px Archive edge.
- A shared `workspace.css` now owns all five outer workspaces and global mutation notices: full width, 22px/14px/10px responsive gutters, 14px/12px/10px top gaps.
- Removed visible redundant tab H1s while keeping named main landmarks and active navigation semantics. Removed the quoted search/submission and page-description banners. Optional search/runtime/usage/rebuild reference lives in contextual help. Errors, real status/counts, sharing warnings, confirmations and uncertain-outcome recovery remain.
- Screenshot review exposed MCP's tool schemas pushing Run below the initial mobile viewport: y=1059.75px plus 38.89px button height at 390px. The schema reference is now collapsed, the instance UUID is inside runtime details, and compact help sits beside the action. Added a failing reproduction before that correction; Run now fits at both 390×844 and 320×844.
- `test:tabs` passes all 60 tab/theme/viewport states, with absolute Archive gutter assertions, equal workspace/content edges, no document horizontal overflow, no redundant titles/banners, correct navigation, and no model-start/rebuild/retry/mint operations merely from reviewing tabs. Optional help is separately exercised at 320px, including closure and preserved controls.
- Synthetic screenshots reviewed at desktop/mobile in both themes; no private sessions or production mutations were used. Static read-only layout review reported no substantive findings (not an independent test execution).

### Validation ledger

Final application source commit: `49d8bd36` (following component/test/layout commits `439f666c`, `ecf25549`, `f3721d2b`, `3748b62b`); final catalog/profile harness follow-ups: `35f2afc4`, `d0b6c20e`. Logs/reports originate under ignored `.local/tab-consistency-validation/`; screenshots/metrics under `chronicle/web/test-results/`. Archive destination in the main checkout: `.local/tab-consistency-20261101/` (validation, browser evidence and worker logs).

- Backend: `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh` → 110 discovered suites, 952 cases, 0 failures/errors/skips. Fresh XML names exactly match the discovered inventory. Seven explicitly named Postgres suites contain 72 cases; PostgreSQL executed, not skipped. Other database integration suites are included in the complete run. Backend inputs remain identical to `ea7de16d`; later edits affect only dashboard/docs.
- Protocol, serially after backend, inside the pinned shell from `chronicle/`: `TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh` → 3 suites, 17 cases, 0 failures/errors/skips. Current API, removed/future rejection and framing/error checks retained. Protocol inputs are unchanged by the dashboard work.
- Collector, pinned shell from `chronicle/collector/`: `npm run typecheck && npm test` → 125 cases, 0 failures/skips.
- Relevance, pinned shell from repository root: `python3 -m unittest discover -s chronicle/eval/relevance/tests -v` → 172 cases, all passed. No relevance runner/transport, prompt or eligibility changes; no new live-provider quality claim.
- Dashboard, pinned shell from `chronicle/web/`: `npm run typecheck && npm test && npm run build && npm run test:browser`, with `CHRONICLE_LOGIN_CASE`, `CHRONICLE_THEME_CASE`, `CHRONICLE_GOAL50_CASE`, `CHRONICLE_BROWSER_CASE`, `HISTORY_CASE`, `CHRONICLE_FILTER_CASE`, `CHRONICLE_UI_CASE`, `REBUILD_CASE` explicitly unset → final run `d0b6c20e` passed, exit 0 (background task `bgt-890fab3d6adb55c7`): typecheck, 147 Node cases (0 failures/skips), production build and the entire unfiltered browser chain. The browser log has 310 scenario/check PASS records plus one aggregate suite-summary line; these have different granularity, not 311 independent test cases. Per-runner records: login 11; general/refresh 27; UX 37; theme 11; goal50 38; catalog 6; filters 7; live Archive 9; popup 16; usage 2; history 39; source filters 1; rebuild 37 plus 4 occlusion; Search 44; transcript 1; UI controls 8; tab layout 12 (5 tabs each).
- Preliminary full dashboard execution exposed missing lexical/semantic precision in optional help and two stale copy assertions. Restored “case-insensitive literal substring” and “not proof of unrelatedness” in contextual help; migrated Activity help/cadence and historical-exclusion assertions without altering interactions, counts, deadlines or mutation checks. Preserved failed logs separately. The full unfiltered UX runner then passed all 37 groups. A subsequent integrated run reached the catalog tests and reproduced an outdated harness assumption that schemas were initially expanded (Schema tab count 0). Its scene now asserts the initial closed state, clicks the native disclosure, and waits for visible tools before the unchanged schema/example/authorization assertions. All 6 catalog groups then passed. The next full run reached source-filter checks, whose stale prose regex expected “recorded claim” rather than the more precise “recorded source-root claim.” Updated it to require the latter plus “not launch attestation”; the unchanged request/provenance suite passes. The complete gate is rerun rather than treating focused checks as completion.
- Additional package check: `nix build --no-link --print-out-paths .#chronicle-web` → passed for final source: `/nix/store/cyp2hhmynxpcqll3hqcl1g4wa2ip9lrw-chronicle-web-0.1.0`. Its 4 production files match the explicit CLI production build byte-for-byte. Rebuilt with `npm run build` after browser execution because the CSP runner also emits `dist/`; the comparison binds the CLI output, not that intermediate test artifact. This does not replace full application suites.
- Two delegated reviews found no useful new skill candidate: ordinary progressive disclosure/shared CSS is already covered by existing test guidance. No draft was manufactured or installed.

Application validation is complete. Integration procedure: fast-forward the clean original `main`, verify identical task content plus typecheck/Node/tab checks and the packaged output, preserve evidence, then remove only the two clean task worktrees. Observed integration/cleanup receipts belong in `.local/tab-consistency-20261101/integration.json` after these actions; this source record does not assert a future postcondition.

No push, downstream pin update, system activation or restart is authorized by this presentation task.
