# Chronicle dashboard

React / TypeScript / Vite. Production contains no fixtures, external assets, fonts, uploads, or browser credential storage. All HTTP and WebSocket operations use the generated Baboon v1.3 classes and JSON codecs in `../generated/typescript/`; generated files are not maintained here.

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

- Archive starts with every authorized source HEAD, including unindexed sources. Its compact table has no redundant page heading. Every visible column sorts globally through `ArchiveSort`; LastTimestamp Desc is the default even for text queries, with the server UUID tie-breaker and NULLS LAST. Each request asks for 50 rows (contract maximum 100); opaque cursors have no authority and pages are live, not a frozen corpus.
- Cmd/Ctrl K focuses the expression editor. AND, OR, NOT, adjacency, parentheses and braces follow the server grammar. Search mode is a global expression directive, not separate buttons: `(A OR B) mode:lexical` is valid; `A OR B mode:lexical` is not. Default Hybrid and metadata/empty browsing do not invoke models without a text operand. Quick filters conjoin the entire body while keeping a quote/escape/group-aware global mode outside it. Suggestions are explicitly **loaded values**, not archive-wide facets. The server remains authoritative for fields, Boolean semantics and errors.
- The small Search syntax popover explains literal lexical matching, semantic bounded sets, Hybrid's unbounded exact lexical union, and bounded-NOT/candidate-domain caveats. `annChunkLimitPerOperand` is a per-operand published **chunk** budget before session deduplication, never a row cap. Archive totals remain exact under those defined candidate sets and retain i64 precision. Unavailable semantic search returns an error; no lexical fallback is hidden.
- Infinite lists append stable IDs and reject superseded successes/rejections. A refresh atomically refetches the loaded page chain; same-identity poll tokens coalesce behind in-flight work instead of starving long chains. Every completed chain immediately removes old IDs absent from its newly authorized result and updates common values in place. Only arrivals/order changes wait behind a local explicit update control, so polling does not prepend while someone reads. The latest successful read replaces pending candidates; errors, identity/generation changes and invalidation clear both visible and pending bodies. Surviving row/pane anchors preserve the viewport across removals. Query/sort/account changes reset the chain.
- A row click or its native title button (Enter/Space) opens a 90vw × 90vh modal. Native modal isolation plus explicit Tab wrapping, Escape/backdrop close, initial/returned focus and body-scroll restoration are tested on desktop and mobile. The left passage list and right original-message pane scroll independently; mobile uses a stacked two-pane fallback. Passage selection scrolls only the right pane, never the background or a polling refresh.
- Archive rows separate HEAD metadata, published view and representative matched view. A modal initially opens matchedView, otherwise publishedView, otherwise archive-only HEAD. Boolean text operands may match different revisions; the chosen view is not an explanation of every term. Every session/annotation/message/locator read retains the same `ContentView(revision,generationId)`; raw explicitly requests its revision. Mismatched pins fail closed. The UI shows viewed revision, HEAD/index counters and lag separately. Explicit latest-HEAD access chooses an archive-only pin with no annotations; switching the whole view clears prior messages, spans and raw content together. Reconnect reauthorizes and can choose the fresh row pin.
- Passage pages and message windows contain 40 items. Passage and message scrolling is automatic; message windows also load earlier pages after a direct locator jump. `LocateMessage` supplies the authorized zero-based position, so there is no scan-through-all-pages or 10,000-message seek cap. Every explicit passage selection cancels an older locator, including selection of an already-loaded target. UTF-8 highlighting preserves literal source text; long messages expand explicitly.
- Activity is owner-only, not group-shared. Infinite collector summaries include report-less namespaces as unknown, server observedAt/receivedAt, explicit stale reports and separately labeled per-run discovery/upload counters. Current and Historical job totals/done/failed counts remain separate; HEADs without a target job are not fabricated as Queued. Infinite job rows distinguish superseded revision, obsolete profile and both, plus active/expired/unleased Running leases. A browser socket, Idle report or processed-window count does not establish worker health, coverage, publication or completion. Only a supplied retryable Current Failed job gets an explicit retry; history is neither automatically retried nor deleted.
- Access preserves Issued/StaticConfig metadata, named mint/revoke and every group create/invite/accept/remove/leave/delete action. Static tokens are configuration-managed/read-only and reveal no secret. Joining explicitly acknowledges sharing all eligible existing/future sessions with current/future members. Token/group APIs return their complete lists and expose no manual pagination controls.
- Token secrets are shown once in component memory and clear on connection/authorization invalidation. Uncertain writes remain account-bound in the top-level controller; they are never automatically replayed. Receipt lookup precedes explicit same-ID retry, and a committed mint with a lost secret requires revoke/remint. Logout uses the same uncertainty mechanism.
- Original source/raw records are literal React text: no transcript HTML, remote images or source links execute. Raw requires the independent Raw scope. Draft/submitted expression/selection IDs are account-bound; explicit logout or an observed different identity clears them before any new-session RPC. Same-user reconnect may retain those private request identities, never previously authorized result bodies.

The dashboard negotiates **only 1.3** before issuing Archive/Activity operations. Server-side 1.0/1.1/1.2 compatibility remains separate, not a client fallback. External permission changes are detected on the next authorized read/poll (Archive/source every 20 seconds; Activity every 4 seconds), not through an invented permission-change push stream. Successful list shrink also revokes the excluded row's bound modal immediately, even without a forbidden response.

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

## Tests

`npm test` runs cheap behavioral tests for protocol/codecs, connection lifecycle, UTF-8 spans, immutable view identity, exact progress, shared server/editor mode fixtures and authorized infinite-list reconciliation. The generated 1.0→1.1→1.2→1.3 evolution chain remains covered.

`npm run test:browser` is the standard complete browser gate. It runs:

1. `tests-browser/run.mjs`: all 22 retained browser scenario groups, adapted from cards/manual pages to table/modal/infinite interactions, plus SSR loading-state coverage. Includes account/logout boundaries, collector phases/large i64s, source pinning and latest archive access, all mismatch-denial cases, 205 passages, literal/UTF-8 text, all management mutations, uncertain writes/receipt recovery, HTTP cookie login/insecure-origin UUIDs, blackhole/restart/lifecycle and bounded transport recovery.
2. `tests-browser/ux.mjs`: 180-row globally sorted/cursor-paged corpus and every header, query-reset/old-cursor race, mode-safe quick filters and errors, successful membership shrink/no-prepend/focus/row-anchor continuity, 205 passages with direct navigation beyond 12,000 messages and rapid selection cancellation, and infinite owner collector/current/history/lease truth.
3. `tests-browser/refresh-regression.mjs` (`test:refresh` also runs it directly): deferred resource/infinite lifecycle checks, coalesced polling, authorization shrink/candidate non-resurrection, responsive 90vw/90vh modal focus/body/pane behavior, and the actual 20-second Archive poll asserting retained DOM nodes and user scroll with zero unsolicited navigation. A successful list shrink then clears the excluded row and bound modal without a transport/auth error.

Fixtures use synthetic content and generated WebSocket codecs; they are not a real Scala/PostgreSQL server. The separate native-server integration gate remains necessary. No screenshots are produced by the browser gate. Ignored `test-results/` can retain local sanitized logs; never capture private source content.

Stable selectors for the separate real-server browser gate:

- Login: textbox `Login`, label `Password`, button `Sign in →` (exact).
- Expression: textbox `Search conversations`, button `Search` (exact); Quick filter / Search syntax summaries. Modes are directives, not radios.
- Archive: table `Conversations`, `.archive-row`, `.table-title` native buttons. Every header button is named `Sort by <column label>`. Scroll `.archive-table-scroll` to append.
- Modal: dialog `Source conversation`; close button `Close conversation`; ready title `.conversation-intro h2`; ready source `.original-message pre`.
- Views: buttons `View latest archived revision`, `View published annotations`, `Reload source snapshot ↻`; exact viewed label `Viewing source rN`.
- Passage list: `.conversation-passages` scroller and `.passage-list .passage` buttons. Source: `.conversation-source` scroller, `.transcript mark`; raw button `Request raw records`.
- Activity: section `Collection`, `.activity-collector-card`, report summary `Per-run collector counters`; section `Indexing jobs`, `.activity-job-row`, scope buttons `Current`/`History`; `.activity-collector-scroll`/`.activity-job-scroll` append automatically.
- Main nav buttons: `archive`, `activity`, `access` (exact). Transport health: `.connection-widget[data-state="live"]`, `unauthorized`, `update-required`, `stopped`, etc.; this is browser-channel status, not collector health.
