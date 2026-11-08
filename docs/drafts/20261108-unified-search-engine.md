# Unified search engine task ledger

User explicitly requested unifying web/paper tiers, alwaysInclude, boosts,
reranking and concurrency, with all timeouts configurable. Paper SearXNG must
participate in alwaysInclude. No deployment or push requested.

## Plan

1. Shared typed engine contracts, session-owned concurrency pool, work-conserving
   scheduling, overall/source deadlines (queue time included), configurable
   native settlement grace and observable outcomes. Verify deterministic tests.
2. Shared identity-agnostic fusion/reranking with domain adapters; expose source
   boosts and configurable reranking to both tools. Verify identity/provenance,
   original ranks, overlap suppression and exact lookup controls.
3. Integrate both services, configurable transport/discovery/reader/credential
   timeouts, configuration and truthful pane policy. SearXNG paper alwaysInclude.
4. Full pinned package/evaluation tests, installed SDK acceptance, independent
   review, commit/integrate and clean only owned worktrees.

## Starting evidence

- Clean main `afbe3d04`.
- Codegraph explore fails due to foreign/unknown PID namespace; direct source
  inspection used, no daemon bypass attempted.
- Existing pipelines are separate, web main batch target3, paper target2.
- Existing web cooldown does not serialize overlapping calls. No shared pool.
- Existing source timeouts and native grace have hardcoded call-site caps;
  new configurable defaults must be resolved centrally, without hidden lower caps.
- arXiv minimum spacing remains a provider constraint, not an overridable timeout.
- Q37 concerns a different Cuckoo worktree; no dependent work in this task.

## Owned trees and work allocation

Integration: `.worktrees/wt-ponygirls-unified-search`, feature/unified-search-engine.
Additional writer trees will be recorded when created. All writers use separate
prepared trees. No existing user changes are copied, reset or stashed.

## Acceptance

Pending implementation. This ledger is updated at substantive milestones.
