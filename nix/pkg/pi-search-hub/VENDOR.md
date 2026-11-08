# Vendored search hub

`src/` is maintained here directly, not as an upstream patchset. It was imported
from the previously packaged pi-search-hub output, based on ronnieops/pi-search-hub
commit `6dd5188` (Nix source hash
`sha256-3LcRegB1PkMjM9xEhZPk98h/2NrE0gFkgw0PaNMIwl0=`).
The former empty-reader-content, always-include-tier and source-provenance patches
and manifest correction are incorporated. Upstream declares MIT in package.json;
its CREDITS.md and historical documentation are retained.

## Automatic metasearch

Web and paper search use the same engine in `src/extensions/engine/`: one
scheduler, concurrency pool, deadline implementation, weighted rank fusion and
reranking pipeline. Domain adapters supply document identity, metadata merging
and exact-identifier matching; provider adapters supply retrieval.

- **Main:** `first` tries sources until the first **nonempty** response;
  `targeted` seeks `targetUsableSources` nonempty lists (default 3), immediately
  replacing failed/empty slots without a slowest-peer batch barrier; `all`
  schedules every main source. Root `mode` applies to both profiles. Existing
  web `combine`/`combineMode` controls are used when root `mode` is absent.
- **Always include:** sources named in `alwaysInclude` are scheduled alongside
  main in every automatic mode, not only after failures. They do not consume the
  main nonempty-source target, but do consume concurrency slots. The pane labels
  this tier "Always include"; older internal monitor records use `fallback`.
- **Native:** supported provider-hosted web search runs alongside both tiers;
  it uses the same pool/deadlines and does not consume the main target. It is not
  inserted into paper results as invented bibliographic metadata.

A named web `backend` or paper `source` isolates one source, but still uses the
shared scheduling/deadline/deduplication/ranking machinery. Candidate depth is
`min(maximum, max(minimum, ceil(multiplier * n)))`, default twice n with bounds
10–40, or a source's explicit `maxResults` (supported 1–50). This complete list is
requested from each selected source; provider APIs may impose lower limits or
return fewer candidates, whose actual counts remain observable. Final n is
applied only after shared fusion and reranking, not by fusing already-truncated
tier pages.

### Shared configuration

Root settings are common defaults. `papers` overrides the same profile schema;
root source/alwaysInclude entries for supported paper sources are inherited,
including their caps, boosts, deadlines and overlap policy. Unrelated web-only
sources are not sent to the paper adapters. Project settings merge global fields
and per-source entries. Paper SearXNG science is alwaysInclude by default; arXiv
joins alwaysInclude only when explicitly enabled. `papers.sources.NAME.enabled`
can override that profile's participation without changing web retrieval.

```json
{
  "mode": "targeted",
  "targetUsableSources": 3,
  "concurrency": { "maxConcurrent": 6, "perProvider": 2 },
  "timeouts": {
    "overallMs": 60000,
    "sourceMs": 30000,
    "alwaysIncludeMs": 8000,
    "nativeMs": 45000,
    "nativeGraceMs": 1000,
    "discoveryMs": 10000,
    "readerMs": 30000,
    "credentialMs": 5000
  },
  "candidates": { "multiplier": 2, "minimum": 10, "maximum": 40 },
  "ranking": { "rankConstant": 60, "rerank": "rrf", "titleWeight": 0.2, "bodyWeight": 0.1, "exactTitle": true },
  "sources": { "exa": { "boost": 1.2 }, "firecrawl": { "timeoutMs": 25000 } },
  "alwaysInclude": { "searxng": { "timeoutMs": 3000, "maxResults": 3 } },
  "papers": {
    "alwaysInclude": { "searxng": {} },
    "sources": { "arxiv": { "enabled": true, "timeoutMs": 15000 } }
  }
}
```

All execution timeout values are configurable; numbers above are defaults, not
hidden caps inside adapters. `sources.NAME.timeoutMs` overrides the tier default;
`alwaysInclude.NAME` overlays the matching source policy. The older
`backends.NAME.timeout` is honored when no source timeout is set. Reader precedence
is source override, backend override, then `timeouts.readerMs`. Timers accept
positive integer milliseconds through the platform timer range (2,147,483,647),
not an arbitrary 60-second maximum; native grace additionally permits zero.

The extension-owned pool is shared across simultaneous web, paper and reader
calls. Lowering limits does not kill already-running requests; new admissions
wait until occupancy is below the new limits. Sources using the same provider share its limit across domains. Source
budgets begin when scheduled, including pool, credential, cooldown and arXiv lock
waits. The overall budget includes native discovery and bounds subsequent work;
expired discovery cannot restart the clock or launch new retrieval. Native grace
is a separately configured maximum cleanup/usage-settlement interval after abort.
No automatic provider retries are introduced.

A deadline aborts owned work and bounds logical waiting. An uncooperative adapter
promise retains its physical pool slot until actual settlement; returning to the
caller does not establish remote transport cleanup. Slots are not invented by
forgetting pending work. This pool is per extension instance, not a distributed
rate limiter. arXiv has an additional shared-directory rate lock described below.

Results preserve completed sources on partial failure or overall expiry and
report `success`, `empty`, `failed`, `timeout`, `cancelled`, or `not-started`, with
reasons for queue/source/overall deadlines, caller cancellation or a satisfied
main target. Unattempted sources are not marked failed/healthy. Caller-cancelled
results remain errors even if some completed results are available.

Weighted RRF uses `sum(boost / (rankConstant + distinct-document rank))` with one
vote per source/document. `sources.NAME.redundantWith` can suppress that source's
extra contribution when specified sources (or `"*"`, any other source) found the
same work; provenance remains visible. No tier has an intrinsic ranking bonus.
`ranking.rerank: "lexical"` multiplies the fused score by
`1 + titleWeight * title-token-coverage + bodyWeight * body-token-coverage`.
`"rrf"` disables that multiplier; it is the common default. Exact URL/identifier
matches, then complete title matches when `exactTitle` is enabled, precede numeric
score in both modes. Body means web snippet/content or paper abstract/snippet.
These are transparent heuristics, not a semantic model reranker. Web result
details and paper output retain contribution/boost/lookup evidence.

Web URL identity preserves path/query case and slash semantics, removing
fragments. Paper identity is described below. See [the ranking investigation](eval/REPORT.md)
for the fixed RRF60 baseline; its evaluation is not evidence for arbitrary custom
boosts or lexical ranking quality.

### Native provider support

Verified adapter registrations are `openai`, `openai-codex`, `anthropic`, `xai`
and the pinned pi-xai `grok-build` provider. Their explicit backend names are
`native:PROVIDER`. The old search backend `openai-codex` selects
`native:openai-codex`; it never substitutes API-key billing for a subscription.

This is an explicit adapter catalog, **not exhaustive detection of every
provider capable of search**. Google/Vertex grounding and arbitrary compatible
endpoints are not yet supported. Provider-native tool contracts, model support
and presentation requirements need separate adapters. Unsupported configured
models of supported providers remain visible as unsupported, not healthy.

Discovery and nested inference use Pi's configured registry: authentication,
OAuth refresh, endpoints and headers remain authoritative. A compatible current
model is preferred, otherwise a verified candidate from the configured catalog
is selected. Only the search query is sent, not the conversation history. It is
losslessly framed as literal query data rather than a chat message, and hosted tool
use is required. A completed tool call alone is not retrieval proof; structured
source evidence is still required. Configured credentials do not establish
server-tool entitlement; account/proxy
restrictions appear as engine failures.

Results come only from structured native search sources/citation events, never
URLs invented in model-generated JSON. Source provenance is not a guarantee of
factual accuracy or live search quality. Anthropic paused server-tool turns are
reported as failures because normalized messages omit their continuation state.

Native calls use configurable `timeouts.nativeMs` and `nativeGraceMs` (defaults
45 seconds and one second). Managed calls leave actual stream settlement to the
shared pool while its logical deadline/grace bounds waiting. An uncooperative
stream produces an explicit usage-unavailable report and retains its pool slot;
returning does not prove transport cleanup. Settled
nested inference usage is included in tool results, including partial failure
and cancellation. SDK token-cost estimates do not include separate search-tool
fees. Query testing from the command pane is not a transcript tool execution and
does not add tool-result usage to session totals.

## Paper research

`paper_research` is a separate tool from `web_search` and `/websearch`, using the
same engine and inherited policy rather than an independent pipeline. It supports:

```json
{"action":"search","query":"retrieval augmented generation evaluation","mode":"all","numResults":10}
{"action":"read","id":"arxiv:1706.03762","query":"How does scaled dot-product attention work?"}
{"action":"related","id":"arxiv:1706.03762","intent":"efficient attention","mode":"citers"}
```

| Source | Default tier | Search | Read | Related |
|---|---|---|---|---|
| Firecrawl Research Index | Main | Dedicated paper abstracts index | Metadata / question-relevant passages | Similar, citers, references |
| Exa `publication` | Main | Scholarly publication retrieval | — | — |
| SearXNG `science` | Always include | Instance-configured science engines | — | — |
| Direct arXiv | Always include, opt-in | Atom API preprints | Metadata only | — |

Existing enabled Firecrawl/Exa/SearXNG backend settings and credential references
are reused. Explicit `papers.sources.NAME.enabled` overrides participation without
changing web search. Direct arXiv requires explicit opt-in. No inference from
native web-search models is used as bibliographic metadata. Available SearXNG
science engines and JSON access depend on the configured instance; it can return
non-paper science pages. A snippet remains a snippet, not a fabricated abstract.

Use the shared configuration above; profile-specific overrides use
`papers.ranking`, `papers.candidates`, `papers.sources` and
`papers.alwaysInclude`. The former paper-only `sources.NAME.tier` and
`papers.rerank` forms are rejected rather than silently ignored. A paper search
call's `mode`/`rerank` overrides that call only; web calls also expose `rerank`.
Paper read/related operations use the same provider pool and configurable
source/overall budgets. Async credential commands are abortable, bounded by
`credentialMs`, and never block the event loop with synchronous execution.

Ranking preserves normalized DOI/arXiv/PubMed identifiers, explicit crosswalks,
original distinct-document ranks and all retrieval paths. It does not merge
unrelated works merely because titles match. arXiv versions share work identity;
this is not a claim that versions or preprint/published text are identical.
RRF uses `sum(weight / (rankConstant + rank))` (default constant 60), one vote per source/work. A SearXNG hit on a
work found by another source retains provenance but contributes no extra term:
its upstream engine lineage may overlap. This conservative rule is not a claim
that the remaining indexes are statistically independent.

Source `boost` is an explicit finite positive multiplier (default 1).
The shared `ranking` settings control fusion and text weighting for both domains. Both modes prioritize exact normalized
identifiers, then complete normalized title matches, then fused/boosted score.
Title equality preserves word order, ignoring case, Unicode compatibility,
punctuation and whitespace; it requires at least three query tokens or an
explicitly quoted short title. Topical substring matches get no lookup priority.
This avoids cross-source agreement drowning out the exact paper requested by
title. Each returned paper includes `exactId`, `exactTitle`, RRF contributions,
text multiplier and final score (lookup priority is a separate ordering key). No citation-popularity, venue-prestige or unverified peer-review
boost is applied. These are transparent, uncalibrated heuristics; deterministic
tests do not establish semantic improvement over the web-search baseline.

Read defaults to Firecrawl; `source: "arxiv"` supports metadata inspection only,
not passage questions. Related-paper expansion currently requires Firecrawl and
uses its structural mode/intent ranking before the local ranking step. No silent
fallback to web snippets is presented as a successful passage read. A successful
empty search is distinguished from all-source failure; partial failures and
available provider notices remain visible. Metadata dates retain `dateKind`
(`created` for Firecrawl, `published` where supplied), rather than implying an
index creation timestamp is publication time. Structured results and model text
are bounded and disclose truncation. Search results are untrusted source data,
not instructions, verified facts or proof of peer review.

Direct arXiv serializes Pi clients sharing `~/.pi/agent/paper-arxiv` and waits at
least three seconds after the prior connection finishes. Operators must also
coordinate clients using different agent directories or machines; API limits
apply across all machines under their control. A retained `paper-arxiv/lock`
after a crash blocks access rather than guessing recovery. Stop all such clients
before operator recovery; do not delete `state.json` to reset the limiter. No PDF
redistribution or full-text scraping is added.

The configured SearXNG instance is an operator-trusted destination and may be
private/loopback, as in ordinary web search. Redirects are refused and credentials
are sent only to that configured endpoint. This does not permit arbitrary private
URLs through paper IDs or returned citations.

### Additional source candidates

- **OpenAlex:** broad works/author/DOI metadata and works search; a useful next
  independent adapter (https://docs.openalex.org/how-to-use-the-api/api-overview).
- **Semantic Scholar:** paper search and citation/recommendation graph; access,
  fields and rate policy need a dedicated adapter acceptance check
  (https://api.semanticscholar.org/api-docs/).
- **Crossref:** DOI/bibliographic lookup, publisher metadata and update information;
  better justified first as enrichment than as a highly weighted topical source
  (https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
- **PubMed:** direct biomedical retrieval would complement arXiv's domain coverage.
- **Serper Scholar:** not implemented without a verified current endpoint contract;
  ordinary Google results are not relabelled as a scholarly index.

These candidates are not advertised as implemented adapters. A scholarly
held-out relevance corpus is still needed to calibrate boosts and measure
candidate recall separately from final ranking.

## `/websearch`

The pane uses the shared `@ponygirls/pi-ui` layout/toggle components. Five tabs
are available: **Web stats**, **Paper stats**, **Fetchers**, **Test web**, and
**Test papers**. Paper testing dispatches scholarly search, not ordinary web
search with an academic query. Its readable results include paper titles, source
URLs/identifiers, authors/dates when supplied, abstract or snippet, sources and
ranking/lookup evidence; unqualified dates are not labelled publication dates.

Both statistics profiles use comparative tables, with sources as rows and one
header per tier group: active/nonempty-success/empty/failed/timeout/cancelled/last
outcome, observed last/total results and latency, plus resolved default source
deadlines/candidate caps/boosts. At narrower widths headers are abbreviated with
legends; tables that cannot fit become metric rows without silently clipping
scalar values. Current main and alwaysInclude sources (plus native web sources)
are distinguished from historical observations in their original tiers. Paper
statistics do not suggest that native web models or web combine controls are
paper-source capabilities. Never-attempted sources show unknown health, not
invented successful/failed requests. Configuration is not proof of entitlement.

The actual paper tool and pane share one paper service/monitor; source activity
from model tool calls and explicit panel tests therefore appears in the same
paper tables. Search, metadata-read and related-paper operations are observed;
reads count one retrieved paper, related/search calls count admitted paper hits.
Reader counts represent successful fetched pages. Counts are logical dispatched
operations, not queued work or physical connection occupancy. Authoritative
source outcomes update immediately, independently of slower peers and before
fusion; ranking failures cannot leave completed retrievals marked active.
Session replacement/reload resets these in-memory observations. Queries,
credentials, raw upstream errors and response bodies are not retained by monitors.

Policy explanations retain main selection and candidate budgets, alwaysInclude
limits, the shared pool, source/overall budgets, web discovery/native grace and
configured fusion/reranking. Default caps are not the last caller's count.
Configured preference is not presented as the next random/round-robin/scored
selection. Viewing metadata sends no search/read probes or nested inference,
resolves no paper credentials and acquires no arXiv lock; web registry discovery
still refreshes configured availability when the command opens.

Tab/Shift+Tab switches views; fullscreen mouse tabs work, while regular mode uses
mouse only when Pi's `regularMouse` is enabled. Test web and Test papers each have
an independent editor, query, result, scroll position and cancellation owner;
switching profiles preserves them and both may run concurrently through the
shared pool. Enter submits the active profile using the same service as its
corresponding tool. Background completions cannot overwrite the other result.
Arrow keys and Ctrl+PageUp/PageDown scroll. Ctrl+C cancels **all pane-owned tests**
from any tab; Escape/dispose closes the pane and cancels its tests, not unrelated
tool calls. Bare PageUp/PageDown work in regular mode; fullscreen reserves them
for transcript scrolling. Unsubscribed monitors and generation checks prevent
late completions from repainting disposed views. Output is bounded and terminal
control sequences are removed before display.

In non-TUI modes, `/websearch` returns separate `web` and `papers` snapshots with
safe engines, policy and statistics. These are observations, not provider probes.

Search and fetch no longer write status-bar entries, including at startup.
The former `showStatus` setting has no effect. `/search-setup` and the textual
`/search-status` remain available. The tool advertises configured engines directly;
the separate backend-rewriting extension has been removed.

## Validation

```bash
nix build .#pi-search-hub
nix build .#checks.x86_64-linux.pi-search-hub
nix build .#checks.x86_64-linux.pi-search-hub-eval
```

The package runs all vendored tests and strict typechecking against the pinned
Pi SDK, not ambient API stubs. npm dependencies are locked and fetched by Nix;
only the compiled shared UI library is linked into the installed package.
Local iteration uses that same SDK/shared UI and the package lock, with an
isolated HOME so personal search.json files cannot change fixture expectations.
Real-PTY acceptance must cover both regular and fullscreen modes; component
checks alone do not establish host-level keyboard routing or runtime loading.
The evaluation check additionally replays pinned public relevance data and frozen
live URL pools; see [eval/README.md](eval/README.md).
