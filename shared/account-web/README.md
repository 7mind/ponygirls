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
- **Sign-out.** Mark the sign-out control `[data-account-logout]`. Sign-out is
  single-flight and shares the one write slot with section writes: while either
  runs, the other (and a second sign-out click) is held with a toast. With an
  unacknowledged secret or link shown it asks first; the confirmation only starts
  sign-out. After `POST /api/account/v1/logout` succeeded (actor from a fresh
  read) the module drops the value, tears the account page down and dispatches
  `account:changed`; the host then revalidates its identity and shows its login
  view. A failed sign-out changes nothing and says so (in the dialog or a toast).
  The answer to `/logout` clears the session cookie, so until every sign-out sent
  has its answer the signed-out views send no request: a sign-in on a login view
  the host shows earlier waits for it and keeps its new session cookie.
- **Events.** In: `account:invalidate` means "authority may have changed" (a
  reconnect is enough). The module re-reads the account and tears nothing down
  meanwhile (see "Authority"). A host that signed out by itself dispatches
  `new CustomEvent('account:invalidate', { detail: { reason: 'signed-out' } })`:
  that is authoritative, the area is torn down at once without a read, with the
  lost-value notice. A plain `account:invalidate` after such a sign-out also ends
  there once the re-read answers 401, or in `unverified` while it cannot. Out: `account:changed` after a response
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

Busy rule: while the sequencer slot is occupied (a section write or sign-out) or
authority is not verified, every control that would start another write or
discard the submitted form (New token, Enroll user, Replace authenticator…, the
require-code switch, row actions and menus, form submit and dialog confirm
buttons) is disabled; one function (`applyBusy()`) drives all of them.

## Sequencer and authority

The coordinator (`createCoordinator` in `account.js`) is the only holder of the
account client and of the existing-endpoint requests. The signed-in area gets an
`io` from it and nothing else; its section code never sees a client:

- `io.read(resource, apply, first)` — `account`, `profile`, `policy` or `admin`.
  Each read takes a per-resource generation and, if it bears on authority, a new
  authority epoch. `apply({ ok, data, cause, kind, verdict })` runs only while
  the area lives and only if the read is newer than the data already applied
  (an older snapshot never rolls the display back). The verdict counts only while
  the read is the newest authority read.
- `io.write(applyAccount, work)` — takes the one slot for {section write |
  sign-out} (a refused start is an invariant violation: the busy rule disables
  every entry point), preflights `GET /` with the owner check, runs
  `work(ops)` with the fresh actor (`ops.post`, `ops.action`, `ops.readAccount`)
  and releases the slot in `finally`. A failed preflight rejects with
  `AccountStop`; a disposed area's write never resumes its caller.
- `io.signOut()` — single-flight in the same slot; the preflight read is bound to
  the area (its signal aborts on dispose) and to its owner: another owner means
  no `POST /logout` and a lost area.

Resources `account` and `profile` are owner-checked and confirm authority;
`admin` is not owner-checked (its success decides nothing). For all three a
transport failure moves a live area to `unverified` (only an area's very first
load ignores it) and 401 or another owner means `lost`. Reads never rebuild a
section while the slot is taken or the section has an open dialog, menu, form or
card: the re-render waits and is flushed when the slot is freed or the prompt
closes; list re-renders keep persistent panels (and their focus) in place.

Authority is explicit: `verified` → `verifying` (a re-read is in flight: nothing
is torn down, capabilities stay as they were) → `verified` again, `unverified`
(one-time values are kept but re-masked, every write entry point is disabled
behind "Connection lost — reconnect to continue"; re-verification on `online`,
window focus, the next `account:invalidate` and Retry) or `lost` (forced
teardown; the notice lists the lost values by name, never their content).

One masking registry, `sensitive(element, kind)`, holds every element that
displays or copies a one-time value: the token secret field (`mask`), Reveal and
Copy (`action`), invitation/reset links (`mask`, `action`) and the
authenticator-replacement QR and key (`conceal`) and Copy key (`action`). The
signed-out signup and enrollment set-up blocks are deliberately unregistered:
their key is generated in this browser for an account that does not exist yet,
so there is no authority to lose while it is shown.

## Interleavings

Outcome of each pair of concurrent flows (W section write, N navigation,
V `account:invalidate` → verify, S sign-out, O an owner-changed or 401 response
of an authority read, D dispose/forced teardown, P the area's first profile read,
L a sign-in on the signed-out view). Rows marked † are rows of the
table-driven browser case "sequencer interleavings"; ‡ are covered by the
"section ownership" and invalidation cases; § by the case "the profile fallback
replaces only the routed fragment, never a navigation still being delivered".

| Pair | Outcome |
|---|---|
| W × W | second write's entry points disabled (one slot); exactly one request ‡ |
| W × N | navigation held with a toast; the result lands in the active section ‡ |
| W × V | both run; the newer read decides authority; same owner → the write completes and its value is shown † |
| W × S | sign-out held with a toast while the write runs † |
| S × W | write entry points disabled and navigation held while sign-out runs † |
| W × O | owner change or 401 from the newest read → forced teardown; the write's late completion is bound to the dead area and does nothing; a possibly created value is listed as lost |
| W × D | requests aborted, slot released; late completions do nothing; possibly created values recorded as lost |
| N × V | navigation is allowed (a read is not a write); the verdict applies to the area whatever section is shown |
| N × P | a section the profile does not offer falls back (`#account/profile`, else `#account/tokens`) only while the location is still the fragment the module routed; a navigation whose `hashchange` is not delivered yet keeps its fragment and is routed as usual § |
| V × V | the newest read decides: a stale 401 after a newer success is discarded †, a stale success after a newer 401 cannot revive the area † |
| V fails (transport) | `unverified`: masked, Reveal/Copy/writes disabled; `online` re-verifies and re-enables † |
| V with `reason: 'signed-out'` | `lost` at once, no read † |
| V × S | a successful sign-out starts a new epoch, so no read that started earlier decides anything; the area is torn down by the sign-out |
| S × S | second click held; one `/logout` request † |
| S fails | nothing changes; with a shown secret the dialog reports the failure and "Keep it visible" keeps it † |
| S × O | the sign-out preflight read must return the area's own owner: another owner (or 401) → no `POST /logout` for anyone; another owner → the area is lost with the notice † |
| S × D | dispose aborts the sign-out preflight (area signal): no POST; a POST already sent is not aborted (its response clears the session cookie); the completion is bound to the area that started it and a replacement area is not touched |
| S × L | the host shows its login view before the `/logout` answer: the sign-in request is sent only after that answer, so the answer cannot clear the new session cookie † |
| background read × W | a read that returns while a write holds the slot (or a form/dialog/card is open) applies its data but does not rebuild the section; the re-render waits until the slot is free and the prompt closed † |
| overlapping refreshes | per-resource generations: the newest list wins, an older snapshot arriving later is discarded † |
| W preflight fails (transport) | the write stops with "connection lost", authority becomes `unverified` (Reveal/Copy/writes disabled) and recovers on re-verification † |
| `unverified` × authenticator replacement | the replacement QR and key are hidden and Copy key disabled; the submit is disabled † |
| O × D | one teardown; the second does nothing (bound to the area instance) |

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
| `account:invalidate`, re-read fails | any | kept | kept | `unverified`: values masked, Reveal/Copy/writes disabled until re-verified |
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

`tests/e2e/flow.mjs` is that smoke: one scenario (sign-up → approval → opt-in
TOTP → recovery → invitation → admin flag → reset → disable) through a service's
real dashboard and server, run by `haystack/web/tests-browser/accounts-e2e.mjs`
(`test:browser`, check `haystack-browser`), `manure/tests/test_browser_accounts.py`
(target suite, check `manure-native`) and `chronicle/scripts/account-e2e.mjs`
(check `chronicle-account-e2e`). `ACCOUNT_E2E_EVIDENCE_DIR=/absolute/dir` saves a
screenshot of each step.
