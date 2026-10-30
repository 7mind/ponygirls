# Evidence assessment v3

Evaluator-only sidecar policy `evidence-assessment-v3`; agent helper protocol
`evidence-navigation-v3`. This is not a replacement for the original strict or
proposition-support-v2 operators. Those files, fixtures and rubrics are unchanged.
The original cohort was already running when this policy was authored: any v3
assessment of it is **retrospective**, not preregistered or a fresh holdout.
Freeze the complete new corpus, rubric, review method, schedule, prompts and
artifact bindings before future provider trials. This implementation invokes no
provider and does not provision content.

## Public Python API

`source_observations_v3.py` exports:

- `FrozenSources.from_fixture(fixture, catalog_documents, principal)`: immutable,
  owner-separated fixture oracle. Original fixture messages lacking `role` use
  the defined old adapter role `user`; supplied roles are preserved. Padding
  messages use the existing fixture adapter. Match actual Core.SnapshotProjection:
  replace U+0000 with the literal six ASCII characters `\u0000` before computing
  end-exclusive UTF-8 byte offsets; do not remove it. `normalized_source_text`
  exports this source rule. Never use Python character offsets. This corrected
  the initial v3 assumption; prior draft3 NUL ledgers are not authoritative.
- `observe_trace(opaque_id, trace, sources) -> ObservationSet`: normalized trace
  events use the existing `evaluationTrace` result shape. Every event retains
  its original index, including failed calls. Failed calls yield no evidence.
  Successful recognized-source inconsistencies raise `EvidenceIntegrityError`;
  assessment makes the entire cell's evidence unavailable, not silently filtered.
- `SourceObservation`: task, trace index, tool, exact session/view/message,
  actual message position, role, start/end, text, kind. `wire()` uses camelCase
  JSON fields. Kinds are `whole-message`, `context-excerpt`, `verbatim-snippet`.
- `citation_occurrences(citation, observations, sources)`: every absolute UTF-8
  occurrence of a nonempty quotation inside **one** validated slice, crosschecked
  against frozen source bytes. Repeated occurrences are retained with trace
  indices. A quote never crosses slices, even adjacent ones. Wrong pins,
  identities, unseen quotes and malformed citations return no occurrences.

Whole `get_messages` records must match the complete normalized message;
position is `result.offset + ordinal`, never `recordIndex`. Context excerpts
must match the exact resolved anchor, scalar endpoints, role, nearest-first
bounded windows, message order, maximum nine excerpts and previous/next
zero-width continuation metadata. No clipped excerpt is a whole message.
Legacy `get_messages/get_chunks/get_session` MCP requests use FLAT optional
`revision` and `generationId`, never an invented nested `view`. Unknown nested
legacy arguments fail as evidence integrity errors. Explicit selectors must
match the returned view: generation without revision is invalid; revision alone
means `ContentView(revision,null)`, not a published-generation fallback. If both
selectors are omitted, only the authoritative returned view is used, and it must
still exactly match the frozen catalog source. No HEAD/pin is invented or added
to the preserved original trace arguments. Legacy message/chunk paging defaults
are the actual MCP offset 0 / limit 20; explicit values and returned page metadata
are validated. New context reads remain explicitly pinned with required `view`.
Every scalar endpoint is checked independently, including empty ranges inside
emoji/combining scalars; decoding an empty slice alone is insufficient.

Request fields are exactly `sessionId, view, anchor, beforeBytes, afterBytes`;
result fields are exactly `sessionId, view, anchor, excerpts, previous, next`.
Anchor <=2048 bytes; each side is 0 or 4..2048; at most four neighboring
messages per side. Serialized normalized result <=128 KiB is checked. Actual
64 KiB source admission accounting, SQL 5s deadlines and fresh live authority
checks belong to server acceptance, not Python byte counters.

SearchHit/get_chunks/get_session literal `chunk.text` is evidence only when a
single source span maps byte-for-byte to the archived message under the exact
returned pin (also the explicit request pin for source reads). Summaries/tags
are never evidence. A legacy multi-span aggregate is deliberately unsupported:
validate its span metadata, retain an `unsupported-source-encoding` diagnostic,
and require an original source read rather than guessing its mapping. A valid
single-span snippet can fully support a fact; there is no extra-read tool-name
success requirement.

### Frozen rubric

```json
{
  "policy": "evidence-assessment-v3",
  "fixtureSha256": "<raw fixture SHA-256>",
  "tasks": {
    "q1": {
      "principal": "reader",
      "propositions": [{
        "id": "approved-port",
        "valueIndex": 0,
        "anchorsAny": [{"document":"decision","messageId":"m","start":30,"end":34}],
        "qualifiersAll": [{"document":"decision","messageId":"m","start":21,"end":29}],
        "factualCriteria": "4319 is the approved TCP port, not the rejected alternative."
      }]
    }
  }
}
```

Ranges must identify actual, authorized, scalar-bounded normalized source bytes;
example offsets are illustrative, not a fixture. Exactly one proposition per
ordered `facts.values` slot is required, with nonempty anchors and qualifiers.
Negative tasks have no propositions. Qualifiers may name other messages and be
observed in separate validated slices; each declared atomic range must be
contained in a slice. A citation must contain a declared anchor's **absolute
occurrence**, not merely the same string elsewhere. Required qualifiers/status
must also have been observed. Rejected/irrelevant/contradictory roles cannot
substitute for requested-fact support. No synthetic contiguous quote is built.

## Per-cell assessment and CLI

`assessment_v3.assess_cell(inputs: CellInputs) -> dict` receives immutable
`BoundArtifact(raw: bytes, expected_sha256: str)` values. Hashes are checked
before parsing; duplicate JSON fields fail. Artifacts are JSON except `trace`,
which is JSONL. Missing answers are `None`, never a fabricated empty answer.

Required artifact roles: `fixture`, `catalog`, `rubric`, `configuration`,
`mapping`, `schedule`, `run`, `native_outcome`, `outcome`, `controller`, `trace`,
`fixed_retrieval`. Also provide nullable `answer`, `review`, `legacy_metrics`.
Identity fields are evaluator `task_id`, model `opaque_id`, and independently
frozen `expected_prompt_sha256`. Configuration/mapping/schedule/run retain the
existing workflow shapes. New runs can include evaluator-only `scheduleCell`
with exactly `batchId, arm, repeat, mode, taskId, ordinal`; the full typed row
must occur exactly once in the bound schedule. This supports a global repeated
arm schedule without ambiguity. A legacy batch with a unique mode/task row may
omit the discriminator; repeated rows without it fail closed. This metadata
never enters the opaque id/question-only prompt. `native_outcome` is the original controller outcome;
`outcome` can be the explicitly bound normalization sidecar. It may not replace
native state/failure; a normalization failure retains `priorFailure`.

```bash
python3 chronicle/eval/relevance/assessment_v3.py \
  --manifest cell-manifest.json --out fresh-assessment.json
```

Manifest shape:

```json
{
  "taskId":"q1",
  "opaqueId":"random-model-identity",
  "expectedPromptSha256":"<frozen prompt UTF-8 hash>",
  "artifacts": {
    "fixture":{"path":"/absolute/fixture.json","sha256":"<raw file hash>"},
    "answer":null,
    "review":null,
    "legacy_metrics":null
  }
}
```

The example abbreviates required roles; every role must appear explicitly.
Paths are interpreted by the CLI as supplied. Output must not already exist.
For fixtures with per-mode `task.fixedQueries`, `fixed_retrieval` is a versioned
`{"request":<actual sent arguments>,"result":<original SearchResult>}` wrapper.
The request must match the declared mode-specific query, assigned mode/project,
limit 5 and offset 0. The caller records the actual arguments passed to the
bridge and preserves the original request trace and raw SearchResult sidecar.
Assessment reports the bound request and `fixture.fixedQueryPolicy`; curated
lexical keywords versus natural semantic/hybrid questions are **not** a
same-query lexical comparison. Legacy result-only artifacts are still accepted
for old fixtures without `fixedQueries`, with request provenance explicitly
unavailable. The evaluator cannot prove a fabricated wrapper was actually sent.

The API validates exact fixture/catalog/rubric binding, one scheduled cell,
opaque mapping and id-only/question-only model tasks, question/principal,
frozen prompt hash, native/projected identity/state/failure lineage and observed
mode/project/deny-related violations. The **caller** must independently bind the
manifest, complete batch schedule coverage, run/terminal-page lineage, original
answer availability/bytes and source publication. Per-cell hashes do not prove
live publication, blindness or batch completeness. `legacy_metrics` is an
optional separately bound existing assessment; the old operators are never run
on new-format context traces. Applicability remains the caller's responsibility.

Outputs separate:

1. Native/projected/controller outcomes, availability and trace completeness.
2. Schema, ordered slot count and literal alias/value conformance. The latter is
   **not semantic truth** and does not replace factual review.
3. Explicitly reviewed factual correctness, including units/polarity/status.
4. Exact authorized observed pinned citation provenance and all occurrences.
5. Absolute proposition anchors, qualifiers and observed availability.
6. Reviewed citation roles and rationale/provenance.
7. Fixed/first attempted/first successful retrieval, evidence acquisition,
   navigation, first evidence-available trace index and subsequent operations.
8. Finite fixture ACL, mode/project and deny-related conditions.

Incomplete/normalization-failed traces make provenance/proposition assessment
unavailable. Recognized payload integrity failures do the same. Actual answers,
first attempts and failures are never rewritten. First evidence availability is
an **observable** range-availability metric, not model cognition. Calls,
normalized JSON response bytes and validated slice bytes (including repeated
observations) are descriptive, not actual database admitted-byte counters.
No general ACL proof is inferred from an owner-separated finite fixture.

`groundedAnswerSuccessV3` requires native completion without native failure,
available schema/slot-conforming answer, complete valid evidence, reviewed
factual correctness, correct abstention, all citation provenance, all required
requested-fact proposition support, and no observed comparison/ACL violations.
`execution.nativeEligible` preserves the native-complete/no-native-failure,
answer-available/complete-trace check; whole `execution.eligible` and grounded
success additionally require `controller.exit == 0`. A cleanup/controller failure
cannot become grounded acceptance merely because native execution completed.
Native and controller outcomes remain separately recorded. Literal aliases are
not the truth gate. There is no invented success answer on failure.

An additional `searchContextCorrectCitationWithQualifier` usability observation
requires an actual earlier validated search snippet, a later context read whose
anchor is within that snippet under the same pin, a correct-role citation
observed in that context read, and all required qualifiers in that read. It does
not replace ordinary support from snippets/original reads. Genuine-provider
execution and reviewed factual success must be established independently;
scripted tests cannot satisfy the genuine-agent acceptance claim.

## Frozen factual and citation-role review method

Review policy `blinded-factual-citation-review-v1` is explicit agent-assisted
review, not an alias expansion and not a claim of human review. Before unblinding
arms, the caller prepares packets with the actual answer, factual criteria,
exact source occurrences and surrounding required status/qualifier bytes.
Packets must conceal arm, search mode, native/model identity, controller outcome
and arm-revealing tool traces; source identity can be pseudonymized consistently.
The evaluator-only binding manifest retains hashes, not reviewer-visible native
metadata. Review independently checks value meaning, units, polarity, decision
status and accurate attribution. Every actual citation gets a role and rationale.

```json
{
  "policy":"blinded-factual-citation-review-v1",
  "blinded":true,
  "opaqueId":"random-model-identity",
  "inputHashes": {
    "fixture":"<hash>","rubric":"<hash>","answer":"<hash>",
    "trace":"<hash>","run":"<hash>","native_outcome":"<hash>"
  },
  "reviews":[{
    "reviewId":"review-1","reviewerKind":"agent-assisted",
    "reviewerId":"recorded-reviewer-identity","method":"recorded method/version",
    "rationale":"Meaning, units, polarity and approved status checked against source.",
    "factualCorrect":true,
    "citationRoles":[{
      "citationIndex":0,"role":"requested-fact","propositionIds":["approved-port"],
      "rationale":"This exact occurrence is the approved decision."
    }]
  }]
}
```

Roles: `requested-fact`, `rejected-contrast`, `contradictory`, `irrelevant`.
`review.citationRoleConformance` is unavailable without an available review;
otherwise every citation must be `requested-fact` with nonempty known proposition
ids, or an accurately attributed `rejected-contrast`. Contradictory, irrelevant
and unassigned requested-fact extras prevent aggregate acceptance even when
other citations support all facts. Source provenance and factual correctness
remain separate dimensions and are not rewritten by this role gate.
All supplied reviews are retained. Agreements must match factual correctness,
roles and proposition assignments, not wording. Disagreements are unavailable
unless an explicit `adjudication` record supplies the same review fields with
`reviewerKind:"root-adjudication"` and `resolvesReviewIds` naming all review ids.
Preserve rationales and disagreeing records. `human` provenance is allowed only
when a human actually reviewed; root adjudication is not automatically human.

Without a bound review manifest, factual correctness, roles and reviewed support
are **unavailable**, even when literal aliases match. Review manifests are
trusted explicit records: code cannot independently prove that reviewers were
blinded, identities are authentic, rationales are competent or a supplied human
claim is true. Parent orchestration must retain that provenance. An accurately
attributed rejected contrast may be source-valid while supporting no requested
positive proposition.

## Agent protocol helper

`agent_protocol_v3.mjs` exports `expectedToolsV3('baseline'|'context')`,
`verifyCatalogV3(catalog,input,variant)`, `uniformPromptV3(task,project,mode)`,
`finalAnswerV3(events,opaqueId)`,
`PROTOCOL_V3`, `MAX_OUTPUT_TOKENS_V3`, `EXPECTED_LIMITS_V3`. Baseline has exactly nine known tools;
context has those nine plus `read_message_context`. Unknown/duplicate catalogs
fail. Same prompt in both arms; it accepts **only** opaque id/question tasks,
contains no evaluator gold and offers conditional context navigation guidance.
It preserves the existing sufficient-evidence stopping/insufficiency policy,
read-only authority, exact pins, mode/project and deny-related conditions,
original citation JSON, MAX/65536 output and 900s guards. It adds no controller,
SDK, provider loop, forced finalization or fallback. Existing assembly, paging,
browser, cancellation and normalization helpers are reused unchanged.

`finalAnswerV3` reuses unchanged multipart `assembled(events)` and all original
answer-shape guards, but accepts the actual ContentView `generationId` as a string
or null. It parses the exact original response without mutation, sentinel pins or
rewriting. The old parser remains unchanged; parent version dispatch must select
this helper for v3, including original archive pins.

The verifier requires the closed exact eleven-field comparison limit object:
128 rounds, 127 calls, 16384 prompt bytes, 65536 source bytes, 131072 result
bytes, 524288 request bytes, 1048576 trace bytes, 256 events, **49152 page bytes**,
900 deadline seconds and 600 retention seconds. Page and source admission are
different controls. These are verifier expectations, not application budget
changes. Regression tests load `tests/data/recorded-agent-catalog.json`, a
sanitized retained real native catalog, rather than inventing limit metadata;
every limit's increment, decrement, omission and an unknown field are rejected.
The first helper version incorrectly equated page bytes with source bytes;
recorded-catalog RED preceded this correction.

## Validation scope

Tests use real wire shapes and frozen synthetic bytes through public APIs
(Behavioral-Active/Blackbox-Group; specified origin). The CLI test also exercises
actual temporary filesystem files in a subprocess. Capability RED used explicit
unimplemented contract stubs, not ImportError or a claimed production defect.
Additional direct-audit REDs precede corrections. Test fixtures are not provider
trials. Server/native/full-application acceptance belongs to the owning runner
and server changes, not these model-free tests.

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
node --test chronicle/eval/relevance/tests/*.test.mjs
```
