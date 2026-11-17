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
- **Sign-out.** Mark the sign-out control `[data-account-logout]`. The module
  runs the leave guard (a pending request holds, an unacknowledged secret or
  link asks first), then `POST /api/account/v1/logout` with the actor from a fresh
  read, tears the account page down and dispatches `account:changed`; the host
  then revalidates its identity and shows its login view. A failed sign-out
  leaves everything in place and says so in a toast.
- **Events.** In: `account:invalidate` means "authority may have changed" (a
  reconnect is enough). The module re-reads the account first and tears nothing
  down meanwhile: the same owner keeps every panel, dialog and request; another
  owner or no session forces a teardown whose notice lists every one-time value
  that was lost ("revoke and re-issue"); an unreachable service keeps
  everything. A host that signs out by itself and then dispatches the event gets
  the forced path with that notice. Out: `account:changed` after a response
  belongs to another account than `data-account-user-id`, after a forced
  teardown and after sign-out (the host revalidates its identity and updates the
  attribute or shows its login view); `account:route` with `detail.section`
  (`null` when the account page closes) so that the host can clear its
  navigation highlight.
- **Capabilities.** Every new surface is driven by `GET /policy` and
  `GET /profile`. When they answer 404 (accounts switched off, or a server
  without the accounts feature) the module degrades to the login form and the
  Access tokens section over the five existing endpoints.
- `#account-enroll=<code>` is captured and removed from the address bar when the
  module is evaluated, before the host's router runs.

## One-time secrets and links

A token secret, an invitation link and a reset link are shown once in a panel
that is not dismissed by Escape or window focus changes. "I have saved it" is
enabled after Copy or Reveal. Window focus re-reads the account silently and
updates only the token rows. While a link is shown or requested, further
link-producing actions (Enroll user, Reset credentials) are disabled until it is
acknowledged.

## Section ownership

Every dialog, prompt, form and in-flight write request belongs to the view that
opened it (an account section, or the signed-out view). Every way of leaving a view
— link click, `hashchange`/Back, programmatic navigation, routing triggered by the
DOM observer or `pageshow` — passes through one function, `mayLeave()`:

- a write request of the view is in flight → leaving is refused, the fragment is
  put back and a toast explains;
- a shown-once secret or link is unacknowledged → "Hide the secret for good?" asks
  first (closing the tab: `beforeunload`);
- otherwise the view's dialogs, prompts and open menus are closed (their
  document listeners removed) and their input discarded before the next view
  renders; a forced teardown and `dispose()` do the same.

Busy rule: while a view has a write in flight, every control of that view that
would start another write or discard the submitted form (New token, Enroll user,
Replace authenticator…, the require-code switch, row actions and menus, the
form's own buttons) is disabled; one counter drives all of them.

A shown-once value is delivered only into its owning section. If it ever arrives
while another section is shown (impossible through the routes above), the
violation is reported with `reportError` and the owning section is shown with
the value instead of rendering into detached DOM.

| Flow | Prompt / one-time value | Leaving with the prompt open | Leaving while in flight | Result |
|---|---|---|---|---|
| Token mint | inline form → secret panel | form discarded | held | secret panel in Access tokens, guarded until "I have saved it" |
| Invitation | inline form → link panel | form discarded | held | link panel in Users, guarded until "I have sent it" |
| Credential reset | password-proof dialog → link panel | dialog closed, password discarded | held | link panel in Users, guarded |
| Revoke reset/invitation, approve, reject, enable/disable | confirmation dialog | dialog closed | held | list refreshed, toast |
| Admin flag change | password-proof dialog | dialog closed, password discarded | held | toast, list refreshed |
| Two-factor: replace authenticator | inline card with a new secret (QR + key) | card and secret discarded (a new one is generated next time) | held | toast, section re-rendered |
| Two-factor: require-code toggle | code dialog | dialog closed | held | toast |
| Profile e-mail, password | inline forms | input discarded | held | inline result |
| Token revoke | confirmation dialog | dialog closed | held | list refreshed |
| Sign-up | form with a secret generated in the browser | form and secret discarded | held | pending screen (or reload when active) |
| Enrollment landing | form with a generated secret | other fragments do not replace the landing until “Go to sign-in” (the code is in memory only) | held | reload into the new session, or the field error in place |
| Recovery | form | input discarded | held | reload, or the rejection in place |
| Login (second factor) | code step holding login and password in memory | step and credentials discarded with the card | held | reload, or the code error in place |
| Same-section repeated replacement (authenticator, link, token) | a second card/form/link while one is pending | — | re-opening controls disabled; exactly one request | the first result only |
| `account:invalidate`, same owner | any | — | nothing torn down while the account is re-read | panels, dialogs and requests kept |
| `account:invalidate`, other owner or signed out | any | forced teardown | forced teardown after the read | outlet notice lists every lost secret or link: revoke and re-issue |
| Sign-out via `[data-account-logout]` | — | allowed | held | guard asks for an unacknowledged secret or link first |

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
