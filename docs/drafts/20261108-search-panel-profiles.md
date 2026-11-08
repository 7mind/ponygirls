# Web/paper panel task ledger

User explicitly requested paper statistics and test capability in `/websearch`,
with tabular statistics for both domains. No deployment or push requested.

Plan:
1. Expose paper service metadata/monitoring and share the actual service instance
   between tool and command. Verify real operations and no probes on inspection.
2. Add Web stats, Paper stats, Fetchers, Test web and Test papers tabs; tabular
   activity/results/timing and resolved source limits. Each test retains its
   query/result/scroll; closing aborts all owned work. Verify unit and real PTY.
3. Full pinned package/evaluation and installed SDK acceptance; independent
   actionable-defect review; preserve concurrent user work, commit/merge/cleanup.

Starting clean main `7d25de8d`. Codegraph unavailable (foreign/unknown PID namespace);
direct source inspection used. No bypass attempted. Q37 is unrelated.

Owned trees:
- `.worktrees/wt-ponygirls-search-panel`: integration, host acceptance, docs.
- `.worktrees/wt-ponygirls-search-panel-view`: five-tab view and comparative tables.
- `.worktrees/wt-ponygirls-search-panel-services`: shared paper metadata/counters.
- `.worktrees/wt-ponygirls-search-panel-pty`: installed regular/fullscreen evidence.
- `.worktrees/wt-ponygirls-search-panel-arxiv`: reproduced abort-ownership correction.

All concurrent writers used separate prepared trees; no same-tree subdelegation.

## Final acceptance

Application commit `d7d5ac94`; source Git tree
`b36b4e4ed9c74b7afbf90826080c0b65d424f2d5`. Installed package
`/nix/store/4w05wqrk58lm5mjzpipa3kagqdmr887v-pi-search-hub-2.8.0-ponygirls.1`,
NAR `sha256-9yqWxzUr46g7bGjK9zZmdnFbzyLUe9d+Y4r35n/hHQw=`.

- Fresh pinned strict typecheck and all 33 files / 568 cases passed, zero skips.
- Fresh 37 evaluation cases, both fixed hashes and 10-pool installed RRF parity;
  unchanged policy-shape output reused.
- Parent byte-compared 59 installed files against source.
- Final installed SDK host passed actual paper tool→shared command statistics,
  no inspection requests/inference or private metadata, and reset on reload.
- Dedicated final installed regular/fullscreen PTY passed both-domain routing,
  independent query/result/scroll, aligned comparative tables at 120×40/80×24,
  concurrent cancellation/close after real dispatch and settled counters.
  Per mode: 12 HTTP calls (8 web/4 science paper), 4 scripted native web calls,
  2 native aborts; all sources success1/failure1/cancel2/active0; exits0 and owned
  socket/HTTP cleanup verified. Fixtures are not live semantic-quality evidence.
- Authoritative source observers now update before aggregation; fail-first
  controls covered slow peers and ranking failure leaving active counters.
- Review found a prior arXiv logical-abort race violating physical permit
  retention. Caller/deadline reproductions failed before a narrow correction;
  original adapter/rate tests and owner-lock negative control passed afterwards.
- Follow-up read-only review found no remaining actionable defects; no novel
  skill candidate beyond existing ownership/testing procedures.

Evidence copied before cleanup to main checkout's ignored
`debug/search-panel-20261108/`, preserving final/interim harness receipts.
Commands and qualified limits are in `nix/pkg/pi-search-hub/VALIDATION.md`.
Integration must preserve concurrent user commits; no activation or push.
