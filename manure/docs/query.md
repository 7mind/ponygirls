# Shared dashboard and MCP query expressions

The dashboard expression field and MCP `search` tool use the same dialect.
`search` accepts only `query` (required string), `limit` (optional positive
integer) and `cursor` (optional string). The existing MCP `list_artifacts`
tool and structured Python `list_artifacts` / `search` parameters remain
available. Python also exposes `ManureClient.search_expression(query,
limit=..., cursor=...)`, which compiles the same expression into current typed
`CatalogueQuery` or `SearchQuery`; it does not add a wire protocol.

## Fields and defaults

| Field | Values | Scope |
| --- | --- | --- |
| `mode` | `catalogue`, `lexical`, `semantic`, `hybrid` | Default `catalogue` |
| `access` | `internal`, `external`, `public` | All modes |
| `state` | `ready`, `uploading`, `publishing` | Catalogue only |
| `expired` | `true`, `false` | Catalogue only; default `false` |
| `sort` | `name`, `created_at`, `expires_at`, `total_bytes`, `file_count`, `visibility`, `state`, `kind`, `created_by_user` | Catalogue only; default `created_at` |
| `direction` | `asc`, `desc` | Catalogue only; default `desc` |
| `kind` | `file`, `dir` | Retrieval only |
| `owner` | Exact creator user ID (case preserved) | Retrieval only; nonblank |
| `text` | Exact underlying search text | All modes; excludes bare search terms |

Field identifiers are case-insensitive; closed values are exact lowercase.
All metadata filters **conjoin**. This is not a Boolean language over metadata:
parentheses, `OR` and `NOT` in bare retrieval text belong to the existing
retrieval engine, not to the metadata parser. Never express alternatives as
`access:public OR access:internal`: duplicate fields are rejected.

Catalogue text is the backend's literal case-insensitive name/artifact-ID
substring filter. Retrieval searches authorized artifact metadata and manifest
paths, not file bytes. Lexical mode uses the existing English retrieval syntax;
semantic/hybrid require the configured provider and can report
`search-unavailable`, with no silent lexical fallback. Retrieval results retain
the backend's evidence, ranking, count scope and approximate candidate semantics.

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
mode:lexical access:internal kind:dir owner:"Exact User" "quarterly report"
mode:lexical text:"(\"cat  dog\" OR bird) NOT fish"
text:"mode:hybrid"
```

`text:` always decodes its JSON string, preserving its exact internal and leading/
trailing whitespace; it cannot be combined with bare search terms. Empty catalogue
expressions are valid. Retrieval requires nonblank text (empty/whitespace-only
quoted bare tokens do not count). Default catalogue hides expired artifacts and
sorts newest first. Continue catalogue pages with the same expression and limit;
restart pagination after changes. Retrieval rejects any supplied cursor, including
an empty one.

## Bounds and failures

The entire source expression is limited to 4096 UTF-16 code units. Valid Unicode
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
`createdByUser`, `sort`, `direction`, or an `error` message. Parser fixtures do
not establish browser interaction or real-provider semantic quality.
