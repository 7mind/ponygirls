# Browsing records

Browse, Attention inbox, Archive, Upstream activity, and Skill candidates use
one scrollable table. Workspace navigation is in a wrapping toolbar, not a
sidebar. The header keeps account identity, Settings, Sign out, and live
connection details together; the activity namespace stays visible on mobile.
Columns show the record title and item id, project, type, status, priority,
attention, tags, modification details, and revision. On narrow screens each row
reflows into labeled metadata, keeping every field and sort control available
without horizontal scrolling or clipped values.

Sign in with your account username and password. Settings manages account API
tokens through the shared account dialog; API tokens are not browser sessions.

Select a column heading to sort the **complete search result**, then select it
again to reverse direction. Modified time defaults to newest first; revision is
numeric. Other metadata is literal, case-sensitive UTF-8 order (priority labels
are arbitrary strings, not a fixed severity scale). Tags are displayed but are
not a sort key. Project and item break ties deterministically.

Results load in batches of 20 as the bottom of the table approaches. The header
stays visible while scrolling. **Load more records** offers the same operation
for keyboard users and browsers without IntersectionObserver. There are no page
numbers or Next/Back controls. The count shows loaded records, with `+` while
more records remain; reaching the end displays the final loaded count.

Changing the query, filters, or sort restarts the list. Filters and sort live in
the URL fragment, including for the inbox, so reload and browser navigation
restore the selection. Unsubmitted search drafts are not applied by sorting.
Live notifications reload the current search from the start; this is a live
view, not a snapshot. If records move across an already-consumed cursor because
of concurrent changes, refreshing restarts traversal. Duplicate record keys are
merged rather than displayed twice.

A failed next-batch request preserves loaded rows and the continuation cursor.
Automatic loading stops until **Retry loading records** is selected; failures
never trigger an automatic retry loop. Responses from superseded searches or
sort orders cannot replace or append to the active result set.

## Search (ranked retrieval)

**Search**, next to Browse in the navigation, is ranked retrieval over record
titles, descriptions and tags (`POST /api/v1/retrieve`, [`api.md`](api.md)).
Fields are not searched here, and the Browse query language does not apply:
the text uses PostgreSQL web-search syntax (`"exact phrase"`, `-word`, `or`)
for the lexical leg; semantic and hybrid also rank by meaning through the
configured embedding. Browse remains the exact listing and filter view.

Ranked Search requires indexing to be enabled for both the record's creator
and the author of the revision being searched. A parked edit does not hide an
older semantic result if both accounts that produced that older revision
still allow it. Disabling indexing hides ineligible results without deleting
the existing index. In Browse, it excludes ineligible revisions from free-text
and phrase matches; the ordinary listing, structured filters, direct record
access and revision history stay available.

The route is `#/search?q=&mode=&project=&archived=` (`mode` lexical, semantic or
hybrid; omitted means the default). Controls:

- **Mode**: Default, Lexical, Semantic, Hybrid. Modes the server does not offer
  (`GET /api/v1/capabilities`) are disabled with the reason "Not configured on
  this server". Choosing a mode searches at once.
- **Project (exact)**: one exact project, applied with Enter or Search.
- **Include archived**: archived records are excluded unless checked.

Default (no mode in the route): hybrid when the server offers it, otherwise
lexical with the notice "Hybrid search is not available on this server:
<reason>; showing lexical results". A default hybrid search that the server
refuses with its fixed reason (`query embedding failed`) is run once more
lexically with the same notice; if that lexical search fails too, the error is
shown under the same notice and mode. An explicitly chosen mode is never
replaced: when the server refuses it, the view shows the reason and a **Search
lexically instead** button. The same rule applies when a later batch of a
semantic or hybrid search is refused: a default search starts again lexically
from the first result (rankings are not mixed), an explicit one keeps the
results already loaded and offers **Search lexically instead**. The line above
the results always names the mode that answered (or was attempted) and whether
it was the default or chosen. Search and Retry run the shown values again. A semantic or hybrid answer
with records not yet indexed shows "N items are not yet indexed for semantic
search; results may be incomplete". An empty query sends no request.

Each result is one record: its key (opens the record; Back returns to the
search with its query, mode, loaded results, scroll position and focus), the
revision, field and pointer of the best matching text, a snippet of that text
(at most 240 characters, shown as plain text) and the score. Counts are shown
as the server declares them: exact matches for lexical, or the records found in
the candidate window (with its ranking limit) for semantic and hybrid. Results
load in batches of 20 as the end of the page approaches, up to the exact
matches or the ranking window, and end with an explicit marker. A failed next
batch keeps the loaded results and offers **Retry loading results**. Returning
to an earlier search route restores its answer only if it had settled; a
search that failed or was still loading runs again.

## Checks

From `haystack/`:

```bash
npm run typecheck
npm test -w web
# Built UI + disposable test PostgreSQL + Chromium; see operations.md.
npm run test:browser -w web
```

`web/tests-browser/browse.mjs` checks real scrolling, global sort order,
keyboard activation, URL reload, mobile overflow, stale in-flight requests,
append retries, and tag-filter navigation. Set `HAYSTACK_BROWSER_CHECK='browse '`
to run those checks alone through `web/tests-browser/run.mjs`. `HAYSTACK_FIREFOX`
selects a Firefox executable explicitly instead of `HAYSTACK_CHROMIUM`; there
is no automatic browser fallback. Use a runtime compatible with Playwright.
The local HTTP fixture injects delayed and failed search responses; production
server code has no fault-injection hooks.

`web/tests-browser/retrieve.mjs` checks Search against two real servers: one
configured with a loopback stub embedding endpoint started by the script
(`embedding-stub.mjs`, deterministic vectors, requests recorded, no external
network) and one lexical-only. It covers the default hybrid, the lexical-only
notice and disabled modes, the lexical re-run and the explicit-mode refusal
with the stub stopped, the pending notice, the record round trip and the
keyboard path to the mode control.
