# Pi reviewer-focus default: protocol and evidence

## Scope

Add overridable agent-facing guidance to the shared Pi operating manual, not a
runtime filter, severity threshold, model default, or requirement to use gates.
The governor must include the guidance in each reviewer task prompt or rubric
because reviewer children do not automatically inherit its context. Explicit user review scope
(including a naming/style review) overrides the default.

Source baseline: Ponygirls `2aa01227`. No host activation or downstream lock update.

## Prespecified pilot (before model calls)

Synthetic mini-reviews only; no repository/private content is sent to models.
Use the installed Pi 1.4.0 `ModelRuntime.completeSimple` with the configured provider and models
`deepseek-ai/DeepSeek-V4.1-Flash-1017` and `zai-org/GLM-5.3`.
Each request is a fresh conversation without tools, inherited context or ground
truth. This measures rubric behavior, **not** the complete gate lifecycle or the
governor's ability to propagate instructions. High reasoning, temperature 0.4,
8192 output-token bound, 120-second request deadline, four concurrent requests,
15-minute whole-run deadline. Bounds prevent runaway execution, not spending.
No Anthropic calls. Arm ordering rotates by fixture/model; there is one sample
per cell, no fixed seed and no claim of statistical significance.

Compare:

- **existing**: task-specific review rubric only.
- **literal**: add “By default, avoid being overly pedantic and do not focus on
  nits. An explicit user request for a different review scope overrides this default.”
- **operational**: add the following reviewer text:

> Focus on actionable defects and concrete risks to correctness, security,
> reliability, or explicit requirements. Do not report style preferences,
> cosmetic nits, optional refactors, or speculative concerns without a concrete
> failure scenario grounded in the candidate or requirements. Small defects
> still count; a small diff or low severity is not a reason to omit a real defect.
> For each finding, explain the trigger and consequence. If there are no
> substantive findings, say so; do not invent work or request changes solely for
> nits. An explicit user request for a different review scope overrides this default.

Common rubric: “Review the supplied candidate against its original task. Report
actionable review findings and decide whether changes are required before acceptance.”
Common output: JSON verdict `approve|revise|blocked`, with findings containing
problem, trigger, consequence, and requiredChange. Empty findings are valid.

Six screening fixtures, each in all three arms on both models (36 calls):

| Fixture | Required result | Non-defect distractions |
|---|---|---|
| Correct capped exponential backoff, nonnegative integer attempt | approve, no findings | short local name, literals, missing docstring/types |
| Zero-based pagination slicing `size + 1` items | revise, off-by-one | short parameter names |
| Untrusted path read with explicit confinement requirement | revise, traversal | typing/docstrings |
| Icon-only button with hidden SVG and no accessible name | revise, accessible-name violation | CSS naming |
| Explicit style-only user scope requiring snake_case/descriptive names, `Calc(d)` | revise, requested naming feedback | speculative invalid inputs excluded by preconditions |
| TTL changed to product-selected five minutes; implementation unavailable | approve, no evidenced findings | imagined races/stale-authorization/resource failures |

Two reserved holdouts, only existing/operational on both models (8 more calls),
run after inspecting screening results without tuning the operational text:

- Documentation says five seconds but sets `timeout_ms=5`: revise, wrong unit.
- Correct Python integer summation loop: approve; `sum()` rewrite is optional.

Ground truth is authored from explicit task contracts before calls; the models
never see fixture IDs, expected outcomes, or oracle annotations. The local
runner retains exact prompts by reconstruction, protocol JSON, prompt hashes,
response text, parsed output, model IDs, timestamps, stop reasons and usage.

### Scoring and selection

Parent audits every finding against the stated contract, not another LLM's score.
Report per arm/model: expected defects found (including wrong documentation),
unsolicited preference/speculation findings, verdict errors, and override
adherence. Count multiple equivalent exploit vectors as one defect category.
Transport, truncation and schema faults are invalid calls, not approvals; report
and retain them, without quietly retrying or excluding them.

Operational wording is acceptable only if it retains every screening defect,
honors the explicit style override, and introduces no false finding or wrong
verdict relative to existing guidance. Prefer it over literal wording when it
makes boundaries explicit without a measured regression; claim a behavioral
improvement only if the observations actually show one. If all arms are at the
floor for nits, report that the pilot did not establish a reduction. Do not tune
the wording to response-specific failures and then reuse the same results as
confirmation. Holdouts must retain the unit defect and approve the clean loop.

## Protocol audit before reading successful model responses

Two runner launches failed before any model call: a bare SDK runtime did not
load the configured inference-provider extension, and the store-packaged extension
could not resolve its SDK import outside Pi's loader. The corrected runner
resolves that import to the installed SDK and bootstraps Tokenfactory 0.3.0's
provider registration, without its UI/request hooks or saved per-model overrides.
This changes no screening arm or stimulus.

Independent protocol review and a parent Python reproduction found an oracle
error: the supposed clean backoff has an unbounded integer domain and raises
`OverflowError: int too large to convert to float` at `attempt=1024`. The exact
stimulus and original oracle are retained, but **overflow is a valid defect, not
a nit**. The six backoff responses are scored separately as an additional
correctness probe, not as clean negative controls. This correction was made
before the parent read successful model responses. A supplemental negative
control with the identical backoff implementation and an explicit input bound
`0 <= attempt <= 20` is added to the second phase before any successful calls.
Together with the two reserved holdouts this yields 12 second-phase calls and
48 calls overall. The supplemental fixture is not a pristine reserved holdout.
No response-specific rubric tuning is permitted. Genuine findings outside a listed oracle are adjudicated
against the actual task and are never counted as preferences merely because the
oracle omitted them. Required style feedback is reported separately from defect
recall. A reported defect with an approve verdict is tracked separately from an
omitted defect. The paired fixture results remain primary; totals are descriptive.

The same audit correctly noted that explicit input contracts reduce baseline
nit opportunities, that single samples are noisy, and that this does not test
long diffs, tools, governor propagation, or other model families. Explicit
requirements make style findings actionable in the override case; the exception
in the operational wording applies to its whole default, including verdicts.

## Results

Screening ran 2026-11-06 17:26:06–17:26:36 UTC; the second phase ran
17:27:08–17:27:13 UTC. Both jobs exited 0: 36 + 12 model completions, all
`stopReason=stop`, no transport/truncation/required-field faults, no model-call
retries. Parent read every response and verified all 48 reconstructed prompt
hashes. The installed reviewer block, with Markdown wrapping removed, equals
the operational arm exactly. No wording was tuned between phases.

Paired results below apply to both models unless noted. `accept` means approve;
`reject` means revise or blocked. Exact-label differences are disclosed below,
not silently treated as exact matches.

| Fixture | Existing | Literal | Operational |
|---|---|---|---|
| Unbounded backoff (oracle correction) | accept, overflow missed | accept, overflow missed | accept, overflow missed |
| Pagination | reject, defect found | reject, defect found | reject, defect found |
| Path confinement | reject, defect found | reject, defect found | reject, defect found |
| Accessible name | reject, defect found | reject, defect found | reject, defect found; one extra conditional rendering risk |
| Explicit naming/style override | reject, both requested naming findings | reject, both requested naming findings | reject, both requested naming findings |
| Unknown cache implementation | accept, no findings | accept, no findings | accept, no findings |
| Bounded backoff (supplemental) | accept, no findings | not run | accept, no findings |
| Documentation timeout units (reserved) | reject, defect found | not run | reject, defect found |
| Correct summation loop (reserved) | accept, no findings | not run | accept, no findings |

Per-model screening totals, excluding the corrected backoff from the original
three planted-defect denominator:

| Model | Arm | Planted defects found | Naming override honored | Pure preference findings | TTL speculation findings |
|---|---|---:|---|---:|---:|
| DeepSeek Flash | existing | 3/3 | yes | 0 | 0 |
| DeepSeek Flash | literal | 3/3 | yes | 0 | 0 |
| DeepSeek Flash | operational | 3/3 | yes | 0 | 0 |
| GLM 5.3 | existing | 3/3 | yes | 0 | 0 |
| GLM 5.3 | literal | 3/3 | yes | 0 | 0 |
| GLM 5.3 | operational | 3/3 | yes | 0 | 0 |

Caveats that prevent reading this as “all reviews were correct”:

- **Every arm missed a real overflow defect**: 0/2 per arm on the unbounded
  backoff. This is a shared false negative, not evidence that the default
  suppresses it. Including that corrected oracle gives 3/4 screening defect
  categories detected per model/arm, not 100% recall.
- Operational DeepSeek also reported that the open SVG line paths have zero
  fill area and no stroke, so the close glyph is invisible **if external CSS
  does not add a stroke**. This is a concrete, candidate-grounded conditional
  rendering risk, not a naming/style preference; external CSS was not provided,
  so an actual deployed visibility defect is not established. Keep this extra
  finding visible rather than claiming identical outputs or zero context-dependent
  concerns. No browser rendering was executed.
- DeepSeek's existing security review split symlink escape into another finding;
  all arms' traversal detection counts once, as prespecified. That difference
  does not establish nit suppression or better defect recall.
- GLM literal/security and DeepSeek operational/security returned `blocked`,
  not the expected `revise`. Under the original exact-label criterion these are
  one mismatch in each respective arm; neither approved the unsafe candidate.
  The pilot did not define the two non-approval labels for its tool-free snippets,
  so their interpretation is ambiguous. Do not claim exact verdict parity or
  that the original strict selection rule passed unchanged.
- One existing GLM security response repeats `trigger` and `consequence` JSON
  keys. JSON.parse retained the last values; the raw text remains available.
  Its concrete traversal finding is visible in the original response. “No
  required-field fault” is not a claim of strict duplicate-key-free output.
- No arm reported a real defect and then approved it; the overflow was omitted
  entirely. All four documentation-unit holdout responses detected the defect;
  all eight clean second-phase responses approved without findings.

### Decision

Use the operational wording as an **explicit policy clarification**, not an
empirically superior winner. It states the important boundary (defects versus
preferences, not major versus minor), preserves task-specific user overrides,
and tells the governor to transmit it to each reviewer. This small pilot found
no pure nits even in the baseline, so **it does not demonstrate reduced
pedantry**, nor superiority over the shorter literal wording. It does provide
limited evidence of retained planted-defect detection and override handling;
it also exposes shared false negatives and one additional conditional risk.
Longer real diffs, repeated samples and other model families remain untested.
The actual gate controller already instructs reviewers that advisory improvements
alone must not force another round (`gate.ts:buildReviewPrompt`). The synthetic
pilot deliberately did not reproduce that controller/tool protocol, so it cannot
establish an improvement in actual gate verdicts or repair-loop behavior.

## Implementation and deterministic validation

- Add `## Reviewer defaults` to `nix/pkg/llm-contexts/pi-context.md`. Cover
  ordinary reviewer task prompts, `spawn_agent gate`, advisory `review`, every
  panel member, and replacement `manage_gate retry_review` rubrics. Do not change models, gate machinery,
  authority, or when gates must be used.
- Add four assertions to the existing `general-context-hm-eval` check: the
  section exists in the Pi fragment, Pi's append prompt equals that fragment,
  the emitted APPEND_SYSTEM file contains it, and it does not leak into shared
  AGENTS.md memory used by the other harnesses. This is behavioral/active,
  blackbox/group, specified-origin module wiring coverage, not a semantic LLM test.
- Before adding prose, `nix eval --offline --raw
  .#checks.x86_64-linux.general-context-hm-eval.drvPath` failed on the new
  missing-section assertion. A subsequent test initially assumed a relative
  configDir; the actual module uses an absolute directory. The assertion now
  uses `defaults.programs.pi.configDir` and passes.
- Final worktree verification: the evaluation above, `git diff --check`, and
  `nix build --offline --no-link .#checks.x86_64-linux.general-context-hm-eval
  .#llm-contexts` all pass. Built contexts output:
  `/nix/store/s4dydyncz1x7n5zrl64ddc5vsvm9zzmf-llm-contexts`.
  `cmp` verifies its installed `pi-context.md` is byte-identical to the source.
  No unrelated application suites, TUI test, host activation, or deployment is claimed.

## Local evidence and replay

The ignored directory `debug/reviewer-focus-pilot-20261106-1725/` retains the
runner, both protocols (including exact stimuli and original oracles), all raw
responses, and SHA-256 manifest. This is local evidence, not a tracked fixture
suite or mandatory live-provider CI check. It contains synthetic material only.
The two pre-call bootstrap failures remain recorded above; no failed model
completion was discarded. Replay with fresh output directories, on the same
installed SDK/provider package, using:

```bash
node debug/reviewer-focus-pilot-20261106-1725/pilot.mjs \
  "$PI_SUBAGENTS_SDK_ROOT" debug/reviewer-focus-replay screen \
  /nix/store/mnzbyqi8xrxflmvkp64r6bkz524fqxxx-tokenfactory-pi-0.3.0
node debug/reviewer-focus-pilot-20261106-1725/pilot.mjs \
  "$PI_SUBAGENTS_SDK_ROOT" debug/reviewer-focus-replay holdout \
  /nix/store/mnzbyqi8xrxflmvkp64r6bkz524fqxxx-tokenfactory-pi-0.3.0
```

Recorded response-file digests:

- Screen: `c8f29be521c02397c72cc2094471143f25e8562d4e8ad999710ca7478055a823`.
- Second phase: `22dff34de28c68ac0bc5dc623fa81d77ca4461ef4c7befdccc3726b7c9aec71a`.

### Independent review and reusable-pattern assessment

A DeepSeek Flash reader reviewed the protocol before successful response
inspection, identified the backoff oracle defect, and later checked the rubric
transfer path, wording and module assertions. Its useful scope correction
(broaden the governor instruction to ordinary reviewer tasks too) is incorporated;
the tested reviewer block is unchanged. Its content-hash/verbatim-copy hardening
suggestions are not added: this task requests overridable prose, not runtime
policy enforcement or a frozen wording API. The conditional SVG concern remains
explicitly unverified in this report. Static source review is not independent
execution of the model pilot or Nix builds.

The delegated reusable-pattern assessment found no new skill warranted: the
existing `docs/drafts/20261102-1947-llm-epistemics/` work already covers frozen
prompt experiments, independent oracle audit and bounded claims. No new skill
draft or memory write is made for this ordinary application of that procedure.

Final independent GLM 5.3 static review reported **no substantive findings** on
the final prose/wiring. It sampled roughly 20 raw responses across every fixture
category and checked the disclosed caveats and rubric-transfer mechanism. It did
not independently execute Nix checks or repeat the model pilot. Parent execution
and byte/hash verification remain the basis for the test claims above.

