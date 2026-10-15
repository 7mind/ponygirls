# Browsing records

Browse, Attention inbox, Archive, Upstream activity, and Skill candidates use
one scrollable table. Columns show the record title and item id, project, type,
status, priority, attention, tags, modification details, and revision. On narrow
screens the table scrolls horizontally rather than hiding its columns.

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
