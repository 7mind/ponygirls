# Manure UI capture harness

Re-runnable screenshot harness for the Manure dashboard, quick upload, token-settings
dialog, external-password unlock page and artifact viewer. It starts an **isolated** server
(private PostgreSQL cluster, JVM assembly, ephemeral ports, temp state), seeds synthetic data
through the real current API, drives the pinned Chromium via the pinned `playwright-core`, and
writes PNGs + `index.md` + DOM/metric dumps. It is **not** wired into any build, check or test.

## Command

From the repository root:

```sh
nix develop .#chronicle --command bash manure/web/ui-capture/run.sh /abs/output/dir
# options after the directory: --count N (bulk artifacts, default 260) --scenes login,catalogue,… --timeout S
```

Measured once: ~5.5 min wall clock (≈100 s seeding, mostly bulk uploads + a 60 s TTL wait that overlaps
them) at host load ≈140 on 128 cores; 130 PNGs, ~16 MB.

Static design-token census (no server/browser needed):

```sh
nix develop .#chronicle --command node manure/web/ui-capture/token-census.mjs /abs/output/dir
```

### Redesign scenes

`--scenes m1` captures the redesigned shell and catalogue (unit UX-M1) and names every file like the
mockup shot it is compared with (`manure-catalogue-<state>-<width>[-dark].png`,
`account-settings-tokens-manure-1440.png`, `account-login-default-manure-1440.png`), e.g.

```sh
nix develop .#chronicle --command bash manure/web/ui-capture/run.sh /abs/out --scenes m1 --count 40
```

`--scenes m2` captures the Upload page and CLI view (unit UX-M2): every state is reached through the real upload
protocol (chunk requests are held or aborted at the network layer for progress, stopped and failed), named
`manure-upload-<state>-<width>[-dark].png`, plus the drop overlay and the hand-off (`manure-catalogue-drop-1440.png`,
`manure-upload-handoff-1440.png`).

`--scenes m3` captures the artifact page (unit UX-M3) under the mockup names `manure-detail-<state>-<width>[-dark].png`
(default, dark, 1024, 390, password, rotate-confirm, access-changed, access-confirm, edit-name, edit-expiry, delete-confirm,
big, big-scrolled, big-end, subdir, uploading, expired, not-found, loading).

The default run is `auth`, `m1`, `m3`, `unlock`, `viewer`. The scenes `login`, `catalogue`, `upload`, `detail`,
`account`, `keyboard` and `dark` drive the pre-redesign dashboard (its ids, the account dialog and native
confirms) and only record how the "before" captures were made; they no longer run against this dashboard.

## Prerequisites

* the pinned `chronicle` dev shell (provides JDK/sbt, PostgreSQL, Node 24, `cc`);
* `manure/scripts/acceptance-tools-x86_64-linux.json` (default) or `MANURE_ACCEPTANCE_TOOLS_JSON`:
  pinned `playwright-core`, Chromium, fontconfig (only DejaVu fonts → screenshots do not use Inter);
* `manure/backend/target/manure-server.jar`: built on first use by `scripts/backend-sbt.sh manureServer/assembly`
  (or set `MANURE_UI_CAPTURE_SERVER_JAR`);
* viewer assets: built through `nix/pkg/manure/viewer.nix` on first use (or set `MANURE_TEST_VIEWER_DIR`).

No live service, credential file or `~/.local/state` path is touched; all credentials are generated per run
and exist only in the temp directory and the node process' stdin. The extra `MANURE_*` variables of the
developer environment are unset by `run.sh`. Every process it starts (server, PostgreSQL) is stopped on exit.

## Files

| file | role |
|---|---|
| `run.sh` | shell entry: tools, jar, viewer, private PostgreSQL, POSIX lib, then `capture.py` |
| `capture.py` | reuses `manure/tests/browser_fixtures.py` (`start_server`, `content_url_for`) to start the real server with 4 users (human + agent, 2 configured tokens for the main user), seeds data, mints dashboard-issued tokens (11, 2 revoked), runs `capture.mjs` |
| `seed.py` | deterministic synthetic corpus: named showcase artifacts (every viewer type, directory with/without index, internal/external/public, long/unicode/hostile names, expiry, `uploading` state, 160-file directory) + `--count` bulk artifacts |
| `capture.mjs` | all browser scenes (`SCENES`), screenshot helper, DOM probes, self-checks, `index.md` writer |
| `token-census.mjs` | static CSS token census + contrast ratios |

Output directory: `NN-page-state-viewport[-dark].png`, `index.md` (file / what / how reached), `dom/*.json`
(scroll containers, sticky elements, column widths, computed styles per probed state), `metrics.json`
(row counts, request counts, back-navigation measurement, tab order), `dialogs.json` (text of native
`confirm()` dialogs, which page screenshots cannot show), `evidence.json` (per screenshot: pixel statistics
and the visible headings/status lines/viewport text, used as a self-check instead of eyeballing).

## Adding a capture

Add a `shot(page, "page-state", "what it shows", "how it was reached", { probe, full })` call to the matching
function in `SCENES` (or a new scene plus an entry in `ORDER` at the bottom of `capture.mjs`). Helpers:
`newPage({vp, scheme, storageState, clipboard})`, `login`, `waitList`, `openDetail`, `applySearch`,
`route.fulfill/abort` for fault injection (`errorBody(route, code)` builds a valid error envelope).
Fixed content for a scene belongs in `seed.py`; give it a `role` name there — `put("role", owner, …)` —
and read `ROLES.role` (ids, content URL, external password) in `capture.mjs`.

Developer loop: `--hold-payload /abs/payload.json` seeds once, writes the browser payload (throwaway
credentials, mode 0600) and keeps the server up until `payload.json.stop` exists; re-run
`node capture.mjs < payload.json` (with `FONTCONFIG_FILE` and the pinned node) against it.

## Known limits

* Dark theme = `prefers-color-scheme` only (the dashboard has no switch).
* Native `window.confirm()` dialogs are recorded as text, not screenshotted.
* Retrieval modes `semantic`/`hybrid` are unavailable (no embedding provider is configured); the
  "unavailable" state is captured, ranked results are not.
* All seeded artifacts are created within minutes, so Created/Expires columns do not show a spread of dates.
* Hover tooltips (`title`) and HTML5 validation bubbles are not captured by Playwright screenshots.
