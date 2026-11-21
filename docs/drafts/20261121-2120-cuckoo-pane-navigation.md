# Cuckoo pane navigation

Base `3505965a`; developed on branch `task/cuckoo-pane-nav`. Paths under
`.local/` are in the main checkout and are not tracked.

**State (2026-11-21): implemented.** Decision Q131 was answered with variant A
and no extras. The decision was made on a mockup page published as Manure
artifact `311dfbaa2178612f725f4894b101ff03` (public, expires 2027-01-20); its
sources are under `.local/cuckoo-pane-nav/mockup/`. Decision Q132, about what
the list view shows after Escape, was answered after the merge with option A:
keep it as built.

## Request

1. Enter in the request list focuses the report view; while it is focused the
   arrows navigate it; Esc returns to the request list.
2. The comment focus (item cursor) could be combined with arrow scrolling;
   Tab/Shift-Tab may stay.
3. Think about what else can be improved in the pane.

## Observed (current pane, real terminal)

Pi 1.5.2 under tmux 3.8, `env -i`, disposable agent/session directories, only
the Cuckoo extension and a scripted in-process provider; fullscreen at 110×34
and 80×24, regular mode at 100×30. The captures shown in the mockup are
fullscreen with the dark theme and truecolor. Captures, the driver files and
the saved session: main checkout `.local/cuckoo-pane-nav/pty/` (`today/` holds
the captures shown in the mockup).

- `↑↓` (`j`/`k`) change the checkpoint and reset the report position. The
  report moves only by half pages (`PgUp`/`PgDn`, `^U`/`^D`), to its ends
  (`Home`/`End`) or with the wheel. There is no line-wise key.
- The pane title, a blank row, the table header, its rule, three rows and the
  `1–3 of 4` row are 8 fixed rows. At 80×24 the report gets 10 rows, 4 of them
  its own header, and 6 rows while a comment is written.
- An objective of the sample report is 20 lines at 80 columns. Tab selects it,
  the next Tab jumps past it; the rest is reachable only by paging.
- Once scrolled, the report has no title under the table, and nothing shows
  how much is hidden above or below.
- Baseline on the base commit, local loop: typecheck clean, 568 tests, 568
  pass (`.local/cuckoo-pane-nav/baseline-tests.log`).

## Proposed design

Two focus states. Everything not listed keeps its present meaning in both.

| Key | List focused (initial) | Report focused |
|---|---|---|
| `↑↓`, `j`/`k` | select checkpoint (as today) | next/previous item, or one line (rule below) |
| `⏎` | focus the report | nothing |
| `esc`, `q` | close the pane (as today) | back to the list |

- Unchanged in both states: `tab`/`shift-tab` (item cursor), `PgUp`/`PgDn`,
  `^U`/`^D`, `Home`/`End`, `c`, `x`, `i`, wheel, left click on an item. The
  comment editor and every close path are unchanged.
- The item cursor is kept across focus changes and cleared only when the
  checkpoint changes (as today). Focusing the report places it on the first
  item on screen when it is not on screen; "on screen" is the view Enter was
  pressed in, before the table folds away.
- A focus change keeps the report where it is: its first visible line stays
  first as far as the size of the view allows, and Enter followed directly by
  Escape returns to the same view. As proposed this read "never moves the
  report"; that cannot hold in two places (see "Differences from the approved
  page").
- Hints per state. List: `↑↓ select  ⏎ detail  PgUp/PgDn scroll detail
  tab/shift-tab item  c comment  [x remove new comment]  i inquire now
  esc close`. Report: `↑↓ item  PgUp/PgDn page  c comment  [x …]  i inquire now
  esc back`. A checkpoint without items (invalid or empty report) shows
  neither `c comment` nor `tab/shift-tab item`, and `↑↓ scroll` in the report.
  A pane without checkpoints shows `i inquire now  esc close`.
  Precedent for the words: the decisions pane (`⏎ detail`, `esc back`).

### Arrow rule in the focused report

Let the view be body lines `[top, bottom)` and items be line ranges
`[start, end)`. For `↓` (`↑` is the mirror image):

1. No item on screen: scroll one line.
2. The cursor is not on screen: it moves to the first item on screen (`↑`: the
   last), without scrolling.
3. The cursor item continues below the view: show the rest of it. When its
   beginning is below the top of the view, scroll by
   `min(end - bottom, start - top)`, which shows all of it when it fits;
   otherwise (it fills the view) scroll one line.
4. Otherwise, with a next item: scroll by the same amount for that item when it
   ends below the view, and move the cursor to it. When that scroll would not
   bring the item on screen (the lines in between fill the view, which takes a
   view of one or two rows), scroll one line and leave the cursor.
5. Otherwise (last item, shown to its end): scroll one line.

No step moves the view by more than its own height, so no body line is skipped
in either direction; this matters when a section heading (`Standing
questions`) lies between the view and a next item taller than the view. The
cursor never moves to an item that is not on screen. A step ends with the
report: at its first or last line it changes nothing. In the mirror image an
item taller than the view is entered at its end.

How the rule got here:

- The first version, the one the published page and Q131 describe, had neither
  the bound nor step 1. A property check of the mockup model
  (`.local/cuckoo-pane-nav/mockup/check-rule.mjs`), first run after the page
  was published and the decision answered, found a walk that skipped the line
  between two items in a small view. Reading the rule while correcting it
  showed a second defect: with no item on screen the cursor moved to an item
  outside the view, a key press without visible effect. The published frames
  are the same under both versions (the regenerated page was byte-identical).
- The second half of step 4 was removed for a while: a mutation that deleted it
  passed every test, and the difference was taken to be invisible. The review
  showed how to see it: after such a step, turning back scrolls the previous
  item into view without its cursor bar. It is back, with a test for that
  sequence.

Rejected: arrows always scroll one line and the cursor follows the view.
Reaching the third item on screen would mean scrolling it to the top, and a
report that fits has nothing to scroll. Rejected: a line cursor; reading a long
report would take one key press per line before the view moves.

### Layout (variants in Q131)

- **A (recommended; chosen).** The table is shown only while the list is
  focused and no comment is being written. The report has a fixed title line: `Checkpoint
  4` under the table, `Cuckoo checkpoint 4 of 4` when the table is hidden
  (`Answer`/`Cuckoo answer` in history), with `↑ lines 13–30 of 65 ↓` on the
  right when the report does not fit (the format of `scroll-state.ts`). The
  wrapped `── Checkpoint 4 (id) · …` line at the top of the body becomes one
  muted line with the request id and the present metadata. `1–3 of 4` moves
  into the pane title and the blank row after it goes. At 80×24: 11 report
  rows in list focus, 18 in report focus, 13 while writing.
- **B.** Same keys, title and header, but the table stays while the report is
  focused: 12 report rows at 80×24. Needs an unfocused style for the selected
  row and a focused style for the report title.
- **C.** Keys and hints only; header and layout as today.

Optional extras: E1 `←`/`→` older/newer checkpoint in the focused report;
E2 `⏎` in the focused report comments on the cursor item; E3 a click on a
table row selects that checkpoint.

Not proposed: age and first objective in the table instead of the request id;
`showReports` receives no timestamps today.

## Implementation

`src/view.ts` only.

- The pane state gains `focus`. `stepItem` implements the arrow rule next to
  `moveNode` (Tab keeps its own rule). `compose` builds the header for the
  state and returns the report's titles; `buildParts` appends the title rule,
  whose scroll position needs the view.
- Titles that do not fit are not cut: the report title gives up `Cuckoo`, then
  the position; the pane title gives up the list position (`fittingTitle`).
- `TableItem.label` became the table's `noun`; the ordinal is the row number.
- Enter is matched as `tui.select.confirm`, like Escape as `tui.select.cancel`.
  Ctrl+C is bound to the same cancel action, so it also goes back one level
  from the report instead of closing the pane.

The fold changes the height of the view after a key was handled, because Pi's
layout engine sizes the body. Four things follow from that:

- **Return to the view.** Enter remembers where the list view stood
  (`returnTop`); any other key, a press, click, drag or wheel that reaches the
  pane, or a change of width forgets the line. The Escape that directly
  follows returns there. This is what makes Enter then Escape return to the
  same view at the end of a report, where the taller view could not keep it.
- **Selected item.** After Escape the view is shorter. A selected item that
  was on screen when Escape was pressed, and that the shorter view puts off
  screen, is brought back.
- **Table rows.** A host that sizes the pane to its content lays it out
  shorter while the table is hidden. `maxTableRows` keeps its last count until
  a layout pass has drawn the table again (`heightHasTable`, set in the
  callback the layout calls). The pass that draws it again asks for one more
  frame, which counts from the height as it is now: the terminal may have
  changed while the table was hidden, and nothing else requests that frame
  when the report fits.
- **Title position.** It is clamped to the report, because the layout engine
  clamps its offset after the header was drawn and requests no frame for that.

The first two are applied by `viewAfterLeaving` once: in the first frame whose
view has another height than the report view had when Escape was pressed
(`leaving`). Before that frame the layout would clamp the offset; after it the
view is the user's again, so scrolling is never undone. The next input ends
what is pending, applied or not.

Rejected: keeping the chosen offset and applying it again on every frame, and
asking for the pending offset on every frame until the next input. Both need
less state, but by Pi's source they undo scrolling that Pi does on the scroll
view directly (a wheel that reaches no component, a text selection dragged
past the edge). The second was built first; a test that scrolls the scroll
view directly reproduced the undoing.

Drawn without the layout engine (tests, and the frame before the first
layout), the pane now keeps its offset within the report, as the engine's
scroll view does. Both drawing paths then behave alike, which the paired tests
rely on.

A notice (for example `New comment removed.`) stands where the count of new
comments was and keeps that line's rows. Otherwise the key that clears the
notice could move the view by a height the view no longer has.

Not done: the scroll-position format is a second copy of `scroll-state.ts`'s.
The extension check copies only the extension directory, so the top-level
module cannot be imported. A third user would justify moving it into
`@ponygirls/pi-ui`.

## Differences from the approved page

The page is the design Q131 approved. The built pane differs from its text in
these places; no approved frame is affected.

1. **Arrow rule.** The page says "inside an item taller than the view, and
   before the first or after the last item, they scroll one line". Built: also
   one line while no item is on screen; no step larger than the view; a cursor
   item that the view cuts off is completed in one press when it fits. The
   reasons are in "How the rule got here".
2. **"Changing focus never moves the report."** Built: its first visible line
   stays first as far as the size of the view allows, and Enter followed
   directly by Escape returns to the same view. Two exceptions:
   - At the end of a report the taller view cannot start where the shorter
     one did, so Enter shows more of what precedes it.
   - After Escape (not directly after Enter) the shorter view follows the
     selected item when it was on screen and would otherwise be hidden. This
     one is a choice; decision Q132 kept it as built. The alternative that
     was not chosen keeps the first line and lets the selection leave the
     screen, after which `c` comments on the first item on screen instead.
     The cost of the built behaviour: Escape then Enter does not restore the
     earlier report view exactly (the cursor is kept; the text starts up to
     the height of the table further down). A third option, to remember the
     report view at Escape so that a directly following Enter returns to it,
     was offered and not chosen.
3. **Narrow widths**, which the page does not show: titles shorten instead of
   being cut (see Implementation).
4. **Hints of an empty pane**: `i inquire now  esc close` only. The page says
   that `c comment` and `tab/shift-tab item` go when a report has no items; a
   pane without any checkpoint has nothing to select or scroll either.
5. **A notice keeps the rows of the count of new comments**: at widths under
   76 columns a short notice leaves one blank row above the hints.

## Verification

Source identity: branch `task/cuckoo-pane-nav` on base `3505965a`; pinned Node
24.22.2, TypeScript 7.0.2, Pi 1.5.2.

- Baseline: typecheck clean, 568 tests pass.
- Tests first: `tests/view-navigation.test.mjs`, 17 cases at that point, 15
  failing on the base code for the expected reasons (no focus, old hints, no
  title, table shown). The two that passed were about click selection and were
  too weak; see the review below.
- Existing view tests: 39 of 40 passed unchanged. One assertion in
  `REPRO: detail header wraps at narrow width preserving all metadata` required
  the qualifier on one line; the metadata line now starts with the request id
  and wraps elsewhere. The test now joins wrapped lines before matching, which
  is what its comment states; all four metadata checks are kept.
- Review. A read-only reviewer (agent `1328a028-3a07-47cc-bd27-46c8c32dafcf`,
  run `50a69a66`) read the change against the Pi TUI sources and reported five
  findings; its result was cut after the findings, in the list of what it
  found correct. Each finding was reproduced by a failing test before the
  correction (`.local/cuckoo-pane-nav/fail-first-review.log`):
  1. In a pane sized by its content, Enter then Escape on a short report left
     the table with one row and a moved window. Reproduced (`2–2 of 5` instead
     of `1–3 of 5`); corrected ("Table rows" above).
  2. From the end of a report, Enter moved the view and Escape did not return.
     Reproduced in the layout-engine path; corrected ("Return to the view"
     above) for the return, stated as a difference for Enter. Related: Enter
     judged "on screen" by different views in the two drawing paths; now the
     view the key was pressed in, in both.
  3. An arrow pressed while a notice was shown could skip a line going up,
     because clearing the notice took a row from the view after the step was
     chosen. Reproduced (the `Standing questions` heading was never shown);
     corrected at its source, the footer.
  4. One assertion that could not fail, and a click test that passed without
     the feature. Both replaced.
  5. Three statements in the README and in this note that the code
     contradicted, among them the claim that a removed branch of the rule
     could not be seen. Corrected; the branch is back (step 4 of the rule).
  The same session found one more defect while the review ran: after Escape
  the shorter view could hide the selected item, so that `c` commented on
  another one. Reproduced in both drawing paths; corrected ("Selected item").
  The first correction of that brought back an item the user had scrolled away
  from in the report; reproduced by a test and corrected (`hold`).
- Second review, of the corrections (same agent, run `4e4b50a5`): the four
  corrections hold in the layout-engine path, traced pass by pass; no blocking
  defect; three low findings and one point for the owner (Q132, since
  answered: keep as built; see "Differences", item 2). Each finding was again reproduced by a failing test
  first where it concerned behaviour (`fail-first-review2.log`):
  1. A table that returns after the terminal grew kept its old row count until
     the next key when the report fits. Reproduced (`1–1 of 5` in a pane with
     room for three rows); corrected (the extra frame under "Table rows").
  2. Half of the content-sized test could not fail for its reason. Removed.
  3. Two gaps in the documents: the frame after Escape, now under "Known
     limits", and the exception for Escape directly after Enter, now in the
     README.
  The reviewer also named one way past the pending state (a wheel over an
  overlay that covers the report). The pending state is now applied once
  instead of on every frame, with a test that scrolls the scroll view directly.
- Now 42 cases in `tests/view-navigation.test.mjs`: both focus states, the
  arrow rule in both drawing paths (every line of a report shown top to bottom
  and back in views of 1 to 38 rows, items taller than the view, a tall item
  after a section heading), completion of an item the view cuts off, adoption
  after scrolling away, a step at the end of the report, what a focus change
  keeps in view (middle and end of a report, the selected or clicked item, an
  item scrolled away, a change of width, that what is pending ends with the
  next key or wheel, and that scrolling the scroll view directly is not
  undone), a one-row view turning back, the fold while writing, a pane sized
  by its content (also after the terminal grew), a notice and an arrow in one
  press, titles and positions, narrow widths, reports without items, history,
  and Pi's fullscreen key path with its layout engine.
- Mutation check of those tests: 37 deliberate defects in `src/view.ts`, in
  the arrow rule, the focus changes, the titles, the hints and the mechanisms
  under Implementation. Five were not detected when first run: tests were
  added for four (the bound, the completion in one press, and the two ways
  the pending state ends); the fifth is the branch discussed under "How the
  rule got here", detected since the review. All 37 are detected on the final
  code.
- Local: typecheck clean; 610 tests, 610 pass, 0 failed/skipped/cancelled.
- Real terminal (tmux 3.8 PTY, `env -i`, disposable directories, scripted
  provider, saved session with four checkpoints, dark theme). Pi exited with
  status 0 each time. Captures and action logs are in the main checkout under
  `.local/cuckoo-pane-nav/pty/`.
  - Before the review corrections (`after/`): fullscreen at 80×24 reproduced
    the eight steps of the mockup with the same scroll positions; also list
    selection, PgUp/PgDn, Home/End, Tab/Shift-Tab, `q`, `x`, an SGR mouse click
    and wheel in the focused report, resizes to 110×34, 62×20, 52×20 and 40×20,
    regular mode at 100×30 and `/cuckoo history`. The run at 40×20 showed the
    pane title cutting the list position to `·…`; corrected and covered by a
    test.
  - After the first review's corrections (`final/`): the eight steps again,
    same positions; the sequences of the review's findings.
  - On the final code, `src/view.ts` sha256 `7ebc0251…` (`final2/`,
    `final2-regular/`): the eight steps a third time, same positions. Escape
    from the report with objective 2 selected in its lower rows: the list view
    follows it (`lines 28–38`); two wheel notches afterwards move the report
    and it stays there. From the end of the report: Enter shows `48–65`,
    Escape returns to `55–65`, the frame equal to the one before Enter. A
    session of five reports without objectives, pane opened by a click on the
    badge at 80×40 (the pane is then sized by its content): Down, Enter,
    Escape gives a frame identical to the one before Enter, table `1–3 of 5`.
    The same pane opened at 80×14 has a one-row table; Enter, resize to 80×40,
    Escape: the table has three rows. Regular mode at 100×30: Enter, four
    arrows, Escape (`16–33`, objective 2 visible, `c` comments on it), End,
    Enter, Escape (equal frames), Tab, and `/cuckoo history` with Enter,
    arrows and Escape.
- Nix, on the final tree (`.local/cuckoo-pane-nav/nix-check-final.log`): of the
  100 flake checks, 14 have another derivation than on the base commit,
  because they take the extensions tree as input. All 14 were built and pass:
  `ponygirls-cuckoo` (typecheck; 610 tests, 610 pass, 0 failed, 0 skipped),
  `ponygirls-subagents` (853), `ponygirls-bg-tasks` (154), `ponygirls-pi-ui`
  (75), `ponygirls-model-picker` (62), `ponygirls-model-stats` (48),
  `ponygirls-usage` (36), `ponygirls-codex-limits` (27),
  `ponygirls-codex-risk-retry` (25), `ponygirls-pi-settings` (23),
  `ponygirls-openai-fast` (20), `pi-claude-code-subagents` (7),
  `ponygirls-historian` (5) and `ponygirls-quirk-kimi-401-retry`.
  `subagents-policy-shape`, which the README names, has the same derivation as
  on the base commit and was reused. The package `ponygirls-pi-extensions`
  builds. `scripts/verify` does not apply: the change touches none of
  Chronicle, Haystack, Manure or `shared/`.
- Not exercised in a real terminal: IME, bracketed paste, font rendering, a
  text selection dragged past the edge of the report.

Known limits:

- After a fold or unfold the position in the title is computed from the
  previous frame's view height; the layout pass that changes the height
  requests the next frame (16 ms later at Pi's render interval), which shows
  the right numbers.
- For the same reason the first frame after Escape still shows the report at
  the offset of the focused view; the return to the remembered line, or the
  move to the selected item, comes with the next frame.
- Without an allocated height PgUp/PgDn move one line (present on the base
  commit). Fullscreen and regular mode both allocate; only tests draw without.
- The mockup model has the arrow rule as corrected right after the decision
  and none of the later changes. It differs from the pane in the rest of what
  is listed under "Differences from the approved page" and in Enter with no
  item on screen (the model takes an item outside the view).

## Mockup provenance

"Today" frames are terminal captures of the base commit. "Proposed" frames
come from `.local/cuckoo-pane-nav/mockup/` (`model.mjs`, `generate.mjs`), which
reuses `checkpointBlocks` and the `@ponygirls/pi-ui` kit with Pi's dark theme
and handles no terminal input. They show intended rendering, not behaviour of
the extension inside Pi's layout engine.
