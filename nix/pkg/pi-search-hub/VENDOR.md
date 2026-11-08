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
  main nonempty-source target, but do consume concurrency slots. The pane's
  historical "Fallback" heading refers to this tier.
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
RRF uses `sum(weight / (60 + rank))`, one vote per source/work. A SearXNG hit on a
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

The pane uses the shared `@ponygirls/pi-ui` layout/toggle components. It shows
configured engines and in-memory, per-extension-instance observations: active,
nonempty success, empty, failed, timed-out and cancelled operations, result counts and
latency. Unattempted engines have unknown health; configuration is not a probe.
Reader counts represent successful page fetches. Session replacement/reload
resets observations. No search queries, credentials or raw provider errors are
retained by the monitor.

The pane has separate **Search engines**, **Fetchers**, and **Test search** tabs.
Search engines groups the current main, fallback and native tiers separately from
historical observations. Its policy explanation reflects automatic-search defaults:
main selection and request budgets, always-included tiers, configured fallback
caps/deadlines, shared pool limits, overall/discovery budgets, native grace,
caller overrides and weighted fusion/reranking policy.
Configured preference is not presented as the next random, round-robin or scored
selection. Reading/rendering the policy neither sends a search nor advances selection.
Configuration still does not establish provider health or entitlement.

Tab/Shift+Tab switches views; mouse tabs work in fullscreen or regular mode with
Pi's `regularMouse` enabled. Default regular mode leaves mouse to the terminal.
Only Test search accepts query input; Enter tests the same metasearch as `web_search`.
Query/results and per-tab scrolling survive tab switches; an in-flight test may
finish while viewing statistics. Arrow keys and Ctrl+PageUp/PageDown scroll;
Ctrl+C cancels the owned test from any tab; Escape closes the pane and its work. Bare PageUp/PageDown also work in regular
mode, but Pi reserves them for transcript scrolling in fullscreen mode. Closing
or replacing a pane prevents late results from repainting it. Search output is
bounded and terminal-control sequences are removed before pane display.

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
