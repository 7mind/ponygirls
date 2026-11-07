# Manure and Haystack UI refresh

Request: replace promotional/congratulatory copy with factual text, use Chronicle's slate/blue palette, and remove forced horizontal catalogue-table scrolling without losing metadata/actions.

Source baseline: fc372af6 (main checkout clean at start).

Work:
- `task/manure-ui`: Manure dashboard, related shells, browser regression.
- `task/haystack-ui`: Haystack UI and browser regression.
- `task/service-ui`: integration and verification.

Acceptance:
- Long names/identifiers wrap; desktop and narrow layouts do not require horizontal page/table scrolling.
- All metadata, sorting controls and row actions remain reachable.
- Light/dark colours use Chronicle's neutral slate and blue accent rather than green-tinted surfaces.
- UI copy describes data/operations, not praise or marketing.
- Existing relevant tests and new layout regressions pass, with unavailable checks reported explicitly.

Codegraph targeted exploration failed: foreign or unknown PID namespace; no fallback attempted. Source inspection uses read/rg.

No deployment is authorized by this task. Chronicle reference files remain unchanged.

## Final validation

Integrated commits: Manure `49cd3556` + runtime-help correction `1f851133`; Haystack `b3d1b97c`. The integration has identical `manure/` and `haystack/` content to their respective task branches (`git diff` empty).

Fresh integration checks in `nix develop .#chronicle --command bash -c '<commands>'`:
- `cd haystack && npm ci --offline --ignore-scripts && npm run typecheck -w web && npm test -w web`: typecheck passed, 67 Node cases including the helper group, no failures/errors/skips; markup passed.
- `HAYSTACK_CHROMIUM=<pinned Chromium> npm run test:layout -w web`: 16 width/theme combinations passed, including breakpoint boundaries, table accessibility semantics, keyboard sort/open and long metadata.
- `MANURE_PLAYWRIGHT_CORE_PATH=<pinned driver> MANURE_CHROMIUM_BIN=<pinned Chromium> node manure/tests/browser/dashboard-layout.mjs`: 20 width/theme combinations passed, including runtime-help copy, catalogue/manifest overflow, accessibility semantics, keyboard actions and nine sorts.
- `node --test manure/tests/browser/*.test.mjs`: 32 passed, no failures/errors/skips.
- `git diff --check`: passed.

The exact pinned browser/driver paths are recorded in `manure/docs/ui-layout-validation.md`.

Source-bound worker evidence reused, not presented as fresh parent execution:
- Haystack full native acceptance: 66 atomic leaf cases, 57 browser checks (16 layout + 39 main + 2 restart), 1 markup; zero failures/errors/skips, exact inventory. Nix package build passed. Receipt retained in `debug/haystack-ui-20261107/`. Parent verified all 131 file hashes in its source binding against integration.
- Manure focused final native dashboard UX: 2 Python tests, 20 layout combinations and 23 native scenarios passed. Earlier unchanged-input unlock 34, viewer Node/browser 11/3, markup/inventory 9/14 passed. Full native target suite not rerun. Evidence retained in `debug/manure-ui-20261107/`; final runtime-help screenshots are in `runtime-help-final-screenshots/`, not the earlier `screenshots/` directory. Parent verified the final runtime/test two-file binding and identical entire service subtree.

Parent inspected normal desktop and stress desktop/mobile screenshots. Static independent reviewer found no substantive defects; parent screenshot inspection separately caught JavaScript overwriting the corrected HTML helper, reproduced by a failing runtime-copy assertion and corrected in `1f851133`.

Browser verification is Chromium-only; WebKit/VoiceOver and deployment were not verified. Arbitrary user-authored Markdown tables retain their existing preview scrolling, outside the management-table contract.

Reusable-pattern analysis was delegated; no sufficiently novel skill candidate was established beyond installed testing guidance. No draft manufactured.
