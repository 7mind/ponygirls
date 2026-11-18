# Haystack UI capture harness

Screenshot + DOM-inspection harness for the dashboard. **Not a test and not wired into any
Nix check, npm script or CI run** — run it by hand when you need before/after pictures.

## Run

From the repository root, inside the pinned shell:

```sh
(cd haystack && npm ci --offline --no-audit --no-fund)        # once per checkout (locked deps, incl. playwright-core)
nix build .#haystack --no-link                                 # once: the native server (not built by the harness)
nix develop .#chronicle --command bash haystack/web/ui-capture/run.sh /absolute/out/dir
```

Takes about 2 minutes wall time on an idle host (measured 2m05s at load average ≈160, 128 cores).

What it does: builds the working-tree dashboard (`npm run build -w web` → `haystack/web/dist`, git-ignored),
starts a private PostgreSQL cluster (`mktemp -d /tmp/haystack-ui-capture.*`, ephemeral port) and the
selected server on a free loopback port, seeds 640 synthetic records (962 revisions, 5 projects, 4 users,
long Markdown/code fields, links, archived and `human-attention: required` items) through the public API,
then drives pinned Chromium (headless) via `playwright-core`. Everything is removed on exit.

Output: `NN-page-state-viewport[-dark][-full].png` (the `shell` scenario names its shots like the mockup
shots instead, e.g. `haystack-browse-dark-1440.png`, through `rec.shot(…, { file })`), `index.md` (one line per file: what + how reached,
plus "Measured:" notes), `manifest.json` (per shot: visible headings/status messages, used because a
reviewer without an image viewer can still verify the state), `dom/*.json` (scroll containers,
sticky elements, table geometry, font-size histogram, small targets, heading outline).

Environment (all optional): `HAYSTACK_SERVER_COMMAND` (default: `bin/haystack-server` of the flake's
`haystack` package), `HAYSTACK_CHROMIUM` (default: Chromium of `PLAYWRIGHT_BROWSERS_PATH`),
`HAYSTACK_UI_CAPTURE_SKIP_BUILD=1` (reuse `web/dist`), `HAYSTACK_CAPTURE_ONLY=auth,browse,…` (run only the
named scenarios; note that `index.md`/`manifest.json` then list only those shots).

### Scenarios that match the redesigned dashboard

Observed at 0f0f00a7: the default run (every scenario) stalls in `browse` (it still drives the pre-redesign
selectors; no shot after `07-boot-unreachable`). The scenarios written for the redesign are `shell`, `browse-h2`,
`browse-fin` (filters applied, offline warning), `record` and `edit`; use

```sh
HAYSTACK_UI_CAPTURE_SKIP_BUILD=1 HAYSTACK_CAPTURE_ONLY=shell,browse-h2,browse-fin,record,edit \
  nix develop .#chronicle --command bash haystack/web/ui-capture/run.sh /absolute/out/dir
```

The remaining named scenarios (`browse`, `query`, `nav`, `errors`, `account`, `live`, `focus`, `responsive`, `dark`) record how the
"before" captures were made and are not maintained against the new views.

## Files

- `run.sh` — infrastructure (PostgreSQL, build, env) and entry point.
- `capture.mjs` — starts the server, seeds, runs scenarios. Reuses `../tests-browser/native.mjs`,
  `database.mjs`, `credentials.mjs` (the same fixtures as the browser acceptance tests).
- `seed.mjs` — deterministic corpus generator (PRNG seed fixed).
- `scenarios.mjs` — the capture list; `lib.mjs` — `Recorder` (screenshots, index, DOM inspector).
- `census.mjs` — static design-token census: `node haystack/web/ui-capture/census.mjs [--json] [css…]`.

## Adding a capture

Add a `{ name, title, async run(env) }` entry to `scenarios` in `scenarios.mjs`:

```js
const { ctx, page } = await open(env, { viewport: DESKTOP, dark: false });   // logged in as `op`
await gotoBrowse(page, env, "#/inbox");
await env.rec.shot(page, "inbox-thing", { desc: "what it shows", how: "how it was reached",
  expect: [".records-panel tbody tr"], full: false });
await ctx.close();
```

`expect` selectors must be visible or the harness fails (guards against blank/half-loaded captures).
Use `page.route(...)` for error/slow states and `page.routeWebSocket` for live-connection states;
product code is never modified. `env` also exposes `corpus`, `clients[author].put/get`, `base`, `uuidv7`.

## Limits

- Native dialogs (`window.confirm` of token revocation, HTML5 validation bubbles) cannot be
  screenshotted headless; the confirm text is recorded as a note.
- Captures use the theme menu's default (System): dark = `prefers-color-scheme: dark`.
- "Identity changed" notice and the live `STALE`/`SUSPENDED` states are not reproduced.
