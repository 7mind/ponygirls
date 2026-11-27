# Blabber dashboard and Pi status pane: the confirmed mockup, as a build brief

Note on this copy (2026-11-27). The mockup's site files are not in the repository. They are kept in the
orchestrator's working directory (`.local/blabber-product/mockup/` of the main checkout, which is not tracked) and in
the published copy, artifact `6f3c4f46995d44b8bd793829d60eeb4d`. Every path below that starts with `site/` refers to
those files. This copy differs from the orchestrator's file in three places only: this note, the published copy named
by its artifact id alone, and section 6.2 marked as settled by the contract rulings.

Readers: the agents who build the Blabber dashboard (design units U15 to U18) and the Pi status pane (U5c). Read
this beside the site's own files under `site/`; every statement below names the view (`view.html?v=<id>`, account
views `account.html?v=<id>`) and the site file and function that draw it. Paths in this document are relative to
`.local/blabber-product/mockup/` in the main checkout unless they are absolute.

## 1. What was confirmed

- **Answer of the owner, verbatim:** "Confirmed as shown, with the recommended variant of each choice".
- **Date:** 2026-11-27.
- **Scope:** the dashboard (view groups 0 to 11) and the Pi status pane (group 12) of the published copy
  `6f3c4f46995d44b8bd793829d60eeb4d`.
- **Local copy (identical files):** `/home/pavel/work/flakes/ponygirls/.local/blabber-product/mockup/site/`
  (start page `index.html`; dashboard views `view.html?v=<id>`; account pages `account.html?v=<id>`).
- **Rule that follows.** The recommended variant of each of the 17 choices (variant `a`, the default of every view,
  marked "rec." in the mockup bar) is the product. The alternative variants the site can switch to (query
  parameters `c1=b` … `c17=b`, `c2=c`, `c3=c`) are **not** to be built. The same holds for the not-chosen options
  of Q207 and Q209 (parameters `q207=2|3`, `q209=2`, and view 9h, which exists only to show Q207 option 3).
- **What is not product.** Everything the site marks as the mockup's own: the striped bar at the top of each view
  (`app/mockup.js` `mockupBar`), the `N<n>` pins (`app/render.js` `pin`), the dashed "mockup" callouts
  (`app/views.js` `callout`), the drawn browser notification (`.mk-notification`), the 390 px phone frame
  (`app/mockup.js` `phoneFrame`, `app/phone.css`), the start page, and `app/mockup.css` except its terminal rules,
  which only draw the pane. Section 8 lists what the mockup does not settle.

### Where the code of the site is

| File | Holds |
|---|---|
| `site/app/views.js` | the view registry `VIEWS` (one entry per view id) and the page assemblers `roomPage`, `roomsPage`, `searchPage`, `connectPage`, `withOutlook`, `withOutlookAt`, `outlookLine`, `adminBanner`, `connBar`, `hitRow`, `timelineItems` |
| `site/app/render.js` | the product components: `masthead`, `themeMenu`, `userMenu`, `rail`, `counts`, `roomHead`, `message`, `systemLine`, `daySep`, `body`/`inline` (message text), `composer`, `ownAgentsLine`, `outlookFor`, `roster`, `rosterRow`, `identification`, `dialogs`, `joinDialog`, `nameOf`, `kindChip`, `presenceWords`, and the word tables `ACTIVITY_WORDS`, `OUTLOOK_WORDS` |
| `site/app/pane.js` | the Pi pane drawings: `pane(state)`, `rosterLines`, `recentLines`, `youLine`, `title`, `paneView` |
| `site/app/core.js` | `timeEl` (local time, UTC on hover), `countText` ("999+") |
| `site/app/data.js` | the invented content (participants, messages, rooms); field names follow the contract |
| `site/app/account-host.js` | the host page of the shared account module (`run`), scenarios from `site/account/scenarios.js` and two local ones (`bb-login-loading`, `bb-login-down`) |
| `site/account/account.js` | a copy of `shared/account-web/account.js` with two changes the product makes in the shared module: `blabber` in `APP_NAMES`, and `INDEXING_APP_TEXT.blabber` (section 4, ruling on the indexing text) |
| `site/ui/` | copies of `shared/ui-web`; `theme-init.js` gains `blabber` in `APPS`, `tokens.css` gains the Blabber accent ramp (`:root[data-app="blabber"]`, light and dark) |
| `site/app/blabber.css` | the dashboard's view CSS (tokens only), sections by component; the narrow layout is `@media (max-width: 720px)` (plus 900 px for the room list, 1100 px for pane widths) |
| `site/app/main.js` | page boot; the document title of choice 14; the simulated send (not product behaviour, section 8) |

## 2. The 17 choices (confirmed variant only)

| # | Decides | Confirmed behaviour | Views | Drawn by |
|---|---|---|---|---|
| 1 | Layout of the room page | Three panes, each its own scroller: room rail, timeline with the composer fixed below it, roster panel that can be collapsed (the "Roster" button in the room header). At 720 px and below the rail and the roster become drawers over the timeline, which keeps the whole width; Escape or the scrim closes a drawer. | 2b, 10a, 10b, 10c, 11a | `views.js` `roomPage` (body class `split-shell`); `blabber.css` "Room page shell" and "Narrow: rail and roster become drawers"; `mockup.js` `toggleDrawer`, `closeDrawer` (sketch of the toggling) |
| 2 | How a person joins | An explicit Join before the first post. Where the person has not joined, the composer is replaced by "Join to post …" with **Join…**, which opens the Join dialog (room id, optional "About, shown in the roster"). A room of which the account is not a member shows only "You are not a member of this room" with Join. | 5n, 4a, 4d | `render.js` `composer` (`replaced: 'join'`), `joinDialog`; `views.js` view 4a |
| 3 | Read marks and unread counts | Stored per account for joined rooms (`RoomEntry.readSeq`). A joined room shows two counts: unread (all visible Chat messages above the mark that the person did not write) and, apart, unread direct messages to the person (mail icon, attention colour); both read "999+" from 1,000. No counts for rooms not joined. | 1b, 1c, 1d, 2b (rail) | `render.js` `counts`, `rail`; `views.js` `roomsPage` |
| 4 | When the read mark moves | When a message has been displayed at the bottom of a visible tab; nothing on screen shows or moves it by hand. | 2b, 2f | no markup (behaviour only) |
| 5 | New messages while reading older ones | The view stays where the reader is; a pill button "3 new messages" at the bottom of the timeline jumps to the newest. The log region is not announced while the reader is scrolled up. | 2f | `views.js` `roomPage` (`pill`, `.pill-sticky`, `.pill-btn`); `blabber.css` `.pill-*` |
| 6 | Send key | Enter sends, Shift+Enter makes a new line; Enter during IME composition does not send. The hint under the composer reads "Enter sends · Shift+Enter: new line · Markdown". | 5a, 5b | `render.js` `composer` (`keyHint`); `mockup.js` `wire` (keydown handler: the rule, not the code to reuse) |
| 7 | Direct messages in the timeline | Direct messages stay in the room's timeline, marked by a "direct" chip with the recipients and a distinct left rule and ground; a toggle "Direct only" in the room header filters to them. | 2b, 2g | `render.js` `message` (`data-direct`, `.chip-direct`), `roomHead` (`.room-direct-filter`) |
| 8 | Default recipients of a reply to a direct message | Everybody who took part (its sender and recipients) without the replying person; a participant that has left is taken out and named in a note. The R14 limits of section 4 apply. | 5e, 5f, 5s | `views.js` views 5e, 5f; `render.js` `composer` |
| 9 | Message text | A safe subset of Markdown: paragraphs, emphasis, inline code, fenced code blocks with a language label and a copy button, lists, links shown with their address in brackets after the link text; no HTML, no remote images. | 2b | `render.js` `body`, `inline` (a sketch of the look; use the safe formatter of the other dashboards' transcript, section 8) |
| 10 | Default search scope | Started from a room (its menu "Search this room"): that room. Started from the masthead field: all rooms of which the account is a member. The scope switch "This room / All my rooms" stays available. | 9b, 9c | `views.js` `searchPage` (`fromRoom`, scope segmented control) |
| 11 | Agent identification in the timeline | Each message shows the sender's handle and a chip with the harness (`pi`, `claude`, `codex`) or "person"; the rest of the identification is in the roster's popover. | 2b, 7b | `render.js` `message` (`.msg-who`), `kindChip`, `identification` |
| 12 | The administrator's switch for others' direct messages | In the banner "Reading as administrator" of a room of others, off at every page load; on, the banner says so and those messages carry a chip "not addressed to you" and a dashed left rule. | 4b, 4c | `views.js` `adminBanner`; `render.js` `message` (`othersDirect`) |
| 13 | Archived rooms in the list | A collapsed group "Archived rooms · n" below the open rooms (also in the rail: "Archived · n"). | 1b, 1k | `views.js` `roomsPage` (`details.rl-group`); `render.js` `rail` (`details.rail-group`) |
| 14 | Attention for a direct message to the person | The page title carries the count of unread direct messages to the person, e.g. "(1) deploy-sync · Blabber" in a room and "(999+) Blabber" on the room list; no browser notifications in this step. | 1b, 2b | `main.js` (`document.title`) |
| 15 | Times | Local time (HH:MM), with the full UTC time on hover (`title`). | 2b and every timeline | `core.js` `timeEl` |
| 16 | The person in the roster and in handles | The handle (`alice/human`) with the display name beside it, in the timeline, the roster and the picker. | 2b, 7a | `render.js` `nameOf`, `message`, `rosterRow` |
| 17 | The Pi status pane | The pane of section 10.2 as drawn in group 12 (not the plain-text `/blabber` report). | 12a to 12k | `pane.js` `pane`, `paneView` |

## 3. The "not in the brief" notes

Where section 9 of the design left something open, the mockup chose and marked the place with a pin `N<n>`; the
start page lists them. With the confirmation the behaviour as drawn is the product, except where the line says
otherwise.

| N | Behaviour as drawn (now confirmed) | Views | Status |
|---|---|---|---|
| N1 | **where Connect an agent is linked.** Where "Connect an agent" is reached from: the room switcher menu and the empty room list. Section 9.2 gives the route but no place in the masthead. | 1a, masthead room switcher of every page | Confirmed as drawn. |
| N2 | **"Not confirmed" wording, Copy text.** The wording of "Not confirmed" and its "Copy text" action. The brief names only "Not confirmed" with Retry. | 5h | Confirmed as drawn. |
| N3 | **place of "Mark as read".** Choice 4, variant "explicit": the place of the "Mark as read" button (room header). | — (choice 4 variant b only) | Belongs to an unchosen variant: not built. |
| N4 | **byte counter from 7,168 bytes.** The byte counter appears from 7,168 bytes (7/8 of the 8,192-byte limit). The brief says "near the limit". | 5j | Confirmed as drawn. |
| N5 | **"activity not reported".** An agent whose activity is Unknown is shown as "activity not reported". The brief gives words for the other four values only. | 7a, 7b, 6a | Settled by the orchestrator's ruling: this is the decided wording. |
| N6 | **"(you)" marks.** The own person is marked "(you)" in handles and in the roster. | 2b, 7a and every timeline | Confirmed as drawn. |
| N7 | **day separators.** Day separators in the timeline. | 2b and every timeline | Confirmed as drawn. |
| N8 | **Reply and Copy link actions.** Per-message actions Reply and Copy link, shown on hover and on keyboard focus. | 2b (hover or keyboard focus on a message) | Confirmed as drawn. |
| N9 | **"Linked message" label.** The label "Linked message" above the target of #/room/<id>/m/<seq>. | 2h | Confirmed as drawn. |
| N10 | **room menu contents, Leave.** The room menu: Copy link, Search this room, Leave room (leave exists in the contract, section 5.1, but the brief names no control for it), and for an administrator Archive/Unarchive. | room menu of every room page; 8a | Confirmed as drawn. |
| N11 | **connection popover.** The connection indicator opens a small popover with the last update and the heartbeat, as the indicator of the other dashboards does. | 3a, 3b (masthead indicator of every page) | Confirmed as drawn. |
| N12 | **room list layout, Join per row.** The layout of the room list (rows with online counts, last message, marks, counts) and of the join form; a Join button on rows of rooms the person has not joined. | 1a to 1k | Confirmed as drawn. |
| N13 | **narrow masthead and drawer buttons.** Narrow masthead: the search field becomes an icon that opens the search page; the room page gets drawer buttons for the rail and the roster. | 10a to 10c | Confirmed as drawn. |
| N14 | **update disables Send and Search.** "Update required" disables Send and Search until the page is reloaded; the brief only gives the text "Reload to update". | 3c | Confirmed as drawn. |
| N15 | **no notice after a server sign-out.** "Signed out by the server" shows the plain sign-in card of the shared module, with no extra notice; the brief says only that the sign-in page is shown. | 3d | Confirmed as drawn. |
| N16 | **"Back to results".** When a search hit's message is gone, the room page offers "Back to results". | 9g | Confirmed as drawn. |
| N17 | **sender filter, result row layout.** Search: the sender filter is a free-text account field; the layout of a result row (room, sender, time, excerpt, sequence). | 9b, 9c | Confirmed as drawn. |
| N18 | **pane selection and title rule.** Pi pane: a roster row is selected with ↑↓ and its identification opens under it with ⏎; the title rule follows pi-ui's frameTitle (── Title · meta ─── state ──), the 10.2 sketch has no rule. | 12b | Confirmed as drawn. |
| N19 | **pane wording of held/stopped states.** Pi pane: the wording of "held after an abort", "held after a restart", "offline" and "stopped". | 12d, 12e, 12f, 12g | Confirmed as drawn. |
| N20 | **module wording when offline.** Sign-in offline: the shared module words a network failure as "The account service is unavailable or returned an invalid response. Your credentials have not been rejected…", not "Cannot reach the server". Shown as the module renders it; changing it is a change of the shared module. | 0f | Settled by the orchestrator's ruling: the module keeps its own wording; the brief's "Cannot reach the server" does not apply to the sign-in page. |
| N21 | **where the tab setting lives.** Choice 12, variant "tab setting": where the setting lives (the account menu) and how the banner reports it. | — (choice 12 variant b only) | Belongs to an unchosen variant: not built. |
| N22 | **token secret format.** The account pages run the real shared module against its development fake; the token secret shown is a neutral 43-character string, because the brief does not say what Blabber's secrets look like. | 0h | Mockup data: the real secret is whatever the shared account code issues; do not copy the format. |
| N23 | **Q207/Q209 switches.** Q207 and Q209 are decisions, not choices of 9.12; the search and administrator views carry a switch for them because sections 9.8 and 9.10 say what they change on screen. | — (mockup chrome on 4b, 9c) | Mockup chrome only; both decisions are now taken (section 4): nothing to build. |
| N24 | **accent colour and brand icon.** Blabber's accent (berry: #ad2a83 light, #f28cc9 dark) and the brand icon (#). The brief asks for an accent but gives no value. | every page | Confirmed as drawn. |
| N25 | **"My rooms | All rooms" switch.** The administrator's "all rooms" switch is a segmented control "My rooms | All rooms" on the room list. | 1b, 1k | Confirmed as drawn. |
| N26 | **"To" field with a room chip.** The composer's "To" field always shows the room as a chip until a recipient is added. | 5a and every composer | Confirmed as drawn. |
| N27 | **wording of choice 2 variants.** Choice 2, variants "join with the first post" and "join by opening": the explanatory line in the composer. | — (choice 2 variants b and c only) | Belongs to unchosen variants: not built. |
| N28 | **notification text.** Choice 14, variant "browser notification": the notification's text. | — (choice 14 variant b only) | Belongs to an unchosen variant: not built. |
| N29 | **outlook words beyond the brief.** Outlook words for outlooks the brief does not word: BlockedOnUser "waiting for its user", Away "away", a person Away "a person, away" (the last from section 10.1). | 6a, 6b, 6c to 6f | Partly settled by the orchestrator's ruling: "does not accept" wins over "away"; an online agent whose activity is unknown reads "activity not reported". The other words are confirmed as drawn. |
| N30 | **"own account only" chip, "Accepts".** The roster marks an agent that accepts only its own account with a chip "own account only"; the identification popover also lists "Accepts". | 7a, 7b | Confirmed as drawn. |
| N31 | **"not joined" in the rail.** The rail marks rooms of the account that the person has not joined with "not joined". | 2b (rail) | Confirmed as drawn. |
| N32 | **wording of stale marks.** The wording of stale marks: "Possibly out of date: last read 14:05". | 1g, 3b, 7h | Confirmed as drawn. |
| N33 | **Join in the administrator banner.** The administrator's banner offers Join; the brief does not say whether an administrator outside a room may post there after joining (the server would allow it: rooms are open by id). | 4b, 4c | Confirmed as drawn. |
| N34 | **About also in the room-list join form.** The ruling puts the optional "About, shown in the roster" field in the Join dialog; the room list's join form (room id, topic) carries the same field. | 1a to 1k (join form) | Confirmed as drawn. |
| N35 | **room messages and the wake budget.** Q213 says a message from the owner restores the wake budget of the owner's own agent; the composer lines are given for direct messages. The mockup assumes a room message restores nothing (it wakes nobody anyway) and says so only for direct messages. | 5u, 6a, 6c | Confirmed as drawn. |

## 4. Decisions and rulings drawn after the brief

| Decision / ruling | What the screens do | Views |
|---|---|---|
| **Q207** (owner): option 1, room and direct messages indexed, each under its sender's preference | One result list for room and direct messages, with a kind filter "All / Room messages / Direct messages" (`SearchRequest.direct`). No "Direct messages" tab: view 9h shows option 3 and is not built. | 9c (9h not built) |
| **Q208** (owner): agents may search too, across every room their account may read | No screen of the dashboard changes. | — |
| **Q209** (owner): option 1, account administrators moderate; other accounts' direct messages only after the explicit switch | The administrator's room list ("My rooms / All rooms"), the banner "Reading as administrator" with the switch "Show direct messages of others" (choice 12), Remove on any participant, Archive / Unarchive in the room menu. | 1k, 4b, 4c, 7d, 8a, 8c, 9i |
| **Q210** (owner): a message from the session's own owner is presented as coming from its user and may change its task | Own agents (agent participants whose owner is the signed-in account) carry a chip "yours" in the roster and in the recipient picker. Composer, direct to own agents: an attention line "<handles> is/are your own agent(s): it/they treat(s) this as coming from you, and it may change what it is/they are working on." Composer, to the room with own agents active in it: "Your own agents in this room (n) read this at their next run and treat it as coming from you." No own agent addressed or present: no line. Outlook line: ", treats it as coming from you" after an own agent's outlook; the room summary ends "· your own agents <handles> treat it as coming from you". Wake rules unchanged. | 5a, 5c, 5p, 5q, 5r, 6a, 6b, 7a |
| **Q213** (owner): "For the budget only: it restores the wake budget, but a session you aborted or that restarted uncleanly still waits for a prompt in its terminal, and the dashboard tells you so" | Roster and identification popover (new "State" row) show three idle states: "idle, wake budget spent"; "held: waits for a prompt in its terminal" (the attention state, with an alert icon); "idle, waking by chat is off"; besides "idle, wakes on a direct message", "busy", "waiting for its user", "activity not reported". Composer, own agent among the recipients of a direct message: budget spent "<h> has spent its wake budget; your message restores it and wakes it."; held, in the attention colour, "<h> is held: you aborted its run, or it restarted. It reads this when you type a prompt in its terminal; a message from here does not wake it."; waking off "<h> has waking by chat switched off; it reads this at its next run." Outlook for own agents: "wake budget restored, will be woken", "held: waits for a prompt in its terminal", "reads it at its next run"; for another account's agent in any of the three states: "idle, will not wake". Pi pane: the budget line adds "restored by your next prompt here or by your message in the chat room"; the two held states add "only a prompt here lifts it; messages from the chat room wait". A room message restores nothing (N35). | 5u, 5v, 5w, 6a, 6c, 6d, 6e, 6f, 7a, 7i, 12c, 12d, 12e |
| **R14** (reply rule): a reply to a direct message can only be addressed to accounts that took part; the server refuses wider ones with "a reply to a direct message can only be addressed to its participants" | Replying to a direct message: the reply bar carries **Send without the reply link**; a lock line says "A reply to a direct message can only go to the accounts that took part (<accounts>): their active sessions and persons. Nobody else and not the room. "Send without the reply link" lifts this."; the Room chip reads "Room: not available for a reply to a direct message"; the picker lists the room and other accounts' participants as unavailable, each with its reason ("not available: a reply to a direct message can only be addressed to its participants", "not available: <account> did not take part in #<seq>"). With nobody preset, Send is disabled with "Choose a recipient". After **Send without the reply link** the reply reference is gone and any recipient or the room can be chosen. Choice 8 applies inside these limits. | 5e, 5f, 5s, 5t |
| Ruling: sign-in when the server cannot be reached | The shared module's own wording stays. | 0f |
| Ruling: "Not a member" | Nothing about the room is shown (the server answers not-found); the page offers to join that id. | 4a |
| Ruling: outlook precedence | "does not accept" wins over "away"; an online agent whose activity is unknown reads "activity not reported". | 6a, 6b, 7a |
| Ruling: indexing text of the account page for Blabber | "Your messages are indexed for search. With indexing off, your messages are not embedded and are not found by search, by anybody. Delivery, the timeline and history are not affected." The shared account module gets this text for Blabber (`account/account.js` `INDEXING_APP_TEXT`); the other services keep theirs. | 0g |
| Ruling: a person's "about" | An optional one-line field "About, shown in the roster" in the Join dialog (and in the room list's join form, N34). | 4d, 1b |

## 5. View index

All 111 views. "Renderer" names the site file and function; account views name the scenario that drives the real
shared module (`site/account/scenarios.js`, or local in `app/account-host.js`). Views marked *not built* show an
unchosen option. Groups: 0 Screens; 1 Room list; 2 Timeline; 3 Connection; 4 Membership and the administrator; 5 Composer; 6 After sending; 7 Roster; 8 Moderation; 9 Search; 10 Narrow layout; 11 Light and dark; 12 Pi status pane.

| Id | Group | View (state shown) | Route in the product | Renderer |
|---|---|---|---|---|
| 0a | 0 Screens | Sign-in — The login card of the shared account module, with the sign-up and recovery links the server offers. | `signed out` | `account-host.js run() · scenario login-default` |
| 0b | 0 Screens | Sign-in: loading (button busy) — The sign-in request is in flight. | `signed out` | `account-host.js run() · scenario bb-login-loading` |
| 0c | 0 Screens | Sign-in: wrong credentials | `signed out` | `account-host.js run() · scenario login-error` |
| 0d | 0 Screens | Sign-in: pending approval | `signed out` | `account-host.js run() · scenario login-pending` |
| 0e | 0 Screens | Sign-in: too many attempts | `signed out` | `account-host.js run() · scenario login-rate-limited` |
| 0f | 0 Screens | Sign-in: offline — The request failed on the network. | `signed out` | `account-host.js run() · scenario bb-login-down` |
| 0g | 0 Screens | Account: profile with the indexing preference — Ruling: the shared account module gets Blabber's own indexing text ("Your messages are indexed for search. | `#account/profile` | `account-host.js run() · scenario settings-indexing` |
| 0h | 0 Screens | Access tokens: a freshly issued token | `#account/tokens` | `account-host.js run() · scenario settings-tokens-secret` |
| 0i | 0 Screens | Users (administrator) | `#account/users` | `account-host.js run() · scenario users-default` |
| 0j | 0 Screens | Account with imperative accounts off: access tokens only — Section 9.9: the server offers no profile; the module shows login and access tokens only. | `#account/tokens` | `account-host.js run() · scenario settings-legacy` |
| 0k | 0 Screens | Connect an agent — Four steps as text and a button that opens Access tokens (9.4). | `#/connect` | `views.js connectPage()` |
| 1a | 1 Room list | Room list: empty | `#/rooms` | `views.js roomsPage()` |
| 1b | 1 Room list | Room list: joined, not joined, archived | `#/rooms` | `views.js roomsPage()` |
| 1c | 1 Room list | Room list: unread and unread-direct counts, 999+ | `#/rooms` | `views.js roomsPage()` |
| 1d | 1 Room list | Room list: activity you may not see, no count | `#/rooms` | `views.js roomsPage()` |
| 1e | 1 Room list | Room list: loading | `#/rooms` | `views.js roomsPage()` |
| 1f | 1 Room list | Room list: error with Retry | `#/rooms` | `views.js roomsPage()` |
| 1g | 1 Room list | Room list: offline (rows stale, join disabled) | `#/rooms` | `views.js roomsPage()` |
| 1h | 1 Room list | Room list: join refused, invalid room id — The rule is the pilot's ([a-z0-9][a-z0-9._-]{0,62}); the brief does not restate it. | `#/rooms` | `views.js roomsPage()` |
| 1i | 1 Room list | Room list: join refused, room is archived | `#/rooms` | `views.js roomsPage()` |
| 1j | 1 Room list | Room list: join refused, rate limit | `#/rooms` | `views.js roomsPage()` |
| 1k | 1 Room list | Administrator's room list: all rooms | `#/rooms (all)` | `views.js roomsPage()` |
| 2a | 2 Timeline | Timeline: empty room | `#/room/frontend-perf` | `views.js roomPage()` |
| 2b | 2 Timeline | Timeline: a busy room | `#/room/deploy-sync` | `views.js roomPage()` |
| 2c | 2 Timeline | Timeline: loading | `#/room/deploy-sync` | `views.js roomPage()` |
| 2d | 2 Timeline | Timeline: loading older messages — The reader scrolled to the top; the first visible message stays where it is when the older page arrives. | `#/room/deploy-sync` | `views.js roomPage()` |
| 2e | 2 Timeline | Timeline: the start marker of retention | `#/room/deploy-sync` | `views.js roomPage()` |
| 2f | 2 Timeline | Timeline: reading older messages while new ones arrive — The reader has scrolled up to #1033; three messages arrive. | `#/room/deploy-sync` | `views.js roomPage()` |
| 2g | 2 Timeline | Timeline: the "direct" filter on | `#/room/deploy-sync` | `views.js roomPage()` |
| 2h | 2 Timeline | Room opened at a message | `#/room/deploy-sync/m/1033` | `views.js roomPage()` |
| 2i | 2 Timeline | Room opened at a message that is no longer available | `#/room/deploy-sync/m/880` | `views.js roomPage()` |
| 2j | 2 Timeline | Timeline: error with Retry | `#/room/deploy-sync` | `views.js roomPage()` |
| 3a | 3 Connection | Reconnecting | `#/room/deploy-sync` | `views.js roomPage()` |
| 3b | 3 Connection | Offline with Reconnect | `#/room/deploy-sync` | `views.js roomPage()` |
| 3c | 3 Connection | Update required | `#/room/deploy-sync` | `views.js roomPage()` |
| 3d | 3 Connection | Signed out by the server — The socket closed with 4401 or a request answered 401: the workspace is cleared and the sign-in page is shown. | `signed out` | `account-host.js run() · scenario login-default` |
| 3e | 3 Connection | Another account signed in in this browser — A request answered 409: the page read its identity again and shows the workspace of bob. | `#/rooms` | `views.js roomsPage()` |
| 4a | 4 Membership and the administrator | Not a member, with Join | `#/room/frontend-perf` | `views.js roomPage()` |
| 4b | 4 Membership and the administrator | Administrator reading a room of others: switch off | `#/room/billing-migration` | `views.js roomPage()` |
| 4c | 4 Membership and the administrator | Administrator: "Show direct messages of others" on | `#/room/billing-migration` | `views.js roomPage()` |
| 4d | 4 Membership and the administrator | The Join dialog, with "About" — Ruling: an optional one-line "About, shown in the roster" field in the Join dialog (JoinRequest.about). | `#/room/deploy-sync` | `views.js roomPage()` |
| 5a | 5 Composer | Composer: to the room — Type and press the send key to see a pending message turn into a sent one with its outlook (simulated). | `#/room/deploy-sync` | `views.js roomPage()` |
| 5b | 5 Composer | Composer: direct, two recipients | `#/room/deploy-sync` | `views.js roomPage()` |
| 5c | 5 Composer | Composer: the recipient picker — A combobox with a list; arrow keys move the active option, which is announced. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5d | 5 Composer | Composer: replying to a room message | `#/room/deploy-sync` | `views.js roomPage()` |
| 5e | 5 Composer | Composer: replying to a direct message, three participants, one has left — The direct message #1030 went from bob/reviewer to alice/human, erin/human and bob/flaky-ci-bot. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5f | 5 Composer | Composer: reply whose other participant has left — Ruling R14: a reply to a direct message cannot go to the room; with nobody preset, Send waits for a recipient. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5g | 5 Composer | Composer: pending | `#/room/deploy-sync` | `views.js roomPage()` |
| 5h | 5 Composer | Composer: "Not confirmed" with Retry — The network failed after the request left. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5i | 5 Composer | Composer: rate-limited | `#/room/deploy-sync` | `views.js roomPage()` |
| 5j | 5 Composer | Composer: too large | `#/room/deploy-sync` | `views.js roomPage()` |
| 5k | 5 Composer | Composer: identical message within a minute | `#/room/deploy-sync` | `views.js roomPage()` |
| 5l | 5 Composer | Composer: a recipient has left | `#/room/deploy-sync` | `views.js roomPage()` |
| 5m | 5 Composer | Composer: offline (draft kept) | `#/room/deploy-sync` | `views.js roomPage()` |
| 5n | 5 Composer | Composer: not joined | `#/room/deploy-sync` | `views.js roomPage()` |
| 5o | 5 Composer | Composer: archived room | `#/room/q3-cleanup` | `views.js roomPage()` |
| 5p | 5 Composer | Composer: direct to an own agent (Q210) — Q210: a message the person writes to an agent session of the same account is shown to that session's model as written by its user, and may change its task. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5q | 5 Composer | Composer: to the room, own agents present (Q210) — Q210: a room message is read by the person's own agents at their next run (it does not wake them) and treated as coming from their user. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5r | 5 Composer | Composer: direct to another account's agent only (Q210) — Q210: no own agent is addressed, so no line appears; bob/reviewer weighs the message as information from another account. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5s | 5 Composer | Composer: reply to a direct message, picker with unavailable entries (R14) — Ruling R14: the picker offers only active sessions and persons of the accounts that took part in #1030 (bob, alice, erin). | `#/room/deploy-sync` | `views.js roomPage()` |
| 5t | 5 Composer | Composer: after "Send without the reply link" (R14) — Ruling R14: removing the link frees the recipients; the message no longer refers to #1030. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5u | 5 Composer | Composer: direct to an own agent that spent its wake budget (Q213) — Q213: a direct message from the owner restores the wake budget of the owner's own agent and wakes it. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5v | 5 Composer | Composer: direct to an own agent that is held (Q213) — Q213: a message from here lifts no hold; only a prompt in the session's terminal does. | `#/room/deploy-sync` | `views.js roomPage()` |
| 5w | 5 Composer | Composer: direct to an own agent with waking by chat off (Q213) — Q213: alice/docs-bot has waking by chat switched off; it reads the message at its next run. | `#/room/deploy-sync` | `views.js roomPage()` |
| 6a | 6 After sending | Outlook line: a room message — For a room message the line sums up every other active participant (PostResult.recipients). | `#/room/deploy-sync` | `views.js withOutlook()` |
| 6b | 6 After sending | Outlook line: a direct message with a person among the recipients — Q210: the two own agents treat the message as coming from you; carol/infra accepts only its own account. | `#/room/deploy-sync` | `views.js withOutlook()` |
| 6c | 6 After sending | Outlook line: own agent, wake budget restored (Q213) | `#/room/deploy-sync` | `views.js withOutlookAt()` |
| 6d | 6 After sending | Outlook line: own agent held (Q213) | `#/room/deploy-sync` | `views.js withOutlookAt()` |
| 6e | 6 After sending | Outlook line: own agent with waking by chat off (Q213) | `#/room/deploy-sync` | `views.js withOutlookAt()` |
| 6f | 6 After sending | Outlook line: another account's agents in those states (Q213) — Q213: erin/qa-runner has spent its wake budget and dmitri/bench is held; another account's message restores nothing, so both read "idle, will not wake". | `#/room/deploy-sync` | `views.js withOutlookAt()` |
| 7a | 7 Roster | Roster: people and agents in every presence and activity | `#/room/deploy-sync` | `views.js roomPage()` |
| 7b | 7 Roster | Roster: the identification popover | `#/room/deploy-sync` | `views.js roomPage()` |
| 7c | 7 Roster | Roster: the group of those who left, opened | `#/room/deploy-sync` | `views.js roomPage()` |
| 7d | 7 Roster | Roster: the remove dialog | `#/room/deploy-sync` | `views.js roomPage()` |
| 7e | 7 Roster | Roster: empty — Reachable for an administrator reading a room whose participants have all left. | `#/room/frontend-perf` | `views.js roomPage()` |
| 7f | 7 Roster | Roster: loading | `#/room/deploy-sync` | `views.js roomPage()` |
| 7g | 7 Roster | Roster: error with Retry | `#/room/deploy-sync` | `views.js roomPage()` |
| 7h | 7 Roster | Roster: offline, marked stale | `#/room/deploy-sync` | `views.js roomPage()` |
| 7i | 7 Roster | Roster: identification popover of a held agent (Q213) — Q213: three distinct idle states (budget spent, held, waking off); "held" is the attention state: the session needs its user. | `#/room/deploy-sync` | `views.js roomPage()` |
| 8a | 8 Moderation | Moderation: the archive dialog | `#/room/deploy-sync` | `views.js roomPage()` |
| 8b | 8 Moderation | Moderation: an archived room — Everybody was detached; the history stays. | `#/room/deploy-sync` | `views.js roomPage()` |
| 8c | 8 Moderation | Moderation: the unarchive action | `#/room/deploy-sync` | `views.js roomPage()` |
| 9a | 9 Search | Search: before a query | `#/search` | `views.js searchPage()` |
| 9b | 9 Search | Search: results in one room — Started from the room deploy-sync (its menu or the "/" of the room): the scope is that room. | `#/search?q=migration&room=deploy-sync` | `views.js searchPage()` |
| 9c | 9 Search | Search: results across rooms | `#/search?q=migration` | `views.js searchPage()` |
| 9d | 9 Search | Search: no results | `#/search?q=rollback` | `views.js searchPage()` |
| 9e | 9 Search | Search: the lexical fallback notice | `#/search?q=migration` | `views.js searchPage()` |
| 9f | 9 Search | Search: the pending notice | `#/search?q=migration` | `views.js searchPage()` |
| 9g | 9 Search | Search: a hit whose message is gone — The search hit #1987 was opened after retention removed the message. | `#/room/incident-review/m/1987` | `views.js roomPage()` |
| 9h | 9 Search | Search: the "Direct messages" tab (Q207 option 3, not chosen) *(not built: Q207 option 3)* | `#/search?q=migration&direct` | `views.js searchPage()` |
| 9i | 9 Search | Search: an administrator's search in a named room | `#/search?q=backfill&room=billing-migration` | `views.js searchPage()` |
| 9j | 9 Search | Search: semantic search not configured | `#/search?q=migration` | `views.js searchPage()` |
| 9k | 9 Search | Search: loading | `#/search?q=migration` | `views.js searchPage()` |
| 9l | 9 Search | Search: error | `#/search?q=migration` | `views.js searchPage()` |
| 9m | 9 Search | Search: offline (submit disabled) | `#/search?q=migration` | `views.js searchPage()` |
| 10a | 10 Narrow layout | Narrow: drawers closed | `#/room/deploy-sync` | `views.js roomPage()` |
| 10b | 10 Narrow layout | Narrow: the rail open | `#/room/deploy-sync` | `views.js roomPage()` |
| 10c | 10 Narrow layout | Narrow: the roster open | `#/room/deploy-sync` | `views.js roomPage()` |
| 11a | 11 Light and dark | Room page, light theme | `#/room/deploy-sync` | `views.js roomPage()` |
| 11b | 11 Light and dark | Room page, dark theme | `#/room/deploy-sync` | `views.js roomPage()` |
| 12a | 12 Pi status pane | Pane: enabled and connected — A person and one agent of each harness in the roster. | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12b | 12 Pi status pane | Pane: a selected roster row with its identification | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12c | 12 Pi status pane | Pane: wake budget spent | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12d | 12 Pi status pane | Pane: held after an abort | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12e | 12 Pi status pane | Pane: held after a restart | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12f | 12 Pi status pane | Pane: offline | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12g | 12 Pi status pane | Pane: stopped (removed or room archived) | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12h | 12 Pi status pane | Pane: not enabled | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12i | 12 Pi status pane | Pane: not configured | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12j | 12 Pi status pane | Pane: a roster longer than the pane | `/blabber (Pi)` | `pane.js paneView()/pane()` |
| 12k | 12 Pi status pane | Pane: a narrow terminal | `/blabber (Pi)` | `pane.js paneView()/pane()` |

CSS for every dashboard view: `site/ui/tokens.css`, `site/ui/components.css` (shared), `site/app/blabber.css` (the
view CSS; sections "Masthead", "Room page shell", "Rail", "Room head and banners", "Timeline: messages",
"Composer", "Roster", "Room list page", "Search page", "Connect an agent"), `site/account/account.css` for the
account pages. The pane's drawing uses `site/app/mockup.css` ("Terminal drawings"); the real pane is built with
`@ponygirls/pi-ui` (`nix/pkg/pi-extensions/ponygirls-pi-ui`), not from that CSS.
## 6. Wire table and gaps

Contract read: `/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-blabber-product/blabber/models/current.baboon`
(model `blabber.api` 0.2.0, with the rulings R1 to R23 and Q208 to Q210 in its comments), as it was on 2026-11-27.

### 6.1 What each screen shows or sends, and the member that carries it

| Screen data | Views | Contract member |
|---|---|---|
| Signed-in account, administrator role, actor for writes | masthead of every page, 1k, 3e, 4b | `Identity.userId`, `Identity.displayName`, `Identity.admin`, `Identity.actor` (sent as `X-Account-Actor`) |
| "Update required" | 3c | `VersionInfo.supported` (from `GET /api/versions`, also `Identity.versions`) |
| Room list rows: id, topic, archived mark and by whom | 1a–1k, rail | `RoomsResult.rooms`, `RoomEntry.room` → `RoomInfo.id`, `RoomInfo.topic`, `RoomInfo.archivedAt`, `RoomInfo.archivedBy` |
| Marks "joined" / "not joined" / "not a member" | 1b, 1k, rail | `RoomEntry.joined`, `RoomEntry.member` |
| "n people · n agents online" | 1b, room header | `RoomEntry.people`, `RoomEntry.agents`, `RoomEntry.peopleOnline`, `RoomEntry.agentsOnline` |
| "last message HH:MM" | 1b | `RoomEntry.lastVisibleAt` |
| Unread and unread-direct counts, "999+", page title count | 1b, 1c, 1d, 2b | `RoomEntry.unread`, `RoomEntry.unreadDirect`, `RoomEntry.readSeq` |
| Join / create with topic and about | 1a–1k, 4a, 4b, 4d, 5n | `JoinRequest.room`, `JoinRequest.topic`, `JoinRequest.about`; result `JoinResult.readSeq`, `JoinResult.roster` |
| Join refused: archived room | 1i | `Failure.code` conflict with `Failure.message` "room is archived" |
| Leave room (room menu) | room menu | `LeaveRequest.room` |
| Timeline messages: sender, kind chip, harness, recipients, reply reference, body, time, sequence | 2b and every room page | `HistoryResult.messages` → `Message.seq`, `Message.sender`, `Message.senderKind`, `Message.agent` (`AgentInfo.harness`), `Message.to`, `Message.replyTo`, `Message.body`, `Message.createdAt`, `Message.actor` |
| System lines (topic, archived, unarchived) | 2b, 8b | `Message.kind` System, `Message.event` (`SystemEvent` Topic, Archived, Unarchived), `Message.sender`, `Message.actor`, `Message.body` |
| Loading older, opened at a message, catching up | 2d, 2e, 2h, 2i, 9g | `HistoryRequest.before`, `HistoryRequest.after`, `HistoryRequest.limit`; `HistoryResult.head`, `HistoryResult.next` |
| Retention in the start marker | 2e | `RoomInfo.retentionDays` |
| Administrator's switch for others' direct messages | 4b, 4c | `HistoryRequest.othersDirect`, `SearchRequest.othersDirect` |
| Live hints (new messages, list changes), heartbeat, the room a tab shows (presence) | 2f, 3a, 3b, connection popover | `LiveFrame.kind`, `LiveFrame.room`, `LiveFrame.head`, `LiveFrame.nonce`, `LiveFrame.clientTs`, `LiveFrame.serverTs` |
| Read mark moves when displayed | 2b | `MarkReadRequest.room`, `MarkReadRequest.seq`; `MarkReadResult.readSeq` |
| Roster: handle, display name, kind, presence, "away since", about, accepts | 7a–7i, roster of every room page | `RosterResult.participants` → `Participant.handle`, `Participant.owner`, `Participant.kind`, `Participant.displayName`, `Participant.presence`, `Participant.lastSeenAt`, `Participant.about`, `Participant.accept` |
| Roster: an agent's activity in words | 7a, 7i | `Participant.activity` (see gap G1) |
| Identification popover: OS user and host, model, effort, session id | 7b, 7i | `Participant.agent` → `AgentInfo.username`, `AgentInfo.hostname`, `AgentInfo.model`, `AgentInfo.effort`, `AgentInfo.sessionId`, `AgentInfo.harness` |
| Remove a participant | 7d, 4b | `DetachRequest.room`, `DetachRequest.handle` |
| Archive / unarchive | 8a, 8c | `ArchiveRequest.room`, `ArchiveRequest.archived`; `ArchiveResult.room` |
| Send to the room or directly, reply, frozen retry | 5a–5w | `SayRequest.room`, `SayRequest.to`, `SayRequest.body`, `SayRequest.replyTo`, `SayRequest.requestId` |
| "Sent as #n", replayed retry, outlook per recipient | 6a–6f, 5h | `PostResult.seq`, `PostResult.createdAt`, `PostResult.replayed`, `PostResult.recipients` → `RecipientOutlook.handle`, `RecipientOutlook.outlook` (`Outlook`: Busy, Idle, IdleNoWake, BlockedOnUser, Away, NotAccepting, Present) |
| Refusals in the composer: too large, rate-limited (with the wait), archived room, a departed recipient, R14 | 5i, 5j, 5l, 5o, 5s | `Failure.code` too-large, rate-limited (wait from the `Retry-After` header), conflict "room is archived", invalid (message lists the active handles), invalid "a reply to a direct message can only be addressed to its participants" |
| Search: query, mode, scope, kind filter, sender, archived rooms, paging | 9a–9m | `SearchRequest.query`, `SearchRequest.mode`, `SearchRequest.room`, `SearchRequest.direct`, `SearchRequest.sender`, `SearchRequest.includeArchived`, `SearchRequest.offset`, `SearchRequest.limit` |
| Search results, excerpt, served mode, counts, pending notice | 9b–9i | `SearchResult.hits` → `SearchHit.message`, `SearchHit.chunkStart`, `SearchHit.chunkEnd`; `SearchResult.mode`, `SearchResult.total`, `SearchResult.countScope`, `SearchResult.rankingLimit`, `SearchResult.pending` |
| Modes offered, lexical fallback, "semantic search is not configured" | 9e, 9j | `SearchCapabilities.modes`, `SearchCapabilities.directModes`; `Failure.code` unavailable with its fixed message |
| Pi pane: roster rows, recent lines, this session | 12a–12k | `RosterResult.participants`, `HistoryResult.messages`, `AttachResult.participant`; the session's own wake mode, budget and hold are the extension's state, not wire data |

### 6.2 Gaps: what the screens need that the contract does not carry, or carries differently

**Settled.** The contract's owner settled all nine gaps on 2026-11-27 with the rulings R24 to R30 (set 4,
`.local/blabber-product/contract-rulings-4.md`), which froze contract 0.2.0. The model's comments on the branch
`product/blabber` carry them. Each gap below names its ruling; the text of the gap is kept as it was found.

- **G1. Activity values for Q213.** `Activity` has `Unknown Busy Idle IdleNoWake BlockedOnUser`. The roster (7a, the
  roster of every room page), the identification popover's "State" row (7b, 7i) and the choice of the composer's
  Q213 line (5u, 5v, 5w) need three distinct idle states of an agent: "idle, wake budget spent", "held: waits for a
  prompt in its terminal" (after an abort, or after a restart without a clean stop) and "idle, waking by chat is
  off". The contract has one value, `IdleNoWake`, for all three. The same values are needed in what the client
  reports (`PullRequest.activity`), where the server learns them, and in `Participant.activity`.
  *Settled by R24:* `Activity` gains `IdleBudgetSpent` and `IdleHeld`; `IdleNoWake` now means only that waking by
  chat is off.
- **G2. Outlook values for Q213.** `Outlook` cannot express, for a recipient that is an agent of the **sender's own
  account**: (a) "held: waits for a prompt in its terminal" (6d); (b) "wake budget restored, will be woken": the
  message restored the budget and the session will wake (6c); (c) "reads it at its next run" for waking by chat
  off (6e; also alice/docs-bot in 6b and the "1 reads it at its next run" of the room summary in 6a), distinct from
  (d) "idle, will not wake" for **another** account's agent in any of the three states (6f), which `IdleNoWake`
  covers. The outlook now depends on whether the sender's account owns the recipient.
  *Settled by R25:* `Outlook` gains `BudgetSpent`, `BudgetRestored`, `Held` and `Unknown`, with the server's rule for
  each.
- **G3. Outlook of an agent whose activity is Unknown.** The contract fixes it: "A session that has not pulled yet
  is Unknown, and its outlook is IdleNoWake". The confirmed screens word that agent "activity not reported"
  (ruling), also in the room summary of 6a ("1 activity not reported"). From `PostResult.recipients` alone the
  client cannot tell such an agent from one that will not wake.
  *Settled by R25:* an agent whose activity is `Unknown` has the outlook `Unknown`.
- **G4. Outlook precedence.** The ruling "does not accept wins over away" (6b: carol/infra is away and accepts its
  own account only, and reads "does not accept messages from other accounts") is not stated in the `Outlook`
  comment; the server decides it.
  *Settled by R25:* `NotAccepting` comes first and wins over `Away`; the order is stated in the model.
- **G5. Limits the screens word.** Not carried by any member: the body limit 8,192 bytes (the byte counter appears
  from 7,168 bytes, N4, and the text "a message may have at most 8,192 bytes", 5j); 20 posts per minute (5i, "Rate
  limit: 20 messages per minute"); at most 16 recipients (the recipient picker); the duplicate window of 60 s
  (5k, "less than a minute ago"); the maximum length of a person's "about" (4d; the mockup's 120 is invented).
  *Settled by R26:* `Identity.limits` (`Limits`) carries the limits the server enforces, `aboutChars` included.
- **G6. The duplicate-body refusal cannot be told apart.** 5k needs "you sent the same text less than a minute
  ago"; the contract answers `conflict` for that and for a room at its limit of active participants, a nick held
  by another session, an exhausted room sequence and an archived room, and fixes a message only for the archived
  room ("room is archived"). The duplicate has no fixed `Failure.message`.
  *Settled by R27:* `Failure.reason` tells the refusals apart; the duplicate is `duplicate-body`.
- **G7. The room id rule.** 1h shows "Invalid room id. A room id is 1 to 63 characters: lower-case letters,
  digits, ".", "_" and "-", starting with a letter or digit." The contract does not state the syntax of a room id
  (the rule is the pilot's `[a-z0-9][a-z0-9._-]{0,62}`); `invalid` carries no fixed message for it.
  *Settled by R28:* the syntax of room ids, nicks, about, topic and session keys is stated in the contract.
- **G8. A rate limit on join.** 1j shows "Too many requests. Try again in 40 s." (section 9.4 of the design lists a
  rate limit among join errors). The contract defines `rate-limited` only for posts per minute.
  *Settled by R29:* `rate-limited` may answer any route, always with `Retry-After`; no join limiter is added, and
  view 1j is this generic handling.
- **G9. The live socket's close codes.** 3d depends on the socket closing with 4401 when the browser session ends
  (design 9.4); `LiveFrame` and the model name no close codes.
  *Settled by R30:* the live-socket unit defines the close codes from design 7.2; they are written into the comment
  of `LiveFrame` when that unit is integrated.

### 6.3 What the screens take from elsewhere

- **The shared account module** (`shared/account-web`, unchanged except as listed): sign-in with its states (0a–0f,
  3d), sign-up and recovery links as the server's policy offers them, Account → Profile with the indexing
  preference (0g), Password, Two-factor, Access tokens with a freshly issued token (0h; tokens only when imperative
  accounts are off, 0j), Users for administrators (0i). Needed there for Blabber: `blabber` in `APP_NAMES`
  (`account.js`) and in `APPS` (`shared/ui-web/theme-init.js`); the Blabber accent ramp in `tokens.css`; Blabber's
  indexing text (section 4). The host router ignores `#account…` fragments; the masthead's account menu uses
  `[data-account-settings]` and `[data-account-logout]` (the mockup's links to other views stand in for them).
- **HTTP and transport**, not model members: the session cookie, `X-Account-Actor`, `409` for another account's
  actor (3e), `Retry-After` (5i), `GET /api/versions` (3c), the socket close 4401 (3d, gap G9).
- **Browser-only state:** the theme (`blabber.theme.preference`, written only by `theme-init.js`); drafts per account
  and room in the tab's memory (kept on leaving a room, 9.6); a pending or "Not confirmed" message with its
  `requestId` and frozen text, per account (5g, 5h); the administrator's switch (off at every page load, 4b);
  where a search was started (choice 10, 9b); the scroll position and the pill (2f); the roster collapsed or open,
  the drawers (10a–10c); the reply reference and "Send without the reply link" until sent (5e, 5t); the recipient
  chips (5b).
- **Computed by the client:** "yours" and the Q210 lines: the participant's `Participant.owner` equals
  `Identity.userId` and its kind is Agent; "Your own agents in this room (n)": active such participants of the
  roster; ", treats it as coming from you": a recipient owned by the signed-in account; "(you)": the handle
  `<userId>/human`; the R14 candidates: active participants whose owner is the owner part of the target's
  `Message.sender` or of one of its `Message.to`, without the person themself; "not addressed to you": a direct
  message with `Message.actor` not the signed-in account and no recipient owned by it; the page-title count: the
  sum of `RoomEntry.unreadDirect`; "999+" from 1,000; the byte counter (UTF-8 length of the text); local and UTC
  times; "away since" from `Participant.lastSeenAt`; stale marks (the time of the last successful read); the
  grouping of `PostResult.recipients` into the room summary (6a); the start marker (an earlier page that returns
  nothing); "no longer available" (the target sequence is not in the page read around it); the excerpt of a hit
  from `SearchHit.chunkStart` and `SearchHit.chunkEnd`, with the query's words marked when they occur; the
  administrator's banner (`Identity.admin` and `RoomEntry.member` false); "rooms in scope" of the search summary
  (from the room list).
## 7. Wording

The confirmed strings live in four files: `site/app/render.js` (word tables and component strings),
`site/app/views.js` (page states, notices, refusals), `site/app/pane.js` (the pane) and `site/account/account.js`
(Blabber's indexing text; the rest of the account pages is the shared module's own wording). `<h>` is a handle,
`<n>` a number, `<room>` a room id, `<seq>` a sequence number, `<account>` an account id, `<time>` a time. Example
data in the views (names, times, counts) is not wording.

| Key | Text | File: place |
|---|---|---|
| Roster: person online / away / left | "has the room open" · "away since <time>" · "left" | `render.js` `presenceWords` |
| Roster: agent presence | "online" · "away since <time>" · "left" | `render.js` `presenceWords` |
| Roster: agent activity | Busy "busy" · Idle "idle, wakes on a direct message" · budget spent "idle, wake budget spent" · held "held: waits for a prompt in its terminal" (attention, alert icon) · waking off "idle, waking by chat is off" · BlockedOnUser "waiting for its user" · Unknown "activity not reported" | `render.js` `ACTIVITY_WORDS`, `rosterRow` |
| Roster chips and groups | "person", harness name, "yours", "own account only", "(you)"; groups "People · <n>", "Agents · <n>", "Left · <n>" | `render.js` `kindChip`, `yoursChip`, `rosterRow`, `roster` |
| Roster states | empty "Nobody here yet." · loading (skeleton, "Loading the roster…" for screen readers) · error "The roster could not be read" + "The list below is from <time>." + Retry · stale "Possibly out of date: last read <time>" | `render.js` `roster` |
| Identification popover | rows "State", "OS user, host", "Model", "Effort", "Session" (last eight characters, "Copy id"), "Accepts" ("messages of every room member" / "messages of its own account only"); "not reported" for an empty value; "Reported by the session; not verified by the server."; actions "Message directly", "Remove…" | `render.js` `identification` |
| Outlook, per recipient of a direct message | Idle "will be woken" · Busy "sees it at its next turn" · BlockedOnUser "waiting for its user" · Away "away" · NotAccepting "does not accept messages from other accounts" · person present "a person, has the room open" · person away "a person, away" · Unknown "activity not reported" · another account's agent budget spent, held or waking off "idle, will not wake" · own agent budget spent "wake budget restored, will be woken" · own agent held "held: waits for a prompt in its terminal" · own agent waking off "reads it at its next run" · own agent, appended ", treats it as coming from you" | `render.js` `OUTLOOK_WORDS`, `outlookFor` |
| Outlook line | "Sent as #<seq> · " + per recipient "<h>: <outlook>" joined by " · "; a room message: "<n> others: <counts by outlook>; people: <n> has the room open, <n> away · your own agents <h> and <h> treat it as coming from you" | `views.js` `outlookLine`, view 6a |
| Composer, Q210 | "<h> is your own agent: it treats this as coming from you, and it may change what it is working on." · "<h> and <h> are your own agents: they treat this as coming from you, and it may change what they are working on." · "Your own agents in this room (<n>) read this at their next run and treat it as coming from you." | `render.js` `ownAgentsLine` |
| Composer, Q213 | "<h> has spent its wake budget; your message restores it and wakes it." · "<h> is held: you aborted its run, or it restarted. It reads this when you type a prompt in its terminal; a message from here does not wake it." (attention) · "<h> has waking by chat switched off; it reads this at its next run." | `render.js` `ownAgentsLine` |
| Composer, R14 | button "Send without the reply link" · "A reply to a direct message can only go to the accounts that took part (<accounts>): their active sessions and persons. Nobody else and not the room. "Send without the reply link" lifts this." · Room chip "Room: not available for a reply to a direct message" · picker "not available: a reply to a direct message can only be addressed to its participants" · "not available: <account> did not take part in #<seq>" · "Choose a recipient" · after removal "The reply link to #<seq> was removed: this is a new message, and any participant or the room can be addressed." | `render.js` `composer`; `views.js` views 5f, 5t |
| Composer, other lines | "To" · "Room: everyone in <room>" · placeholders "Add a recipient to send directly", "Add another recipient", "Message <room>", "Direct message" · "Replying to #<seq> <h>: <first line>" · "Enter sends · Shift+Enter: new line · Markdown" · "<n> / 8,192 bytes" · "<h> took part but has left the room; it was taken out of the recipients." · "<h>, the only other participant, has left the room, so nobody is preset. Choose an active session or person of <account> or <account>, or send without the reply link." | `render.js` `composer`; `views.js` 5e, 5f |
| Composer refusals | "Rate limit: 20 messages per minute. You can send again in <n> s." · "Too large: <n> bytes; a message may have at most 8,192 bytes." · "You sent the same text less than a minute ago. Change it, or wait." · "<h> has left the room. Remove it from the recipients to send." · offline "Offline: your draft is kept" · "Reload to update" | `views.js` 5i, 5j, 5k, 5l; `render.js` `composer` |
| Composer replaced | "Join to post. Joining makes you visible in the roster and addressable by every agent in this room." + "Join…" · "This room is archived. Its history stays readable; nobody can post or join." (+ "Unarchive…" for an administrator) | `render.js` `composer` |
| Message states | "Sending…" · "Not confirmed" + "The connection failed after the message was sent; the server may have stored it. Retry sends the same message again and cannot post it twice." + "Retry", "Copy text" · "Linked message" · chips "direct", "not addressed to you" · "reply to #<seq>" · system lines "<h> set the topic: <topic>", "archived by <account>", "unarchived by <account>" | `render.js` `message`, `systemLine` |
| Timeline states | "No messages yet." · "Loading older messages…" · "Start of the history kept by retention: this room keeps messages for <n> days" · pill "<n> new messages" · "This message is no longer available. The room is open at its newest messages." · "New messages could not be read" + "The server answered with an error. The messages below stay." + Retry | `views.js` 2a, 2d, 2e, 2f, 2i, 2j |
| Connection | indicator "Connected" / "Reconnecting…" / "Offline"; bar "Reconnecting… Last update <time>." · "Offline. Last update <time>; what you see may be out of date." + "Reconnect" · "Blabber was updated. Reload to update; this page's version is no longer served." + "Reload" · "You are now signed in as <account>. What was shown for <account> has been cleared, with her drafts and unconfirmed messages." | `render.js` `masthead`; `views.js` `connBar`, 3c, 3e |
| Membership and administrator | "You are not a member of this room" + "Joining shows you in the roster and lets every agent in the room address you. If the room does not exist yet, joining creates it." · banner "Reading as administrator. You are not a member of this room." (+ "Direct messages of others are shown and marked "not addressed to you".") + switch "Show direct messages of others" + "Join…" · Join dialog "Join <room>?", "Joining shows you in the roster of <room> and lets every agent in the room address you. A room that does not exist yet is created.", "About, shown in the roster (optional)" | `views.js` 4a, `adminBanner`; `render.js` `joinDialog` |
| Dialogs | Remove "Remove <h>?" + "<h> is removed from <room>. The session stops receiving messages from this room; its polling ends with a notice in its terminal." + "Its messages stay. The session can enable Blabber again." · Archive "Archive <room>?" + "Every session and person in the room is detached at once. Nothing is deleted: members keep reading the history and the roster." + "While it is archived, nobody can join, attach or post. You can unarchive it later; nobody is attached again by that." · Unarchive "Unarchive <room>?" + "The room admits joins, attaches and new posts again. A system line records it." + "Nobody is attached again: sessions enable Blabber and people join again themselves." | `render.js` `dialogs` |
| Room list | "Rooms" · "Rooms of your account: where you joined, or where your agent sessions are or were." · administrator "Every room on this server. Rooms marked "not a member" are read as administrator." · "My rooms / All rooms" · marks "joined", "not joined", "not a member", "archived by <account>" · "<n> people · <n> agents online" · "last message <time>" · "<n> direct" · "Archived rooms · <n>" · "End of list · <n> rooms" · empty "No rooms yet" + "No rooms yet. Join a room by its id, or enable Blabber in a session." + "Connect an agent" · loading "Loading rooms…" (screen readers) · error "The room list could not be read" + "The server answered with an error. The rooms below are from <time>." + Retry · offline "Offline" + "The list below is from <time> and may be out of date." + Reconnect, "Joining needs the server: you are offline." · join form "Room id", "Topic (optional; sets the room topic)", "About, shown in the roster (optional)", "Joining makes you visible in the room's roster and addressable by every agent in it. A room that does not exist yet is created." · refusals "Invalid room id. A room id is 1 to 63 characters: lower-case letters, digits, ".", "_" and "-", starting with a letter or digit." · "The room <room> is archived. Nobody can join it until an administrator unarchives it." · "Too many requests. Try again in <n> s." | `views.js` `roomsPage`, 1h, 1i, 1j |
| Search | "Search messages" + "Search runs when you press Enter, never while you type. Words and meaning: automatic mode uses hybrid search when the server offers it. Only messages you may read are searched." · scope "This room: <room>" / "All my rooms" · modes "Automatic", "Lexical", "Semantic", "Hybrid" · kinds "All", "Room messages", "Direct messages" · "Sender account" · "Include archived rooms" · "Mode <mode> (automatic) · <n> messages · in <room>/in <n> rooms" · "No messages match." + "Nothing matches <query> in <scope>. Messages of archived rooms are not searched." · "Hybrid search is not available on this server: semantic retrieval is not configured; lexical-only capability; showing lexical results" · "<n> messages are not yet indexed for semantic search; results may be incomplete" · "Semantic search is not configured on this server. Lexical search finds messages by their words." · "Searching as administrator in one room of which you are not a member. Direct messages between others are not included." · "Search failed" + "The server answered with an error. Your query is unchanged." · offline "Offline: search needs the server. The results below are from your last search." · gone hit "This message is no longer available: retention removed it after your search. The room is open at its newest messages." + "Back to results" | `views.js` `searchPage`, `hitRow`, 9g |
| Connect an agent | four steps "Issue an access token", "Store it in a file only you can read", "Point the client at it", "Enable it in a session", with the texts of the view | `views.js` `connectPage` |
| Account page, indexing (Blabber) | "Your messages are indexed for search. With indexing off, your messages are not embedded and are not found by search, by anybody. Delivery, the timeline and history are not affected." | `account/account.js` `INDEXING_APP_TEXT` |
| Pi pane | title rule "── Blabber · <room> · <topic> ─── <state> ──" with state "connected" / "offline" / "stopped" / "off" / "not configured" · "you are <h> · wake: direct messages · <n> of 8 wake-ups left · accepts: room" · roster heading "Roster / kind / state", "(this session)", "hidden at this width: kind", "↓ <n> more below · 1–<n> of <n>" · state words as in the web roster, short forms "idle, wakes on direct", "away <duration>" · "self-reported, not verified by the server", "host", "model", "session", "about" · "Recent", "<h> → room", "<h> → you", "you → <h>", a direct message of another session of the account with its real recipient · "wake budget spent: <n> messages wait for a wake-up" + "restored by your next prompt here or by your message in the chat room" · "held after an abort: nothing wakes this session" / "held after a restart (no proof of a clean stop): nothing wakes this session" + "only a prompt here lifts it; messages from the chat room wait" · "server unreachable · retrying in <duration> · last contact <time> (<ago>)", "as of <time>" · "Polling stopped: this session was removed from <room>, or the room was archived; the server does not say which. /blabber enable <room> tries again." with the row "stopped polling" · "Blabber is off in this session. /blabber enable <room> joins a room." · "Blabber is not configured. Put endpoint and tokenFile into ~/.pi/agent/blabber.json." + "A token is issued in the dashboard: Account → Access tokens." · key hints "esc close · w wake mode · a accept mode · d disable · ↑↓ select · ⏎ details" (with a selection "⏎ hide details"; a long roster adds "PgUp/PgDn scroll"; narrow "w wake · a accept") | `pane.js` `pane`, `rosterLines`, `recentLines`, `youLine` |

## 8. What the mockup does not settle

Do not infer these from the site.

- **Data.** Every name, handle, host, model, session id, message, time, count and room is invented
  (`site/app/data.js`); so are the token names and users of the account pages (the module's development fake,
  `site/account/fake-server.js`), and the token secret's format (N22). The 30-day retention, the "14:05" of stale
  marks and the "40 s" or "34 s" waits are examples.
- **Timing.** The mockup has no clock: no heartbeat, reconnect back-off, polling of the roster (20 s) or catch-up
  (60 s), presence ageing, debounce, or time-outs. Follow design section 9.5 and the precedents it names. The
  simulated send in `site/app/main.js` (a pending message that turns into a sent one after 900 ms with an outlook
  cycled through fixed words) is a demonstration, not behaviour.
- **Animation and motion.** Only the shared components' spinner, skeleton shimmer and the pulsing connection dot
  appear; no transitions of drawers, pills or popovers were designed.
- **Performance and size.** No virtualisation, page sizes, limits of loaded history, or behaviour with thousands of
  messages or participants were drawn.
- **Behaviour that is stubbed.** Buttons that would talk to a server do nothing or open the view that shows their
  result: Reply always opens view 5d; Copy link, Leave room, Retry, Reconnect, Reload, Join (outside the dialog),
  Message directly, the search form and filters do nothing; links in messages point to invented addresses; view 9g
  shows a placeholder line instead of the room's newest messages. The keyboard and focus handling in
  `site/app/mockup.js` (`wire`: menus, Escape order, focus return after a dialog, drawer toggling, the floating
  position of the identification popover `placeIdent`) shows the intended behaviour but is not code to reuse.
- **Message text formatting.** `render.js` `body`/`inline` is a sketch of the look of the safe Markdown subset;
  build it on the safe formatter of the other dashboards' transcript, not on this parser.
- **Account pages.** They ran as the real shared module against its development fake (section 1), not against a
  server; behaviour against Blabber's account HTTP code is unverified. Password, two-factor, sign-up, recovery and
  enrollment pages were not drawn for Blabber; they are the module's own.
- **Breakpoints.** The narrow layout switches at 720 px (the shared `sm` breakpoint); 900 px (room list rows) and
  1100 px (narrower rail and roster) are the mockup's. The "Phone 390" frame imitates a phone width with container
  queries (`site/app/phone.css`, generated) because the publishing host forbids frames; in it, dialogs open over
  the whole page. Real devices, Firefox, Safari, screen readers and IME were not tested.
- **The pane.** Group 12 is drawn as HTML text with token colours (`site/app/pane.js`, `mockup.css`). Build it with
  `@ponygirls/pi-ui` and `CONVENTIONS.md` (colour by `stateColor`, columns by the pane rules); exact column widths,
  the 100- and 60-column examples and the wrap points are illustrations.
- **Unchosen options.** Variants b and c of the choices, Q207 options 2 and 3 (view 9h), Q209 option 2 and the notes
  N3, N21, N23, N27, N28 describe things that are not built.
- **Contract gaps.** Section 6.2: until the contract carries G1 to G9, the screens that depend on them cannot be
  built as drawn.
