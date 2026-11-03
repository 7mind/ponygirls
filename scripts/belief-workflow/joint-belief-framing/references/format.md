# Cooperative record format v1

This is a small document checker/projector, not an authority ledger, semantic
approval parser, requirements database or evidence runner. All authors, source
attributions, interpretations, dependency identities and outcomes are supplied
by the record author. Even `by: "human"` is not authenticated. Invalid references
are detectable; false but internally consistent declarations are not.

## Commands

From the repository root, set the explicit script path:

```bash
tool=scripts/belief-workflow/joint-belief-framing/scripts/bookkeeping.py
python3 "$tool" snapshot INPUT.json
python3 "$tool" check SEALED.json
python3 "$tool" render SEALED.json
python3 "$tool" diff PREVIOUS.json CURRENT.json
```

Python 3.11+; standard library only. All input paths are explicit. There is no
stdin fallback, output-file option, network access, artifact traversal or command
execution. Results go to stdout; validation and I/O failures go to stderr.
Never redirect output onto an input path: the shell would truncate it first.
A shell redirect is not an atomic/durable publication mechanism.

- `snapshot` validates an unsealed or sealed bundle, adds missing fingerprints,
  and emits sealed JSON. An existing incorrect fingerprint is an error, never
  silently repaired. It does not establish authorship, approval or past immutability.
- `check` requires fingerprints and reports record integrity and evidence-selection
  matching. `consistent: true` has **only** `record-integrity-only` scope.
- `render` requires fingerprints and emits Markdown with complete active claim
  conditions/open matters, selected and referenced dependency declarations, attributed
  interpretations and reported evidence scope. It does not resolve conflicts,
  choose the active baseline or decide which interpretations are faithful.
- `diff` requires two sealed bundles. Every previous immutable record must remain
  present with identical canonical content, regardless of recomputed hashes.
  It reports additions, active-selection changes and evidence applicability.
  Selection changes are not authorization or human intent revision.

Exit codes: `0` structurally consistent (ordinary differences and stale evidence
are allowed); `1` invalid data/history, including the explicit input-size bound;
`2` invocation or I/O failure. Errors produce no successful snapshot/projection
on stdout. Inputs are bounded at 4 MiB; oversized inputs fail, never truncate.

## Shape

The root has exactly these fields, all required:

```json
{
  "version": 1,
  "sources": {},
  "interpretations": {},
  "claims": {},
  "dependencies": {},
  "evidence": {},
  "active": {"claims": {}, "dependencies": {}}
}
```

Record maps use exact `ID@N` references. IDs start with an ASCII letter and contain
up to 64 ASCII letters/digits/underscores/hyphens. Revisions are positive integers,
without leading zeroes. References are globally unique; an ID family stays in the
same collection. Active selections map a stable ID to its exact retained revision,
e.g. `"claims": {"G": "G@2"}`. Older revisions remain available, not overwritten.

The version must be integer `1`, not boolean or float. Duplicate JSON keys,
unknown/missing fields, nonfinite/floating-point numbers and invalid UTF-8 scalar
strings are rejected. Text is not stripped, Unicode-normalized or whitespace-folded.

Each record has `_sha256` in sealed bundles. That is the SHA-256 of its body,
excluding only its own `_sha256`, encoded as:

```python
json.dumps(body, sort_keys=True, separators=(",", ":"),
           ensure_ascii=False, allow_nan=False).encode("utf-8")
```

The snapshot output escapes Unicode in JSON without changing decoded strings.
Only `snapshot` permits an absent fingerprint; all other fields below are required.
Fingerprints detect changed bytes against the provided reference—not authenticated
history. Rewriting both previous and current files can defeat cooperative comparison.

## Records

### Sources

An input source has `kind: "input"`, `by`, `text` and `source_ref`. The last is
an opaque declared origin locator (e.g. an actual conversation-event reference,
or an explicit manual-transcription description); it is never opened or authenticated.
An empty locator records a provenance gap. Input can be an unsolicited request/
correction; it need not answer a proposal. Keep the original text and context,
not an invented normalized approval.

A proposal has `kind: "proposal"`, `by`, `text`, `source_ref` and `scope`. Scope is a map from
scope IDs to exact proposed clause text. It records the author's account of what
was displayed; the CLI does not authenticate actual presentation or verify that
those clauses faithfully represent the presentation.

### Interpretations

Fields: `by`, `input`, `kind`, `proposal`, `scope`, `text`.

- `input`: exact source revision whose kind is `input`.
- `kind`: `instruction`, `scoped_approval` or `unresolved`.
- `proposal`: exact proposal-source revision or explicit `null`.
- `scope`: array of unique declared proposal-scope IDs. Without a proposal it is
  empty. A scoped-approval interpretation requires a proposal and nonempty subset
  of its scope. Other interpretations may retain a proposal as context.
- `text`: attributed explanation, not a mechanically verified reading.

A new interpretation revision cannot rewrite its raw source or an older proposal.
The CLI never reads “yes” as agreement, detects topic changes semantically, or
resolves incompatible acts by latest timestamp. It validates the *declared*
relationship. A deliberately false interpretation can still be structurally valid.

### Claims

Fields: `by`, `kind`, `text`, `conditions`, `basis`, `dependencies`,
`evidence_route`, `open`.

- `kind`: `goal` or `assumption`; neither becomes true or authorized by being recorded.
- `conditions`, `open`: full string arrays; no silent row limit/truncation.
- `basis`: interpretation revision references, not automatic human ratification.
- `dependencies`: exact dependency revision references.
- `evidence_route`: proposed route, with an empty string honestly recording a gap.

Editing text, conditions or applicability means a new claim revision. No automatic
semantic-equivalence judgment, entailment, goal-graph refinement or readiness flag
is implemented. Source text lives in the bundle; the projection identifies basis
references rather than reproducing every raw conversation exchange.

### Dependencies

Fields: `by`, `kind`, `ref`, `digest`.
`kind` is `artifact`, `check`, `environment` or `oracle`; `ref` is an opaque locator
or description, and `digest` is declared lowercase 64-hex SHA-256. The locator is
never opened or executed. Even an existing file at that path may have changed.
Select intended current revisions in `active.dependencies`; record new revisions
when the declared inputs change. Dependency completeness is not verified.

### Evidence

Fields: `by`, `subjects`, `dependencies`, `scope`, `outcome`, `text`, `artifact`.

- `subjects`: nonempty array of exact claim revision references.
- `dependencies`: exact dependency revisions, including every dependency declared
  by the subjects. Additional dependencies are allowed and count for applicability.
- `scope`: explicit checked-scope strings. Empty means none recorded, not universal coverage.
- `outcome`: `pass`, `fail`, `error`, `skipped`, `unavailable` or `unchecked`.
- `text`: attributed result description.
- `artifact`: `{ "ref": "opaque locator", "digest": "64-hex SHA-256" }`;
  explicit `null` is allowed only for skipped/unavailable/unchecked outcomes.

`current_selection_match` is true only when all evidence subjects and dependencies
are exactly selected. It is not freshness against the actual runtime, artifact
verification, broad goal support or semantic correctness. Historical records remain
valid but are reported as not matching the active selection. Conditions-only claim
changes invalidate automatic reuse. Unchanged explicitly declared bindings may
match, but missing dependencies or incomplete oracles remain possible.

Findings retain declared evidence authors, subjects, dependencies and checked scope.
Markdown includes unselected dependency declarations referenced by active claims or
historical evidence, rather than replacing their checked environment with the
currently selected one. Historical metadata remains identified, not made current.

The tool does not run checks, read reports, judge oracle independence or verify
external digests. A recorded pass is only a reported result for its recorded scope.
No evidence and unchecked scope are not transformed into either success or failure.

## Rendering and privacy

Free text is placed in dynamically sized fenced blocks. Markdown/HTML/backticks
remain data; terminal/format controls are displayed as visible Unicode escapes,
while exact originals remain in snapshots. This is not a hostile-agent sandbox.

Only provide authorized material. Do not import private acceptance cases during
framing, credentials or an entire conversation archive merely for convenience.
Nothing is automatically discovered, uploaded, installed or added to a user's
profile. Generated Markdown is not safe to treat as a new authority source.
