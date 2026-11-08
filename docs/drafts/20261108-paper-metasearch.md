# Paper metasearch implementation ledger

## Scope

User approved a separate paper research tool, then requested metasearch tiers,
reranking, boosts and consideration of SearXNG/arXiv/additional supported providers.
Ordinary web search behavior must remain unchanged. No deployment or push authorized.

## Plan and acceptance

1. Verify scholarly source contracts; implement Firecrawl Research, Exa publication,
   SearXNG science and opt-in direct arXiv adapters. Verify: deterministic adapter
   contract tests and separately reported public live smoke checks.
2. Implement scholarly identity, raw-list tier fusion and disclosed ranking boosts.
   Verify: duplicate/transitive IDs, provider overlap, original ranks, cancellation,
   deadlines and partial failures in deterministic tests.
3. Register separate search/read/related operations with bounded structured output,
   reuse credentials and configure paper sources independently. Verify pinned SDK
   typecheck, all package tests, Nix evaluation checks and extension loading.
4. Review, commit, safely integrate and remove owned worktrees after verification.

## Accounting

- Main started clean at `7cef6e14`.
- Integration: `.worktrees/wt-ponygirls-paper-metasearch`, branch
  `feature/paper-metasearch`.
- Adapter writer: `.worktrees/wt-ponygirls-paper-adapters`, owns provider adapters
  and adapter tests, package dependency changes if necessary.
- Ranking writer: `.worktrees/wt-ponygirls-paper-ranking`, owns identity/ranking/
  orchestration and tests.
- Codegraph explore failed with foreign/unknown PID namespace error; direct file
  inspection used. No bypass or maintenance actions performed.

## Source observations (2026-11-08)

Authoritative pages fetched through web_read:

- https://docs.firecrawl.dev/features/research.md
- https://docs.firecrawl.dev/api-reference/endpoint/research-search-papers.md
- https://docs.firecrawl.dev/api-reference/endpoint/research-paper.md
- https://docs.firecrawl.dev/api-reference/endpoint/research-related-papers.md
- https://exa.ai/docs/search/data/research
- https://exa.ai/docs/reference/search
- https://docs.searxng.org/dev/search_api.html
- https://info.arxiv.org/help/api/user-manual.html
- https://info.arxiv.org/help/api/tou.html

Firecrawl has dedicated GET research endpoints with top-level `results` and
`paper`/`passages`. Exa's current documented category is `publication`, not the
older `research paper`. SearXNG supports `categories=science`; available engines
and JSON support depend on the instance. arXiv Atom API requires one connection
and at least three seconds between requests across all clients under the
operator's control. Local serialization cannot guarantee coordination across
independent machines; direct arXiv is opt-in.

Read-only source-analysis agent found no existing scholarly modes and no useful
new reusable skill beyond installed constructive-test-taxonomy/dual-tests.
Its provider guesses were treated as hypotheses and superseded by fetched docs.

## Ranking boundaries

Weighted RRF60 over original lists, identifier-aware merging, SearXNG overlap
contribution suppression, optional bounded lexical reranking and exact-ID
priority are transparent heuristics. Correctness tests and live transport smoke
checks do not establish semantic relevance improvement. Existing web evaluation
corpora are not a scholarly relevance benchmark.

## Final evidence

Implementation and pre-integration verification complete. Detailed command,
artifact and limitation accounting is in `nix/pkg/pi-search-hub/VALIDATION.md`.

- Final application source tree: `bf8972436b77e9bd7be6be33394a32d766b0284d`.
- Pinned Nix build: strict typecheck; 23 files / 450 Vitest cases passed;
  37 evaluation cases passed, frozen web-report hashes and 10-pool RRF parity.
- Final installed package: `/nix/store/mgmxgvn94igavxvfg5kx1rslzgv9hwgp-pi-search-hub-2.8.0-ponygirls.1`.
- Installed real-Pi SDK host case passed against controlled loopback SearXNG.
- Credential-free installed live Firecrawl search/inspect/read/related and direct
  arXiv search/inspect passed. Production Exa/SearXNG readiness not claimed.
- Live title lookup failure reproduced before a complete-title priority correction.
  Same-pool baseline/candidate replay: development title rank 4→1; held-out
  titles 4→1, 1→1, 1→1. No general topical-quality claim.
- Independent read-only review found a legacy arXiv parser round-trip mismatch;
  fail-first fixture followed by correction. Follow-up found no substantive new
  findings. Existing testing skills cover observed reusable patterns; no new
  skill draft was justified.
- Evidence copied before cleanup into main checkout's ignored
  `debug/paper-metasearch-20261108/` (public query pools; no credentials).

At wrap-up, merge into the clean original `main` without overwriting its concurrent
Cuckoo pilot commits, verify source/artifact identity and remove the three owned
worktrees. No unrelated worktrees are owned by this task. No activation or push.
