# Agent-memory plan: adversarial review ledger

Scope: review the implementation plan, not an implemented service. Design
approval is not runtime verification or user acceptance of remaining proposals.

Candidate: `docs/drafts/20261007-1828-agent-memory-implementation-plan.md`.
Reviewer: independent reader agent `adversarial-memory-plan`,
`openai-codex/gpt-6-astra`, high reasoning.

Review rubric: requirement coverage/scope; identifier and data contracts;
revision/CAS/replay/query consistency; authentication/privacy; deployable
NixOS/Home Manager/three-harness and PostgreSQL design; agent-workflow failure
boundaries; achievable implementation/verification ordering. Unresolved choices
are acceptable only behind explicit prerequisite decision gates. The reviewer
must identify concrete counterexamples and actionable corrections, rather than
manufacture findings or demand nonexistent implementation evidence.

The author keeps each candidate frozen during review. Every changed candidate
is re-reviewed under the same rubric until the reviewer returns `APPROVED` with
no remaining material actionable findings. Source hashes identify the reviewed
snapshots; findings and dispositions will be retained below.

## Round 1

- Candidate SHA-256: `3f2caff5557c11cbd72b136232c7d0254ce29a85f410d65b5a37e93dc70b07bb`.
- Task run: `918fb7d0-215b-4c0c-a28c-30e6e46dfa0a`.
- Verdict: `CHANGES_REQUESTED`.
- Changes before review: adopted the user's combined `project:item` references
  and specified component percent-encoding, common codec, and cross-project
  query examples.

### Reviewer findings

1. **Medium — Authenticated-response caching unspecified** (§5, Step 5).
   Backend revocation cannot prevent a cache serving previously authenticated
   responses. Require no-store for API/MCP/auth responses and proxy cache bypass;
   verify through the deployment proxy after logout/revocation.
2. **Medium — Query leakage through URLs/logs/referrers** (§6–8).
   Query strings and Referer can expose search contents despite omitting query
   bodies from application logs. Specify URL-fragment state, no-referrer, and
   application/proxy log redaction; verify with a confidential canary and reload.
3. **Medium — GitHub complete keys not deterministic across clients** (§9).
   Local project knowledge can choose different namespaces for one artifact;
   URL normalization/digest details were unspecified. Define one complete-key
   algorithm and collision handling; test independent clients and concurrent
   accounting with cleared-attention preservation.
4. **Low — Skill semantic-convergence claim too strong** (§9).
   CAS/shared namespace prevents duplicate writes to one key, not equivalent
   drafts under different names. Narrow guarantees and require best-effort
   reconciliation, including unrelated drafts with a colliding name.

### Dispositions

All four findings accepted and corrected before Round 2:

- Required no-store for every dynamic/auth response and proxy cache bypass;
  isolated public static assets, cleared in-memory client state, and added
  proxy-backed logout/revocation/history tests.
- Put optional saved search state in URL fragments; search/item keys travel in
  JSON bodies. Added no-referrer, explicit browser-history/share caveats, and
  allowlisted application/proxy/database logging with canary checks.
- All GitHub accounting uses one server-authoritative activity namespace,
  persisted/checked across startup and verified by client whoami. Defined a
  versioned full SHA-256 key from canonical GitHub identity, explicit kind,
  collision rejection, and pending resolution behavior. Project context uses
  cross-project links rather than another accounting copy.
- Scoped skill guarantees to same-key transactional convergence; semantic
  overlap is best effort. Added explicit reconciliation, naming-collision,
  human-edit/cleared-attention preservation scenarios.

Additional author audit corrections in the same candidate:

- Defined bearer whoami as required, not optional, for the mandatory preflight.
- Specified token encoding/file-terminator/hash consistency.
- Specified RFC6901 traversal rooted at fields and prevented PostgreSQL's
  negative/loose array indexing from changing that contract.
- Empty/punctuation-only text atoms produce diagnostics, not match-all.
- Consulted GitHub's documented global-ID migration: legacy/next opaque IDs can
  identify the same object. Required canonical GraphQL next-ID resolution with
  `X-Github-Next-Global-ID: 1`, kind from `__typename`, and a reviewed transition
  for future identity-format changes rather than assuming opaque IDs never
  change representation. This is a documented API behavior, not an upstream
  defect report.

Verification: whitespace/fence/step/example checks and reference-codec
round-trip/noncanonical-input checks passed. These check the document and its
reference contract, **not** an implemented service.

## Round 2

- Candidate SHA-256: `4d5e83d3d2ad34b50a091e06e8e3ff15c039dc2439b652f96859ecb7b779c66f`.
- Task run: `aaa5436a-587a-4ee2-8ba4-edf914a62e47`.
- Verdict: `CHANGES_REQUESTED`.
- Reviewer confirmed all four Round 1 findings addressed, then identified:

1. **Medium — Exact-byte token validation missing at host loading boundary**
   (§5/§7). Linux/Darwin generic `$(cat file)` loading strips trailing LFs;
   injected-env-only validation cannot distinguish one LF from multiple LFs in
   the original file. Embedded LF could affect line-based secret composition.
   Require exact-byte host-side validation before transformation/injection.
2. **Low — Logging allowlists contradict operational requirements** (§5/§6).
   A closed route/request/timing/status allowlist omitted the principal/token
   labels, result category, and DB health required elsewhere. Define compatible
   per-layer schemas and verification of approved/excluded fields.
3. **Low — Superseded project-fallback instruction** (Step 10).
   An old implementation-step phrase contradicted authoritative accounting
   namespace selection. Replace it with activity namespace/project-context links.

### Dispositions

All three findings accepted and corrected before Round 3:

- Added one shared exact-byte reader for direct/Linux/Darwin paths at the host
  loading boundary. Validate and inject the same read, propagate failures without
  export-status masking, and never compose rejected bytes. Sandbox wrappers use
  only validated injected credentials. Tests cover zero/one LF, multiple LF,
  embedded LF/CRLF, NUL, malformed encoding, variable injection, and profiles.
  Existing unrelated secrets retain their semantics: the finding is a prospective
  token-v1 integration mismatch, not a reproduced generic-loader defect report.
- Specified proxy/application/infrastructure logging schemas with attribution
  labels and fixed result categories separated from health counters; explicitly
  excluded content, credentials/digests, DSNs, raw URIs and exception messages.
  Operational requirements now reference that same policy.
- Removed project fallback from Step 10 and retained project associations only
  as links/context.

Verification: document whitespace/fences/steps/JSON examples and checks for
removal of stale fallback language, shared reader boundary, sandbox behavior,
and one operational logging policy passed. No service runtime tests occurred.

## Round 3

- Candidate SHA-256: `343aac44c5f1ffcc4f708b76d6c1aae66d84a77f46510dbe17453e177433d730`.
- Task run: `e7080eac-99c4-4b97-acc3-b7e61e07c805`.
- Verdict: **`APPROVED`**.

### Final reviewer response

> Candidate SHA256:
> `343aac44c5f1ffcc4f708b76d6c1aae66d84a77f46510dbe17453e177433d730`
> (supplied).
>
> Re-audited all 1,046 lines and the review ledger under the original frozen
> rubric. All prior findings are addressed; no remaining actionable defects
> identified.
>
> This approves the planning document—not runtime correctness or acceptance of
> proposals still requiring user decisions.

The author independently recomputed the current plan's SHA-256 after receiving
this verdict and verified an exact match. No further plan edits followed
approval. Documentation/contract checks passed; implementation, native-client
compatibility, authentication/proxy tests, and release/runtime checks remain
work for the plan's verification gates. This task edited only the plan and this
ledger. Final working-tree checks also showed unrelated modifications to
`nix/pkg/pi-extensions/ponygirls-bg-tasks/tests/extension-status.test.ts` and
`nix/pkg/pi-extensions/ponygirls-bg-tasks/tests/tool.test.ts`; they were left
untouched.
