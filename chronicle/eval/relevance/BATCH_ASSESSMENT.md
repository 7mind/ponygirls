# Portable captured-batch assessment

`assess_batch.py` is a model-free adapter for the directory layout produced by
`run_real.py` and, optionally, `reparse.mjs`. It uses ordinary local imports of
`evaluate.py` and `proposition_support.py`: no dynamic operator module paths,
additional dependencies, providers, service discovery or new model calls.

```bash
python3 chronicle/eval/relevance/assess_batch.py \
  --original ORIGINAL_BATCH --observed ORIGINAL_BATCH \
  --rubric chronicle/eval/relevance/semantic-propositions.json \
  --out NEW_ASSESSMENT_DIRECTORY

# For a previously validated offline reparse:
python3 chronicle/eval/relevance/assess_batch.py \
  --original ORIGINAL_BATCH --observed REPARSED_SIDECARS \
  --rubric chronicle/eval/relevance/semantic-propositions.json \
  --out ANOTHER_NEW_ASSESSMENT_DIRECTORY
```

All four arguments are required. Output must be fresh and disjoint from both
input trees, including resolved symlink ancestors. Files are exclusive-create;
original attempts, reparse sidecars and original strict scores are never edited.
The output contains `summary.json` and `input-manifest.json`. Every consumed
artifact and the adapter/scorer/policy source files are hashed from the bytes read
and rechecked before publishing. Configured credential files are not followed or
read; metadata may contain file paths, never credential bytes.

## Layout and provenance

The original batch supplies `bindings.json`, `schedule.json`,
`preflight/catalog.json`, each `agent-*/input.json`, evaluator-private case map,
controller exit, persisted `run.json`, original outcome/answer and final protocol
page, plus each matching `baseline-MODE-TASK/retrieval.json`. The fixture must
match both its explicit bindings hash and catalog hash; the ledger must validate
against that same fixture. Every scheduled cell must appear exactly once.

Before evaluator-only identity projection, the adapter verifies opaque task IDs,
exact questions, principals, mapping completeness, and that model tasks contain
**only** `id` and `question`. Original persisted instance/run IDs must agree with
the native page. Observed native state cannot replace a different original state;
observed answers must have the original opaque ID and identical original bytes.
It independently counts assigned-mode/project/related-session violations and
requires agreement with the captured outcome.

When observed data is separate, its `source-manifest.json` must name only
allowlisted agent metadata, per-run metadata, answers and protocol pages/events
inside the supplied original batch. Unrecognized paths, including credential
references, are rejected before reading their bytes. Hashes and complete per-run
lineage must match. Both archived parser snapshots must be present and match the
declared historical hashes; neither old installation paths nor escaping parser
symlinks are followed. The source outcome hash must match. Failure payloads must
remain identical, except the known normalization repair restores exactly the
original normalization failure's `priorFailure`; arbitrary deletion is rejected.
This adapter binds and consumes the reviewed normalizer's output; it does not
implement another protocol normalizer or rerun models. Original pages/events
remain available for independent protocol audits.

Answer availability is derived explicitly from retained answer files and passed
to the unchanged v2 API. Only the absent-answer case creates the explicit
unavailable evaluator placeholder, with availability `False`; it never becomes
a new model answer. Native failure and trace/execution gates remain in force.

## Interpret results without rewriting history

- `status:Assessed` means the adapter completed assessment, **not** that all
  answers succeeded or that the original controller completed successfully.
- `answerSuccess`, `evidenceCoverage` and other legacy fields retain the exact
  existing strict scorer semantics. `groundedAnswerSuccessV2` is the separate
  proposition policy result; no old result file is rewritten.
- `originalControllerExit` remains the captured original exit. Offline repaired
  normalization does not turn its original nonzero exit into a successful run.
- `originalNativeState`/`originalNativeFailure` retain operator-compatible observed
  outcome reporting. `sourceNativeFailure` records the original final native-page
  failure; `originalControllerFailure` retains the original controller outcome.
  Thus a native failure cannot be relabelled as native completion.
- Fixed-query Recall@1, Recall@5, all-required-at-5 and MRR use only that cell's
  original fixed baseline. Inherited Recall@k/MRR use the unchanged first
  successful search definition. First-attempted-search fields separately retain
  whether that attempt failed. `anyQueryRequiredCoverage` unions only required
  source coverage across queries; it is **not** pooled ranking or pooled MRR.
- Incomplete or normalization-failed trace evidence gives unavailable additional
  agent retrieval metrics, never observed zero coverage. V2 execution eligibility
  remains false. Fixed baseline metrics are independently available.

Controlled tests use copied versioned synthetic sources and generated run-layout
artifacts; they establish adapter behavior, not semantic model quality:

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
```
