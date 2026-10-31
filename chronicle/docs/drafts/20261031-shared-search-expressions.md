# Shared Archive and Search expressions

Archive and Search use the same server-parsed expression language and authorized HEAD universe. Search renders source cards rather than the Archive table; it does not translate expressions into the narrower MCP `search_sessions` filters.

```text
mode:hybrid (project:"chronicle" OR project:"ponygirls") AND NOT tag:"archived" AND "migration"
mode:lexical agent:subagent AND yolo-profile:"work" AND branch:"feature/search"
mode:semantic "how publication fencing works"
```

Both editors share field shortcuts, authorized value completion, syntax help, clear/Escape behavior and Cmd/Ctrl-K. Mode is a global outer-AND directive: `mode:lexical`, `mode:semantic` or `mode:hybrid` (default). `(A OR B) mode:lexical` is valid; `A OR B mode:lexical` is not. Invalid expressions reach the server unchanged; no client parser repairs or narrows them.

Fields are `project`, `branch`, `tag`/`tags`, `user`, `producer`, `format`, `model`, `agent`, `yolo-profile`, `status`, `after` and `before`. Boolean AND/OR/NOT, adjacency, parentheses, braces and quoting have Archive semantics. Dates follow the same server grammar: `after` is inclusive and `before` exclusive, not the previous separate Search form's inclusive-through-day conversion.

## Execution and counts

Archive retains its live 350ms debounce and remembered column/relevance order. Search submits only on Enter/Search. Its shortcuts and completion edit the draft without executing retrieval; clearing Search clears the draft/results without submitting another query. Suggestions themselves do not invoke models. Explicit semantic/Hybrid text execution can invoke query embeddings.

Search uses `ArchiveSearch(ArchiveQuery)` with ten-card pages, LastTimestamp Desc as its browsing tuple and relevance preferred for positive text. It receives the actual `ArchiveResult` plus bounded source representatives. Counts retain signed-i64 precision. Empty, metadata-only, mode-only and negative-only expressions need not have positive textual evidence. Unindexed HEADs remain eligible.

Lexical matching is Archive's PostgreSQL Unicode-lower literal substring membership in normalized HEAD source/metadata, not English websearch stemming. Semantic operands each use bounded compatible published ANN candidates. Hybrid includes the unbounded exact lexical union. The ANN budget is per-operand **chunks**, not a cap on result rows; Hybrid or complement counts can exceed it. NOT means outside the defined retrieved set, not proof of semantic unrelatedness. Ordering, cursor bindings and scope labels come from the same Archive kernel.

Next/Previous retain cursor positions for explicit replacement pages. Counts/order/visibility can change between requests; neither cursor history nor client navigation freezes a corpus or guarantees exhaustive enumeration under concurrent changes.

## Source cards

Card metadata describes HEAD. At most two representative positive source spans are returned per conversation; these are not an exhaustive explanation or proof of every Boolean operand. Each representative has its own immutable `ContentView`, source span, operand, literal/semantic kind and optional separately labeled generated annotation. HEAD lexical support and an older published semantic witness may coexist without merging their revisions or messages.

The browser reads bounded original text using `ReadMessageContext` with that exact pin. Literal locations are mapped back to original UTF-8 scalar boundaries on the server; folded Unicode offsets are not reused as source offsets. Returned spans, BOMs, roles and adjacent context retain the existing fidelity checks. Oversized spans receive explicit bounded partial previews, not fabricated full matches.

A metadata/negative match may have no message span. Its title still opens the explicit representative/published/HEAD pin selected from the returned row; no arbitrary first chunk is labeled a match. Opening a representative excerpt uses that excerpt's pin, not another witness's revision. Retired, denied or mismatched source reads fail closed; they do not redirect to current HEAD. Source failures and stale replies retain owner/connection/resource-generation fences. Current same-session authority failures clear an open source across pins; view-local errors remain pin-specific for the directly selected result. A related dialog chooses its own pin internally, so a current failure for that dialog's effective session clears it conservatively without assuming the original opener's pin. Failures for other sessions do not clear the dialog.

Server evidence selection shares the Archive query's repeatable-read transaction and actual candidate sets. Source materialization and result limits are explicit errors rather than truncation or silent row omission. Existing context, MCP, native-tool and trace budgets are not enlarged.

## Protocol and MCP boundary

The owned deployment retains its self-contained sole API 1.9 schema, as specified in `CONTRACT.md`; generated codecs are compiler output. Dashboard and server must ship together for the new `ArchiveSearch` operation. No historical codec compatibility layer is added.

MCP `search_sessions` remains unchanged: published-only English websearch/semantic/Hybrid retrieval with its existing structured filters, result/count contract and JSON-default/text-opt-in presentation. It does not acquire the Archive DSL implicitly. This UI work does not change embeddings, annotation policy, eligibility, source storage, index profiles or MCP ranking.

## Verification scope

Controlled browser tests establish UI/protocol behavior, including full expression forwarding, mode completion, explicit submission, count precision, cursor navigation, independent source pins and fail-closed source reading. Real PostgreSQL tests establish shared-kernel parity, candidate provenance, original Unicode source locations, authorization and admission. Neither is a claim of improved semantic quality, a real-provider acceptance result or production deployment.
