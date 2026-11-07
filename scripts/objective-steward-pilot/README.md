# Objective-steward feasibility pilot

Isolated experimental instrument for [the design](../../docs/drafts/20261107-1817-objective-steward.md), not an installed Pi extension, production graph API, or Human-benefit study. Uses wholly synthetic inputs and a small prescribed profile. No existing private sessions, hidden reasoning, autonomous work execution, goal-sidecar writes, service changes or extension enablement.

## Implemented boundary

- Strict typed source/objective/claim and steward interpretation/note/assessment/proposal records. Every model-controlled reference/revision is checked against its captured snapshot. Sources/claims/operational goal stay unchanged; proposals cannot adopt themselves or create authority-changing edges.
- Own-account publication/history plus a read-only concise objective view. Worker claim, scoped steward assessment, source links, uncertainty, gaps and missing Human acceptance remain distinct. `reviewed-window` is not complete semantic extraction or verified fulfillment.
- Memory and real SQLite adapters exercise the same behavior. Single-document revision CAS, atomic publication, bounded history, stale input/context/ABA fencing, serial coalescing, late-return rejection and stable issue identity. Identical re-reviews preserve delivery/ack state.
- Feedback seam returns current unresolved issue deltas only at an explicit active boundary. Enqueue acceptance is not acknowledgement, agreement, Human acceptance or resolution; settled work is not woken. **No real SDK enqueue/command/hotkey integration is implemented.**
- Tool-less single-turn pinned Pi SDK worker, explicit provider/model/thinking, no fallback/repair, 180s SDK deadline and 205s parent hard deadline. Parent kills only its own subprocess group and awaits exit. Input/output/stream/pass/history bounds are execution controls, not a token/cost budget. Codex `maxTokens` is a hint, not an established wire generation cap.
- Committed-source export to an immutable Nix-store snapshot before evaluation; generic prompt, source, cases and separate oracle are hash-bound. One fresh Agent per case. Model stdin contains only generic `SYSTEM` and that synthetic input: no oracle, split, expected verdict or scorer rationale.

This is a deliberately narrow replacement for neither Historian nor Codex-goals. The host fixture adapter is trusted synthetic metadata, **not authenticated native-session ingestion**. The profile is experimental; it does not extend Pilot U's schema or ratify the production candidate. SQLite here is an instrument choice, not a production storage decision.

## Reproduction

Prerequisites: pinned Python3.14.8, Node24.21.0, Nix, and pinned Pi1.4.0 SDK. No pip/npm installation is needed. The bridge permits only:

```text
/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo
```

From the repository root:

```bash
python3 -B -m unittest discover -s scripts/objective-steward-pilot -p 'test_*.py' -v
node --test scripts/objective-steward-pilot/live.test.mjs
python3 -B scripts/objective-steward-pilot/run.py validate-corpus \
  --cases scripts/objective-steward-pilot/fixtures/cases.json \
  --oracle scripts/objective-steward-pilot/fixtures/oracle.json
```

The SDK suite's live-provider test is explicitly skipped: it runs scripted streams through the real pinned Agent, not a remote provider. Live evaluation is the separate leg below. Python store/business contracts run memory and SQLite; binding/CLI checks use actual filesystem/subprocesses. Regression-origin controls identify reproduced pre-live failures; other controls are specified-origin. No ordinary app/Chronicle suite is replaced by these pilot tests.

**Commit first:** freezing exports Git objects at the chosen revision, never silently includes working-tree edits. Use a fresh output directory. This invocation discloses only the synthetic corpus to the specified provider, through its existing SDK authentication; it does not authorize a new provider for private histories.

```bash
frozen=$(python3 -B scripts/objective-steward-pilot/freeze.py \
  --repository "$PWD" --revision HEAD)
python3 -B "$frozen/run.py" evaluate \
  --cases "$frozen/fixtures/cases.json" --oracle "$frozen/fixtures/oracle.json" \
  --out "$PWD/.local/steward-live-001" \
  --node "$(realpath "$(command -v node)")" \
  --sdk /nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo \
  --provider openai-codex --model gpt-6.1-sol --thinking medium
python3 -B "$frozen/run.py" score \
  --cases "$frozen/fixtures/cases.json" --oracle "$frozen/fixtures/oracle.json" \
  --out "$PWD/.local/steward-live-001"
python3 -B "$frozen/run.py" view \
  --database "$PWD/.local/steward-live-001/P01/state.sqlite"
```

`view --details` exposes typed notes/proposals, source text and exact issue IDs; `view --history` exposes historical scoped publications. View opens SQLite in read-only mode and performs no inference. It is a CLI projection, **not an acceptance-tested Pi TUI/hotkey**. The raw records remain available rather than being hidden behind summary wording.

## Evaluation protocol and limits

16 cases, 8 development and 8 heldout, 18 claims. Generic prompt frozen before parent inspection of heldout narratives. Agent-authored oracle stored separately; no Human gold or independent-model-family evidence. Read `corpus.md` for counts/rubric. Keep the oracle fixed; no participant reruns, replacement or selective failure removal to manufacture a pass. If a later change is tested, use a separately identified successor run and retain the original.

Exact verdict/citation/primary-source checks are controls, not proof of entailment, complete objective extraction or useful Human oversight. Non-blind parent inspection of the actual synthetic sources and output is a separate qualitative assessment. Usage is SDK-reported telemetry, potentially normalized; null is not zero, and neither SDK counters nor elapsed time establish quality. Report correct-worker false challenges as well as missed challenges.

### Explicit operational gaps

- No safe automatic pending-job crash recovery. A persisted in-flight marker can outlive its process; reopening does not establish provider drain. The prototype intentionally rejects overlapping work and labels the phase as persisted, not current process-liveness evidence. Do not clear it or restart against it merely because a marker looks old. Production needs an ownership/drain bridge. Completed-state reopening is tested; mid-request recovery is not declared solved.
- Ordinary `Controller.close()` fences publication and waits for the worker; it does not itself issue provider cancellation. The live subprocess adapter has bounded timeout/cancellation cleanup. Process exit is not provider-side erasure or proof a remote request never ran.
- No canonical ontology learning, broader cross-root arbitration, native branch/authentication adapters, operational-goal observer bridge, full graph service or real safe-boundary notification integration.
- No Human participants, Human-benefit comparison, measured comprehension improvement or native UI acceptance. A useful next test would compare inspection/correction with existing Historian plus `/goal`, not merely count passing code tests or tokens.
