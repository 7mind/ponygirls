# Historian reliability work ledger

Base: 2a342040bb91029a502b49b4a13f88d92b91fe06. Dedicated worktree:
`.worktrees/wt-ponygirls-historian-reliability`, branch `feature/historian-reliability`.
User authorized continuation of diagnostics/output/citation improvements and a
Sol 6.1/high comparison. Q26 r2 remains Sol 6.1/medium; no ordinary defaults change.
Only new synthetic or previously authorized synthetic pilot evidence is eligible.

## Plan and checks

1. Reproduce lost failure accounting after successful retry/restart. Add durable,
   content-free attempt receipts, safe failure categories, explicit interrupted
   outcomes and status totals distinct from the current retry streak. Verify
   memory/file SQLite contracts, controller lifecycle and real Agent boundaries.
2. Check the pinned SDK and actual approved provider for schema-constrained output.
   Keep strict output validation and no silent format repair/fallback. Improve
   claim-level citation instructions without claiming deterministic entailment.
3. Freeze a synthetic comparison before live calls: same evidence/prior-journal
   inputs across baseline/candidate and Sol 6.1 medium/high; retain attempt-level
   outcomes and score claim support separately from JSON validity. Include
   descendant, failed-action, contradictory-report and interrupted-work controls.
4. Run complete affected mechanical suites/typechecks and a real PTY smoke; record
   source/artifact identity, counts and limitations. Commit and safely integrate.

## Evidence and boundaries

Prior live pilot: `.git/historian-live-evidence-20261106/` in the main checkout.
It had two recovered JSON-decoding failures, but no durable failed-attempt receipts;
13/15 claims were fully citation-supported, two were partially supported. No
contradicted facts. Do not overwrite that journal, erase failed attempts, infer
provider support from generic OpenAI compatibility, or equate cancellation with drain.

Codegraph exploration was unavailable (foreign/unknown PID namespace). Read-only
advisory review covered pinned SDK/provider hooks and failed tap wiring.

## Intermediate implementation progress

- Reproduced reset-to-zero failure accounting after successful retry, then added
  schema-2 content-free admission receipts with monotonic durations, safe failure
  categories, interrupted outcomes, recovery totals and bounded recent status.
- Reproduced and corrected a controller unexpected-error UI leak using a private
  sentinel. Real worker errors and persisted receipts retain no arbitrary body.
- Added user-requested `programs.pi.historian.{journalRoot,model}`. The model has
  explicit provider/id/thinking. Managed `historian-defaults.json` is independent
  of mutable `historian.json`; null runtime model inherits, explicit overrides
  win, and `default model inherit` clears them. OFF/consent remain independent.
  Root changes require restart; no old journals or pending evidence are moved.
- Initial complete Nix Historian validation: 58 tests plus 2 packaged host tests,
  zero failures/cancellations/skips, with typecheck. Three HM/policy checks pass.
  Logs are in ignored extension `node_modules/.historian-validation/`; these are
  intermediate checks, not final-source evidence.
- Actual approved Sol 6.1/high SSE schema probe: plain control HTTP200/PLAIN;
  strict marker schema HTTP200/exact marker despite conflicting prose;
  invalid schema HTTP400; full proposed Historian schema HTTP200/empty envelope.
  Evidence: main `.git/historian-reliability-evidence-20261106/`.
  Initial probe failed preflight before any request: `refreshOnCreate:false`
  leaves the runtime configured-auth snapshot unpopulated. An explicit no-network,
  selected-provider refresh corrected harness setup. Failed script/log retained.
- Candidate objective v2 uses a proposals envelope and stronger per-claim citation
  instructions. Exact approved Codex model/API gets text.format JSON schema;
  other models use prompt-only JSON, explicitly not a retry fallback. Strict
  parsing and proposal validation remain; no salvage/repair. Comparative semantic
  evaluation and final validation were pending at this intermediate milestone.

The pinned Codex adapter does not emit maxTokens on the wire. Deadline and streaming
character bounds are the real runtime guards. The original passive tap checked
legacy context.systemPrompt, while bare Agent sends system messages in the
transcript. The corrected harness qualified that boundary before comparison calls.

## Final corrections and validation

Review found a root-switch ownership bypass: after cancellation returned but before
provider drain, a controller using a changed journal root could acquire a different
lease. The failing test opened the new journal instead of reporting existing
ownership. Stable agent-directory ownership plus target-journal ownership now
survive root changes; canonical aliases are deduplicated. The retained regression
checks blocking, positive recovery after drain, pending preservation and no late
publication/double finalization. A subsequent failing assertion exposed a stale
ownership error after successful recovery; reconciliation clears it only with no
outstanding worker retry failures. An initialization-cleanup hypothesis did **not**
reproduce: the positive test passed before any change, so no cleanup fix was made.

Other review corrections: production schema mode is pinned to the actually tested
SSE transport; extra proposal/claim fields now fail local validation (red/green),
not merely provider schema validation. Safe provider failures never expose raw
bodies through status or notifications. Real OS-process tests cover interruption
only after lease acquisition/process death, preserving another live root.

Final command from the task worktree:

```bash
nix build --keep-going --no-link --print-out-paths -L \
  .#checks.x86_64-linux.ponygirls-historian \
  .#checks.x86_64-linux.ponygirls-subagents \
  .#checks.x86_64-linux.ponygirls-decisions \
  .#checks.x86_64-linux.subagents-policy-shape \
  .#checks.x86_64-linux.dev-llm-module-boundary \
  .#checks.x86_64-linux.tui-hm-eval
```

All six passed. Fresh Historian typecheck/full suite: **64 tests**, 0 failures,
0 cancellations, 0 skips (8.002 s); packaged combined-host leg **3 tests**, same
zero counts (1.572 s). Subagents **779** and Decisions **120** reuse the exact prior
Nix outputs, not fresh execution. Their unchanged outputs are respectively
`bakvpnl3nmk9qxhc1ghfhqz15fwf1yja-ponygirls-subagents-test` and
`ggyr73qybhfzjmsa2hz4jl7ywdmr91j0-ponygirls-decisions-test`.
Final Historian output: `vbrawidp1ljwqcdj5fgs7kncq1j1kzv6-ponygirls-historian-test`;
package: `6nk7h73214ilgp1c44naz2h2wwl2vqww-ponygirls-pi-extensions`.
HM evaluation covers unset defaults/no file, exact configured JSON, writable-file
separation, invalid relative root, and empty provider/model IDs. No activation.

Retained intermediate failures include missing local subagent peer-dependency
links (all three direct host tests failed to load, not behavioral failures), a
missing test import, and an incorrect fixture assumption that Agent transport was
undefined rather than `auto`. Corrected tests and the pinned Nix environment passed;
none was counted as an application defect.

## Controlled live-provider comparison

Archive: main `.git/historian-reliability-evidence-20261106/` (owner-private).
`COMPARISON.md`, `cases.json`, `comparison-source-v2.sha256` freeze the protocol,
19 synthetic events in four cases, and baseline/candidate source snapshots before
any comparison calls. First two cases target earlier citation shortcomings; two
held-out cases cover descendant interruption and missing completion/injection.
Every cell receives identical case evidence, gaps, focus and empty prior journal.
All calls use approved `openai-codex/gpt-6.1-sol`, explicit SSE, a fresh tool-less
worker, no oracle input, no fallback/repair, and sequential drain before successor.
The candidate bundles prompt, envelope, schema and strict-validation changes;
individual component effects are not identified.

| Worker / effort | Validated / admissions | Accepted claims: supported / partial | Mean duration | Fixture criteria retained |
| --- | --- | --- | --- | --- |
| v1 / medium | 4 / 4 | 15 / 0 | 9.54 s | 12 / 12 |
| v2 / medium | 4 / 4 | 16 / 0 | 10.17 s | 12 / 12 |
| v1 / high | 3 / 4 | 10 / 1 | 10.10 s | 9 / 12 |
| v2 / high | 4 / 4 | 17 / 0 | 11.08 s | 12 / 12 |

All 16 admissions have matching stream/payload/HTTP/visible-response/terminal
receipts; every observed HTTP response was 200. Counts are not an assertion about
unobserved SDK/provider-internal wire retries. All references in the 59 accepted
claims resolve to their case's evidence. No deadline, truncation or repair occurred.
The old legacy `context.systemPrompt` filter matched **zero** of these 16 intercepted
calls, while transcript-aware instrumentation captured all of them.

The v1/high write case returned malformed JSON at position1559; its exact visible
synthetic output is retained and parsing failure reproduced, unlike the irrecoverable
first pilot failures. It has no accepted claims: semantic claim coding is N/A and
retained fixture findings are 0/3. The v1/high literal case's claim2 said the command
“ran” but cited only the source/request, not its result. The next claim's citation
does not repair that claim's own support. No other partial, contradicted or wholly
unsupported accepted claims were found by the blinded reader or parent review.

Reader `a7e4aeb4-e7ea-4dcc-bb24-37df70e87cfb` (Sol 6.1/medium) coded randomized IDs
without implementation/effort labels. Parent independently read all accepted claims
against the authored fixtures, then unblinded labels. `semantic-review.md` retains
coding, its two reporting corrections and parent adjudication. Explicit repetition
of the injected instruction was not required and its omission is not a defect.
These are model/parent judgments, not mechanical entailment proof or independent
human annotation. Four calls per cell cannot establish reliability rates or an
advantage for high effort. **Medium remains the starting selection; no default was
changed.** This assembled-evidence trial is not a genuine descendant execution or
new coding-agent session, and does not replace the earlier live pilot's mixed result.

## Packaged interactive smoke and cleanup

Real Pi 1.4.0/tmux3.8, disposable credential-free HOME/agent directory, scripted
providers, tools/MCP/context discovery disabled. The packaged UI displayed managed
model/custom root while OFF; explicit global ON left writable model null; a
synthetic task published a v2 episode and one validated attempt. At 120×40 and
80×24, status/journal remained usable. Global model override was unapproved;
`default model inherit` restored the previously approved managed model. Local OFF
survived reload; durable totals stayed1 while runtime last-commit reset. Managed
symlink/content stayed unchanged. Normal exit0; only the owned tmux server was
stopped and verified unreachable. No installed session or credentials were changed.

Artifact `tui.tar` retains actions, rendered screens, raw terminal stream, session,
SQLite journal and cleanup. Two premature captures are retained: `04-attempts`
matched old transcript text before the overlay, and `07-wide` preceded resize
redraw. Assertions were corrected to fresh overlay/geometry evidence (`05`, `09`,
`geometry.txt`); these early captures are not passing postconditions. The PTY ran
package `azgmk54spmwdmq3k8cnlmlfr7kqcbiy8-ponygirls-pi-extensions`; final package
runtime-input equivalence passed for 50 source/package/fixture files and the same
shared-settings/UI dependencies (only docs/tests changed afterward). The initial
verifier assumed the shared libraries were copied sibling sources, rather than
pinned `node_modules` links; its failed probe is retained alongside the correction.
This is rendered-cell verification, not physical terminal or live semantic evidence.

## Review, reuse and integration accounting

Reader `41f8f4a3-3b44-4752-abe2-54b400beb521`, final task
`a06b3660-cb6b-496a-8f8b-2e82319d18e1`, found no new material defect after the
three corrections; source-only review, no independent execution claim. Delegated
pattern analysis recommended existing procedures, not a new skill draft. Parent
freshly read Haystack caller-completion-resource-ownership r3,
erased-batch-failure-evidence r2 and paired-evaluation-state-isolation r1; installed
TASS/test-taxonomy/dual-tests/TUI/monitoring guidance covers the remaining methods.
Agent-behaviour-pilot r7 was truncated and is not claimed fully read. No skill was
created, installed or activated.

Validation logs, failed probes, exact synthetic failed output, source snapshots and
review receipts are retained in the new archive; the first pilot is unchanged.
Integration/source identity and owned-worktree cleanup are recorded separately in
that archive's completion receipt. No push, Home Manager switch or deployment.
