# Shared account web UI

`account.js` renders the account surfaces of the three dashboards (spec:
`docs/drafts/20261117-2130-dashboard-redesign-spec.md` §4) as a thin vanilla-JS
layer over the DOM-free client `account-client.js` (behaviour: accounts design
§4.9, §5.1, §12). `account.css` styles them with the host's `tokens.css` and
`components.css` only; it has no palette, font, unit system or literal colour of
its own. Both files and `account-client.js` are served next to each other
(`account.js` imports `./account-client.js`).

## Host contract

- **Signed out.** Render `<main data-account-auth></main>` in the login view. The
  module renders the login card (`form[data-account-login]`), the second-factor
  step, sign-up (`#account/signup`), recovery (`#account/recover`) and the
  enrollment landing into it. Links to sign-up and recovery appear only when
  `GET /policy` allows them. A host-rendered `form[data-account-login]` with
  `login` and `password` inputs keeps working without the mount; it gains the
  second-factor step, the awaiting-approval notice and the rate-limit wait.
- **Signed in.** Render `<div data-account-outlet data-account-user-id="<user id>" hidden></div>`
  as a sibling of the host's `<main>`. On an `#account/<section>` route
  (`profile`, `password`, `two-factor`, `tokens`, `users`) the module hides the
  sibling `<main>` elements (they stay mounted), shows the outlet, and restores
  them and `scrollY` when the route leaves. Host routers must ignore fragments
  starting with `#account`.
- **Triggers.** Any `[data-account-settings]` element opens `#account/profile`;
  `data-account-settings="tokens"` (or another section name) opens that section.
  Plain links to `#account/<section>` work as well.
- **Events.** In: `account:invalidate` ends the account lifecycle (in-flight
  requests are abandoned, an unacknowledged secret is cleared and recorded as
  lost). Out: `account:changed` after a response belongs to another account than
  `data-account-user-id` (the host revalidates its identity and updates the
  attribute), `account:route` with `detail.section` (`null` when the account page
  closes) so that the host can clear its navigation highlight.
- **Capabilities.** Every new surface is driven by `GET /policy` and
  `GET /profile`. When they answer 404 (accounts switched off, or a server
  without the accounts feature) the module degrades to the login form and the
  Access tokens section over the five existing endpoints.
- `#account-enroll=<code>` is captured and removed from the address bar when the
  module is evaluated, before the host's router runs.

## One-time secrets and links

A token secret, an invitation link and a reset link are shown once in a panel
that is not dismissed by Escape, window focus changes, section changes or Back:
in-app navigation asks first ("Hide the secret for good?"), closing the tab uses
`beforeunload`. "I have saved it" is enabled after Copy or Reveal. Window focus
re-reads the account silently and updates only the token rows.

## Token creation recovery

A mint POST is non-idempotent. Once sent, any failure—including HTTP 400, 401,
403 or 409—can leave its commit outcome unknown. Account v1 has no validated
no-commit receipt, so an HTTP status never authorizes replay. A validated success
response establishes creation before the follow-up account read, but a failed
read still withholds the secret and requires recovery.

Recovery metadata belongs to its particular creation intent and owner. Leaving
the account page, invalidating or reopening it does not discard it while the page
remains loaded. Late responses cannot clear or relabel a newer intent. The
warning offers "Refresh list and check"; "Dismiss" (which enables creation again)
is available only after a successful refresh. If a token was created but its
one-time secret was lost, revoke it before creating a replacement.

Recovery metadata is **in memory only**. Reloading clears the warning; it never
submits or retries creation. Passwords, TOTP secrets, enrollment codes, token
secrets and links are never placed in browser storage; a password typed into a
proof prompt is used for that one request.

## Development harness

`dev/` holds a controlled-route page that mounts the production `account.js`
with an in-page fake of the account HTTP plane (`dev/fake-server.js`). One
scenario exists per mockup state (`dev/scenarios.js`):

```bash
nix develop .#chronicle --command node shared/account-web/dev/serve.mjs 8123
# open http://127.0.0.1:8123/?scenario=settings-tokens-secret&app=manure&theme=dark
```

`?steps=0` loads a scenario's fixture without driving the views into the state.
`/ui/*` is served from `shared/ui-web/` when it exists, otherwise from the
reference copies in `docs/drafts/20261117-2130-dashboard-redesign/`.
`dev/capture.mjs` renders every scenario (1440×900; 1024×700 and dark for the
main ones) named like the mockup shots.

## Verification

```bash
nix develop .#chronicle --command node --test shared/account-web/tests/account-client.test.mjs
nix develop .#chronicle --command node shared/account-web/tests/browser.mjs
```

The browser checks use the harness page in the pinned Chromium (playwright-core
from `chronicle/web`, provisioned with `npm ci`). They do not establish backend
or deployment behaviour; per-service smokes against the real endpoints belong
to the host integration.
