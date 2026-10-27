# Ergonomic filter languages and query editors

> **Reference implementation:** https://github.com/pshirshov/cq4
>
> - `docs/design/query-language.md`: the grammar, the attributes, diagnostics and completion contract.
> - `core/src/main/scala/cq/core/QueryParser.scala` and `QueryCompleter.scala`: parser and completer.
> - `web/src/query.ts`: the browser editor (popup, keyboard, diagnostics, live search).
> - `docs/validation/m3-query-*.md` and `m5-query-editor.md`: how each part was verified.

These are agent guidelines for building a filter that people can type fluently, not a form of dropdowns. The filter is one text box with a small typed query language. Behind it sits one pure engine that parses, evaluates and completes the query. The editor around it shows what is possible, what is wrong and what will happen.

The guidance does not depend on the stack. Examples use a generic issue tracker with `status`, `assignee`, `label`, `comments` and title text.

The four parts depend on each other:

1. **Language.** A small grammar whose mistakes are reported, never silently reinterpreted.
2. **Engine.** Pure functions from text (and cursor) to an AST, a match, completions and hints.
3. **Editor UX.** A popup, hints, inline errors and chips that all edit the same text.
4. **Verification.** Table tests for the engine and a real-browser drive for the editor.

---

## Part 1: The language

### L1. Use one grammar for every client

Copy this grammar; it is the GitHub/Gmail-style idiom users already know.

```text
query       := expression | empty
expression  := conjunction (OR conjunction)*
conjunction := unary ((AND)? unary)*
unary       := (NOT | -) unary | '(' expression ')' | atom
atom        := word | quoted-string | attribute ':' value
value       := word | quoted-string
```

- **Precedence:** `NOT`/`-` binds tightest, then `AND`, then `OR`. Terms written side by side mean `AND`.
- **Keywords** ignore case (`or`, `Or`, `OR`). To search for the word itself, quote it (`"not"`).
- **A dangling keyword** (a bare `NOT`, `bug AND`, `a AND OR b`) is an error that says how to search for the word: `Expected a term: OR is a Boolean operator; quote it ("or") to search for the word`.
- **Same parser everywhere.** The CLI, the API and the browser accept the same text and run the same parser. A second, "simpler" parser in one client is how dialects begin.

### L2. Lex strictly

- **Token delimiters:** whitespace, `(`, `)`, `:`, `"`, and a leading `-`.
- **Quoted strings** use JSON escaping (`"say \"hi\""`).
- **A backslash in an unquoted word** is an error. There is no second escaping scheme to learn.
- **Keyword-shaped values.** When a value contains a delimiter, starts with `-` or is a keyword, the language requires quotes. The completer inserts it already quoted (see C3).

### L3. Unknown attributes and bad values are errors, never text

`colour:red` must not quietly become a text search for "colour:red" that matches nothing. Report `Unknown attribute "colour": the attributes are status, assignee, label, comments, title; quote text that holds ':'`.

Likewise `status:dun` reports the known statuses, and `comments:lots` says a count was expected. A filter that silently empties the list is the worst outcome: the user concludes there is no data.

### L4. Give attributes types, and keep them in one registry

Each attribute has a type that decides how its value parses, matches and completes:

| Type | Example | Matching | Completion offers |
|---|---|---|---|
| closed vocabulary | `status:open` | exact, case-insensitive | the vocabulary, each with its count |
| boolean | `has-assignee:true` | exact | `true` and `false` with counts |
| count | `comments:>5`, `comments:3` | `N`, `>N`, `>=N`, `<N`, `<=N` | comparators first, then the counts present |
| identifier | `id:4d05` | prefix, case-insensitive | known ids, labelled with their titles |
| exact label | `label:"needs review"` | exact; decide case sensitivity explicitly | the labels present |
| text | bare word, `title:timeout` | state it: substring or normalized words | nothing |

Declare every attribute **once**, in one registry entry:
- name;
- one-line type;
- description;
- examples;
- value parser;
- matcher;
- value enumerator for completion.

The parser, evaluator, completer, hint panel and documentation all read that entry. A new attribute is then one entry, and the five parts cannot drift apart.

Prefer comparisons on counts over boolean shorthands. `comments:>0` replaces a `has:comments` flag, and `comments:>=10` comes free. If you are replacing an older ad-hoc syntax, map it to the grammar and delete it rather than keep both. Typical replacements:

| Old | New |
|---|---|
| `status:a,b` | `(status:a OR status:b)` |
| `is:open` | `status:open` |
| `has:x` | `x:true` or `x:>0` |

### L5. Diagnostics carry a span and a sentence

- **Report the first error only**, with a **half-open span** in the editor's own offset unit. In JavaScript that is UTF-16 code units, matching `selectionStart`. Missing input at the end gets a zero-width span there.
- **The message says what was expected,** and lists the legal choices when there are few.
- **Bound the input:** length, token count, and nesting depth (cq4 allows 16 levels of brackets and negations), so a pasted query cannot exhaust recursion.

### L6. Define empty and implicit scope explicitly

An empty query selects everything, or a documented default view.

If a default predicate exists (for example "hide archived items"), apply it only when the query never mentions that attribute. cq4 adds `archived:false` unless `archived:` occurs anywhere, so `NOT archived:true` and `x OR archived:true` keep their stated meaning.

### L7. Say what text matching means

Decide, and document in the hint, whether bare text:
- matches a case-insensitive substring of the title (or id); or
- requires every normalized word, with quotes meaning a contiguous phrase.

Users test a filter by typing part of a word. The behaviour must be predictable from the hint.

---

## Part 2: The engine (pure functions)

Write the engine as pure, deterministic functions with no I/O, the clock or the DOM:

```text
parse(text)                       -> { ok: true, query } | { ok: false, diagnostic }
matches(query, item)              -> boolean
complete(text, cursor, items)     -> { suggestions[], more, hint, diagnostic, completing }
toggleValue(text, attr, value)    -> text           // for chips (U6)
```

A suggestion is `{ kind, label, detail, text, span }`:
- `kind` is attribute, value or operator.
- `detail` is "3 issues" or a title.
- `text` is what gets inserted, and `span` is the half-open range it replaces.

Pure functions are table-testable, and the same functions can run on a server or in the page.

### C1. Find the cursor's site from the tokens before it

Tokenize the text up to the cursor in a lenient mode that tolerates an unclosed quote. Classify the position:

- **Inside quoted text:** offer nothing.
- **An attribute name** (a `:` follows the token): attribute names only.
- **A value** (the previous tokens are `attr` `:`): that attribute's values.
- **A term position:** operators and attributes (C4).
- **Past a token that cannot be read:** nothing; the diagnostic speaks.

### C2. Replace the whole token around the cursor

The span covers the entire token the cursor touches, not just the text before the cursor. Completing `stat|us:open` replaces `status`, not `stat`, and keeps the existing colon instead of inserting a second one. Value insertions are escaped and quoted by the same rule as L2.

### C3. Order suggestions for the next likely step

At a term position, offer in this order:

1. After a complete term, the joining operators: `AND`, `OR`, and `)` only when a bracket is open.
2. Attributes, inserted as `name:`, each with its one-line type as detail.
3. The term-starting operators: `NOT` and `(`.

Some refinements:
- An all-capitals prefix (`N`) asks for an operator, so operators move to the front.
- After `-`, only `(` makes sense.
- Never offer `)` without an open group, or `OR` directly after `AND`.
- After `attr:`, offer the attribute's values with how many current items match each (`open · 12 issues`).
- For counts, offer the comparators first, then the counts present (`>40 · 2 issues`).
- Cap the list (cq4 uses 50) and report `more`.

### C4. Space after a completed term

A suggestion that **completes a term** inserts one trailing space: a value, `)`, `AND`, `OR`, `NOT`. If whitespace already follows the token, widen the span over it instead of adding another, so no double spaces appear and the caret lands ready for the next term.

A suggestion that **opens** something inserts no space, because the next keystroke belongs to it: an attribute name (`status:`), `(`, a comparator (`>`). After any insertion, re-run completion at the new caret so the popup presents the next step.

### C5. Keep a mistake apart from text still being typed

While the text is invalid only because its last token is unfinished (`status:`), the parse diagnostic and the suggestions overlap. Set `completing = true` when some suggestion's span covers the diagnostic's span. The editor then hides the error while the popup can fix it, and shows it once the popup closes or no suggestion applies.

---

## Part 3: The editor

### U1. Make the popup behave like a combobox

- **Anchor** it under the token being completed, not at the left edge of the input. Measure the text before the token with the input's own font.
- **Keys:**
  - ↑/↓ move and wrap;
  - Enter or Tab inserts;
  - Esc closes and leaves the text alone;
  - Ctrl+Space opens it on demand.
  - Enter with the popup closed applies or submits.
- **Mouse:** hover highlights; a click inserts. Handle `mousedown` with `preventDefault` so the input keeps focus and the caret.
- **Async responses:** debounce completion requests (about 150–200 ms) when the engine runs remotely. Tag each request with a generation counter and drop stale answers.
- **IME:** do not complete during IME composition (`compositionstart` to `compositionend`).
- **Accessibility:**
  - the input: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`;
  - the list: `role="listbox"`, with `role="option"` items;
  - `aria-describedby` points at the diagnostic.

### U2. Show the attribute hint

Beside or under the list, show the hint of the highlighted attribute, or of the attribute whose value is being typed: name, type, one-line description, and two or three examples. Users learn the language from it; no separate help page is needed for the common case.

### U3. Show errors inline, at their position

- **Under the input:** the message, plus a mirror of the query with the faulty span highlighted. Clicking either selects that span in the input.
- **Keep the text:** never discard what the user typed, and never clear it on error.

### U4. Keep the last valid filter while the text is invalid

While the user edits through invalid states, keep filtering with the last query that parsed, and say so (for example "12 of 80 · last valid filter"). The list then does not flash empty on every keystroke.

If the engine runs on a server, submit live only texts that the completion analysis found free of diagnostics. This is cq4's live-search rule.

### U5. Apply local filters live

When the data is local, filter on every valid change; there is no Search button. When the data is remote, submit after a short pause (about 300 ms) and only valid text.

### U6. Chips and quick filters edit the same text

Status chips, label buttons and "mine" toggles are shortcuts that **edit the query text**, through `toggleValue`. They are not a second filter state:
- Toggling a second value of the same attribute merges it into `(status:a OR status:b)`.
- Toggling it off removes the term, and the bracket when one value remains.
- A chip shows as active exactly when the text contains that term.

The text stays the single source of truth, is shareable, and teaches the syntax by example.

### U7. Persist and share

Keep the query per view: in the URL for sharing, and in local storage for the next visit. Guard storage reads; storage can be unavailable. A clear (×) button resets to the empty query.

---

## Part 4: Verification

- **Parser tables:**
  - precedence (`a b OR c` means `(a AND b) OR c`; `NOT a b` means `(NOT a) AND b`);
  - keyword case;
  - quoting and escaping;
  - every diagnostic's message and exact span, including zero-width at the end;
  - nesting and length limits.
- **Evaluator tables:** each attribute type against representative items, including absent fields.
- **Completion tables:** `(text, cursor) -> [(label, text, span)]` for:
  - the start of the query;
  - after a term;
  - after `-`;
  - inside `( … )`;
  - mid-token, with the cursor inside the word;
  - before an existing colon;
  - after `attr:`, and after a comparator;
  - inside quotes;
  - at the end vs. before following text (C4 spacing);
  - capitals vs. lowercase prefixes.
- **Property:** applying the first suggestion repeatedly until none remain yields text that parses.
- **Chip round trips:** toggling on and off returns the original text.
- **The editor in a real browser** (Playwright, or CDP driving headless Chromium):
  - type, use the arrows, Enter, Tab, Esc and Ctrl+Space;
  - click a suggestion;
  - confirm focus and caret position after the insertion;
  - screenshot the popup on an attribute, on values, on operators, on an error, and in dark mode, and look at the screenshots.
  - Unit tests of the engine do not show the popup's position, focus loss or clipping.

---

## Pitfalls checklist

| Symptom | Cause | Fix |
|---|---|---|
| A typo in an attribute empties the list | unknown attributes fall back to text search | report them (L3) |
| `a,b` lists, `is:`/`has:` flags, one-off sigils | syntax grew feature by feature | one grammar (L1); map old forms (L4) |
| Completion leaves the tail of the word (`statusus:`) | replaces only the prefix before the cursor | whole-token span (C2) |
| Double colons or double spaces after accepting | insertion ignores what follows | keep the colon; absorb whitespace (C2, C4) |
| The user must type a space after every pick | no trailing space on completed terms | C4 |
| The error flashes while the user is still typing | diagnostic shown even though a suggestion fixes it | `completing` (C5) |
| The list flashes empty mid-edit | the filter applies invalid text as "no match" | last valid filter (U4) |
| A click on a suggestion loses the caret | the popup takes focus on click | `mousedown` + `preventDefault` (U1) |
| Chips and the text disagree | chips keep separate state | chips edit the text (U6) |
| Parser, completion and docs drift apart | attributes defined in several places | one registry (L4) |
