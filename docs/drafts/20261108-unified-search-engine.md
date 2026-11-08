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
- `.worktrees/wt-ponygirls-search-scheduler`: shared runtime/policy writer.
- `.worktrees/wt-ponygirls-search-fusion`: generic fusion/domain adapters writer.
- `.worktrees/wt-ponygirls-search-transports`: async credentials/native/readers writer.
- `.worktrees/wt-ponygirls-search-test-update`: existing contract-test migration.
- `.worktrees/wt-ponygirls-search-ui-acceptance`: final installed PTY evidence.

No existing user changes were copied, reset or stashed. The test-update worker
briefly delegated disjoint same-tree test edits contrary to the worktree policy;
parent detected this, required both children be interrupted/closed, preserved
their edits and had the original writer finish alone. No parallel test writers
remained during final verification.

## Acceptance

Final application commit `32e098e7`; subsequent tracked changes are documentation.
Source tree `3bc8d4f4f25308606489819e0b33598ebd93f674`. Final installed artifact
`/nix/store/m2ml0v5s68vchsxrj9zisdyxzzkkjs6q-pi-search-hub-2.8.0-ponygirls.1`,
NAR `sha256-bsmz8r6+K/QULRkdHMySa2yGP2igCDCRIbXRa2el7R4=`.

- Fresh pinned strict typecheck and all 29 files / 531 cases passed, 0 skips.
- Fresh 37 evaluation cases, fixed report hashes and 10-pool installed RRF parity.
- Nix module-boundary/managed-config checks passed; final invocation reused their
  exact prior outputs, plus the unchanged subagent policy-shape output.
- Parent compared 57 installed files to source; installed SDK host case passed.
- Credential-free installed web/paper live Firecrawl/arXiv smoke passed, including
  paper alwaysInclude, known-title lookup, passage read and references. No live
  native inference, production Exa/SearXNG readiness or semantic-quality claim.
- Final installed regular/fullscreen PTY journeys passed with owned loopback and
  scripted native transport. Parent reviewed manifests/captures/run/cleanup
  receipts: zero inspection requests; per mode 8 HTTP and 4 native requests;
  2 native abort settlements; all three monitors active0/cancelled2, failure1;
  both exits0 and owned sockets/HTTP listeners unavailable after cleanup.
- Independent read-only review found no substantive findings after fail-first
  corrections. Its logical-versus-physical resource-ownership skill suggestion
  exactly overlaps Haystack `corporate-activity:skill-draft-caller-completion-resource-ownership`
  r3, fully read by parent; no duplicate draft was written or installed.

Full commands/limits are in `nix/pkg/pi-search-hub/VALIDATION.md`. Sanitized public
and fixture evidence was copied into main checkout's ignored
`debug/unified-search-20261108/` before worktree cleanup. Integration must preserve
concurrent Cuckoo history changes on `main`; no activation or push is authorized.
