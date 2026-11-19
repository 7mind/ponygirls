# Shared dashboard and MCP query expressions

The dashboard expression field and MCP `search` tool use the same dialect.
`search` accepts only `query` (required string), `limit` (optional positive
integer) and `cursor` (optional string). The existing MCP `list_artifacts`
tool and structured Python `list_artifacts` / `search` parameters remain
available. Python also exposes `ManureClient.search_expression(query,
limit=..., cursor=..., notify=...)`, which compiles the same expression into
current typed `CatalogueQuery` or `SearchQuery` and returns an `ExpressionSearch`
(`mode`, `mode_explicit`, `notice`, `page`, `pending_note`); it does not add a
wire protocol.

## Mode selection

The dashboard, the CLI and MCP `search` choose the mode as follows:

- An explicit `mode:` is never substituted. An unavailable explicit mode is an
  error (`search-unavailable`) with the server's reason.
- Without `mode:`, no search text, any catalogue-only field (`state`, `expired`,
  `sort`, `direction`) or a continuation cursor selects `catalogue`.
- Otherwise search text selects `hybrid` when `GetCapabilities.searchModes`
  offers it, and `lexical` otherwise. A defaulted hybrid request answered
  `search-unavailable` is re-run once as `lexical`. Each substitution produces
  the notice `Hybrid search is not available on this server: <reason>; showing lexical results`, where the reason is
  `semantic retrieval is not configured` (capabilities without hybrid, or that
  server reason) or `query embedding failed`; any other server message is never
  shown and the reason is the code `search-unavailable`.
- A semantic/hybrid page with `pending > 0` adds the note `1 item is` / `N items
  are not yet indexed for semantic search; results may be incomplete`. `pending`
  counts sources whose current version is not indexed yet; an older indexed
  version of such a source may still be returned until it is replaced.

The effective mode is always reported: CLI human output starts with
`Mode: <mode>`; the notice and the pending note go to stderr (before the lexical
re-run, and in `--json` mode too, whose stdout stays the page with its `pending`
field). MCP `search` results add `mode`, `notice` and `pending_note` to the page
JSON (text content and `structuredContent`); a failed lexical re-run returns the
error with its `notice`. The dashboard's list status ends with the effective mode
(`N hits · lexical`) and shows the notice or the pending note above the results;
an unavailable explicit mode is refused before any request. As for every
retrieval, a defaulted query opened from a URL waits for Search.

| Expression | Capabilities / server answer | Effective mode |
| --- | --- | --- |
| `quarterly report` | hybrid offered | `hybrid` |
| `quarterly report` | lexical only | `lexical` + notice |
| `kind:dir tag:release report` | hybrid answered `search-unavailable` | `lexical` + notice |
| `state:ready report`, `access:public tag:release`, empty | any | `catalogue` |
| `report` with `--cursor` / `cursor` | any | `catalogue` |
| `mode:semantic report` | lexical only | error `search-unavailable` |

## Fields and defaults

| Field | Values | Scope |
| --- | --- | --- |
| `mode` | `catalogue`, `lexical`, `semantic`, `hybrid` | Default: see [Mode selection](#mode-selection) |
| `access` | `internal`, `external`, `public` | All modes |
| `tag` | Exact tag; repeat up to 32 distinct tags (AND) | All modes |
| `hostname` | Exact source hostname | All modes; nonblank, at most 253 Unicode scalars |
| `project` | Exact project path | All modes; nonblank, at most 4096 Unicode scalars |
| `state` | `ready`, `uploading`, `publishing` | Catalogue only |
| `expired` | `true`, `false` | Catalogue only; default `false` |
| `sort` | `name`, `created_at`, `expires_at`, `total_bytes`, `file_count`, `visibility`, `state`, `kind`, `created_by_user` | Catalogue only; default `created_at` |
| `direction` | `asc`, `desc` | Catalogue only; default `desc` |
| `kind` | `file`, `dir` | Retrieval only |
| `owner` | Exact creator user ID (case preserved) | Retrieval only; nonblank |
| `text` | Exact underlying search text | All modes; excludes bare search terms |

Field identifiers are case-insensitive; closed values are exact lowercase.
All metadata filters **conjoin**. Tag, hostname and project values are
case-sensitive exact matches: no trimming, case folding, path canonicalization,
prefix matching or host resolution. Each tag must be nonblank and at most 128
Unicode scalars. `tag:Release tag:release` requires both tags; repeated identical
tags and duplicate hostname/project fields are errors. This is not a Boolean language over metadata:
parentheses, `OR` and `NOT` in bare retrieval text belong to the existing
retrieval engine, not to the metadata parser. Never express alternatives as
`access:public OR access:internal`: duplicate fields are rejected.

Catalogue text is the backend's literal case-insensitive substring filter over
name, artifact ID, tags, hostname and project path. Retrieval searches authorized artifact metadata and manifest
paths, not file bytes. Lexical mode uses the existing English retrieval syntax;
semantic/hybrid require the configured provider and can report
`search-unavailable`; only a defaulted hybrid falls back to lexical, visibly.
Retrieval results retain the backend's evidence, ranking, count scope,
approximate candidate semantics and `pending` count.

## Quoting and text

Tokens are separated by whitespace. A value is an unquoted run without whitespace,
colon or quote, or a complete JSON string. JSON escapes (`\"`, `\\`, `\n`,
`\uXXXX`, etc.) are validated. Quotes cannot be embedded in an unquoted token.
Use JSON quoting for literal colons: `text:"https://example.test"`.

Bare tokens join with one space, preserving spaces inside quotes. In catalogue
mode, whole quoted bare tokens decode: `"quarterly  report"` searches the
literal text `quarterly  report`. In retrieval modes their raw JSON spelling is
preserved, so `mode:lexical "quarterly  report"` passes the quoted phrase to
the retrieval engine. Use `text:` when exact text matters, when quotes adjoin
parentheses/operators, or when data looks like a metadata field:

```text
access:public state:ready sort:name direction:asc report
mode:lexical tag:release hostname:build-host project:"/work/project" access:internal kind:dir owner:"Exact User" "quarterly report"
mode:lexical text:"(\"cat  dog\" OR bird) NOT fish"
text:"mode:hybrid"
```

`text:` always decodes its JSON string, preserving its exact internal and leading/
trailing whitespace; it cannot be combined with bare search terms. Empty catalogue
expressions are valid. Retrieval requires nonblank text (empty/whitespace-only
quoted bare tokens do not count). The catalogue hides expired artifacts by
default and sorts newest first. Continue catalogue pages with the same expression and limit;
restart pagination after changes. Retrieval rejects any supplied cursor, including
an empty one.

## Bounds and failures

The entire source expression is limited to 131072 UTF-16 code units; the compiled
search text is independently limited to 4096 UTF-16 code units in every mode.
`text:` JSON escapes are decoded before this text limit; bare retrieval phrases
retain their raw JSON spelling as described above, which counts toward the text
limit. Metadata does not consume the search-text budget. Valid Unicode
surrogate pairs are supported; unpaired surrogates in source or decoded JSON
values are rejected. Python `QueryError.start` / `.end` are UTF-16 offsets for
selection in the browser. MCP/client expression errors use `bad-query` with a
generic actionable message and UTF-16 range where applicable. They do not echo
query literals or cursor contents. Invalid expressions do not start a client
request or provider call. Unknown fields, duplicate fields, malformed JSON,
invalid closed values and unsupported mode/filter combinations fail explicitly.
No field is silently ignored or reinterpreted as search text.

`tests/fixtures/query-expressions.json` is the shared cross-language contract:
each array entry contains `name`, `query`, and either an `expected` plan with
`q`, `mode`, `visibility`, `itemState`, `includeExpired`, `kind`,
`createdByUser`, `sort`, `direction`, `tags`, `hostname`, `projectPath`, or an
`error` message. Cases without search text or with a catalogue-only field need
no `mode:`; text cases state `mode:catalogue` explicitly.
`tests/fixtures/query-defaults.json` specifies the default rule itself: each
entry adds `modeExplicit` and an optional `continuation` (a cursor was given).
The Python and dashboard parsers check both fixtures. Parser fixtures do not
establish browser interaction or real-provider semantic quality.
