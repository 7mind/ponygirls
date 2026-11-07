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
