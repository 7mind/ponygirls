# Rites web UI browser tests

Real-browser (pinned Chromium via `playwright-core` 1.64.1, no browser
downloads) tests for the vanilla TypeScript UI in `rites/web/app.ts`.

## What this is — and what it is not

`server.mjs` is a **synthetic fixture**: an in-process HTTP server that serves
the compiled app (`rites/target/browser`, produced by `tsc -p
web/tsconfig.json`) in the packaged layout (root `index.html` plus `web/` and
`generated/`) and implements the documented REST contract (ABI 0.2.0:
sessions/cookies, revisions and conflicts, role checks, write-only credential
secrets, OAuth client metadata, run idempotency, `X-Rites-User` identity
echo, same-origin + `Content-Type: application/json` mutation rules) against a
fully in-memory dataset with synthetic names only.

The fixture is **not** the real Rites backend. Passing here proves the UI's
behavior against the contract; it does not prove backend conformance. The
parent integration step re-runs the same UI against the actual backend; these
tests make no claim about that leg.

## Running

From the repository root, inside the pinned backend shell:

```bash
nix develop .#backend --command bash -c 'cd rites/web/tests && npm test'
```

The run builds the app first (`rites/node_modules/.bin/tsc -p
web/tsconfig.json`) and requires `PLAYWRIGHT_BROWSERS_PATH` (set by the shell)
— tests never download browsers. `npm ci` in this directory provisions
`playwright-core` from the pinned lockfile.

## In-process fixture controls

Tests drive the fixture directly (never over HTTP): revision bumps
(`bumpCredential`/`bumpRepository`/`bumpRite`), session drops
(`dropSession`), server-side role/owner changes without revision bumps
(`setRole`/`setOwner`), lost run responses (`dropNextRunResponses` — partial
body, so the browser cannot silently retry), held responses
(`holdNext`/`releaseHeld`), and status failure modes (`fail` 503,
`chunked-stall` headers-then-stall, `huge` byte-cap breach). The fixture also
self-checks the mutation contract and records violations
(`db.contractViolations`) and refused identity mismatches
(`db.identityMismatches`).

## Deliberate production constants

The app has no runtime-configurable timers: the poll interval and the fetch
deadline are fixed 10 s constants in `app.ts`. Tests never shorten them; the
chunked-body regression waits out the real 10 s deadline, and refresh-driven
checks use the app's own `visibilitychange` refresh path.

## Coverage map

- `auth` — login/logout/session-expiry, keyboard login, boot-unreachable.
- `status` — visible status, 503 failure, real-deadline chunked-body stall,
  oversized-body cap.
- `credentials` — write-only secrets (token and OAuth access+refresh), Token
  vs OAuth modes (GitLab-only), client reference, expiry metadata, refresh
  health guidance, conflicts, 404 deletes, secret clearing on Escape.
- `repositories` — role-aware controls, own-credential binding, id
  immutability, create/edit/delete, conflict reload, stale-owner 403.
- `grants` — owner immutability, role changes, grant removal (role null),
  add grant, revision continuity, conflicts.
- `rites` — cron/model forms, viewer read-only, editor controls, XSS-safe
  id rendering, stale-role 403 on runs, deletes.
- `runs` — history rendering, http(s)-only proposal links, pending-state run
  button, UUID idempotency keys, unknown-outcome retry with the same key,
  explicit new run, late-response isolation after logout.
- `identity` — two-page cookie-switch: refused mutation with no effect, held
  mismatched response flips the view exactly when it lands, refused logout,
  and the `X-Rites-User` + `Content-Type` mutation contract.
- `mobile` — 375×667 layout, dialog fit, Escape close, row taps.
- `focus` — polling never steals focus or replaces an open form.
