# Chronicle dashboard UI capture harness

Analysis tooling, **not** part of any build, check or test run (nothing in `package.json`, Nix or CI references it).
It drives the real dashboard (React app, production transport/manager config) in the pinned Chromium against a
**scripted in-browser Chronicle server** — the same `ChronicleFixture` family the browser tests use
(`../tests-browser/{fixture,goal50-fixture,search-fixture}.mjs`) — seeded with synthetic data. No real server, database or
model provider is started (no existing browser test does either); semantic behaviour such as ranking is therefore *scripted*.

## Run

From the repository root:

```bash
nix develop .#chronicle --command bash -c 'cd chronicle/web && npm ci --offline \
  && node --experimental-transform-types --import ./tests/resolve-generated.mjs \
       ui-capture/capture.mjs /path/to/output-dir [scenario-regex]'
```

* `npm ci` is only needed on a fresh checkout. The dev shell exports `PLAYWRIGHT_BROWSERS_PATH` (pinned Playwright 1.64.1 / Chromium 1248); nothing is downloaded.
* Vite listens on `127.0.0.1:<ephemeral>`; Chromium is headless; everything is stopped on exit. Wall time ≈ 5–8 min under heavy host load.
* On a host with an exhausted inotify limit Vite prints many `file watcher error: EMFILE` lines; they are harmless here (no watching is needed).
* Optional second argument: regex over scenario names (`archive-deep`, `session-kinds`, `account-flows`, …) to re-shoot a subset. Numbering restarts per run, so use a fresh output directory.

Output: `NN-page-state-viewport.png` (suffix `-dark` = OS dark scheme, `-full` = full-page capture; viewports 1440x900 primary, 1024x700 secondary, 390x844 for a few responsive checks),
`index.md` (one line per file: what it shows, how it was reached, blank-capture check), `inventory/*.json` (DOM inspection: scroll containers,
sticky elements, table column widths, contrast / font-size / target-size audit, interaction measurements, page errors).

`token-census.mjs [out.json]` is a static census of the stylesheets (font sizes, spacing, radii, shadows, colours, custom properties, dead selectors); `capture.mjs` does not run it.

## Layout

| File | Role |
|---|---|
| `capture.mjs` | entry point; runs scenarios, writes `index.md` |
| `lib.mjs` | Vite+Chromium rig, `Recorder` (PNG + blank check + index), DOM inspection/audit functions, variants (deep / tablet / dark / mobile) |
| `seed.mjs`, `transcripts.mjs` | `CaptureFixture`: 420 archive rows, 36 collectors, ~290 jobs, tokens, groups, usage; 6 deterministic transcript templates (4–260 messages, giant tool outputs, Markdown, CJK) |
| `scenes-*.mjs` | scenarios per area; `scenes.mjs` registers them |
| `scenes-shell.mjs` | shell (masthead, menus, routes) and the account outlet/login at 1440/1024/390 in light and dark, named like the mockup shots (`chronicle-archive-1440.png`, `account-settings-tokens-dark-1024.png`, …) instead of numbered |

## Adding a capture

1. Pick (or add) a `register…` function in a `scenes-*.mjs` file; scenarios are `scenario(name, async ({rig, recorder, errors}) => …)`.
2. `withScene(ctx, variant, { fixture: seededFixture(f => { /* tweak */ }) }, async ({ page, fixture, shot }) => { … })`. Mutate `fixture` fields (`archiveFailure`, `holdArchive`, `conversationFailure`, `activityFailure`, `mode`, …) to reach error/loading states; use `install(page)` to add `page.route` overrides (they run before the fixture's routes; call `route.fallback()` to delegate).
3. Wait for a DOM condition, then `await shot('page', 'state', 'what it shows', 'how it was reached', { full: true })`. File names are generated; never sleep as the only synchronisation.
4. `await inspect(page, recorder, 'name')` dumps scroll containers / sticky elements / tables / audit.
5. For the three variants use `VARIANTS` (`deep` runs everything, others should only take first-render shots: `if (!variant.deep) return;`).

Limits: the in-app confirmation dialogs (Access group delete/leave/join, token revoke) are modal `dialog` elements and appear in page screenshots; no native `window.confirm` is left. The MCP scenes use the goal50 fixture (the archive fixture has no MCP endpoints).
