# Dashboard redesign spec — Chronicle, Haystack, Manure and the shared account UI

Status: **direction approved by the owner (decision Q89); implementation proceeds from §7 and §8**. Orchestrator decisions on the former open questions are recorded in §9. Base commit `f153d1ae`. No product code, test or Nix file is changed by this document.

**Reference copies of the design-system candidate are committed next to this file** in `docs/drafts/20261117-2130-dashboard-redesign/` (`tokens.css`, `components.css`, `account.css`, `chronicle.css`, `haystack.css`, `manure.css`) so that implementers do not depend on the scratch directory. They are documentation, not product code; nothing loads them.

**Primary evidence is the clickable mockup site**, not this text:
`/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/ux/mockups/` (`index.html`; `shots/index.html` is a before/after gallery).
The candidate design system is `tokens.css` + `components.css` there; per-app view styles are `chronicle.css`, `haystack.css`, `manure.css`, `account.css`. `mock.js` and `*-mock.js` are mockup scaffolding only.

**Evidence conventions.** *Measured* = DOM measurement of the mockups in the pinned Chromium (`tools/shoot`, `tools/measure`; results in `shots/scrollers.json`, `shots/measurements.json`). *Looked* = screenshot inspected through the `look` vision wrapper (a model's reading of a PNG, not a human review). *Groundwork* = the three reports under `.local/overhaul-20261117/reports/ux/` (defect ids A/S/Q/V/D/G for Chronicle, H-xx for Haystack, Dxx for Manure — cited as `M-Dxx` below to avoid a clash with Chronicle's D1–D7). *Proposed* = design intent that a static mockup cannot prove (keyboard order, focus, real data shape, performance).

**Scroll-container result for the final mockups** (measured, `shots/scrollers.json`, 231 renders at 1440×900, 1024×700 and dark): every model-A render has the document as its only vertical scroller (or none when the content fits); every session render has exactly the transcript pane and, when open, the side pane; no render has horizontal document overflow or a page error.

**Limits.** (1) This host has only DejaVu fonts; every screenshot renders wider than it will with Inter or a system UI font. (2) Mockups use synthetic data and scripted states; ranking, latency, real message shapes and real error payloads are not represented. (3) Haystack and Manure pages were built by two delegated authors against this system and reviewed by the design lead through `look`; their own notes (`notes-haystack.md`, `notes-manure.md` in the mockup root) list what each verified. (4) Hover, focus order and screen-reader behaviour were not exercised.

---

## 1 Principles and scroll model

1. **One vertical scroller per view.** Two models, nothing else:
   - **Model A — document scroll (default).** The document is the only vertical scroller. The masthead (48 px), an optional sub-navigation (40 px), the view bar (56 px) and the table header (36 px) are `position: sticky` and stack by token heights. Lists load more when the *document* nears its end, show `N <things> · M loaded` in the view bar and end with an explicit `End of list · N <things>` marker. No list has a `max-height`; no wrapper around a table has `overflow`.
   - **Model B — deliberate split.** Only the Chronicle session page. The shell is exactly viewport-high, the page does not scroll, and two panes (transcript, side pane) scroll independently. Closing the side pane leaves one scroller.
   - Wide tables never get an inner horizontal scroller: columns are prioritised and chosen; if a user enables more columns than fit, the document scrolls sideways with the first column pinned.
2. **One long list per view.** A second list becomes its own view (Activity → Collectors / Jobs), a capped summary with a link (incoming links, "5 of 37 shown"), or a tab of a side pane (session outline / find hits / related).
3. **One list idiom.** Cursor-driven infinite loading everywhere, including Search. No numbered pages, no numbered cards, no per-card pagers, no "Load more" buttons. A failed append keeps the rows and offers "Retry".
4. **Data starts high.** No page heading + subtitle + help-sentence stack above lists. Measured in the mockups at 1440×900: first data row at y = 180 px in Chronicle Archive, Haystack Browse and Manure Catalogue (groundwork: 378 px in Haystack, 537 px in Manure), 13 two-line rows fully visible, sticky header at y = 104 px after scrolling.
5. **Lists never reset under the reader.** Live updates and polling announce themselves with a floating pill ("12 conversations changed · Show") that takes no layout height; the user applies them. Typing a new query keeps the previous results (dimmed, labelled) until submitted.
6. **Everything addressable.** Every view, query, sort, sub-view and opened item has a URL; browser Back returns to the previous view with its loaded rows, scroll position and selection.
7. **One design system.** All sizes, colours, radii, shadows and layers come from `tokens.css`. Nothing below 12 px. Controls are 32 px high, in-row actions at least 28 px. Status is always a dot + label or a chip, never colour alone.
8. **Feedback where the action is.** Errors are inline `notice` blocks next to what failed and persist; success is a toast; destructive actions use one in-app confirmation dialog. `window.confirm` is not used anywhere.
9. **Siblings with identities.** The three dashboards share chrome, type, spacing and components; each keeps its logo mark and accent (Chronicle ink blue, Haystack teal, Manure violet — decided, §9).
10. **Keep what works.** Chronicle's Archive stays a query bar over a table with the same columns and filter shortcuts; Search stays query → conversation cards with highlighted excerpts. Query languages and their capabilities are unchanged.

## 2 Design tokens and component inventory

### 2.1 Tokens (final values; source of truth: `tokens.css`)

| Group | Tokens |
|---|---|
| Font families | `--font-sans`: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", sans-serif · `--font-mono`: ui-monospace, "JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace. Two families; Georgia is dropped. Inter is bundled (variable WOFF2, self-hosted from `shared/ui-web/fonts/`, `@font-face` in `tokens.css`, `font-display: swap`) — decided, §9. |
| Type scale | `--text-xs` 12 (floor: captions, table headers, chips) · `--text-sm` 13 (table cells, buttons, inputs, nav) · `--text-md` 14 (base, prose, transcript) · `--text-lg` 16 (section and result titles) · `--text-xl` 20 (page titles) · `--text-2xl` 28 (headline numbers). Replaces 40 sizes in Chronicle, 12 in Haystack. |
| Weights / leading | 400, 500, 600 · line-height 1.25 (titles), 1.45 (UI), 1.6 (prose) |
| Space | `--space-0` 2 · `-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48. The only values allowed in margin/padding/gap (hairlines excepted). Replaces 62 spacing literals in Chronicle, 21 in Haystack. |
| Sizes | `--control-h` 32 · `--control-h-lg` 40 (query bar, auth fields) · `--control-h-sm` 28 (in-row only) · `--row-h` 40 · `--row-h-2` 52 · `--masthead-h` 48 · `--subnav-h` 40 · `--viewbar-h` 56 · `--gutter` 24 (16 ≤ 1100 px, 12 ≤ 720 px) · `--measure` 720 (prose) · `--rail-w` 340 (300 ≤ 1100 px) |
| Radius | `--radius-sm` 4 (chips) · `--radius-md` 6 (controls, cards, popovers) · `--radius-lg` 10 (dialogs, auth cards) · `--radius-full` |
| Elevation | `--shadow-1` (popover, menu, toast) · `--shadow-2` (dialog). Cards are flat with a border. |
| Layers | `--z-sticky` 10 · `--z-masthead` 20 · `--z-popover` 30 · `--z-dialog` 40 · `--z-toast` 50 |
| Neutrals (light / dark) | canvas `#f4f5f7` / `#0d1015` · surface `#ffffff` / `#151920` · sunken `#f0f2f5` / `#1b2029` · hover `#f3f5f8` / `#1d232d` · border `#d8dce2` / `#333a47` · border-strong `#a9b1bd` / `#4a5362` · text `#181b20` / `#e5e8ed` · muted `#59616e` / `#a0a9b6` · faint `#6b7380` / `#8891a0` |
| Accent (per app, light / dark) | Chronicle `--accent` `#2c56c4` / `#86a8ff`, solid `#2f5bd0` / `#3d68dc` · Haystack `#0a6c61` / `#56d3c0`, solid `#0b7a6d` / `#0d7f70` · Manure `#6238c0` / `#b7a0ff`, solid `#6a41c8` / `#7450d6`; each with `-solid-hover`, `-soft`, `-soft-border`, `--focus` |
| Status (fg / soft bg / border) | ok, warn, danger, info, neutral triplets; `--danger-solid`; `--mark-bg/fg` for search highlights; `--role-user/assistant/tool/system` for transcripts; `--qr-fg/bg` theme-invariant |

Theme contract: a blocking `theme-init.js` always sets `<html data-theme="light|dark" data-theme-choice="system|light|dark">`, so there is one dark block and no duplicated `prefers-color-scheme` copy. `<html data-app="chronicle|haystack|manure">` selects the accent ramp only. All three dashboards get the same System / Light / Dark menu (today only Chronicle has one — M-D34, Haystack groundwork question 5).

Contrast of the token pairs, computed with the WCAG 2 formula from the hex values (not measured on rendered pixels):

| Pair | Light | Dark |
|---|---|---|
| text on surface | 17.3 : 1 | 14.4 : 1 |
| muted text on surface (on sunken) | 6.3 : 1 (5.6 : 1) | 7.4 : 1 |
| faint text on surface (placeholders) | 4.8 : 1 | 5.5 : 1 |
| accent text on surface — Chronicle / Haystack / Manure | 6.5 / 6.3 / 7.4 : 1 | 7.6 : 1 (Chronicle) |
| white on solid accent — Chronicle / Haystack / Manure | 6.0 / 5.2 / 6.6 : 1 | 5.0 / 4.9 / 5.4 : 1 |
| status text on its soft ground — ok / warn / danger | 5.1 / 5.5 / 5.4 : 1 | 7.0 / 7.5 / 6.9 : 1 |
| `--border` (dividers) on surface | 1.4 : 1 | 1.5 : 1 |
| `--border-strong` (control outlines) on surface | 2.2 : 1 | 2.3 : 1 |

Text pairs meet WCAG AA. Borders do not reach the 3 : 1 that WCAG 1.4.11 asks of the only visual boundary of a control: dividers are decorative (structure also comes from the sunken header band and spacing), and control outlines at 2.2 : 1 are a deliberate compromise between definition and visual weight (the current dashboards measure 1.5–1.7 : 1). Raising `--border-strong` to 3 : 1 is a one-token change if the owner prefers it.

### 2.2 Components (source of truth: `components.css`)

| Component | Class(es) | Notes |
|---|---|---|
| Shell | `.masthead`, `.brand`, `.nav`, `.conn`, `.user-button`, `.avatar` | Brand, primary nav (links, `aria-current`), then connection indicator, theme menu, user menu (Account settings, Access tokens, Users, Sign out). The floating connection pill is gone (A7). |
| Layout | `.subnav`, `.viewbar`, `.viewbar-meta`, `.page`, `.page-narrow` (1200), `.with-rail`, `.rail-sticky`, `.split`, `.pane`, `.grid-2`, stacks/rows | List views are full-bleed on `surface`; document-like views (detail, settings, Access, overview) are centred at 1200 px on `canvas`. |
| Buttons | `.btn` + `-primary`, `-danger`, `-danger-quiet`, `-ghost`, `-lg`, `-sm`, `-icon`, `-block`; `[aria-pressed]`; `.link-button` | One primary per view. |
| Fields | `.field`, `.label`, `.hint`, `.field-error`, `.input`, `.select`, `.textarea`, `.input-code`, `.check`, `.switch`, `.segmented`, `.form-grid` | Inline errors under the field; `aria-invalid` border. |
| Chips / status | `.chip` + `-outline`, `-accent`, `-ok`, `-warn`, `-danger`, `-info`; `.status` + variants (dot + label); `.count`; `.kbd` | |
| Tabs | `.tabs`, `.tab` | Sub-navigation and side-pane tabs. |
| Query bar | `.querybar`, `.query-suggest`, `.filterbar`, `.filter`, `.filter-field`, `.filter-divider` | Shortcut row: preset toggles (solid pills) · divider · field inserters (dashed, monospace) · right end: order toggle when relevant and the "Query syntax" link. |
| Table | `.table`, `.table-2line`, `.table-inset`, `.table-static`, `.th-sort`, `.cell-title`, `.cell-sub`, `.col-num`, `.row-actions`, `.row-detail` | Sticky header in the document; row details expand in place instead of popovers. |
| List states | `.list-foot`, `.list-end`, `.spinner`, `.skeleton`, `.empty`, `.update-pill` | |
| Surfaces | `.card`, `.tile`, `.dl`, `.well`, `.code-block`, `.notice` (+ variants), `.banner` | |
| Overlays | `.menu`, `.popover`, `.dialog` (confirmations and short forms only), `.toasts` | A dialog is never a page substitute. |
| Auth | `.auth-page`, `.auth-card`, `.auth-card-wide` | Login, signup, recovery, enrollment, Manure unlock. |

Icons are inline SVG from one sprite (24-unit grid, 1.75 stroke, `currentColor`); no icon font, no `data:` URLs. Dynamic geometry (a progress fill, the session position indicator) is set through the CSSOM (`element.style.setProperty`), never through `style=""` attributes or `<style>` blocks, so Manure's CSP holds.

## 3 Per-dashboard redesign

Mockup files are named `<app>-<view>.html`; states are `?state=<name>` and listed by the switcher at the bottom left of each page.

### 3.1 Chronicle

**Shell** (`App.tsx`). Masthead with nav Archive · Search · Activity · Access · MCP (label "MCP", not "Mcp"). A red dot on Activity when something needs attention (failed jobs, stale collectors). Connection state is a dot + label in the masthead with a popover. The identity cluster (name, Settings, Sign out, Theme) becomes a theme icon menu and a user menu. Fixes A7, D6, G7.

**Archive** — `chronicle-archive.html` (states: default, filtered, text, updates, loading, empty, error).
- Structure: view bar (query bar with clear, `Ctrl K`, Search; counter `420 conversations · 50 loaded`; refresh; table-options menu with columns and fit modes) → shortcut row (the existing five presets and field inserters; at 1024 px the rarer inserters fold into "more…") → table → end marker.
- Same six default columns and the same eleven available ones. Rows stay two-line: title + tags as chips + producer; Last activity shows date and a relative sub-line; status is dot + label (Complete, Queued, Running, Failed, Unscheduled).
- The table is in the document; the header sticks under the view bar (measured: th top 104 px at scrollY 1500). Fixes A1 and the owner's "double scrolling". Type is 13/12 px (A5: was 11/10/9).
- "Ordered by … · Relevance for text" becomes a Relevance | Last activity toggle shown only when the query contains text; otherwise sort lives in the header alone.
- Auto-refresh keeps the "update available" gating as the floating pill. Empty and error states replace the empty bordered frame (A6). Loading shows skeleton rows.
- Column chooser beyond the available width: document scrolls sideways with the Conversation column pinned (A4) — proposed, not mocked.

**Session** — `chronicle-session.html` (states: default, outline-closed, passage, find, tool, folded, expanded, related, info, loading, error). Scroll model B. Replaces the 90vw × 90vh modal (S1–S8, A3, G1).
- Header (60 px): back button, title, one meta line (Archive link · producer · project · branch · time span · message count · index chip), then Find, Side pane toggle and a "⋯" menu (Recheck source, Go to latest archive, Copy link, Open raw source record, Provenance and metadata). The old top bar, hidden `h2` and provenance line collapse into this (S6).
- Transcript pane: prose in the sans family at 14 px with a 720 px measure; code blocks and tool output use the full pane width. Message header is one line: role, time, `#n`, passage chips, then technical ids and actions (copy, copy link, more) on hover/focus; the "⋯" stays faintly visible for touch and keyboard. No per-message footer and no two-button row (S2).
- User messages carry a subtle ground so that prompts act as anchors; assistant and system messages do not.
- Tool calls are 36 px rows grouped under one rule: tool name, argument, size/duration, exit chip, time, `#n`; output is folded by default and long output shows a head with "Show all N lines" (S2). Diff lines are coloured.
- Long messages fold after about seven lines with a fade and "Show full message · N characters" (was: only above 20 000 characters). A system prompt is one line with "Show".
- Find is a docked bar at the top of the transcript pane (not a floating overlay): input, previous/next, "Match 3 of 27 in 21 messages", Done. The current match has a distinct style from other matches; the message containing it is unfolded; the hit list with snippets is the side pane's Find tab (S4).
- Side pane (340 px, closable, state remembered): tabs Outline (passages as compact two-line rows: faint ordinal, title, tags, message number — the ordinal is deliberately secondary), Find, Related (opens as normal navigation, so Back returns — S8), Info (source/revision/snapshot, index figures, identifiers — everything that was in the provenance popover).
- Passages are linked both ways: outline row → scroll and highlight the span; passage chips in message headers → select the outline row (S3).
- Position bar at the bottom of the transcript pane: "Messages 1–9 of 260", a position track, Start / End / Go to message… — replaces the floating counter.
- Measured: the two panes are the only scrollers (`div#pane`, `div#rail-pane`); with the side pane closed, one. Looked: about twice as many messages visible as before at 1440×900 (8 vs 4; four of them are collapsed tool rows).
- Loading shows a skeleton transcript; an access error shows a notice with "Back to Archive" inside the normal page (S7).

**Search** — `chronicle-search.html` (states: default, results, expanded, stale, loading, empty, error). Model A.
- Same query bar and shortcuts as Archive. Counter `349 conversations · 20 loaded`; an info popover holds what the old seven-clause summary line said (candidate bounds, ordering) — Q5.
- A result is a compact block: title (link to the session), one crumb line (producer · project · branch · message count · match count; a chip when a conversation matched by exact text only), up to two highlighted hits (role, two-line clamp, message number; each opens the session at that message with Find active), the annotation line, and two actions: "N more matches · context" (expands in place) and "Open at first match". Looked: 4 results per 900 px screen (was 1 card).
- Expanded in place: all matches of that conversation with the preceding message as muted context and "⋯ n messages between" markers; Earlier/Later context buttons. This replaces "Source span 1 2", "Earlier/Later context" and "Matched source" pagers (Q2).
- Infinite loading with end marker; no result pages (Q1). Byte ranges, representative counters, source revision and generation ids move to the session's Info tab and message "⋯" menu (Q5).
- Editing the query keeps the previous results dimmed with "Query edited · Enter to update" in the counter slot (Q3). Query, results and scroll survive tab switches and reload through the URL and a per-route cache (Q4).
- First render shows what Search does and four example queries instead of an empty page.

**Activity** — `chronicle-activity.html` (states: overview, collectors, collectors-stale, collector-detail, jobs, jobs-failed, jobs-collector, job-detail, jobs-updates, empty, usage, maintenance, retry-confirm, rebuild-confirm). Model A with a sub-navigation: Overview · Collectors · Jobs · Model usage · Maintenance; tabs carry problem badges ("5 stale", "37 failed"), the snapshot time and refresh sit at the right end.
- **Overview**: six tiles (Archive HEADs, Without target job, Queued, Running, Failed, Complete — each a link), a "Needs attention" list ordered by severity (failed jobs, expired leases, stale collectors, unscheduled conversations — each a link to the filtered list), job totals as two bars plus the Current/Historical table and the lease line, a collector summary and a model-usage summary. Replaces the 9–11 px totals card (V3).
- **Collectors** and **Jobs** are separate single-scroll views (V1). Each has one view bar: (Jobs only) Current | History, the metadata expression editor, counter, table options; one shortcut row.
- Cross-links (V2): collector row → "Jobs" → Jobs view with `collector:"…"` applied as a removable chip in the same expression (the separate Collector ID form, Apply and "All my collectors" go away); failed counts link to the filtered Jobs view; job title → the session page; job details → collector.
- Row details expand in place under the row (last report, counters, failure stage, lease, ids, actions) instead of 560 px popovers (V7). In-row buttons are 28 px (was 24).
- Jobs columns: Last activity, Conversation (+ project · branch), State, Revision, Attempts, Windows (progress + done/total), Lease, Reason, details. Classification moves to the detail row; other fields stay in the column chooser (V3, V4: no pinned columns inside a two-way scroller).
- **Model usage**: its own view — the same six measures as a readable table (TPS in the main line, tokens below), the measurement explanation in a popover, indexing settings as a definition list.
- **Maintenance**: "Retry failed indexing jobs" and "Rebuild archive index" as cards with scope figures; each opens a preview dialog with exact counts and the confirmation checkbox (V5: no more inline expansion that pushes tables). The persistent "outcome unknown" region keeps its place on this view.
- Polling keeps running; changes are announced by the pill and applied on request; scroll never resets (V6).

**Access** — `chronicle-access.html` (states: default, new-group, join, delete, toast). Centred page: pending invitations first (they need action) with the sharing warning once, then groups as cards with a member table, invite field and a "⋯" menu; "New group" opens an inline form. Joining and deleting use in-app dialogs (D3). The left column that only pointed to token settings is removed; a sentence links to Account → Access tokens (D6).

**MCP tester** — `chronicle-mcp.html` (states: default, schemas, running, complete). Two columns: tool catalog (model line, three tools with expandable schemas) and the work column (prompt card with byte counter and Run; run card with status, actions, identifiers in a popover; the trace rendered with the transcript's tool rows and a Response block). All existing functions kept; only the shell is designed here.

### 3.2 Haystack

Details, state lists and the full H-xx mapping: `notes-haystack.md`.

**Browse and its presets** — `haystack-browse.html` (default, inbox, upstream, skills, archive, filtered, completions, invalid, updates, loading, empty, inbox-empty, error, append-error, offline; shots also cover the syntax dialog, scrolled and end-of-list). Model A.
- Nav entries Browse · Inbox (count) · Upstream · Skill drafts · Archive are real routes that preset the query; the active entry is derived from the route, and a record page keeps its originating entry highlighted (H-23).
- One view bar (query bar, counter, icon actions) and one shortcut row; page heading, subtitle, "Query" label, help sentence, second heading and "Sorted by" caption are gone (H-02, H-10). The server has a cursor but no total, so the counter reads "40 loaded · more available" and ends with "All 569 records loaded" (H-09). No count is added to the API (decided, §9).
- Columns: Record (type tile, title, qualified key; `archived` chip or non-`actual` status in the sub-line), Type, Project, Tags (chips, at most two + "+N"), Attention (only "Needs review"), Importance (text; critical as dot + label), Modified (date + "by user"), Rev. The Status column, constant on nearly every row, is dropped from the default set (H-11). The table stays a table at 1024 px (Project and Rev hide) instead of 184 px cards (H-12).
- Live changes show the pill and never clear the list (H-03). Offline keeps the data under one inline warning.
- All text ≥ 12 px (H-07). Empty, "Inbox zero", load failure, failed append and loading are designed states (H-25).

**Record** — `haystack-detail.html` (default, source, raw, skill, archived, snapshot, restore-confirm, cleared, saved, not-found, loading). Model A.
- The view bar is the record header and stays visible: Back to the originating list (history-aware — H-04), type tile, title, key, revision, then Clear attention / Edit / "⋯" (H-13).
- Main column: review/skill-draft/archived notice, description, fields (Markdown and code fields as cards with a Rendered | Source switch instead of a duplicated source block; scalar fields as rows of one card), links (outgoing and incoming). Incoming links keep today's query (first 100, no total): when the cap is hit the card says "First N shown · more exist" with "Open all in Browse" (the `linked-to:` query) — H-30. A server-side link summary (totals, relation of incoming links) is deferred (§9). Rendered Markdown headings are demoted below the page title (H-14).
- Rail: metadata with formatted dates (H-29) and history (compact rows, View, Compare revisions…).
- Snapshot: banner "Viewing revision 3 of 4" with compare select, Back to latest and Restore as new revision (with confirmation); a field-level diff replaces two stacked views (H-18).

**Edit** — `haystack-edit.html` (default, pristine, raw, invalid, remote, conflict, pending, leave). The view bar becomes the edit bar with a dirty indicator, Cancel and "Save as new revision" always visible (H-13, H-15, H-16). Textareas grow with content and Write/Preview are two columns that both grow — no inner scrollers (H-08; measured by the author). Inline field errors with a summary; conflict, remote update and unknown write outcome are three distinct notices; leaving with changes asks in an in-app dialog.

**Connection indicator** — `haystack-connection.html`: Live, Connecting…, Reconnecting · 3/12, Stale · 2 min, Offline; a small popover with one sentence, three figures, a collapsed event log and "Reconnect now" (H-26). The same component is used by Chronicle.

### 3.3 Manure

Details, state lists, the M-Dxx mapping and a source check of every assumed capability: `notes-manure.md`.

**Catalogue** — `manure-catalogue.html` (default, filtered, expired, suggestions, diagnostic, stale-draft, retrieval, retrieval-unavailable, empty, error, loading, drop, row-menu, delete-confirm, copy-fallback, path-mode, syntax, end). Model A.
- View bar: query bar, counter, refresh, primary Upload. Shortcut row: the access scope (All / Internal / External / Public) as a segmented control that applies immediately, then real query fields, then "Query syntax". The always-visible upload strip, heading block and 193 px search panel are gone (M-D11: first row at 180 px instead of 537 px; M-D16).
- Table in the document with a sticky header (M-D01, M-D02): Name (kind tile, name, id), Access (chip with icon), Size, Files, Created, Expires (relative; warning status under 48 h), Owner, actions (Open; copy link and "⋯" with Copy ID / Delete…). Kind merges into the tile; State appears only when it is not Ready (M-D12). Stays a table at 1024 px (M-D13).
- Typing never clears results; a changed draft is labelled (M-D14). Dropping files anywhere opens the upload page with the files staged. Delete uses the in-app dialog (M-D21). Copy-link failure shows a dialog/notice, not an expanding table cell (M-D18).

**Upload** — `manure-upload.html` (default, staged, progress, done, done-external, failed, cli): a routed page with a large drop zone, access mode with its one-line explanation, expiry and tags, one list of files with per-file progress, result link and — for External — the password panel. CLI instructions are the `cli` view of the same page (M-D30, M-D33). Expiry and tags at upload exist in the API but are not wired in today's dashboard: this is new dashboard wiring.

**Artifact** — `manure-detail.html` (default, big, subdir, password, rotate-confirm, access-changed, access-confirm, edit-name, edit-expiry, uploading, expired, not-found, loading, delete-confirm). The view bar is the artifact header (Back, kind, name, access, state; Open artifact, Copy link, "⋯"). Main column: Overview and the content manifest as a table in the document with a sticky header, a path filter and folder drill-down (M-D03: measured, a 161-file manifest scrolls the page). Rail: Access & sharing (mode, explanation, Save with a confirmation that states the revocation), external password (masked, Reveal, Copy, Rotate…), Danger zone. Loading, not-found and expired are states of this page, not banners on the catalogue (M-D19). Metadata editing covers what `ArtifactPatch` supports: name, access, expiry. Tags are read-only chips; editable tags need a new API field and are deferred (§9).

**Viewer and directory listing** — `manure-viewer.html` (markdown, raw, directory, pdf, image, error): one slim bar (brand, breadcrumb, Rendered | Raw, Copy raw, Download, theme), content in the document; directory listings are a styled table with a breadcrumb and the README rendered beneath (M-D23); heading anchors appear on hover (M-D26). The directory page is rendered by the server today, so styling it needs a change in `manure/backend/src/main/scala/manure/Http.scala` and its CSP; this Scala change is accepted and belongs to UX-M4 (§9).

**Unlock** — `manure-unlock.html` (default, error, rate-limited, expired): the shared auth card (M-D22: one visual system instead of four).

## 4 Shared account surfaces

Mockups: `account-login.html`, `account-signup.html`, `account-recover.html`, `account-settings.html`, `account-users.html`; all accept `?app=haystack|manure` to show the same surface in the other chrome (captured: `account-settings-tokens-haystack-1440.png`, `account-settings-tokens-manure-1440.png`, `account-login-default-{haystack,manure}-1440.png`). Behaviour is fixed by the auth design document (§4.9, §5.1) plus the owner decisions made after it; this section fixes look and flow.

### 4.1 Decision: a routed page, not a dialog

The account area is a **routed full page** rendered by the shared module, with a section navigation on the left and one section per route. Reasons:
1. The content grew from one token list to five sections plus a user table of up to about a thousand rows. A dialog that holds this is a page with worse scrolling: the groundwork measured the current dialog at 3.3 to 6.7 viewports of content (D1, D2, H-19, M-D05).
2. Model A applies unchanged: the document scrolls; the section header and the table header stick. Measured: document is the only scroller in every account state.
3. A route gives Back, reload and deep links (`…#account/tokens`) for free, and a place for the one-time secret that is not destroyed by dismissal gestures.
4. It embeds identically in React and vanilla hosts: the host only provides an outlet element.

Dialogs remain for confirmations (revoke, approve, disable, grant admin, reset, toggle TOTP, hide secret).

### 4.2 Embedding contract (identical in the three dashboards)

- The shared stylesheet consumes the host's tokens; `account.css` has no palette, font, radius or unit system of its own (D1, H-22, M-D08).
- The shared client owns URL fragments starting with `#account`: `#account/profile`, `/password`, `/two-factor`, `/tokens`, `/users`, `#account/signup`, `#account/recover`, and the existing `#account-enroll=<code>` (captured and removed at module evaluation, as the auth design requires).
- Signed in: the host renders `<div data-account-outlet hidden>` next to its `<main>`. On an `#account/…` route the shared code hides the host main (it stays mounted: lists, drafts and scroll are kept), shows the outlet, remembers `scrollY` and restores it on return. It dispatches `account:route` so the host clears its nav highlight. Host routers ignore `#account…` fragments.
- Signed out: the host renders `<div data-account-auth>` in its login view; the shared code renders login (keeping `form[data-account-login]`), the TOTP step, signup, recovery and the enrollment landing into it, showing the links that `GET /policy` allows.
- Entry points: user menu → Account settings / Access tokens / Users. `[data-account-settings]` keeps working as a trigger. Existing events `account:invalidate` and `account:changed` are unchanged.
- Permissions in the token form come from the service's supported list: Chronicle shows Ingest / Read / Raw; a service with a single scope (Manure: `api`) shows no fieldset, just "Full API access".

### 4.3 Surfaces

| Surface | States mocked | Design |
|---|---|---|
| Login | default, error, pending, totp, totp-error, rate-limited, signup-off | One card. Generic error for wrong credentials. **Awaiting approval**: a correct password for a not-yet-approved account shows "Awaiting approval by an administrator" (amber notice, not an error). The TOTP step replaces the card content ("Signing in as alice"), keeps login and password in memory only, has "Use a different account". Rate limit shows the wait. |
| Signup | default, errors, pending, closed | One page, two columns: Account (username with policy hint, e-mail, password with meter) and Authenticator app (QR rendered as DOM cells, manual key with copy, 6-digit proof). The switch "Also require a code at every sign-in" is **off by default** and worded neutrally (optional; can be changed later). Field errors are inline with one summary line. Success with approval required is its own screen: "Account created — waiting for approval". "Sign-up is not available" covers the closed and cap-reached cases and says existing accounts keep working. |
| Enrollment landing | enroll, enroll-reset, enroll-invalid | The signup form with the username fixed and a line saying who invited and when the link expires; the reset variant has no e-mail field and explains that current credentials work until completion; invalid/expired/used links get one explanation. |
| Recovery | default, rejected, weak, rate-limited | Username, authenticator code, new password; generic rejection; states what happens to sessions and tokens. |
| Settings · Profile | profile, declarative | Username (read-only), e-mail, account type, role, session. Declarative accounts see a neutral notice and no editable sections. |
| Settings · Password | password | Current + new; says other sessions are signed out. |
| Settings · Two-factor | totp, totp-replace, totp-toggle | Authenticator status with "Replace authenticator…" (password + new QR + proof, inline card); the require-at-sign-in switch (off by default) asks for a current code in a dialog in both directions. |
| Settings · Access tokens | tokens, tokens-new, tokens-invalid, tokens-secret, tokens-copied, tokens-leave, tokens-revoke, tokens-long, tokens-uncertain, tokens-loading, tokens-error, tokens-empty | See 4.4. |
| Users (admin) | default, pending, menu, approve, reject, enroll, enroll-link, disable, grant-admin, reset, reset-link, signup-only | See 4.5. |

### 4.4 Access tokens

- A table: Name, Permissions (chips), Source ("Issued here" or "Configuration" with a lock; configured tokens are read-only — the per-row sentence is gone), Created, Token ID (short, full value in the tooltip, copy on hover), Revoke. Revoked tokens are hidden behind "Show N revoked". Long lists get a name filter; the header row and table header stick while the document scrolls (measured with 32 tokens). Fixes D2, H-19, M-D05, M-D10.
- **New token** opens an inline form above the table (name; permissions with one-line meanings). A whitespace-only name gets an inline error (D4, H-21, M-D09).
- **One-time secret**: the form is replaced, in the same place, by an amber panel: title naming the token, the secret (masked by default, Reveal, Copy — decided, §9), a "Not copied yet / Copied" chip, and "I have saved it" — disabled until the secret was copied or revealed, and confirmed by a dialog ("Hide the secret for good?"). The panel is not dismissed by Escape, window focus changes, section changes or Back: in-app navigation asks first, closing the tab uses `beforeunload`. The window-focus revalidation re-reads the account silently and must not re-render this section (root cause of H-05; also H-06, D-secret complaints). The new token row is highlighted in the table.
- **Revoke** uses a dialog naming the token with its permissions, date and id (D3, H-20, M-D06).
- **Unknown creation outcome** (request sent, reply lost) is one warning with "Refresh list and check"; a request rejected before commit (4xx with an error code) is a plain error next to the form and does not lock creation (D5, H-21, M-D07).

### 4.5 Users (admin)

- Filter: All · Pending approval (count) · Disabled · Admins, a name filter, and "Enroll user" (hidden when invitations are disabled; resets stay available — state `signup-only`).
- A banner states how many self-registered accounts wait for approval.
- Table: User (username, e-mail or note), Status chips — Pending approval (amber), Active (green), Admin (accent), Invitation sent / Reset link sent (blue, with expiry), Locked (red, with factor and remaining time), Disabled (grey, muted row) — Source (Sign-up, Invited by <admin>, Configuration), Two-factor (Required / Recovery only / —), Created, actions. Pending rows have a primary "Approve…" (opens the application dialog); other imperative rows have a "⋯" menu (Reset credentials…, Grant/Revoke admin…, Disable account…); disabled rows have "Enable"; declarative rows and the admin's own row are read-only.
- Every action confirms in a dialog that states the consequences from the accounts design v2. **Pending applicants**: the dialog "Application of <name>" offers **Approve** (can sign in immediately) and **Reject application…**; rejecting asks once more and then *deletes* the application and frees the username (a pending account never held authority or data). There is no "reject and disable" and no rejected row state. **Disable** exists only for accounts that were active (sessions and tokens stop; the username of an account that was active is never reused). **Reset**: current credentials keep working until the link is used.
- **Enroll** and **Reset** produce the same "shown once" panel as the token secret, holding the link with Copy and "I have sent it".
- The footer shows the self-registration cap usage ("11 of 100 slots").

## 5 Routing and state preservation

Fragment routes in all three dashboards (decided, §9; Haystack already uses them; no server routing change; the account fragments coexist).

| Dashboard | Routes |
|---|---|
| Chronicle | `#/archive?q=&sort=&dir=&cols=` · `#/search?q=` · `#/session/<id>?rev=&at=<message>&find=&pane=outline\|find\|related\|info\|closed&passage=` · `#/activity/overview\|collectors\|jobs\|usage\|maintenance?q=&scope=current\|history&sort=` · `#/access` · `#/mcp` |
| Haystack | existing `#/browse?q=&sort=&direction=`, `#/inbox`, `#/item/<key>` plus `#/upstream`, `#/skills`, `#/archive`, `#/item/<key>?rev=&compare=`, `#/item/<key>/edit` |
| Manure | `#/artifacts?q=&access=&sort=` · `#/upload` · `#/cli` · `#/artifact/<id>?path=` |
| All | `#account/<section>`, `#account/signup`, `#account/recover`, `#account-enroll=<code>` |

Rules:
1. Reload restores the route; the default route after sign-in stays as today (Chronicle: Search).
2. Opening an item pushes a history entry; Back returns to the list with loaded rows, scroll position and row focus intact. Implementation: keep each list's loaded chain in a per-route cache above the view components (Chronicle: lift `useInfiniteResource` state; Haystack/Manure: keep the list mounted or cached), keyed by route + query + sort, and restore `scrollY` after the rows are rendered.
3. In-page "Back" controls call `history.back()` when the previous entry is in-app, otherwise go to the parent list.
4. Query drafts are view state (not in the URL) but survive tab switches; submitted queries are in the URL.
5. Session: `at`, `find`, `pane` and `passage` are replaced (not pushed) while reading, so Back leaves the session in one step; opening a related session pushes.
6. Live refresh, polling and reconnects never replace a rendered list: they set "changes available"; applying them merges in place and keeps the scroll anchor. First connection does not refetch a list that was just loaded (H-03).
7. Unsaved edits (Haystack edit, an unacknowledged secret or link) guard in-app navigation with a dialog and tab close with `beforeunload`.
8. The session side-pane state, table column choices and theme are remembered per browser (local storage; no secrets). The side pane defaults to open at viewport widths ≥ 1280 px and closed below.
9. Times are shown in the browser's local time zone as `Nov 17, 21:08` with a relative sub-line where space allows; the tooltip carries the full ISO timestamp with the zone. The mockups' times are illustrative.

## 6 Removed or demoted

| Item | Change | Reason |
|---|---|---|
| Session modal (90vw × 90vh) | replaced by a routed page | S1, A3, G1 |
| Numbered result pages and per-card "Source span" pagers (Search) | infinite loading; expand in place | Q1, Q2; owner complaint |
| Search summary jargon, byte ranges, generation ids, "HEAD r · published r" on cards | info popover; session Info tab; message "⋯" menu | Q5 |
| Per-message "Copy message" / "Source text" buttons and id/parent footer | hover/focus actions and "⋯" menu | S2 |
| Passage cards with large serif numbers and Start/End byte lines | compact outline rows; byte ranges in the passage's detail on selection | S3; owner dislikes numbered cards |
| Floating Find overlay, floating message counter, "Back to Find results" button | docked find bar, position bar, side-pane hit list | S4 |
| Activity: stacked totals card + two inner-scrolling tables; Collector ID form; inline retry/rebuild previews; detail popovers | sub-views, expression chip, dialogs, expanding rows | V1–V7 |
| Chronicle Access left column ("Open token settings") | one sentence with a link | D6 |
| Floating connection pill | masthead indicator | A7 |
| Georgia serif in login, titles, blank states | sans only (brand mark keeps its identity) | G2, G7 |
| Login "story" column (75 px serif heading) | plain auth card | G7 |
| Haystack: page heading stack, Status column, "Load more records" button, "Activity namespace" label, per-row "Restore" in history, links textarea syntax | see `notes-haystack.md` §4 | H-02, H-09, H-10, H-11, H-16, H-18 |
| Manure: always-visible quick-upload strip, Kind and State columns, "Load more" button, footer repetitions, native confirms | see `notes-manure.md` | M-D02, M-D11, M-D12, M-D21, M-D30 |
| Account dialog, its explanatory paragraphs, "Refresh token list" as a large button, the two-step "I checked the list" gate | routed page; refresh icon; single warning | D1–D7 |
| `window.confirm` (token revoke, group delete, artifact delete, make public) | in-app dialog | D3, H-20, M-D06, M-D21 |

Nothing functional is removed without a new place, with two deliberate exceptions to confirm: Haystack's bulk paste of links (one textarea line per link) becomes row entry, and Manure's access presets apply immediately instead of editing the draft.

## 7 Implementation plan

Owner decision Q89: the direction is approved; implementation proceeds from this section. Facts given by the orchestrator and built into the plan:
- (a) The layout-pinning browser tests are being **deleted by the test-overhaul workstream** (Chronicle: tab-layout, activity-layout, the popup-regression matrix, rebuild-occlusion, copy-text scenes; Manure: DashboardLayoutTests). UX units do not port them; each unit writes the fresh, lean checks listed in 7.4 and 8.
- (b) The Chronicle browser suite becomes a pool runner (`chronicle/web/tests-browser/run-all.mjs`, scenario scripts as child processes). Every new scenario script must stay independently runnable (`node … <script>.mjs`), own its fixture and port, and share no state with other scripts.
- (c) The accounts backend lands in parallel. A DOM-free client `shared/account-web/account-client.js` (API wrappers and view state machines) is being written by the auth workstream; the account views are built on it and are developed against controlled routes/fakes before the endpoints exist (7.3).
- (d) The capture harnesses under `*/web/ui-capture/` are on the integration branch; each unit extends its harness so that every state it implements produces an "after" shot named like the mockup shot, for visual acceptance through `look`.

### 7.1 Shared package layout

```
shared/ui-web/
  tokens.css          design tokens (this spec §2.1; start from the mockup file unchanged)
  components.css      shared components (§2.2; delete the "Mockup-only helpers" block)
  theme-init.js       blocking: resolves system|light|dark, sets data-theme / data-theme-choice, reacts to OS changes
  fonts/              InterVariable.woff2 + its OFL licence text (self-hosted; no remote font request)
  icons.js            the icon set as an ES module: icon(name) → SVG string; also emitted as icons.svg sprite for React <use>
  README.md           rules of §1 and §2 in one page; how to consume; what may not be added (literals, sizes < 12 px)
shared/account-web/
  account-client.js   DOM-free (auth workstream)
  account.js          views (this spec §4), built on account-client.js
  account.css         tokens only; no palette, units or fonts of its own
  dev/                controlled-route harness page + fakes for developing and capturing every state (7.3)
  tests/              browser checks of the views against fakes
```
Consumption (same mechanism as `shared/account-web` today, so no new build tooling):
- Chronicle and Haystack: extend the existing `accountAssets` Vite plugin (rename to `sharedAssets`) to serve and emit `/ui/tokens.css`, `/ui/components.css`, `/ui/theme-init.js`, `/ui/icons.svg` next to `/account.css` and `/account.js`; `index.html` links them before the bundle. React code uses a small `Icon` component (`<svg><use href="/ui/icons.svg#name"/></svg>`). App CSS files keep only view-specific rules and consume tokens.
- Manure: the dashboard and viewer directories receive verbatim copies at packaging time (as `account.js` / `account.css` are today); `index.html` links them. The served unlock page and directory listing link the same two stylesheets from the content origin (CSP `style-src 'self'`).
- Nix: the packaging expressions of the three dashboards gain the `shared/ui-web` input. Whoever lands UX-U0 runs the packaging policy/module checks in addition to the application suites.
- Inter: UX-U0 adds the variable font file from an approved source (the pinned nixpkgs `inter` package if it provides the WOFF2 — not verified here — otherwise a vendored release file with its licence) and the `@font-face` rule; the capture harness environments get the same font so that "after" shots are comparable.
- Order of stylesheets in every host: `tokens.css`, `components.css`, app view CSS, `account.css`.

### 7.2 Work units

Unit ids carry the prefix `UX-` (the test plan and the accounts design use similar short ids). Each row is sized for one implementation agent. "Owns" lists the files the unit may edit; a file appears in exactly one unit of a wave. "Replaces" lists existing browser scripts whose subject the unit changes: where the test-overhaul workstream has already deleted a script (fact a), the unit only adds its fresh checks; otherwise it rewrites the affected cases and keeps the unaffected ones green.

**Wave 0**

| Unit | Scope | Owns | Depends on | Replaces / fresh checks |
|---|---|---|---|---|
| **UX-U0 Design system** | Create `shared/ui-web/*` from the mockup files; theme contract; `sharedAssets` plugin in both Vite configs; Manure static copy; Nix inputs. No visual change to any view yet except that hosts load the files. | `shared/ui-web/**`, the two `vite.config.ts`, `chronicle/web/index.html`, `haystack/web/index.html`, `manure/web/dashboard/index.html` (link tags only), packaging Nix | — | fresh: a static conformance script (`shared/ui-web/tests/census.mjs`: tokens file defines every referenced property; components.css has no literal colour / off-scale size) reusable by later units |

**Wave 1** (parallel after UX-U0)

| Unit | Scope | Owns | Depends on | Replaces / fresh checks |
|---|---|---|---|---|
| **UX-W2a Account views on fakes** | §4 complete at the view level: routed outlet and section navigation, auth card (login incl. TOTP step and awaiting-approval), signup, recovery, enrollment landing, Profile / Password / Two-factor, Access tokens (table, new-token form, secret panel, revoke dialog, unknown-outcome warning), Users admin; confirm dialog; focus-revalidation fix. Developed and captured against the controlled-route harness (7.3). | `shared/account-web/account.js`, `account.css`, `dev/**`, `tests/**` | UX-U0; the **interface** of `account-client.js` (not the backend) | replaces `shared/account-web/tests/browser.mjs` (dialog markup, "Dismiss secret", two-step recovery gate); fresh: checks 8.1, 8.6–8.8 on the harness page |
| **UX-C1 Chronicle shell + router** | Masthead, user/theme/connection menus, fragment router and per-route list cache, account outlet and auth mount, removal of dead CSS, tokens in `theme.css` mapped to shared tokens. Views keep their old insides but render under routes. | `App.tsx`, `main.tsx`, `workspace.css`, `theme.css`, `theme.ts`, `styles.css`, `ThemeControl.tsx`, `ConnectionHealth.tsx`, `Popover.tsx`, `popover.css`, `hooks.ts`, new `router.ts` | UX-U0 | tab-layout and popup matrix are deleted (a); `theme-retry.mjs`, `persistent-login.mjs`, `prior-error-regression.mjs`, `ui-controls.mjs` and the navigation/connection-widget steps of `run.mjs` are adapted (they click nav buttons named `archive`, `activity`, …: nav items become links with the same accessible names); fresh: route round trip (8.4), masthead at 1440/1024/390 |
| **UX-H1 Haystack shell** | Masthead, nav as routes for the five presets, connection indicator and popover, theme menu, tokens, account outlet and auth mount, record/edit routes. | `App.tsx`, `styles.css`, `Live.tsx`, `Login.tsx`, `connection.ts` (labels only), `browse-state.ts` (routes) | UX-U0 | `run.mjs:547-586` (radius 0, colour scheme) rewritten; `layout.mjs` topbar cases; `inventory.json` updated; fresh: 8.4 for presets |
| **UX-M1 Manure shell + catalogue** | Masthead, fragment routes, catalogue view (view bar, scope control, table in the document, counter, end marker, row menu, drop overlay), shared confirm dialog, tokens, account outlet. | `manure/web/dashboard/index.html`, `app.js` (shell, list, routing, confirm), `styles.css` | UX-U0 | DashboardLayoutTests (`browser/dashboard-layout.mjs`) deleted (a); `test_dashboard_markup.py`, the list cases of `browser/dashboard-ux.mjs` / `test_browser_dashboard_ux.py`, `test_browser_dashboard.py` (native confirm → dialog; `steps.mjs` dialog channel), `browser/access-modes.mjs`, `browser/query-expression.test.mjs`, `browser/dashboard-retrieval.mjs` and `test_browser_path_mode.py` (path-mode warning placement) adapted; `current-test-inventory.json` updated; fresh: 8.1–8.5 |

**Wave 2** (parallel within a dashboard only where "Owns" does not overlap)

| Unit | Scope | Owns | Depends on | Replaces / fresh checks |
|---|---|---|---|---|
| **UX-C2 Archive** | §3.1 Archive: view bar, shortcut row, document table with sticky header, lifted infinite chain, update pill, states. | `Archive.tsx`, `archive.css` (list part), `archive-requests.ts`, `TableColumns.tsx`, `table-columns.css`, `table-widths.ts`, `ExpressionEditor.tsx`, `ExpressionInput.tsx`, `FilterShortcuts.tsx`, `expression.css`, `InfiniteTrigger.tsx`, `infinite.ts`, `ScrollAnchor.tsx` | UX-C1 | `ux.mjs` archive cases (`.archive-table-scroll` scrollTop loading), `run.mjs` archive cases, and the archive parts of `filter-table-ux.mjs`, `table-controls.mjs`, `source-filters.mjs`, `live-archive.mjs` rewritten (script-to-view mapping by name and a grep of their selectors; confirm when opening them); fresh: 8.1–8.5 |
| **UX-C3 Session page** | §3.1 Session: route, header, transcript (messages, tool rows, folding), find bar, side pane tabs, position bar, states. | `Conversation.tsx`, `SessionFind.tsx`, `session-find.ts`, `passages.ts`, `source-view.ts`, `MessageContent.tsx`, `message-format.ts`, `highlight.ts`, `Dialog.tsx` (sessions stop using it), `dialog.css`, `session-find.css`, `passages.css`, `message-content.css`, `archive.css:5` rules for `.conversation-*` move here | UX-C1 | `refresh-regression.mjs:137` (modal geometry), `history-find.mjs`, `transcript.mjs`, `ux.mjs` pane cases, `run.mjs` dialog cases rewritten for the page; fresh: 8.1 (two panes), deep link to `at=`, Back |
| **UX-C4 Search** | §3.1 Search: results, expansion, stale-while-editing, infinite loading, first-render state. | `Search.tsx`, `search.css`, `search-source.ts`, `Pagination.tsx` (deleted) | UX-C1; UX-C3 for "open at match" (can stub the link) | `search-serp.mjs` rewritten (no "Result page N" / "Source span N"); fresh: 8.3, 8.4 |
| **UX-C5 Activity** | §3.1 Activity: five routed sub-views, attention list, cross-links, expanding rows, dialogs, pill. | `Activity.tsx` → `activity/*.tsx`, `ActivityTables.tsx`, `RetryFailedIndexing.tsx`, `OwnerReindex.tsx`, `ReindexProgress.tsx`, `ModelUsage.tsx`, `model-usage.ts`, `MetadataEditor.tsx`, `progress.ts`, `reindex-status.ts`, `activity.css`, `retry-failed.css`, `goal50.css` | UX-C1; table component from UX-C2 (land UX-C2 first or agree the shared `Table` module up front) | activity-layout and rebuild-occlusion deleted (a); `activity-tables.mjs`, `usage-presentation.mjs`, `rebuild.mjs`, `goal50.mjs` and the Activity parts of `filter-table-ux.mjs` rewritten per view; fresh: 8.1 per sub-view, collector → jobs → session links |
| **UX-C6 Access, MCP, feedback** | §3.1 Access and MCP; toast and notice components on tokens; shared confirm dialog used by Access. | `Access.tsx`, `McpTester.tsx`, `ToolCatalog.tsx`, `mcp-trace.ts`, `mcp-tester.css`, `tool-catalog.css`, `MutationToast.tsx`, `MutationNotice.tsx`, `mutation-toast.css` | UX-C1 | `tool-catalog.mjs`, Access/MCP cases in `run.mjs`; copy-text scenes deleted (a); fresh: no native confirm (8.7) |
| **UX-H2 Browse** | §3.2 Browse and presets. | `Browse.tsx`, `QueryInput.tsx`, `query-edit.ts` | UX-H1 | `browse.mjs` (`.records-panel`, page size, "Load more records"), `browse-markup.mjs`, `layout.mjs` (row height, 1100 px cards) rewritten; fresh: 8.1–8.5 |
| **UX-H3 Record + history** | §3.2 Record, snapshot/compare, restore dialog. | `Detail.tsx` (view part; split the file first into `Record.tsx` / `RecordEdit.tsx`), `FieldsView.tsx`, `Icon.tsx` | UX-H1 | detail cases in `run.mjs`; fresh: Back to originating preset (8.4) |
| **UX-H4 Edit** | §3.2 Edit. | `RecordEdit.tsx`, `FieldsEditor.tsx`, `pending-write.ts` (UI hooks only) | UX-H3 (file split) | edit cases in `run.mjs`, `quick-preview.mjs`, `restart.mjs`; fresh: no inner scrollers (8.1), leave guard |
| **UX-M2 Upload** | §3.3 Upload page and CLI view; drop-to-upload hand-off. | `quick-upload.js`, upload section of `index.html`, upload functions of `app.js` (move to `upload.js`) | UX-M1 | `test_browser_quick_upload.py`, `browser/quick-upload.test.mjs` rewritten |
| **UX-M3 Artifact page** | §3.3 Artifact: header, overview, manifest in the document with drill-down, access rail, password, danger zone, states. | detail section of `index.html`, detail functions of `app.js` (move to `detail.js`) | UX-M1 | detail/password/rotate cases of `dashboard-ux.mjs`, `test_browser_handoff.py` hooks; fresh: 8.1 with a 161-file manifest |
| **UX-M4 Viewer, listing, unlock** | §3.3 viewer bar and content, unlock card, server-rendered directory listing on the shared stylesheets. | `manure/web/viewer/**`, `manure/web/unlock/**`, and the directory-listing HTML and its CSP in `manure/backend/src/main/scala/manure/Http.scala` | UX-U0 | `browser/viewers.mjs`, `test_browser_viewers.py`, `test_browser_unlock.py`; `docs/ui-layout-validation.md`, `docs/directory-browsing-validation.md` superseded. This is the only unit with a server-side change: it needs the backend suites, not just the web ones. |

**Wave 3**

| Unit | Scope | Owns | Depends on | Replaces / fresh checks |
|---|---|---|---|---|
| **UX-W2b Account integration** | Wire the three hosts' outlets and auth mounts to the real `account-client.js` and endpoints; per-service permission lists; remove the old dialog code paths and the Access-tab pointer; per-service account smoke. | `shared/account-web/account.js` (adapter only), host mount code touched in UX-C1 / UX-H1 / UX-M1 | UX-W2a, UX-C1, UX-H1, UX-M1 **and the account backend** (policy, profile, signup with approval, recover, enrollment, admin endpoints) | `haystack/web/tests-browser/account.mjs`, Chronicle and Manure account cases; one real-backend smoke in one service (auth design §9) |
| **UX-X1 Visual acceptance** | Run the three capture harnesses on the integrated branch, build the after/mockup comparison, review through `look`, file defects per unit. | `*/web/ui-capture/**` (scenario lists only) | all | — |

File-split note: `manure/web/dashboard/app.js` (1 144 lines) and `haystack/web/src/Detail.tsx` (477 lines) are edited by several units; UX-M1 and UX-H3 perform the mechanical split **first** in a separate commit so that UX-M2/UX-M3 and UX-H4 own disjoint files.

Suggested dispatch for the owner's complaints: UX-U0 → (UX-W2a, UX-C1, UX-H1, UX-M1) → (UX-C2, UX-C3, UX-C4, UX-C5, UX-C6, UX-H2, UX-H3, UX-M2, UX-M3, UX-M4) → UX-H4 → UX-W2b → UX-X1.

### 7.3 Account view layer on the DOM-free client

The interface below is what the views need from `account-client.js`. It is a **proposal to align with the auth workstream**, not a description of that module (its code was not available when this was written).

- One factory: `createAccountClient({ transport, origin })`. `transport(request) → Promise<response>` is the only I/O seam; the default wraps `fetch` with the account-plane rules (actor header from a fresh read, strict JSON). Fakes replace it.
- One store per surface, each a small state machine with `getState()`, `subscribe(listener)`, and named actions. States are plain tagged objects (`{ tag: 'form', fields, errors }`), exactly the state names of auth design §4.9 plus the ones added here:
  - `login`: `credentials | submitting | second-factor | awaiting-approval | rate-limited(retryAfter) | error | done`
  - `signup`: `loading-policy | form(secret, otpauthUri, qrMatrix) | submitting | field-errors | awaiting-approval | closed | rate-limited | unavailable | done`
  - `enrollment`: `inspecting | form(kind, username, expiresAt) | invalid-link | submitting | field-errors | done`
  - `recovery`: `form | submitting | rejected | weak-password | rate-limited | done`
  - `profile`, `password`, `totp` (replace), `totpRequired` (toggle): `view | form | saving | error | saved`
  - `tokens`: `loading | list(tokens) | load-error`; `mint`: `closed | form | invalid | submitting | rejected(code) | secret(token, secret, copied) | outcome-unknown(name, refreshed)`; `revoke`: `idle | confirming(token) | submitting | error`
  - `users`: `loading | list(users, filter) | error`; per-row `confirming(action) | saving`; `enroll` and `reset`: `form | submitting | issued(link, expiresAt, copied) | error`
  - `route`: the parsed `#account…` fragment and `navigate(section)`; a `guard` hook the views register so that leaving with an unacknowledged secret/link asks first.
- The client never touches the DOM, storage or `location` except through the injected `origin` and the route helper; secrets (password, TOTP secret, enrollment code, token secret, link) live only in store state and are dropped on `done`/acknowledge.
- `account.js` is a thin view layer: `mount(outlet, client)` subscribes to the stores and renders with `document.createElement` (no framework, no `innerHTML` with data), one render function per surface, events call store actions. The QR is rendered from `qrMatrix` into DOM cells. No timers except the toast.
- **Developing before the backend exists**: `shared/account-web/dev/index.html` mounts the views with a fake transport driven by a scenario name in the URL (`?scenario=tokens-secret`), one scenario per mockup state of §4.3. The same page is the target of the browser checks and of the capture harness, so "after" shots of every account state exist before any endpoint does. Playwright `page.route` on `/api/account/v1/**` is the second seam, used for the per-service smokes once hosts mount the real client.
- If the client's real interface differs, the views adapt at one place: a `stores.js` adapter inside `shared/account-web` that maps the real machines onto the states above. The mockup states remain the acceptance target either way.

### 7.4 Test approach for UX units

- Fresh checks are lean and behavioural: scroll containers, sticky offsets, loading contract, route round trips, state preservation, no native dialogs, token conformance (§8). They do not pin gutters, pixel widths or copy that is not a contract.
- Hooks: tests address elements by role and accessible name first, then by stable `data-*` hooks added for the purpose (`data-view`, `data-list`, `data-row-id`, `data-state`); never by styling classes of `components.css`.
- Chronicle scenario scripts follow the pool-runner contract (b): one script per view (`archive.mjs`, `session.mjs`, `search.mjs`, `activity-*.mjs`, `access.mjs`, `mcp.mjs`, `shell.mjs`), each starting its own fixture, runnable alone.
- Accessible names that tests and users rely on stay unless the function changed: e.g. combobox "Search conversations", tables "Conversations" / "Collectors" / "Indexing jobs", "Find messages", "Retry all current failed indexing jobs", "Rebuild archive index", Haystack "Query", "Save as new revision", "Sort by <Column>", Manure `data-sort`, `data-action`. Names that must change because the function changed: "Close conversation" (now Back), "Result page N", "Source span N", "Load more records", "Dismiss secret" (now "I have saved it"), "Close settings".
- Every unit extends its capture harness scenario list (d) with the states it implements, using the mockup shot names, and attaches the `look` comparison of after-vs-mockup for its main states to its report.

## 8 Acceptance checks

Per unit, in addition to the full suites required by the repository's validation policy. Checks 1–5 and 7 are written fresh by the unit as independently runnable browser scripts (they replace the deleted layout-pinning tests; nothing is ported from those). A unit is accepted when its checks pass, the unaffected existing suites pass, and its "after" captures have been compared with the mockup shots:

1. **Scroll containers** (the central assertion). In the browser test of each view, after loading enough rows to overflow:
   ```js
   const scrollers = [...document.querySelectorAll('body *')].filter((el) => {
     const s = getComputedStyle(el);
     return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0;
   });
   ```
   Model A views: `scrollers.length === 0` and `document.scrollingElement.scrollHeight > innerHeight`. Session page: exactly the transcript pane and (when open) the side pane, and the document does not scroll. Open menus, popovers and dialogs are excluded by closing them first.
2. **Sticky chrome**: after `scrollTo(0, 1500)` the view bar's top equals the masthead height (+ sub-navigation) and the table header's top equals the sum of the sticky heights (104 px; 144 px with a sub-navigation).
3. **Loading contract**: scrolling the document to the end appends without duplicates; the counter changes from `M loaded` to all loaded; the end marker appears; a failed append keeps rows and shows Retry; no element named "Result page N", "Source span N" or "Load more".
4. **State preservation**: load three batches, scroll, open an item, `history.back()` → same row count and `scrollY` (± 2 px), focus on the originating row; same after a tab round trip; reload restores route, query and sort.
5. **Live refresh**: a remote change while scrolled shows the pill and leaves row count and `scrollY` unchanged until it is applied.
6. **Design-system conformance** (static, extend the existing census scripts): zero colour literals outside `tokens.css`; every `font-size` is a `--text-*` token; margin/padding/gap use `--space-*`; radii and shadows from tokens. Runtime audit: no visible text below 12 px; no interactive target below 28 px high (24 px for inline links). Mockup baseline measured: 0 text nodes below 12 px, minimum control 28 px.
7. **No native dialogs**: `window.confirm`/`alert` absent from the three dashboards and the shared account code; confirmations are `dialog` elements with a named destructive button and Cancel focused by default.
8. **Account**: the secret panel survives `window` blur/focus, Escape, section change and Back (dialog asks); "I have saved it" is disabled until copy or reveal; the panel, the token form and the uncertain-outcome warning render in the same position; with 30+ tokens only the document scrolls and the section header sticks; identical markup and screenshots in the three dashboards apart from the accent and masthead.
9. **Layout matrix**: 1440×900, 1024×700, 390×844 in light and dark: no horizontal overflow of the document, no clipped table headers, tables remain tables at 1024.
10. **Screenshots**: each unit extends its capture harness (`chronicle/web/ui-capture`, `haystack/web/ui-capture`, the Manure harness, `shared/account-web/dev`) with the states it implements and names the output like the mockup shot (`<app>-<view>-<state>-<width>.png`). Acceptance: pass the after-shot and the mockup shot of the same name to `look` in one call and resolve every reported structural difference (missing element, different order, extra scroller, clipped or overlapping content); typographic and data differences are expected. Not a pixel threshold.
11. **Keyboard**: skip link to the list; the table is not a tab stop; rows reachable; Escape closes the top overlay only; focus returns to the trigger.

## 9 Decisions

Decided by the owner/orchestrator after the mockup review (Q89 and follow-up). They are binding for the units of §7.

| # | Topic | Decision |
|---|---|---|
| 1 | Font | Bundle Inter in `shared/ui-web` (self-hosted variable WOFF2); system stack as fallback. |
| 2 | Accents | Keep three accents: Chronicle blue, Haystack teal, Manure violet. |
| 3 | Corners | Radii 4 / 6 / 10 px are adopted; Haystack's 0 px test case is rewritten by UX-H1. |
| 4 | Routing | Fragment routes in all three dashboards. |
| 5 | Totals | No backend total counts now. Where the API has no total the counter reads "N loaded · more available" and "All N <things> loaded" at the end. UX units plan no API changes. |
| 6 | Session side pane | Open at ≥ 1280 px, closed below; the user's choice is remembered per browser. |
| 7 | Tool output | Folded by default. |
| 8 | One-time secret | Masked by default, with Reveal and Copy; "I have saved it" after copy or reveal. |
| 9 | Token "last used" | Later; no column now. |
| 10 | Rejecting an applicant | Follows the accounts design v2: rejecting a pending applicant **deletes the application and frees the username**. The dialog offers "Approve" and "Reject application…" (with a confirmation that it removes the application). No "reject and disable", no rejected state. "Disable" exists only for accounts that were active. |
| 11 | Sign out | In the user menu. |
| 12 | Activity indicator | Keep the red dot on the Activity nav item (no number). |
| 13 | Haystack | As in `notes-haystack.md`, minus everything that needs a new API field: the incoming-link summary (totals, relations) is deferred — the record page keeps today's capped query. Type and Status stay free text with suggestions. |
| 14 | Manure | As in `notes-manure.md`, minus new API fields: editable tags are deferred (tags stay read-only on the artifact page). The access scope applies immediately (accepted; reverses the "presets only edit the draft" behaviour). The server-rendered directory listing is styled in UX-M4 (Scala change accepted). Expiry and tags on the upload page use existing API fields and are in scope of UX-M2. |
| 15 | Time zone | Local time; zone in the tooltip. |
| 16 | Row release / windowing | Deferred. |

### Remaining questions

1. **Control outline contrast.** `--border-strong` is 2.2 : 1 on the surface (computed), below the 3 : 1 of WCAG 1.4.11 for a control's only boundary; the current dashboards are at 1.5–1.7 : 1. Darkening it is a one-token change that makes every button and input visibly heavier. *Recommendation:* keep 2.2 : 1 unless accessibility conformance is a stated goal.
2. **Haystack bulk entry of links.** The line-per-link textarea becomes rows; pasting several lines into a row could be split into rows. Needed? *Recommendation:* implement the paste-split, it is small (UX-H4).
3. **Interface of `account-client.js`.** §7.3 states what the views need; the auth workstream owns the module. If its stores differ, UX-W2a adapts in `stores.js`; a short alignment before UX-W2a starts avoids rework.
4. **Default route after sign-in in Chronicle.** Kept as today (Search). The redesigned Search first-render explains itself; Archive would show data immediately. *Recommendation:* keep Search unless the owner prefers Archive.
