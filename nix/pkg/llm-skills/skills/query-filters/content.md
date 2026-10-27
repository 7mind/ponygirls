# Filter languages and query editors

Build an editing surface, not a syntax manual: one editable expression, useful
inline actions, predictable application and truthful results. CQ/GitHub-like is
an interaction reference, not a universal grammar, dependency choice or permission
to copy another product's code.

## 1. Establish the contract before editing

Read the actual parser, request types, editor helpers and behavior tests. Record:
- Fields per target; literal quoting/escaping and keyword case; precedence,
  implicit conjunction, groups, repeated-field semantics and global directives.
- Empty-query/default-view policy, date boundaries, text matching semantics,
  Unicode/byte limits, token count and nesting limits.
- Metadata versus full-text/approximate search; local versus remote evaluation;
  explicit Apply versus live application; query privacy and sharing policy.

An illustrative Boolean dialect is:

```text
query       := empty | expression
expression  := conjunction (OR conjunction)*
conjunction := unary ((AND)? unary)*
unary       := NOT unary | '(' expression ')' | atom
atom        := word | quoted-string | attribute ':' value
```

Do not copy it over an existing language. Negation sigils, braces, unquoted
backslashes, keyword-shaped values, JSON escaping and comparison operators are
**dialect choices**. Share one authoritative grammar/semantics per declared
dialect across clients; share parser code where practical, otherwise use common
contract fixtures. Lenient editing analysis is not a competing executable parser.
Do not silently replace established syntax or public compatibility contracts.

Define empty and default scope explicitly. If mentioning an attribute overrides
a default predicate, specify what mentions inside NOT/OR/groups mean and test it.
State whether text means literal substring, normalized words, quoted phrase or
approximate candidate membership; labels must not promise stronger matching.

## 2. Typed attributes, a pure core and authorized adapters

Centralize attribute name, type, description/examples, value parser, matcher or
query-plan rule, and completion vocabulary policy in a registry. Parser,
completer, hints and docs should derive from it rather than drift independently.
Typical types include closed vocabulary, boolean, numeric/count comparisons,
identifiers, exact labels and text. Use only operators the domain supports.

Where the grammar recognizes an attribute expression, unknown attributes and
invalid **typed/closed** values should produce actionable errors, not silently
reinterpreted text or a fabricated empty result. Literal colons follow the
dialect's quoting/escaping rules. Open-vocabulary
values absent from loaded rows are not necessarily invalid. Declare equality,
case sensitivity and normalization per type; opaque IDs are not automatically
case-insensitive prefixes. Count comparisons can replace ad-hoc flags when an
explicitly scoped language design/migration calls for them, not by default.

Keep syntax/encoding/edit analysis deterministic and testable. A local evaluator
may be `matches(ast, item)`; a remote engine may compile a plan instead. Put clocks,
DOM, database/HTTP and metadata acquisition behind adapters. Do not download the
whole authorized universe to make a remote filter look like a local pure engine.
Authorize metadata acquisition and every hint request, including static hints.
Loaded-row values are neither exhaustive facets nor global counts.

## 3. Diagnostics and conservative query edits

Give diagnostics an actionable message, code and precise span where the protocol
supports it. Prefer the first useful error over a wall of cascading errors;
missing end input can use a zero-width span. Declare coordinate units and map
server scalar/byte positions to browser UTF-16 correctly. Keep the draft; a click
on a positioned diagnostic may select its corresponding input range.

Use one grammar-compatible literal encoder and declared field identifiers. For
every supported value, `decode(encode(value)) == value`. Test quotes, backslashes,
whitespace, colons, delimiters, operator words, controls and non-BMP text. JSON
escaping is correct only for a JSON-literal dialect. Reject unsupported values;
never silently trim, normalize or shorten them. Never build filters from clipped
rendered text: retain the complete underlying value.

Conjoin a new constraint with the **entire** Boolean body: in the example dialect,
`A OR B` becomes `(A OR B) AND <clause>`. Preserve global directives outside new
groups. Use the dialect's parser/serializer or a proven lexical helper, not regex
splitting on spaces/colons. Refuse unsafe composition of unfinished quotes,
operands, groups or conflicting directives with a local error; do not silently
repair a different executable query. Local structure checks do not establish
server field/value-policy validity.

Inline field/value shortcuts insert real syntax and return focus to the relevant
value. Keep help secondary; a syntax manual is not the primary workflow. Chips
are derived views of the query, never a second filter store. An AST-aware toggle
may group same-attribute alternatives only when that is the declared semantics.
Do not determine chip activity by substring presence under NOT/OR, or rewrite
arbitrary expressions to manufacture a toggle state. Preserve outside text and
the opaque Boolean body unless a rewrite is proven safe: even Boolean-equivalent
rewrites can alter approximate candidate discovery.

## 4. Completion is a bounded, context-aware edit contract

Use lenient tokenization/analysis to locate attribute, value, operator and group
sites, including incomplete drafts. Offer only syntactically appropriate next
steps: no closing group without an opener or disjunction after a missing operand.
Prefer likely joining operators after a complete term, then applicable fields
and term starters; describe field types/examples near the current suggestion.
Quoted-value completion is a dialect/implementation capability, not universally
forbidden. If unsupported, suppress it deliberately rather than corrupt quoting.

A response carries kind, display label/detail, replacement range, **full insertion
text** and insertion-relative caret. Replace the whole touched token/value,
including its suffix; preserve an existing colon. Insert a separator after a
completed term where needed, but not after an opener such as `field:`. Absorb
following whitespace only inside the declared replacement range; preserve all
outside text exactly. After insertion, analyze the new caret for the next step.
Labels and clipped previews are never insertion data. Counts/details must name
their authorized scope; omit unavailable counts rather than invent zero.

Validate shape, integral/ordered/in-bounds offsets, scalar-safe boundaries and
resulting query limits before offering/accepting an edit. Omit uninsertable
candidates whole, report truncation and never shorten a literal to meet a budget.
Expected in-progress diagnostics can be softened while a known completion can
resolve them, but do not hide unrelated or authoritative domain errors. The absence of
completion diagnostics does **not** prove executable-query validity.

Prefer grammar/vocabulary plus authorized metadata for hints. Do not invoke LLMs,
embedding providers, transcript search or raw-content readers merely to complete
a keystroke. Scope metadata/hint caches by principal, security epoch and complete
target/scope; cached candidates never substitute for required current authorization.
Debounce and bound requests/results; with one request in flight,
coalesce to the latest desired state. Fence replies by request identity, exact
text, caret/selection, complete target/scope, principal/security epoch and
connection generation. Cancellation alone is not a stale-reply fence. Invalidate
incompatible hints on edits, selection, composition, blur, target or authority
changes; late replies must not reopen dismissed popups or revive old-account data.
Hint failure must not prevent manual editing or imply query invalidity.

## 5. Draft, application and displayed results are distinct

Completion/snippets edit the draft. Search/Apply captures one exact expression
for editor and request state; do not submit stale state immediately after setting
it. Choose the product's application policy explicitly. When dynamic results are
chosen, use **debounced, latest-only live application**: keep typing responsive,
apply the exact settled draft, and make the pending/submitted/result distinction
visible. Enter can flush the current eligible intent; declare whether explicit
Search also requests authoritative diagnostics for an incomplete original draft.
Neither path may submit during composition or execute a rewritten query.

For remote execution, bound starts, not only state commits: one unsettled request
plus one replaceable unsent intent across query, sort, page and refresh changes.
Keep physical admission across logical key changes and navigation within its
connection lifetime. Each queued intent owns its captured request and promise;
never give a new query the active query's result as generic single-flight reuse.
Settle superseded intents explicitly, not as fabricated empty successes. Coalesce
refresh into an already-unsent current read rather than issuing it again afterward.
Cancellation, timeout and disconnect do not prove backend/provider work stopped;
state the actual bound rather than promising bounded billing or cancellation.

Withhold structurally incomplete drafts from automatic execution using lenient
editing analysis. Continue scanning past earlier complete-invalid literals so a
later unfinished quote, group, escape, operand or field continuation is not missed.
Do not reject complete date literals merely because they contain colons. Complete
unknown fields/typed values/modes still reach authoritative validation unchanged;
absence of completion errors is not validation. Keep semantic/hybrid costs and
admission explicit; do not silently add per-keystroke provider work or force a
cheaper search mode. Hints remain a separate provider-free editing service.
Refresh/theme changes must not submit an unsent draft.

Keep the submitted query and query/scope owning displayed rows explicit. While
editing an incomplete draft, retained results may remain tied to the prior
applied query. On rejection, clear rows or identify their prior query/stale state;
never present them as successful results for the rejected expression. Last-valid
retention never overrides authorization loss: erase denied data immediately.
Applied query/sort/scope changes invalidate old cursors and selection, not unrelated
editors. Clear sensitive state at account/session boundaries; never replay a
prior owner's query.

Provide a named in-field clear/reset control. Decide whether it clears only the
draft or also applies the empty query; update both coherently and retain focus.
For live application, clear cancels obsolete debounce/queued intents immediately;
applying the empty query still obeys physical admission and cannot resurrect an
older draft. A flushed Enter or clear must not fire again when its timer expires.
URL sharing and persistence are explicit privacy/product decisions, not defaults.
Do not put private filters in URLs, logs or browser storage without authorization.
Where enabled, use a reversible query/view encoding, principal/view scoping,
retention/clear rules and observable handling of unavailable storage.

## 6. Caret, keyboard, geometry and accessibility

Browser selections use UTF-16 code units, parser positions may use scalars/bytes,
and visual movement uses graphemes. Reject surrogate-pair splits and unpaired
surrogates; count UTF-8 budgets separately. Restore the caret after exact edits.
Handle same-text/caret-only acceptance or reset immediately, without leaving a
pending command to corrupt later typing. Support selections deliberately or
suppress non-collapsed completion.

During IME composition suppress hints, acceptance, automatic execution and form
submission, including pointer Search. Guard native composition/key events as well
as component state; resume from committed text. If explicit reset is available,
it must cancel composition and apply the documented empty query, never interim
text; otherwise defer it. Synthetic composition events do not prove real IME behavior.
Define and test:
- Up/Down select an option, keep it visible and retain input focus.
- Enter inserts an active suggestion without submitting; otherwise follows the
  product's Apply/live policy, never submitting during composition.
- Tab/Shift+Tab traverse focus normally unless an explicit, accessible acceptance
  policy deliberately changes this; do not silently steal standard traversal.
- Escape dismisses the innermost popup, consumes that action and preserves the
  query/parent dialog. Only a subsequent, documented action may reset the query.
- Pointer/touch insert the full value with intended focus/caret. Prevent pointer
  focus transfer when necessary; hover may move the active option.
- Search-focus and optional on-demand completion shortcuts target the intended
  editor and respect overlay precedence; document select-all behavior.

Use a labelled combobox, accurate expanded/controls/active-descendant state, a
uniquely identified listbox and selected options. Keep DOM focus in the input and
active IDs valid as results change. Link diagnostics and announce useful status
without trapping focus or relying on color. A token-anchored popup can improve
context: measure actual typography and input scrolling, and clamp/flip within the
viewport; a simpler input anchor is acceptable if it remains clear and reachable.
Give overlays predictable dismissal and focus restoration.

## 7. Verify behavior, not just text sent to an input

Use `constructive-test-taxonomy` for test placement; prefer public behavior.
- Parser/type/evaluator-or-plan fixtures: precedence, keyword handling, quoting,
  repeated fields, defaults under NOT/OR, unknown/invalid values, exact diagnostic
  spans including end-of-input, length/token/depth and Unicode/byte boundaries.
- Encoder/edit/completion fixtures: round trips, whole-token replacement at every
  caret site, existing colons/spacing, incomplete/quoted contexts, injection-shaped
  literals, outside-text preservation and same-text caret acceptance. Use bounded,
  deliberately terminal completion journeys; repeatedly choosing the first option
  need not converge. A partial completion need not already be an executable query.
- Chip on/off behavior under the declared semantics, including NOT/OR/groups;
  require original text retention where promised, otherwise proven semantic and
  outside-edit equivalence rather than blanket canonicalization.
- Controlled browser journeys: shortcuts, Apply/live policy, reset, arrows,
  Enter/Tab/Escape, pointer, nested overlays, focus restoration, mid-token edits,
  selections and composition. Assert exact text/caret, requests and non-submission.
- Controlled-time live journeys: burst typing before/at the debounce boundary,
  Enter flush and immediate clear without duplicate timers, incomplete prefixes
  after complete-invalid literals, and valid colon-containing dates. Hold an
  active read while replacing several queued queries, sorting and refreshing;
  only the latest unsent request may start afterward. Include held cursor and
  multi-page refresh chains, tab unmount/remount and owner changes with pending
  timers/queued reads. Verify stale replies cannot append, reopen or cross owners.
- Deferred replies across edits, dismissal, target/scope, reconnect and account/
  revocation changes; real authorization/provider-free adapter checks, not only
  UI stubs. Distinguish no suggestions/results, loading, unavailable hints, invalid
  query, stale results and denial.
- Inspect rendered long/clipped values, active-option scrolling, popup geometry,
  diagnostic selection, narrow viewports, zoom and supported themes. Use a real
  IME/screen reader when those are acceptance criteria.

Report executed checks, observed outcomes and unverified cases. Parser tests or
screenshots alone do not establish interactive correctness.

## Optional reference

[cq4](https://github.com/pshirshov/cq4) supplies another language/editor design to
compare: its query-language design, parser/completer, browser editor and validation
notes. Inspect the chosen revision and license before reuse. Its escaping, live
application, key bindings and persistence policies are examples, not this skill's
universal contract.
