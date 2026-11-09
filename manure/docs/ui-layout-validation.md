# Dashboard layout validation (2026-11-07)

Scope: factual dashboard copy, Chronicle slate/blue tokens across dashboard,
unlock and viewer, catalogue/manifest wrapping without hidden horizontal content.
User-authored viewer Markdown tables and image/diagram viewports retain their
existing scrolling; arbitrary preview content is outside the catalogue contract.

## Reproduction and correction

The maintained `tests/browser/dashboard-layout.mjs` runs the source dashboard,
generated current codecs and controlled API responses in Chromium. Before the
correction, the long-metadata fixture failed with results-panel client width 1166
and scroll width 3785 at a 1440px viewport. The forced 1280px table minimum and
non-wrapping cells caused horizontal scrolling. Fixed-layout wrapping tables and
labeled card reflow below 1351px remove those constraints without hiding cells.
All ten columns, nine sort controls and row actions remain present.

## Commands and observations

Node v24.21.0; pinned driver:
`/nix/store/phc5gsqnm205r6hvlay77f7ia3w4bzzk-playwright-core-1.64.1`.
Pinned Chromium executable:
`/nix/store/r0f9i35n3r7rng8162xih4c1dag0s1vw-chromium-156.0.8078.47/bin/chromium`.

- `node manure/tests/browser/dashboard-layout.mjs` with the pinned
  `MANURE_PLAYWRIGHT_CORE_PATH` and `MANURE_CHROMIUM_BIN`: 20 combinations passed
  (320, 390, 570, 571, 800, 801, 1024, 1350, 1351, 1440px × light/dark).
  Long unbroken names/owners/paths; document, table, panel and cell overflow;
  retained metadata; nine actual sort commands via Enter; real Tab traversal
  with unobscured focus; accessible table/rowgroup/row/header/cell snapshots.
- `python3 -m unittest discover -s manure/tests -p test_browser_dashboard_ux.py -v`
  under `python3 nix/tests/with-owned-postgres.py`: 2 tests passed, including
  23 real-native-server browser scenarios and the layout matrix; no skips.
  Fresh native run took 102.900s. Final accessibility-snapshot assertions were
  subsequently rerun directly across all 20 layout combinations.
- Same owned runner with `-p test_browser_unlock.py`: 34 passed, no skips.
- `node --test manure/tests/browser/*.test.mjs`: 32 passed, no skips.
- `python3 -m unittest discover -s manure/tests -p test_dashboard_markup.py -v`:
  9 passed. Same command with `test_current_test_inventory.py`: 14 passed.
- From `manure/web/viewer`: `npm ci --offline --ignore-scripts`, `npm test`
  (11 passed), `npm run build`, then `CHROMIUM_BIN=<pinned executable>
  npm run test:browser` (3 passed); no skips.
- `git diff --check`: passed.

The current native executable was resolved with
`nix eval --raw .#manure.nativeArtifact.outPath`:
`/nix/store/wk12aylfrk01d2gs6lf3fdc5zqdzlzxk-manure-native-artifact-0.1.0/libexec/manure-server`.
Owned PostgreSQL/provider/tool paths were read from
`nix derivation show .#checks.x86_64-linux.manure-native`.
The fixture served this checkout's dashboard/unlock assets and freshly built
viewer assets, not an installed/stale web shell. Initial native setup failed
because `psql` was missing from PATH; adding the derivation's PG_BIN corrected
that prerequisite before the successful runs.

This is focused frontend/native-UX evidence, **not** a full native target suite,
WebKit/VoiceOver check, deployment, or reuse of previous acceptance. Source identity
is the commit containing this document. Sanitized logs, resolved environment and
normal/stress screenshots are retained in ignored `debug/manure-ui-20261107/`.
Normal-record density screenshots are `screenshots/catalogue-light.png` and
`screenshots/catalogue-dark.png`; stress images include the viewport in the name.

## Runtime helper correction

The original `screenshots/catalogue-dark.png` was a fresh native runtime capture,
not stale: `app.js:updateDraft` replaced the edited static `index.html` helper
with the old horizontal-scrolling instruction. Thus the original screenshot's
helper contradicted the responsive layout. The prior final-source screenshot
claim was incomplete: source HTML alone did not establish runtime copy.

Added an exact runtime-helper assertion to the maintained layout test. Before
correction it failed for the expected reason: actual helper ended in “all columns
remain available horizontally”, while expected copy described fitting metadata
and actions. Updated the catalogue branch of `updateDraft` to match the HTML.

Fresh post-correction owned-native dashboard UX run: 2 tests, including all 20
layout/theme combinations and 23 native browser scenarios, passed in 101.788s;
no failures/errors/skips. Dashboard Node suites: 32 passed, no skips.
Red/green logs are `runtime-help-red.log`, `runtime-help-green.log`, and
`runtime-help-node.log` within the preserved debug directory. Refreshed normal
and stress screenshots are in `runtime-help-final-screenshots/`; these supersede
original screenshots for helper-copy validation. Normal desktop examples remain
`catalogue-light.png` and `catalogue-dark.png` within that new directory.


## Full-width shell (2026-11-08)

Removed the left rail and its reserved margin. The retained manure brand and
unique `whoami`/`whoami-text`/`logout-button` controls share the topbar, including
in artifact details. Long identities truncate visually without changing their
accessible text or displacing logout. Right padding reserves the fixed hosting
warning. All/Internal/External/Public are compact buttons immediately below the
search row, not navigation. `app.js` is unchanged: presets insert the draft
(including its trailing space), never submit; `aria-pressed` describes the
applied query, not an unapplied draft. CLI guidance remains in the catalogue and
footer.

The maintained controlled layout test reproduced the old controls before the
fix (two obsolete sidebar/service-label nodes), then the old geometry (main
left edge 224px rather than zero). Final checks pass at all ten existing widths
from 320–1440px in light/dark: full-width main, unique topbar auth, long identity,
compact preset placement, keyboard insertion without a list request, original
pressed-state semantics, detail auth availability, table accessibility and no
document overflow. The normally hidden Path-mode warning is explicitly shown
and focused in this Subdomain fixture; its rectangle is separated from brand,
identity and logout at every width/theme. This isolates the collision contract
without replacing the real Path-mode capability/security tests.

Fresh pinned `nix develop .#chronicle` checks:

- `bash scripts/backend-sbt.sh 'manureServer/assembly'`: passed; local assembly
  SHA-256 `21ade3db1ca84e86825f9733a78fd1e0f864b650acc8bcc2fe07f852fcc7a0c2`.
- Owned PostgreSQL `python3 -m unittest discover -s manure/tests -p
  test_browser_dashboard_ux.py -v`: 2 passed, no skips (105.479s), including
  23 real-JVM-server scenarios and the controlled layout matrix. Explicit
  unchanged viewer assets: main checkout `manure/web/viewer/dist`. The runner
  reads only the public provider/tools descriptors, not live credentials.
- Final controlled `node manure/tests/browser/dashboard-layout.mjs`: all 20
  width/theme combinations passed, including the additional shown-warning
  collision checks and two existing clipboard/password scenarios.
- `node --test manure/tests/browser/*.test.mjs`: 32 passed, no skips.
- `python3 -m unittest discover -s manure/tests -p test_dashboard_markup.py -v`:
  9 passed. `git diff --check`: passed.

Sanitized local evidence (not published) is under
`debug/manure-dashboard-shell-202611/` in the main checkout: `layout-red.log`,
`geometry-red.log`, `layout-final.log`, `focused.log`, the explicit
`run-focused.sh`, and assembly/source hashes. Synthetic catalogue/manifest
screenshots have no revealed passwords or tokens; desktop/mobile examples are
`screenshots/catalogue-1440-light.png`, `screenshots/catalogue-1440-dark.png`,
`screenshots/catalogue-390-light.png`, and `screenshots/catalogue-390-dark.png`.
The complete 40 screenshots include both views at all widths/themes. This is
focused frontend evidence, not a fresh full backend/full-target run or deployment.
Source identity is the commit containing this section. No distinct reusable
skill pattern was identified beyond the installed constructive test taxonomy.

### Complete final validation

The complete candidate `c5c155b1` subsequently passed fresh, unfiltered pinned
runs, not merely the focused checks above:

- `bash manure/scripts/test-backend.sh`: 15 backend suites / 186 cases and one
  storage suite / 32 cases; zero failures, errors or skips.
- Owned-provider `bash manure/scripts/test-target.sh jvm full`: all 359 current
  Python cases, including actual Chromium UX, migration, durability and recovery;
  zero failures, errors or skips. All 32 Node cases and 76 TypeScript codec
  vectors also passed. No deadline or interaction was relaxed.

Archived final receipts are `debug/manure-flat-dashboard-20261108/final-backend/`
and `final-target/` in the main checkout. `run-full.sh` there records the exact
command, explicit owned provider/tool descriptors and source identity. All
recorded compiled/test inputs and reused viewer assets were SHA-256 checked
against the completed reports; actual assembled SQL resources were also checked
against source. Assembly digest remains
`21ade3db1ca84e86825f9733a78fd1e0f864b650acc8bcc2fe07f852fcc7a0c2`.

Independent read-only review found no actionable defects. This documentation-only
addition changes no tested input. These source/JVM/browser results do not establish
native-runtime acceptance, installed-package behavior or production deployment.
