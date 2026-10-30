# Additive proposition support: v2

`proposition_support.py` and `semantic-propositions.json` are **evaluator-only**.
Never send the ledger, anchors, context, aliases, evaluator task IDs or expected
values to a model. This is an explicit assessment amendment, not a retrieval,
prompt, annotation, model, alias or execution-policy change.

## Scope and binding

Policy: `proposition-support-v2`. The complete ledger binds the original fixture
**bytes**, SHA-256
`c79739ea73edc3c01af9afb6e1678feb53fdefe1a355ceab669191f3339af306`.
It covers all 16 task IDs: 16 ordered-value propositions across 12 positive
tasks, with empty proposition lists for the four abstention tasks. Only source
facts/questions informed the held-out ledger; no held-out results were used.
Development reassessment is retrospective. Adoption for held-out evaluation is
a prospective criterion amendment only after independent review and freezing.
Keep the original strict scores and original attempts; do not overwrite them.

The validator rejects mismatched fixture bytes/metadata, missing/extra tasks,
duplicate task/proposition identities or value slots, wrong principals, missing
sources/messages, and empty or non-verbatim anchors/context. Required observed
context must retain the original source evidence. The finite anchors are
independently reviewed meaningful propositions, not a generic semantic inference system.

## What changes, and what does not

A valid original-message citation can contain a meaningful exact anchor without
containing an entire gold sentence. Separate valid citations can support separate
requested values from the same message. For example, q01 may cite `last confirmed
offset`; q02 may separately cite `port 4319` and `24 concurrent workers`.

Each proposition also requires the full declared original context to have been
observed through `get_messages`, under the **same** published session, message
identity and ContentView. This establishes production/approval status, negation,
units and other qualifiers. Merely reading the message, citing `the`, quoting an
unrelated clause, or borrowing another source's citation is insufficient. Anchors
are not stitched across arbitrary fragments. Every citation must be valid, even
when other citations already support every proposition.

Citation validity is reused by calling the unchanged `evaluate.score_task` with
each singleton citation. Thus source membership, relevance, exact view, actual
retrieval and absolute verbatim substring checks remain identical; no Unicode
normalization, whitespace rewriting or quotation equivalence is introduced.
Fact matching also remains exactly the existing ordered-value/alias comparison.
The owner-only authorization oracle is unchanged; this is not a general sharing
or group-ACL evaluator.

All legacy result fields, including `factMatch`, `citationValidity`,
`evidenceCoverage` and `answerSuccess`, are returned unchanged. Additional fields
include per-proposition source, supporting citation indices, required context,
observed trace indices, verdict and rationale; `allPropositionsSupported`;
`allCitationsValid`; `correctAbstention`; `executionEligible`; and
`groundedAnswerSuccessV2`.

V2 success requires unchanged fact match, correct abstention, every proposition
supported, every citation valid, no ACL leak, native `Complete`, explicit answer
availability, a complete trace, no execution failure and zero condition
violations. Failed native runs remain failed even for an empty-proposition
negative task or an otherwise correct evaluator placeholder. Incomplete or
normalization-failed traces set `propositionEvidenceAvailable:false` and cannot
pass v2. Existing fail-closed runtime metric handling is untouched; inherited
legacy fields are not a substitute for the new availability/execution gates.

## API and CLI

`assess(fixture, document_catalog, task, answer, trace, outcome, rubric, k, *,
principal, fixture_sha256, answer_available)` requires explicit operator values.
The supplied digest must bind the exact bytes from which the fixture was decoded;
the CLI reads/hashes those bytes together. Outcome and trace task IDs must already
be projected to the evaluator task identity after verifying original opaque IDs.

```bash
python3 chronicle/eval/relevance/proposition_support.py \
  --fixture semantic-fixtures.json --catalog catalog.json \
  --answer projected-answer.json --trace projected-trace.jsonl \
  --outcome projected-outcome.json --rubric semantic-propositions.json \
  --principal reader --answer-available yes --k 5 --out NEW-v2-score.json
```

`--answer-available yes|no` is required, with no default. For a failed/no-answer
case, the operator may supply its explicit evaluator placeholder only with `no`;
retain the native failure and original artifacts. Availability does not repair
an original controller exit. CLI outputs are exclusive-create and bind every
input file hash. Missing or extra task entries are rejected; duplicate JSON keys
at the rubric decoding boundary are rejected.

Controlled local checks:

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
node --test chronicle/eval/relevance/tests/*.test.mjs
```

The test-only source subset preserves original source/fact/alias content. Tests
that append a conflicting unit/proposal use explicitly rebound, test-only input
bytes; they do not edit the benchmark or expand its aliases.
