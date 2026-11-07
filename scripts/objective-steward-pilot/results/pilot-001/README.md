# Retained feasibility run 001

**Synthetic, single model, single pass; not Human gold or a benefit experiment.**

Source commit: `db883ad84cd03d740f4e301f2025dcfda1d7841a`; pinned SDK Pi1.4.0, API-selected `openai-codex/gpt-6.1-sol`, medium effort. The immutable execution export is `/nix/store/fm6xrigw9gfy04mw1qmns1jh1d0rbpl9-objective-steward-pilot` and can be reconstructed from that commit using [freeze.py](../../freeze.py). No private session history or hidden reasoning is present in these retained records.

- 16 planned/admitted/published cases, 18 claims, no participant reruns/repair/fallback.
- Original oracle label agreement17/18; minimal citation checks18/18; primary-source linking16/16. Development9/9 labels, heldout8/9. These controls do not establish faithful ontology maintenance.
- P13's label mismatch distinguishes claim-warrant criticism from unknown objective truth; preserve the original oracle and17/18.
- P08/P16 mix ancillary work into primary criteria; P16 also puts commentary in criteria. No downstream failure is claimed executed.
- All16 proposal arrays are empty. Actual proposal generation, repair and delivery remain unestablished.

A public hosted copy expires2026-12-07. Its URL is retained in the user handover and ignored local publication receipt, not Git, under the repository local-reference policy. CLI readback matched the retained HTML exactly; public ACL is service-reported, not a separate anonymous-browser acceptance test.

See [full interpretation and limits](../../../../docs/drafts/20261107-2114-objective-steward-pilot.md), [source-first HTML view](index.html), and [qualitative assessment](semantic-review.json).

## Files and bindings

`manifest.json` binds prompt, instrument, corpus/oracle, model selection and source commit. Each `Pxx/` directory retains the exact admitted input, model request, visible response/SDK telemetry, guarded view, objective display, admission and terminal receipt. There are no hidden reasoning blocks or credentials. Original per-case SQLite files remain only in the archived local task evidence, not this textual bundle.

`attempts.json` is the complete case inventory. `score.json` is the original frozen-source grading result. `semantic-review.json` is an explicitly non-blind Agent inspection bound to that score, not a replacement oracle. `telemetry.json` was read/reduced after that qualitative assessment was persisted; SDK counters are not independently verified actual usage/billing. Null is not zero.

`bindings.json` records SHA256 for117 original retained text files (before this README and presentation were added). `presentation-bindings.json` separately binds the rendered HTML and its inputs/generator. Verify these before presenting a transported copy as the same evidence. A successful hash check establishes bytes, not semantic truth, Human comprehension or authorization.

## Inspect without inference

`index.html` is a static escaped presentation. Opening details performs no API calls, acceptance or execution. To regenerate it from the repository root, using a fresh output file:

```bash
python3 -B scripts/objective-steward-pilot/report.py \
  --cases scripts/objective-steward-pilot/fixtures/cases.json \
  --oracle scripts/objective-steward-pilot/fixtures/oracle.json \
  --out scripts/objective-steward-pilot/results/pilot-001 \
  --html .local/steward-pilot-view.html
```

This validates bound original artifacts, not a fresh participant run. Native `/objectives`/hotkey, authenticated source ingestion, actual worker feedback and pending-crash recovery are not implemented by this pilot. Safe native integration and Human inspection/repair evaluation are the next boundary, not autonomous intent rewriting.
