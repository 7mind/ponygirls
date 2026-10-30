# Explicit runner/probe integration

`run_real.py` requires `bindings.workflow`; omission never selects a pipeline.
Existing native/browser controller, ownership, credentials, deadlines, paging,
cancellation and cleanup remain the execution boundary. No alternative model or
SQL controller is introduced.

## Binding API

`runner_integration_v3.WorkflowBinding.parse(value, phase)` returns frozen
`WorkflowBinding`, `ExecutorCodecs` and (for run) `BatchBinding` values.
`validate_workflow_bindings(bindings, phase)` additionally checks actual executor
files, exact max/65536 agent settings and fresh publisher agreement.

```json
{
  "sourcePolicy": "trusted-workflow-v3",
  "fingerprintPolicy": "digest-state-v3",
  "protocolPolicy": "evidence-navigation-v3",
  "catalogVariant": "context",
  "executorCodecs": {
    "project": "/absolute/executor-project",
    "files": [
      {"relativePath": "generated/typescript/example.ts", "sha256": "<64 lowercase hex>"}
    ]
  },
  "rubric": {"path": "/absolute/v3-rubric.json", "sha256": "<64 lowercase hex>"},
  "batch": {
    "batchId": "batch-1", "arm": "candidate", "repeat": 1,
    "schedule": {"path": "/absolute/master-schedule.json", "sha256": "<64 lowercase hex>"}
  }
}
```

The illustrated file list is abbreviated; every generated TypeScript file must
be declared exactly once with its actual hash. The only source/fingerprint pairs
are `archived-bridge-v1` / `full-state-v1` and `trusted-workflow-v3` /
`digest-state-v3`. Catalog variants are exactly `baseline` (9 tools) or `context`
(10). Fields are closed at workflow, codec, bound-file, batch and schedule-row
boundaries. `batch` must be explicitly null for prepare. There is no V2 rubric or
optional grading pipeline in these bindings.

For run, master `trials` rows have exactly
`{batchId,arm,repeat,mode,taskId,ordinal}`. Repeat is a positive integer; ordinal
is a nonnegative integer unique within batch/arm/repeat. The selected batch,
arm and repeat must cover exactly the requested split/tasks/modes once. Order
and row identities are copied, not randomized or renumbered. The master hash
and selected exact rows are retained in `schedule.json`; each probe `run.json`
has that same `scheduleCell`. Original `trial_schedule` remains available to
construct seeded schedules, but the runner does not silently generate one.

## Publisher and executor separation

Top-level `generatedProject` / `generatedFiles` remain immutable **publisher**
declarations. `clone_prepared` retains the old native, protected-metadata,
publication-input, data inventory, private-credential and offline-copy checks;
it also compares `generatedProject` and checks explicit source/fingerprint
policy before copying data. Never rewrite seed bindings to admit an executor.

The probe uses only the independently verified/frozen `workflow.executorCodecs`.
Fresh prepare requires exact publisher/executor file-set/hash agreement, not
identical absolute project paths. An archived ELF can use a private frozen
codec project; historical codecs need not exist in the current repository.
Hello uses that project's loaded `ClientEnvelope.BaboonDomainVersion` only.

The original full-state fingerprint function remains byte-identical (16 tables,
six selected jobs columns). Its wrapper adds `policy: full-state-v1` outside the
original hashed state. Trusted digest fingerprints use `digest-state-v3` and
must not be compared to old full-state hashes. Summaries, fresh prepared proofs
and before/after publication artifacts name the policy. Old unlabelled seeds
are admitted only with the explicit archived pair and get a separate
`seed-policy.json` record marked `historical-unlabelled-seed`.

## Pipelines and evidence

Archived policy retains the small Bridge ingestion/preflight/fixed behavior,
including its whole-message fixed-baseline reads. This is publication regression
support, not production wire compatibility. Trusted policy calls
`workflow_v3.provision_documents`, `verify_publication`, `fixed_retrieval` and
`fingerprint`. The manifest binds the actual owned/config/index-profile-catalog/
fixture files. The exact existing owned/deadline-checked SQL closure is passed
through unchanged. Fresh empty phase directories are precreated. Original raw
receipts and parsed receipt maps remain distinct; fresh seed metadata hashes
all ingest/preflight artifacts. Trusted fixed output keeps both actual
request/result wrapper and raw `retrieval.json`, without fetching messages.

Preflight and rubric/source validation finish before any fixed retrieval or
agent start. Trusted acceptance requires accepted work, exact source roles and
normalized fingerprints, Problem/Context separation, valid vectors and at
least 1001 actual eligible pieces. A failed prerequisite raises, retains phase
attempt/failure evidence and reaches ordinary owned cleanup; no retry or
fallback starts an agent.

Only opaque task id/question enter `uniformPromptV3`. Protocol policy, actual
loaded API version, catalog variant and schedule identity are recorded outside
the prompt. Exact catalog/limit checks and `finalAnswerV3` are shared helpers,
not copies. Conditional context instructions are identical across arms. Raw
native pages, pre-normalization controller outcome, normalized outcome, trace,
answer and controller exit remain separate artifacts.

`score.json` retains unchanged `score_task` historical-format metrics and an
explicit scope label; summary status still reflects those strict metrics and
controller exits, not V3 review success. V2 remains separate unchanged
`assess_batch.py` postprocessing where applicable. `assessment-v3.json` is a
separate sidecar using exact bound artifact bytes. No review is fabricated:
factual/role judgments remain unavailable and grounded V3 success is false
until an actual review is supplied to later assessment. Missing actual
controller artifacts produce an explicit unavailable sidecar, never an
invented run/prompt/trace. The sidecar's prompt hash identifies the preserved
actual prompt; it is not an independent preregistration claim.

## Freezing and validation limits

`frozenInputs` must cover all 13 local Python/JS runtime files, fixture, config,
embedding proof, both profiles, V3 rubric and bound master schedule (run), plus
all declared `runtimeFiles` and the Playwright entry file. External runtime
closure declarations remain the caller's responsibility; copying declared
files does not independently discover dynamic SDK or standard-library imports.
A contract test traverses all local static Python/JS imports and confirms none
are omitted. Generated executor TypeScript is an independently exact-set/hash
snapshot; original and frozen codec sets are reverified at completion.

Python/Node contracts exercise policies, seed guards, local dependency freezing,
real temporary filesystem copies, schedule identity, sidecar preservation and
probe helpers. They are not real SQL/native/browser/provider acceptance. Parent
owns final source/import verification, external runtime-closure review and
actual application acceptance.
