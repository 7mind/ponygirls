# Synthetic coverage experiment v2

Opt-in, quarantined live-provider experiment; not a production policy change or a
release gate. It reads no archive/database and sends only versioned synthetic
messages from `CoverageExperiment.scala`. `Config.load` supplies the existing
annotation endpoint, model/revision, file-backed credential, request policy,
response bound, deadline and admission capacity; no configuration is rewritten.
Other parsed configuration fields are not used for archive/database access.

From the repository root, compile and run the deterministic self-test:

```bash
nix develop .#chronicle --command bash -c '
  chronicle/scripts/sbt.sh \
    '\''set Test / unmanagedSourceDirectories += baseDirectory.value / "eval/indexing"'\'' \
    '\''Test/runMain chronicle.CoverageExperiment --self-test'\''
'
```

For an explicitly authorized live run, supply a local deployment config and a
**nonexistent** output directory whose parent already exists. Run from the
repository root, replacing the two placeholders (paths must not contain spaces):

```bash
nix develop .#chronicle --command bash -c '
  chronicle/scripts/sbt.sh \
    '\''set Test / unmanagedSourceDirectories += baseDirectory.value / "eval/indexing"'\'' \
    '\''set Test / run / baseDirectory := baseDirectory.value'\'' \
    '\''Test/runMain chronicle.CoverageExperiment /path/to/local-config.json /tmp/fresh-coverage-report'\''
'
```

Never copy/export credentials. The runner requires its checked-in source at
`chronicle/eval/indexing/CoverageExperiment.scala`; the explicit `Test / run /
baseDirectory` setting gives the fork `chronicle/` as its working directory.
An existing output directory fails without
replacement. Do not interpret partially written output as a completed run.

## Paired provider benchmark (optional)

Use two serial legs on the same 12 cases (14 planned windows **per provider**).
These commands do not read a deployment config or start Chronicle. Make two
local annotation-only JSON files of this form, replacing the placeholders with
the respective endpoint, model/revision and existing credential **file path**:

```json
{
  "endpoint": "https://provider.example/v1/chat/completions",
  "model": "provider-model-id",
  "revision": "operator-recorded-revision",
  "credentialFile": "/absolute/path/to/existing-readable-provider-key-file",
  "timeoutSeconds": 900,
  "maxResponseBytes": 1048576,
  "requestPolicy": "strict-json-schema"
}
```

Use a full HTTPS operation URL or loopback HTTP for an owned local endpoint.
Use matching policy, deadline and response bounds for a fair comparison; the
values above are examples, not deployment defaults. Do not paste key material
into JSON, copy any credential, or run as root to read a service's credentials.
Run from the repository root with `nix develop .#chronicle --command`:

```bash
nix develop .#chronicle --command chronicle/scripts/sbt.sh \
  'set Test / unmanagedSourceDirectories += baseDirectory.value / "eval/indexing"' \
  'set Test / run / baseDirectory := baseDirectory.value' \
  'Test/runMain chronicle.CoverageExperiment --provider-baseline /abs/mimo-annotation.json /abs/fresh-mimo-report'
nix develop .#chronicle --command chronicle/scripts/sbt.sh \
  'set Test / unmanagedSourceDirectories += baseDirectory.value / "eval/indexing"' \
  'set Test / run / baseDirectory := baseDirectory.value' \
  'Test/runMain chronicle.CoverageExperiment --provider-qwen-nonthinking /abs/qwen-annotation.json /abs/fresh-qwen-report'
```

Each leg does one case at a time, no application retries, with a whole-leg
bound of `14 * (timeoutSeconds + 30) + 60` seconds. Separate processes may be
run side by side if the endpoints and measurement resources are independent;
otherwise avoid overlapping the legs. Run both even if the first reports a
coverage/classification failure (nonzero exit); keep each exit status and
summary. `--provider-baseline` sends the exact production request (MiMo);
`--provider-qwen-nonthinking` requires `strict-json-schema` and only adds the
request-level `chat_template_kwargs: {"enable_thinking": false}`. It does not
add the coverage reminder, change the schema/token cap, alter production
configuration, or guarantee a provider honored the override. To compare at a
larger completion budget, put the same optional integer `benchmarkMaxTokens`
(2,048–32,768, strict-schema benchmark legs only) in each annotation-only JSON
file. The override changes only `max_tokens`; the effective bound is recorded
as `maxTokens` in each manifest and does not affect production.

Compare coverage and exact correctness over all 14 planned windows, including
blocked windows, and join window records by `caseId` and `window`. Check that
corpus/gold hashes and bounds match, and use `previousSha256` to identify any
different accepted carry. `postElapsedMillis` measures the monotonic elapsed
around `ModelHttp.post` (including credential read and HTTP processing, but
not passage validation/scoring). Compare timings over like outcomes; fast
rejections are not fast annotations. Parsed responses, even if rejected,
include sanitized `usage` counters; missing values are null, not zero, and
reasoning tokens are a subset of completion tokens, not additional. Transport
failures have no parsed usage. Neither reported latency nor counters include
blocked requests. Provider usage is self-reported and tokenization can differ.
The usual sanitized outputs apply: no response text, accepted summaries, or
reasoning text, and the benchmark does not assess summary quality. A single
pass is a paired synthetic observation, not a reliability estimate or proof of
semantic quality on real content.

## Fixed comparison

- Baseline: **exact** `ProblemPassageHttp.request` output.
- Candidate: only `requiredTerminal: {fragmentIndex, scalarOffset}` and
  `coverageReminder` added to the JSON inside the user message. System prompt,
  response schema, source/window limits, previous carry, model, temperature,
  max_tokens and reasoning policy remain unchanged for a given input/carry.
  The configured per-request deadline (including a deployment's 900 seconds)
  is passed unchanged to `ModelHttp.post`; it is never shortened.
- Both modes use actual `ProblemPassages.Source`, HTTP request/response codecs,
  `ModelHttp` admission/telemetry and `ProblemPassages.accept`, not a substitute
  decoder. Nothing is promoted into production or assigned the candidate's
  own production policy identity. `baselineAnnotationIdentity` describes only
  the baseline implementation.
- Twelve deterministic case IDs; 24 case/mode jobs and **28 planned calls**:
  runtime-only negative control, genuine developer assignment, domain facts
  without imperative, mixed Unicode (combining mark/CJK/non-BMP), exactly 64
  fragments, exactly one 2048-byte fragment, legitimate prompt-analysis plus
  runtime context, held-out runtime/developer and domain/system templates, and
  a 65-fragment same-task source spanning two windows, plus dense 24- and
  65-message mixed Problem/Context sources with every fragment exactly 2048
  UTF-8 bytes. The dense65 source exercises the production JSON/window budget
  and accepted carry across two windows.
- The original three held-out templates were frozen before v1 live results.
  V2 adds two stress templates after v1 failed to reproduce a coverage rejection;
  the candidate reminder is unchanged, not tuned against either stress result.
  `heldOut=true` is procedural separation, not a statistical generalization
  guarantee. V1's baseline classified meaningless filler as Context in the
  long2048 fixture, so its single gold mismatch alone does not establish a
  semantic-quality improvement.
- Each mode processes carry windows serially using its own **actual accepted
  prior response**. A failed first window blocks the dependent second window
  and counts as failure, never success. Carry contents can consequently differ
  between modes; `previousSha256` records this confound. This is not a forced
  identical-carry comparison or a full semantic problem-boundary benchmark.
- Jobs use bounded `parEvalMapUnordered(annotationSessions)` plus production
  annotation-session/request admission. No retries and no cost/token budget
  cap. The call ceiling is32; this corpus plans28. A finite whole-run bound is
  `28 * (configuredDeadline + 30) + 60`
  seconds; unfinished windows are failures. Provider unavailability is failure.

The gold is a separate per-message `Kind` vector in evaluator source, never
included in the request. The scorer consumes **accepted production byte spans**,
reconstructs their Unicode scalars from synthetic input bytes, and counts exact
classification. It does not grade summaries or claim real-corpus relevance.

## Artifacts and interpretation

- `manifest.json`: runner-source/corpus/gold SHA-256, baseline identity,
  configured model/revision/policy and numeric bounds. Model/revision are
  configuration observations, not independently verified provider identities.
- `progress.jsonl` and stdout: one JSON line per completed case/mode job, with
  window/coverage/failure counts (plus a whole-deadline event if applicable).
- `summary.json`: all window outcomes, coverage-valid rate over **all 28 planned
  windows**, mismatch/unfinished/failure counts and paired mode aggregates.
  Each validated window has scalar/byte confusion vectors in order
  `[Problem→Problem, Problem→Context, Context→Problem, Context→Context]`,
  accuracies, classificationExact, and sanitized kind/coordinate/continuation
  shape. Confusion totals must equal its exact source scalar/byte count.
  Invalid/blocked windows have no classification score. `validatedOnly`
  accuracy is conditional; `unscoredScalars` and
  `correctScalarsOverAllInputs` retain failed windows in the interpretation.
  Empty score denominators render JSON null, not perfect accuracy.

Hashes use SHA-256 of UTF-8 `Json.noSpaces`, preserving the serializer's property
order. Request hashes bind the exact serialized POST body. Response hashes bind
parsed/reserialized JSON, **not raw transport bytes**; transport/JSON parse
failures have no response hash. Per-window source hashes bind the exact JSON
source, with previous carry hashed separately. Raw responses, message contents,
summaries, credentials, credential paths and endpoints are never emitted.
Failures expose typed rejection reason tokens and bounded structural diagnostics
when available, otherwise allowlisted DomainError codes/static reason labels;
never unchecked exception messages. Output shape includes only known kinds, numeric
coordinates and continuation booleans.

Exit status is nonzero for any coverage failure, unfinished window or scored
classification mismatch; inspect the summary rather than treating process
status as an accuracy metric. Abrupt termination or configuration/output I/O
failure may prevent final summary publication: retain the partial directory and
rerun only into a fresh one.

The self-test is Behavioral-Active / Blackbox-Group, specified-origin. It checks
corpus/call/window bounds, scalar-vs-byte scoring, negative controls, exact mode
delta, production response rejection and actual cross-window carry. It performs
no provider/configuration access. The live experiment is a quarantined
Evil-Communication evaluation; neither self-test nor a scripted provider proves
live model classification quality. Full application suites remain required for
integration and are not claimed by this runner's focused validation.
