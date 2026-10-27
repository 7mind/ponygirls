# Filter expression UX

Build an editing surface, not a syntax manual: one editable expression, useful
inline shortcuts, predictable application and truthful results. CQ/GitHub-like
is an interaction reference, not a universal grammar, dependency choice or
permission to copy another product's code.

## Establish the language and scope

Read the actual parser, request types, editor helpers and behavior tests first.
Record fields per target, quoting/escaping, precedence and implicit conjunction,
groups, repeated fields, global directives, empty queries, date boundaries and
Unicode/byte limits. Distinguish metadata filtering from full-text/approximate
search. Different targets need not accept the same grammar. Share representative
parser/editor fixtures; do not infer syntax from placeholder text.

## Direct actions, exact composition

- Put common filter/field shortcuts beside the input. Insert real syntax and
  focus the relevant value. An anchored value picker can help; a modal syntax
  manual is not the primary workflow. Keep examples/help secondary.
- Distinguish inserting a snippet from applying a filter. Keep the expression
  editable; chips and previews are derived views, not another query store.
- Loaded-row suggestions are not exhaustive facets or global counts. Permit
  arbitrary valid values where the grammar permits them.
- Use one grammar-compatible literal encoder and declared field identifiers.
  For every allowed value, decoding its encoding must recover the exact value.
  Cover quotes, backslashes, whitespace, colons, delimiters, operator words,
  controls and non-BMP text. JSON escaping is correct only for a JSON-literal
  dialect. Reject unsupported values; never silently trim, normalize or shorten.
- Conjoin with the entire Boolean body: in an AND/parenthesis dialect, adding
  a constraint to `A OR B` requires `(A OR B) AND <clause>`. Use a parser,
  serializer or proven lexical helper, not splitting on spaces/colons.
- Preserve global directives outside new groups. Refuse unsafe composition of
  unfinished quotes, operands, groups or conflicting directives with a local,
  actionable error. Do not silently repair a different executable query. Local
  structural checks do not establish server field-policy validity.
- Preserve the opaque Boolean body unless a rewrite is proven safe. Even
  Boolean-equivalent rewrites can change approximate candidate discovery.
- Never derive a filter from clipped rendered text. Clip previews visually if
  needed, but retain and insert the complete underlying value.

## Draft, applied query and displayed results

Keep these states distinct. Typing, completion and snippet insertion edit the
draft; they must not run result searches unless live application is explicitly
required. Hints are a separate read path. Search/Apply captures one exact
expression for editor and request state; do not submit stale state immediately
after setting it. Applied query/sort/scope changes invalidate old cursor chains
and selection, not unrelated editors. Refresh/theme changes do not submit drafts.

Provide a named in-field clear/reset control. Decide whether it clears only the
draft or also applies the empty query, and update those states coherently. Keep
input focus. Document its shortcut and Escape precedence: dismiss the innermost
suggestion/value popup first without changing the query or closing its parent;
only a subsequent, documented action may reset the search. Do not steal Escape
from IME composition or an enclosing dialog.

## Authoritative, bounded completion

Prefer deterministic grammar/vocabulary plus authorized metadata. Do not call
LLMs, embedding providers, transcript search or raw-content readers per keystroke.
An incomplete draft may be completable without being executable. The server owns
field applicability, visibility and final validation. Authorize every hint
request, including static suggestions; scope caches by principal/security epoch
and complete target/scope.

Debounce and bound requests/results. With one request in flight, coalesce to the
latest desired request instead of queueing keystrokes. Fence replies by exact
text, caret/selection, target/scope, connection/security generation and request
identity; cancellation alone does not exclude stale replies. Invalidate hints
on incompatible edits, selection, composition, blur, target or authority changes.
Late replies must not reopen dismissed popups or restore old-account data. Clear
sensitive state at account/session boundaries; do not replay prior-owner queries.

Treat responses as edits: replacement range, complete insertion and relative
caret. Validate their shape, offsets and resulting query limits before offering
or accepting them. Labels are presentation, not insertion text. Omit uninsertable
candidates whole, disclose omissions and never shorten a literal to meet a budget.
Hint failure must not prevent manual editing or imply that the query is invalid.

## Caret, keyboard and accessibility

Declare coordinate units end to end: browser selections use UTF-16 code units,
parser diagnostics may use Unicode scalars, visual movement uses graphemes, and
budgets may count UTF-8 bytes. Validate integral, ordered, in-bounds offsets;
reject surrogate-pair splits and unpaired surrogates. Replace the full indicated
token/value, preserve outside text exactly and restore the caret. Handle
same-text/caret-only acceptance without leaving a pending command for later
keystrokes. Support selections deliberately or suppress non-collapsed completion.

During IME composition suppress hint requests, acceptance and form submission.
Guard native composition/key events and component state. Resume from committed
text; synthetic events alone do not prove real IME behavior.

Define and test:
- Up/Down select an option, keep it visible and retain input focus.
- Enter inserts the active suggestion without submission; otherwise submits the
  draft, except during composition.
- Escape dismisses the innermost popup, consumes that action and preserves the
  query/parent dialog. A late reply must not undo dismissal.
- Tab/Shift+Tab traverse focus normally without silently accepting a value.
- Pointer/touch insert the full chosen value and preserve intended focus/caret.
- The search-focus shortcut targets the intended active editor; document
  select-all behavior and overlay precedence.

Use a labelled combobox with list autocomplete, accurate expanded/controls/
active-descendant state, a uniquely identified listbox and selected options.
Keep DOM focus in the input and active IDs valid as results change. Announce
useful status without trapping focus or relying on color alone. Give overlays
predictable dismissal and focus restoration.

## Truth and verification

Distinguish no suggestions, no results, loading, unavailable hints, invalid query,
stale prior results and authorization loss. Rejected queries must not present
old rows as successful results: clear them or identify their previous query and
stale status. Preserve drafts and useful diagnostics with correct coordinate
mapping. Never silently change fields/modes or invent zero counts.

Use `constructive-test-taxonomy` for test placement; prefer public behavior.
Verify encoder/parser/editor round trips, precedence/directives, malformed and
injection-shaped literals, Unicode/byte boundaries, exact outside-text retention
and same-text caret acceptance. In controlled browser journeys check shortcuts,
Apply, reset, keys, pointer, nested Escape, focus, mid-token editing, selections
and composition. Assert exact text, caret, requests and non-submission.

Exercise deferred replies across edits, dismissal, scope, reconnect and
account/revocation changes. Verify real authorization/provider-free paths, not
only UI stubs. Inspect long/clipped values, empty/error states, option scrolling,
narrow viewports, zoom and supported themes. Use a real IME/screen reader when
those behaviors are acceptance criteria. Report executed checks and unverified
cases: parser tests or screenshots alone do not prove interactive correctness.
