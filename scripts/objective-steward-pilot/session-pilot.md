# Full-session ontology-maintenance pilot (separate from snapshot pilot001)

## Correct target

The requested behavior is **automatic maintenance of an ontology account and intent tags**, not editing Human intent. Revising nodes/types/links when understanding changes is normal curation and does not need per-change Human approval. Source Human/worker/tool messages remain immutable. In the earlier snapshot-pilot discussion, treating empty correction-proposal arrays as a failure of this requested workflow was a framing error. Its original evidence/results remain historical; they do not establish longitudinal maintenance.

## Frozen procedure

- One compact, wholly synthetic, coherent24-event session;12 chronological update boundaries, not12 unrelated test cases. No private history or live goal/service mutation.
- Generic prompt frozen before parent inspection of the independent author-produced narrative/oracle or any live outcome: SHA256 `a256334222b4c4123168c4df6fb7b667b31ecf721cc0ec3f98f93a7f2f0ce045`.
- Each call receives raw source prefix and **actual last committed model-produced graph**. Initially empty; no host-authored objective/claim records, no oracle/selector/rationale fields. A fresh tool-less Agent performs each boundary update, while one SQLite-backed graph/history persists across them. This tests longitudinal ontology state, not retention in one Agent's hidden conversational context.
- Model: `openai-codex/gpt-6.1-sol`, medium thinking, existing pinned Pi1.4.0 bridge. Exactly one original admission per checkpoint, no JSON repair, replacement, semantic rerun, model/provider fallback or outcome-based fixture/oracle/prompt edits.
- Automatic full-graph replacement preserves entity/relation IDs and historical graph versions. Own-account text/types/tags/states/edges may change directly. No source editing, Human-ratification invention or execution authority. Structural guards are not semantic verification.
- Explicit failed-response policy: retain original response/failure, do not publish invalid graph, expose stale source coverage, carry only the last valid graph to the **next distinct** checkpoint together with the full current source prefix. This is not a rescue of the failed checkpoint. In-flight restart is blocked, not replay authority. Persisted phase is not process-liveness proof.
- Guards:48events/16checkpoints maximum,64nodes/96relations,240characters/node,32KiB graph,128KiB SDK input,180s bridge/205s parent deadline per call. Finite12-call measured sequence. No financial token caps.
- Independent predeclared oracle checks classification/cardinality, selected links, concept continuity and forbidden classifications. Matchers are deliberately bounded controls, not entailment/accuracy. Count all planned/attempted/published/failed/unattempted checkpoints; do not report only passing final state.
- Preserve exact requests, replies, prefix/previous-graph bindings, SQLite history, per-checkpoint receipts and aggregate inventory. Score reconstructs original replies and verifies previous-graph continuity; no hand-authored state spliced into the trajectory.
- Parent inspects all graph versions and sources, makes non-blind qualitative judgments and persists them **before telemetry reduction**. Same-family Agent review is advisory, not independent-family/Human gold or Human-benefit measurement.

## Checks and invocation

Core specification contracts run against hand-written MemoryStore and real SQLite. Runner contracts use a scripted transport and real files/SQLite, exercise continuity, cancellation accounting, retained invalid originals and evidence-chain attacks. These establish workflow behavior only.

```bash
python3 -B -m unittest discover -s scripts/objective-steward-pilot -p 'test_session*.py' -v
python3 -B scripts/objective-steward-pilot/session_run.py validate \
  --session scripts/objective-steward-pilot/fixtures/session-001.json \
  --oracle scripts/objective-steward-pilot/fixtures/session-001-oracle.json
python3 -B scripts/objective-steward-pilot/freeze.py --repository "$PWD" --revision COMMIT
```

Run `session_run.py evaluate` from that immutable export with its exported `--session`, `--oracle`, a new `--out` directory and explicit `--node`, `--sdk`, `--provider`, `--model`, `--thinking`. Then `score` uses the same committed corpus/oracle and original output directory. `score_result` also supports read-only recomputation without overwriting original scores. `test_runner.py` in the existing full suite still requires the explicit repository/revision/artifact environment described in the main README.

## Limits

A compact source prefix fits the model window. This does not test context eviction, compressed-source-only operation, long real development histories, asynchronous native event capture, branch navigation, production CQ4 schema, hotkey/UI integration, trustworthy live-source authentication, a second goal writer or actual Human inspection/repair benefit. These limits do not turn routine ontology corrections into approval proposals.
