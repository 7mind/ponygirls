# Chronicle dashboard

React / TypeScript / Vite. Production contains no fixtures, external assets, fonts, uploads, or browser credential storage. All HTTP and WebSocket operations use the generated Baboon v1.1 classes and JSON codecs in `../generated/typescript/`; generated files are not maintained here.

## Build and verify

Node 24 and npm 11; exact dependency versions are locked in `package-lock.json`.

```bash
npm ci
npm test
npm run typecheck
npm run build
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-1.64.1-browsers \
  npm run test:browser
```

The provisioned development browser directory is `/nix/store/3jc1mc38kwqi6vqzns8z1nqq70affw5k-playwright-browsers`. Tests never download browsers. `npm test` uses Node's experimental TypeScript transformation for generated enums, plus a test-only resolver for the generator's `.js` imports. Production uses Vite's TypeScript compilation.

Serve `dist/` on the **same origin** as `/api/login`, `/api/ws`, and the remaining server API. TLS and the server's exact Origin, session-cookie, and CSRF policies are required in deployment. The dashboard has no cross-origin/token configuration. `npm run dev` starts Vite on loopback; a local same-origin API reverse proxy is needed to use a real server. The browser fixture instead serves a separate, test-only entry through Vite.

## Interface

- Cmd/Ctrl K focuses and selects the search field. Modes are explicit: Lexical, Semantic, Hybrid. An unavailable semantic profile is an error, not an undisclosed lexical fallback.
- The dashboard negotiates API1.1. Lexical totals are exact matching-session counts; semantic/hybrid results show **ranked candidates** from a bounded approximate chunk window, not the archive total. The server supplies the count scope and ranking limit; inconsistent metadata is rejected before rendering. API1.0 remains a server-side compatibility path with its original exact-search semantics, not a fallback used by this dashboard.
- Project, branch, time and tag filters match the frozen contract. User, group and harness filters are not exposed by that contract and are not invented here. Search/filter drafts and submitted search/selection IDs survive same-user connection replacement; protected result bodies do not. Draft, submitted-query and selection state is bound to the observed account ID, cleared on explicit sign-out/account change, and render-gated before a different account can mount or issue reads.
- Annotation lists use generated `GetChunks(sessionId, offset, limit, view)` requests in source-ordered pages of 20 with totals and previous/next controls; they do not rely on the bounded initial `GetSession.chunks` list. Winning `SearchHit.chunks` outside the current annotation page remain separately pinned and navigable, derived from the current authorized search snapshot rather than retained across invalidation.
- Every open source uses the generated `ContentView(revision, generationId)` identity. Search selection starts from the hit's exact view; other/default source selection accepts the server's chosen published view (or archive-only head if no index exists). Session metadata, annotation pages, message pages, span navigation and raw reads remain pinned even if a newer archive or index publishes. Raw always requests the selected revision, never implicitly HEAD. Response revision/generation mismatches clear the affected read instead of displaying misattributed text.
- Head/index counters are separate from **Viewing source rN**. Periodic authorization/head checks retain the chosen immutable view. **Reload source snapshot** and reconnect can choose the current published view. **View latest archived revision** explicitly chooses `ContentView(head, undefined)`: an unindexed/archive-only view with no annotation generation, even if that revision later becomes indexed. Existing and future model failures therefore do not block source/raw access. Search winners from another revision **or generation** are suppressed; switching views clears prior source bodies and highlights.
- Split-pane source, annotation passages, UTF-8 byte-accurate source highlighting, provenance, related conversations, indexing lag and explicit raw permission. Source requests contain at most 40 messages; span navigation scans bounded pages of 100, up to the contract's 10,000-message source bound. Off-screen message layout uses CSS content visibility. Very long individual messages expand explicitly.
- Activity lists authorized jobs, failures and explicit retries. The API does not expose collector root discovery/coverage, so the dashboard does not claim collection is complete.
- Access includes named token mint/revoke and group create/invite/accept/remove/leave/delete. Acceptance explicitly acknowledges sharing **all eligible existing and future sessions** with current and future members. The owner deletes rather than leaves a group.
- Token secrets are shown once, held only in component memory, and cleared on connection/authorization invalidation. Uncertain writes persist in the top-level controller across reconnects; they are never replayed automatically. Receipt lookup precedes explicit same-ID retry. A committed mint with a lost secret requires revoke/remint. Recovery metadata is account-bound and hidden while unauthenticated. Logout uses the same uncertainty mechanism.
- Original source and raw records render as literal React text, never HTML. No source links or remote images are executed or fetched.

Read bodies clear on transport invalidation and are refetched after each verified new ALIVE generation. Each source/job/group/token request is authorized by the server. Archive/source snapshots are rechecked every 20 seconds while the archive is open; job status every 10 seconds. Scope/entity denials clear the affected read, not the authenticated connection. There is no permission-change push stream: external ACL changes become visible on the next authorized operation/poll, and denied data is not retained on screen.

## Transport / resilient-ws-ui checklist

`src/transport/manager.ts` is independent of React, browser globals and wire DTOs. Socket factory, protocol adapter, scheduler/clock, nonce source, random source and lifecycle source are injected. `baboon.ts` supplies the real generated codec adapter; each socket gets its own Hello/ping correlation state.

Implemented:

- NEW / ALIVE / STALE / DEAD; ALIVE requires accepted version negotiation and a matched application pong. The v1 wire contract carries a nonce but no timestamp: the adapter correlates the response's envelope ID and nonce to its locally recorded send time.
- Per-nonce pong deadlines, connect timeout with native `readyState` check, bounded handshake timeout, read/request deadlines, explicit uncertain mutation outcomes, and superseded-socket/request-generation guards.
- Immediate overlapping replacement during stale grace, maximum three live sockets; late-pong recovery supersedes the replacement. Stale grace timers cannot expire a later stale period. Lifecycle verification cannot fork heartbeat chains.
- Full jitter over `[0, min(cap, base × 2^attempt)]`, capped exponential delay, eight retries, attempt reset only on ALIVE, then STOPPED/manual retry. Hidden retries defer without consuming attempts.
- Permanent protocol/data/size/TLS close codes and observable 4400/4401/4406 application closes stop. Typed unauthorized/version/protocol failures stop even without a pending request. `forbidden` is a per-request denial.
- Timer-gap detection, short-gap verification, proactive long-resume replacement, visibility/online/offline/network-change/freeze/resume/pagehide/pageshow wiring, BFCache socket closure/restore, destroyed reentry guard, and timer/listener cleanup.
- One fixed, text-plus-symbol/ring health widget derived from manager stats; countdown budgets, event-driven updates plus ~10 Hz requestAnimationFrame, title state, active/background pool styling, RTT windows, heartbeat deadline-miss rate, retry details and bounded timestamped event log.

Explicit boundaries / mitigations:

1. Main-thread timers can be throttled/frozen in hidden tabs. There is no heartbeat worker; visibility/resume/timer-gap checks replace and reauthorize instead of promising continuous background liveness.
2. Reconnection creates a fresh logical session. Whole authorized snapshots reload; there is no durable push history or mutation replay.
3. Server heartbeat scheduling/nonce lookback and Scala/native behavior belong to the server lane. The client answers server Ping with the **same envelope ID and nonce**, separately from its own heartbeats. Client tests cannot prove server scheduling correctness.
4. Browser tests dispatch resume/BFCache lifecycle events and the fake clock simulates timer pauses. These verify recovery paths, not a real OS suspension or browser BFCache eligibility.
5. The WebSocket fixture is controllable browser communication, not an actual Scala server. The integrated Scala/PostgreSQL/native browser gate remains separate.

## Tests and screenshots

`tests/connection.test.ts`: Behavioral-Active Blackbox-Atomic public-manager tests with strict hand-written socket/scheduler/lifecycle dummies. `tests/baboon.test.ts`: Blackbox-Group real generated codec/adapter tests. UTF-8 span tests fail rather than highlighting incorrect byte boundaries. Requirements were written against an unimplemented boundary before the manager; discovered regressions retain failing-before-fix cases.

`tests-browser/run.mjs` runs the real React app and browser WebSocket with generated-codec request/response interception (not injected UI state). It verifies neutral task headings, empty states and branding (without changing source text or security notices), Alice→Bob identity changes and logout→Bob/Alice sign-in without prior-account query/filter/source RPCs (while retaining same-user reconnect drafts), resumed-session revision/generation pinning while HEAD/publication advance, explicit archive-only access, fail-closed mismatched message/chunk/raw responses, 205 annotations across bounded generated-codec pages (including the final partial page), an off-page search winner and source highlighting before/after reconnect, keyboard search, literal source rendering, UTF-8 and later-page source navigation, raw denial, token/group forms including destructive operations, job retry, silent blackhole → snapshot resync, server restart, auth/version stop, retry exhaustion/manual recovery, lifecycle restore, cookie-only HTTP login, uncertain mint/receipt/revoke and uncertain logout. Auth denial also removes token recovery metadata. An initial-render assertion prevents a header-only blank source pane. Responsive screenshots wait for the actual conversation title **and original message content**, then blur aesthetic focus; keyboard focus is asserted separately.

Artifacts (ignored): `test-results/archive-desktop.png`, `test-results/archive-mobile.png`.

Stable selectors for the separate real-server browser gate:

- Login textbox: `getByRole('textbox', { name: 'Login', exact: true })`; password: `getByLabel('Password', { exact: true })`; submit: `getByRole('button', { name: 'Sign in →', exact: true })`.
- Search textbox: `getByRole('textbox', { name: 'Search conversations' })`; button: `getByRole('button', { name: 'Search', exact: true })`; radios: `Lexical`, `Semantic`, `Hybrid`.
- Results: `.search-hit` buttons with title headings. Source header: `Source conversation`; ready title: `.conversation-intro h2`; ready source: `.transcript .original-message pre`.
- Revision controls: `View latest archived revision`, `Reload source snapshot ↻`; selected source label: `Viewing source rN` (exact text).
- Annotation navigation: `getByRole('navigation', { name: 'Annotation pages' })`; off-page matches: `getByRole('region', { name: 'Matching search passages' })`.
- Chunk buttons: scope to `.passage-list` (a result excerpt can contain the same text). Highlights: `.transcript mark`. Raw button: `Request raw records`.
- Navigation buttons: `archive`, `activity`, `access` (exact). Health: `.connection-widget[data-state="live"]`, `unauthorized`, `update-required`, `stopped`, etc.
