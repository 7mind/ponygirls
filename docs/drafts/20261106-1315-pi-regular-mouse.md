# Pi regular-mode border mouse: local preparation and pinned backport

**Final acceptance pending after rejected artifacts (2026-11-06).** Widget
reconciliation, stable Decisions/Tokemon registrations and fullscreen capture
validity corrections are implemented, and the complete Pi 1.4.0 backport is
packaged. Separately reviewed seven-badge matrices passed for the `4giir`, `n5b`,
`rxn` and latest `9im` bundles. Corrected immutable native controls passed for
`n5b`; `rxn` positive03 later failed an HTTP-count assertion after pacing denied
refreshes just before their deadlines. That failure remains preserved. Fresh
`9im` Decisions04 completed with CLI, cleanup and analysis exit 0; independent
completed-run review remains pending. The reviewed Tokemon04 controls have been
launched, but their terminal outcomes have not yet been read.
This checkpoint does not claim every current artifact or full suite passed.

The preceding real seven-badge run stopped at 120×36: after two rapid Agents
clicks, a third held click delivered a press but no release/click despite
unchanged visible geometry. A subsequent instrumented run reproduced a held
Agents close failure: a Decisions timer rebuilt an unrelated spacer, changing
the root layout token and clearing the press before release. Source tests also
isolated global border invalidation, producer-owned republication and baseline
fullscreen geometry defects. These failures remain preserved; passing source
checks do not replace final immutable acceptance. No main integration,
publication or deployment.

## Current checkpoint — concurrent main integration

The original immutable `matrix01` stopped at 48×12 because its Agents locator
required an optional ID omitted by the allocated view. The capture showed the
Subagents pane, selected fixture path and close controls. A saved-capture
fail-first reproduction and independent review supported a locator-only change;
no product code, timings, geometry sequence or journeys changed. The failed run
remains preserved. The separately named `matrix02` completed with exit 0 on
`z0wh` Pi and `4giir` extensions, covering all seven badges in original order at
120×36 → 48×18 → 48×12. Its independent final review and 1,628-entry seal are complete; the parent verified every hash.

The independent generic/fallback matrix passed all twelve executions. Its
924-entry manifest was verified, and source/artifact text captures matched:
154 CLI, 20 fallback and 16 held-fixture captures. This matrix does not load
the real extension bundle. Separate source Tokemon geometry-negative and
stable-geometry positive controls completed with CLI, cleanup and analysis exit
0. The positive covered twelve native 31-second holds across three modes;
the negative observed an unchanged registration expanding from 49 to 60 cells,
with sticky cancellation already set before release/click. Their independent
final review and source aggregate seal are complete; the parent verified all
1,258 entries. The original long-run failure remains failed.

Main advanced to `2a342040bb91029a502b49b4a13f88d92b91fe06`, adding Historian
and changing Subagents, among other concurrent work. Verified package changes
were committed as `255a22a7`; main was merged **into the task branch**, producing
`631d75c00851b749bcd34f379893200f8fa0acfe`. Main itself was not modified.
The old package-input hashes still match, but the extension bundle must be
re-evaluated rather than presumed identical. Job `bgt-96f54baf9e604c13`
completed all fourteen Nix targets, including Historian, settings, model picker
and Subagents policy wiring: seven observed fresh builds and seven without fresh
execution established in that run. Pi's derivation and NAR remain unchanged.
The new bundle is `/nix/store/n5b2w7zz8qxqs8jn4yl3dq2s9dis7kaa-ponygirls-pi-extensions`,
NAR `sha256-b875JrCcvSweULkC+yUv7wSoQRyaPxSUYD771x/FFd4=` (observed 18:27:01Z).
Its `combined01` matrix completed with exit 0 (`bgt-a1a17dc6c97b0a4a`):
21 original journeys, 401 actions, 420 plain/ANSI capture pairs, 69 open snapshots,
48 same-badge closures and 12 rapid batches with the original follow-up controls.
Independent review cleared the saved evidence; the parent verified all 942 seal
entries, digest `4d73c2682defa4a75d1d3a346ddc0e8beba7ca8fb9843bfb7789d2bc6e376861`.
The matrix does not establish native history, mailbox, Historian, physical mouse,
rapid intermediate delivery or enqueue delivery behavior.

The Nix audit records 1,149 fresh and 946 exact-input reused case executions,
not 2,095 fresh or unique cases. Six reuse bindings match derivation, output,
NAR and log bytes; policy-shape has no numeric count or old-final reuse claim.
No counted failures or skips; packaging remains a selected regression subset.

After code-specific review and a reproduced analyzer correction for retained
hold-10 geometry transitions, the parent launched three isolated immutable
controls: Decisions `bgt-12cb09cc8c0bd1b0`, Tokemon stable-positive
`bgt-d146831e02f9061b`, and moving-negative `bgt-649538b177e31dd4`.
All three are terminal. Decisions and positive completed UI execution and cleanup
with exit 0, but failed analysis because the producer panes are not instances of
the CLI bundle's VStack. Negative passed its distinct geometry assertions, without
verifying that producer-class identity. Native pi-ui stacks and the actual loader
branch explain the missed boundary: async JavaScript dependencies load natively
and resolve the unbundled SDK, despite the fixture's correct virtual-module map.
Old failures remain preserved. The separately named `controls02` adapter verifies
actual native producer ancestry while keeping core hooks bound to the CLI bundle.
After independent static review, Decisions `bgt-61370d437e92b203` completed with
CLI, cleanup and analysis exit 0: 24 gestures, 18 held clicks and twelve observed
Decisions panes with exact native PanelLayout/SDK VStack ancestry. Their
`bundledVStack:false` observations remain explicit. Parent raw-trace and cleanup
checks passed at 19:35:35Z. The full-length Tokemon positive and negative controls
subsequently completed with CLI, cleanup and analysis exit 0. Independent review
cleared all three `n5b` controls; the parent verified the complete 1,219-entry
seal at 20:01:11Z. Positive covered twelve 31-second holds with stable geometry;
negative observed sticky cancellation during the eleventh held gesture.
No cache-policy change, namespace substitution or silent rerun was used.

A further concurrent main commit, `35b112f7036adf8b128e16a6c19e50259855493d`,
adds Historian reliability and managed defaults. It was merged into the task
branch as `063df9b11f9c8e1c1434a4e14d6e7ee280127235`, without modifying main.
The fourteen-target Nix job `bgt-41584058e435ac96` completed with exit 0.
Pi and shared UI/settings remained unchanged; the resulting bundle was
`/nix/store/rxn5ywvw9wkffz63hmdixgkhvbzhiv5c-ponygirls-pi-extensions`,
NAR `sha256-LCSrtNpZXV+gbVQe18DekTZ//22BcJ753kaR6fBPe8U=`.
Its independently reviewed matrix passed the same 21 journeys and 401 actions;
the parent verified all 939 seal entries at 20:36:11Z. This is separate runtime
evidence, not acceptance transferred from `n5b`.

The original `rxn` build audit omitted 87 Python executions from Background
Tasks. A separately reviewed correction preserves the inaccurate report and
reviewer misses. The corrected total is **389 fresh + 1,725 reused = 2,114
executions**, including 462 reused selected Pi checks. These are not unique
cases. All 28 current/prior logs and their 16 runner segments per build were
reconciled against runner commands; the parent independently verified the hashes
and totals. ANSI stripping was not the cause: the extractor omitted Python's
runner-summary format.

`rxn` Decisions03 and geometry-negative03 completed successfully. Positive03
completed its UI journey and cleanup but failed analysis: only one usage/profile
HTTP pair occurred, not the required two. Native refresh claims were 21/31 ms
early and the pane's native tick was 7/17 ms early against endpoint pacing
deadlines. Cached responses advanced report freshness without another HTTP
fetch. This trace does not establish a product regression or missing callback.
The failure remains failed. The separately reviewed successor retains all twelve
31-second holds, native timers and HTTP-count assertions, then observes passively
through another native refresh cycle without extra input, redraw, resize or
manual refresh. Its static preparation does not establish runtime acceptance.

Main subsequently advanced to `25dec23bf5d9f56506ce6990a5268d327d2e9f86`,
adding the managed Historian Sol 6.1/medium default. It was merged into the task
branch as `b86b267bb1b18eb6beaef091674d15015222a7a8`; main was not modified.
Job `bgt-e59edf977b87644a` completed all fourteen targets. Its reviewed audit
again records 16 runner segments and **389 fresh + 1,725 reused = 2,114
executions**: six fresh derivations (bundle plus five checks), eight exact reuses.
The changed Home Manager assertions were evaluated; a reused policy output does
not imply unchanged evaluation. All fourteen patches, dependencies and catalog
inputs remain preserved.

The new bundle is
`/nix/store/9imcl15v2d58jrzsivcznnmb2wjc8544-ponygirls-pi-extensions`,
NAR `sha256-Ns8BuSed+JXHdb0GFKUaqrJDGaIMNdFYjFsEcWVGrCw=`.
Parent actual NAR hashing at 20:38:05Z verified it and unchanged Pi/UI/settings.
The 381-entry bundle comparison differs only in Historian's README; all seven
selected extension trees and shared targets match. This does not automatically
accept the new artifact. Its separate `combined03` matrix completed with exit 0:
21 journeys, 401 actions, 420 plain/ANSI capture pairs, 102 held gestures, 69 opens
and 48 same-badge closures. Independent review cleared the saved evidence; at
21:08:19Z the parent verified all 934 entries of manifest
`62919846afa218b9fff57dcefacd1bf80d6bcdab49fa78a0517ccb3203a80da5`.

Native controls04 required a fail-first harness correction: its cleanup allowlist
still named03 cases. The blocked snapshot remains preserved; only those names
changed, followed by three routing and twelve passive-policy checks and renewed
independent static clearance. Manifest
`a33414e94bf33c2396d23fc23b39fe0c0f0ca93951966d9ab66cfd5471da0af5`
binds the corrected nine inputs. Fresh Decisions04 completed with 24 gesture
triplets, 18 holds (minimum 1.128918074 seconds) and twelve actual native panes,
explicitly retaining `bundledVStack:false`. CLI, cleanup and analysis exited 0;
the parent verified raw trace, input hashes and scoped resource absence before
writing the fresh terminal gate. Independent completed-run review is pending.
Positive04 and negative04 were then launched in isolated runs. The first negative
launch failed before execution because the parent supplied an incorrect working
directory; that error is retained separately from the corrected launch. Neither
Tokemon terminal outcome has yet been read. No native-timer, Historian, physical
mouse or real-enqueue-delivery acceptance follows from the regular matrix.
The managed model default grants neither Historian activation nor inference.

## Behavior and boundaries

- `regularMouse` defaults to `false`. Set `"regularMouse": true` in trusted Pi
  settings to enable component clicks without entering fullscreen.
- Mouse capture is pane-wide, not restricted to badges. Capture off preserves
  native terminal selection/scrolling; capture on cannot promise those behaviors.
  This work does **not** solve or change clipboard transport.
- Inline custom views opt into `retainEditorBorders`. Existing permission,
  input and confirmation dialogs do not inherit these controls.
- Terminal-owned, single-flight CPR queries prevent a canceled renderer's late
  reply being applied to its replacement. Unknown origin fails closed for mouse
  routing, without suspending rendering/keyboard input. A nonreplying terminal
  can leave capture unavailable indefinitely. Standard CPR has documented key
  encoding ambiguity; universal terminal compatibility is not claimed.
- Geometry, pending-wrap behavior, streaming appends, non-clearing shrink,
  gesture capture and stale/replaced targets have explicit regression coverage.

## Source identities

Upstream preparation is frozen on `922c3ff2bdea786b16c9b26680f22c2272251ffc`,
not a promise about the current remote head:

| Commit | Purpose |
|---|---|
| `c78677e775c9f16f1a3b6dc4917fa8346a0da78a` | Prerequisite editor-border port, original attribution preserved |
| `2125d59` | Separate measured fullscreen footer correction |
| `a98affb545ee6c3d2d47944d53ab5b52e7023354` | Retained controls, generic example and gesture lifecycle |
| `9cc2d701e0ee0f60b4225edf52e1fcae586f0ba8` | Opt-in regular mouse implementation |
| `2aaf333b366d37d8976f1d9e8caff5c46b4c675b` | Combined integration and both application call sites |

Pinned downstream remains **Pi 1.4.0**:

- `e84f0e681b1c0e65a6f4ea2e765bc7a802fb36a6`: local import of v1.4.0 and the
  eight existing downstream patches; not an upstream submission commit.
- `2e75ec0d3bbb90fa020a953f2a68fafac45f7efd`: surgical border corrections.
- `31cf211c82e3ccdf21def5b2aec6c302e05a8ee8`: surgical regular-mouse backport.
- Flake commit `449acb6e` adds two ordered patches and packaged regression checks.
  Existing runtime version, dependency locks and vendored model catalog remain
  unchanged. Concurrent `main` Decisions changes through `dfc8454c` were preserved
  in task integration `11c9ff6b969a2d65987766791db4e2ab8c196750`.

## Current corrections — source evidence, not immutable acceptance

- Widget reconciliation: upstream `1dad8ea5a47ab011e11e99478ba971effb5e0afc`,
  exact pinned port `7d35e99d74629dd4a5da6420e2e290727b0be011`. Unchanged
  registrations and spacers retain identity; genuine replacement revokes the
  previous lifetime even when the same component object is republished.
- Decisions/Tokemon: `62a2868c31781ecc0b7408d532f92a0e981b690b`, integrated into
  the outer preparation branch. Mutable presentation preserves native polling,
  live countdowns and owner/visibility invalidation without republishing badges.
  Source tests: 124 Decisions and 95 Tokemon passes. Source CLI evidence includes
  real one-second and thirty-second timer-spanning holds; the throwing ingress
  feature-detection stub was never called, including during cleanup.
- Fullscreen: complete correction through
  `469d0e72ee5aa17d5b1fd109764e6240b3933d88`, including the initial `725b04f`.
  The initial commit alone regressed capture transfer and must not be used alone.
  Explicit internal validity provenance separates inherited path constraints
  from replaceable current-target constraints. Public handler fields and root
  exports, MainScreenMouse source, locks and model data remain unchanged.
- Frozen fullscreen branch: 81 focused passes; full TUI 1,272 passes/two skips;
  40 scoped agent passes; check/build/private geometry and transfer PTYs pass.
  Actual GC checks retain three guards after 10,000 transfers and zero of 63
  historical frames. Original failed candidates and opaque-input rejection
  evidence remain separate from structured-input boundedness results.
- Combined upstream preparation is
  `c28191a7579284536c7887e517569df84e284980`. Combined full TUI passes 1,272
  cases with two platform skips; the host matrix passes all eight former failures.
  Full coding-agent results are 3,193 pass, two baseline failures, 50 skip.
  AuthStorage's coalesced-reader failure recurred alongside the long-path AGENTS
  assertion; both retained failure bodies match the original baseline. Neither
  was filtered, retried or repaired by this task.
- Complete pinned fullscreen port:
  `91942df9125d5c427e1804b736a17a86c8b636bd`, one attributed commit containing
  both upstream corrections, with the same stable patch ID and no adaptations.
  Pinned checks: 81 focused passes; 1,227 full TUI passes/two skips; 364 agent
  passes including all eight former failures. Scoped gates/build and private
  geometry/transfer PTYs pass; broader baseline lint/type failures remain.
  The new ordered patch includes all four new TUI suites in package checks.
- Pre-main-integration Nix job `bgt-c463c6d900abc2d8` completed with exit 0. All ten selected
  derivations were freshly built: packaged agent 202 passes, packaged TUI 260
  passes, eight extension checks 1,496 passes; no failures or skips.
  Pi is `/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0`
  (NAR `sha256-de247vq21LT2yFJjTbNWS/uospcAL5QHolWO1FM5xT8=`); bundle is
  `/nix/store/4giirx6la7ks0aqxm5ibhm714kpqi2vn-ponygirls-pi-extensions`
  (NAR `sha256-N0DcyMw49gXuEwrpgJhgqyIYuSDIHqbVwc26FpqdmTE=`).
  Actual derivation patch inputs match all fourteen preparation-tree patches.
  Evidence: `debug/regular-badge-mouse/final-nix-validation/REPORT.md`.
- Refreshed source pictures bind `c28191a` in
  `debug/regular-badge-mouse/final-upstream-pictures/`: all three generic
  scenarios passed; all three intended PNGs were visually inspected, and all
  115 manifest entries independently verified. `before-open-rgb.png` is a
  pixel-identical compatibility conversion, not a changed capture; original
  grayscale PNG and failed evidence-verifier attempt remain preserved.
- Source timer/mode-switch job `bgt-2e23588ee11ab1c5` exited 1: Decisions passed,
  but Tokemon's eleventh 31-second hold did not reopen its pane. During that
  hold the badge gained `⚠ stale 5m` and widened from 49 to 60 cells, moving
  its left edge from x68 to x57. No own republication occurred; raw release
  arrived and Main reached click dispatch, but producer continuation callbacks
  were absent. Required local geometry cancellation is strongly supported;
  separately reviewed positive/negative controls subsequently established their
  own stable-span and sticky-cancellation observations. They do not supply the
  original run's missing inner trace. The original run stays failed; no product
  fix, timer suppression or acceptance retry has been applied.
- Current generic source matrix completed with exit 0: seven full-CLI scenarios
  plus one constructor/terminal held-gesture fixture. This does not establish
  immutable or all-seven real-producer acceptance. Separate immutable generic,
  fallback and seven-badge matrices now pass; final immutable native-timer
  controls remain required.

## Rejected shrink/allocation candidate — historical evidence

- Upstream `a2984f67ead603fc320703a0ce9317a8978a10b9` combines shrink correction
  `f3a5defc79f7cbca98b07765d2b7cebd2ea22895` and bounded retained allocation
  `51f42336f8cffc1d42f7260609703cff0e41931d`.
- Pinned equivalents are `ef8a63a006a6cb08f454498f3dac28974d04d2d3` and
  `4083619c8fc4163763f5168ef52912f67996f0bd`. Version, locks and model data remain
  unchanged. Concurrent main documentation through `32034dab` is preserved in
  outer task `34d9d765`.
- Fresh upstream check/build pass. Full TUI: **1,191 pass, two skipped tests**
  (1,193 total), plus an explicitly skipped Linux clipboard suite. Full
  `./test.sh` exits **1**: coding agent **3,115 pass, one fail, 50 skip**. The
  long-path AGENTS failure block matches both baseline records; the earlier
  auth-storage failure did not recur. No retry or claim of an auth correction.
  Full workspace skip/expected-failure counts remain in the source report.
- Pinned full TUI: **1,146 pass, two existing skips**; focused agent **285 pass**.
  Scoped lint/types/build pass; broad pre-existing lint/type failures remain.
- Corrected Nix job `bgt-c872f1f7401f417a` completed with authoritative exit **0**.
  Package checks: **123 agent tests / 10 files**, **179 TUI tests / 25 suites**.
  Eight freshly built extension checks: **1,488 passes**, no failures or skips.
- Immutable Pi: `/nix/store/zjpakvw3jcdvv63r6smlwwdxqc9cz16f-pi-coding-agent-1.4.0`,
  NAR `sha256-RiaFIQqG/2G8oIEfGs8b/8nHyZcY7ul4iHtJWqFZDMQ=`.
  Bundle: `/nix/store/k9wg468brbdi30m8d0klsw05cin9xnfz-ponygirls-pi-extensions`,
  NAR `sha256-obF7Vu7rXHoousno4tK5JuaET4qibUabYkW/cZ9LDac=`.
- Generic immutable matrix: **8/8 scenarios**, seven actual bundled-CLI runs
  and one shipped constructor/terminal fixture; 52 injected clicks, 27 dialog
  cycles. Includes mode switches, growth/shrink and 48×12 held presses. All exit
  0 with reporting disabled and private resources cleaned. This matrix does
  **not** load the seven-extension bundle. Source comparisons retain two
  autocomplete-frame differences and explicit timer-counter differences.
- Real bundle attempt `corrected-real-badges/attempt01` failed on the held
  Agents click described above. Only Goals and the preceding Agents journeys
  ran; five other wide journeys and both narrow dimensions were not reached.
  The failed trace and cleanup receipts are retained. A first instrumented run
  failed earlier, on same-badge close: actual immutable-bundle instrumentation
  records Decisions publication, unchanged Agents identity/geometry, spacer/root
  token replacement, capture clearing, then a correctly parsed release with no
  retained press. This proves that diagnostic failure's cause, not the exact
  uninstrumented attempt's timing. Two deterministic upstream runs reproduce
  both ancestor and border-revision cancellation mechanisms. Correction has a
  separate worktree; no shortened holds, timer freezes or quiet-period retries
  are accepted fixes.

Source reports: integration `debug/corrected-integration/REPORT.md` and
`debug/corrected-artifact/REPORT.md`; backport `debug/host-backport/REPORT.md`.
Outer Nix receipts: `debug/regular-badge-mouse/corrected-nix-validation/`.
Historical pictures bind `a2984f67` in `corrected-upstream-pictures-final/`;
a preceding Unix-socket-path harness failure is preserved separately.

## Historical validation — superseded `2aaf333b` / `31cf211`

### Upstream

- Combined `npm run check` and `npm run build:offline`: passed.
- Focused agent: **294 passed / 28 files**; focused TUI: **409 passed / 34 suites**.
- Fresh full TUI: **1,162 passed, two existing skips, zero failures** (1,164 cases).
- Full `./test.sh`: **exit 1**, with the same two assertion failures reproduced
  independently on untouched base `922c3ff`: auth-storage coalesced reload and
  the long-path compact-AGENTS rendering assertion. Combined coding-agent totals:
  **3,104 passed, two failed, 50 skipped**. Other workspace summaries are retained
  without removing skipped or expected-failure cases.
- The baseline initially had seven additional native-daemon import failures.
  Building the pinned native prerequisite resolved these before the combined
  full run. Native build success is not substituted for application acceptance.

### Pinned backport and package

- Backport full TUI: **1,117 passed, two existing skips, zero failures**.
- Focused agent: **66 passed**; mouse/probe subset: **33 passed**.
- Scoped source/test types and strict lint passed; actual offline build passed.
- Broad pinned checks still expose pre-existing lint/type/formatting failures.
  Root type output was byte-identical to the retained baseline; affected baseline
  files and formatting deltas were compared explicitly. No hook bypass, unrelated
  repair or weakened check was used.
- Nix package: **113 agent tests / nine files**, **118 TUI tests / 15 suites**,
  all passed without skips or failures; installed version check remains 1.4.0.
- Final eight extension checks: **1,488 tests**, zero failures/cancellations/skips:

| Check | Passed |
|---|---:|
| Shared UI | 31 |
| Codegraph | 60 |
| Goals | 109 + 17 |
| Archive | 79 |
| Decisions | 120 |
| Tokemon | 91 |
| Background tasks | 131 Node + 87 Python |
| Subagents | 763 |

The initial fresh eight-check run passed 1,484 tests. After importing concurrent
Decisions changes, the bundle and affected UI/Decisions/background-task checks
were rebuilt. Unchanged exact derivations were reused explicitly, not represented
as fresh execution. Both sets of logs and derivation identities are retained.

### Actual private-PTY acceptance

Basic source and immutable-artifact matrices passed: regular capture on/off,
fullscreen, seven prior shell lines, repeated open/close, draft preservation,
Escape/reopen, 100×30 → 48×18 → 100×30, normal exit and disabled reporting after
exit. Each private server was removed.

Extended source and immutable-artifact matrices also passed:

- Real `/settings` regular → fullscreen → regular transitions, both capture-on
  and absent/default-off settings. Settings submission intentionally clears
  input; no existing-draft-across-command claim is made.
- Two 45-line widget growth/shrink cycles without resize; retained control clicks
  use freshly captured coordinates, and the unsent draft remains unchanged.
- Ten visible dialog cycles / twenty clicks per matrix. Harness, fixture,
  actions, coordinates and result geometry matched between source and artifact.

Seven real extension-badge journeys are a separate acceptance leg, recorded in
the current checkpoint; their result is not implied by the generic fixture above.

All PTYs use isolated `env -i`, disposable state and synthetic providers that
reject inference. Injected SGR is not physical mouse, native selection or desktop
clipboard validation. Fresh inspected PR pictures are monochrome rasterizations
of actual captures, comparing retention off/on on the same upstream source.

## Historical immutable artifacts — rejected for final acceptance

- Pi: `/nix/store/c8s3av5n27xz520gzjxjrw6vnl0bs8vh-pi-coding-agent-1.4.0`
  - NAR: `sha256:1qqz0023ag7w2bx6xqbkh7f59qc333wdp2fv5wmnxr5bwasi9rm4`
- Final extensions: `/nix/store/pdiss05f8gcmii6p0zhzks0lx38sm8fl-ponygirls-pi-extensions`
  - NAR: `sha256:0liql6521ckhh0lpjnlycaapi81ly03grjxvjxbs7vsda71n9xll`

## Publication, evidence and follow-up

Publication remains blocked by Q23 revision 2: keep `durkadoctor`, prepare locally,
wait for maintainer approval. No push, new PR, change to existing #10602, account
switch or deployment is authorized. Reobserve remote approval and prerequisite
state before eventual submission; historical API observations are not current
permission.

The local PR draft contains rationale, the generic example path, exact source
identities, validation caveats and fresh sanitized pictures. Preserve its source
repository and evidence before task worktree cleanup. A fabricated deferred-factory
reproduction was explicitly withdrawn: actual factory invocation is synchronous
inside `Promise.resolve(factory(...))`; no speculative example fix was retained.

Q27 revision 2 authorizes private archival, recovery verification and removal of
only the two owned task worktrees **after every gate passes**. Actual preservation
and removal remain blocked on final acceptance/integration, recovery verification,
writer freeze and no-drift checks. Q28 requests scoped Codegraph maintenance:
the read-only audit could not establish ownership/quiescence, and missing owner
records are not evidence of inactivity. No daemon control, lock deletion,
real-source archive/export or worktree removal has occurred. Synthetic run-01
failed before creating fixtures because its inherited `/dev` mount rejected
Git's `/dev/null` access. A separately reviewed private-device correction let
run-02 exit successfully. Its independent saved-evidence review and eighteen-file
seal are complete. At 21:21:56Z the parent verified the seal
`64ff19c9515df77aa6626d10277b25615674c704e69ba932f2aab573f480d9f7`
and all 1,001 preserved input nodes. Evidence covers five positive stages and
109 command receipts (106 exit 0; three expected exit 1), not 109 tests. Restored
payloads contain 77 files and forty directories, four Git packs, three bundles
and one 112-byte no-reference NAR. No captured symlink, socket, xattr or hardlink
case was exercised. The host Nix store stayed visible, and registered process/group
absence does not independently attest absence of escaped descendants. Neither
synthetic run clears real-data preservation or removal gates. Q28 remains pending;
the advertised ready-index inventory does not establish ownership or an admission
barrier.

The reviewed reusable procedure was saved and read back as Haystack
`corporate-activity:skill-draft-untagged-terminal-reply-fencing`, revision 1.
It is an inert human-review-required draft, not an installed skill; evidence is
limited to one implementation and overlap with existing drafts is recorded.
The bounded-validity procedure was also saved and read back as
`corporate-activity:skill-draft-bounded-guard-provenance`, revision 1. Its evidence
is one upstream correction plus a backport, not independent recurrence or feature
acceptance. The optional runtime-identity instrumentation amendment was saved
and read back as `corporate-activity:skill-draft-tui-testing-runtime-identity`,
revision 2. Its complete proposed skill retains the installed text outside the
new optional section; it does not prove initializer counts or observational
noninterference. The optional runner-accounting procedure was saved and read back
as `corporate-activity:skill-draft-runner-execution-accounting`, revision 1;
whole-document equality was verified. It addresses command-to-runner-to-summary
completeness, repeated executions and fresh/reused provenance, based on one
incident rather than demonstrated independent recurrence. All four drafts remain
inert, not installed or activated.
