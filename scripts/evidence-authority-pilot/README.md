# Evidence-authority pilot components — development, not live acceptance

Follow-up design: `../../docs/drafts/20261108-1252-live-ontology-freshness.md`, section13.

Current components:

- `evidence.py`: host-owned file/execution observation records, write generations, model assertion qualifications and explicit completion-action ordering policies. A matching typed digest never verifies accompanying prose or grants acceptance.
- `deltas.py`: pure atomic graph-delta admission, stable relation proposition identity, immutable prior-source pins and incremental request construction. Failed proposals cannot consume an eligible source frontier or partially change the supplied head.
- `legacy_domain.py`: unchanged domain/projection source from immutable first-pilot source `/nix/store/g5hyq8zji1vd33893ymcrqdgzpc4m3ag-ontology-loop-measured-source-001/domain.py`. This is deliberate baseline reuse, not a copy of an uncommitted working tree. The original artifact and all original trajectories remain untouched.

These are NOT a completed runner, model transport, corpus, source-retrieval tool, persistent transaction protocol, sandbox acceptance or next-pilot result. Supporting-worker setup was restored and verified by a separate same-model smoke check; Q46 is dismissed without model-substitution approval. No new scientific original or experimental participant inference has run. The generic common worker prompt was frozen before any new corpus authoring; private evaluation content must remain unavailable to participants/runtime authors.

## Trust and applicability

Only the trusted host adapter calls the evidence-capture API. Python dataclasses/IDs are not authentication against malicious in-process callers. A model-facing parser accepts evidence references, not host fact values. Capturing a process result does not prove its stdout truthful or its tests exhaustive. Completion-action status concerns only the declared action, not full scenario fulfillment or Human acceptance.

`DiskBytes` requires a fresh owned directory with stable ancestors and no hostile concurrent writers. Leaf no-follow checks reject symlinks. This component is not a universal mount/ancestor-race, same-byte external replacement or crash-durability proof. The integrated launcher still needs detached authorization, source/runtime pinning, confinement and explicit lifecycle evidence. Filesystem write and journal persistence are not claimed atomic across a crash.

Same-byte writes advance generation. `after_latest_write` requires the exact generation snapshot; `exact_content` permits reuse only for equal declared content identities. Historical observations remain immutable. Coverage and applicability are separate; model text is always unverified as prose, even with current coverage and correct cited values.

## Controls

Run from repository root with pinned Python:

```bash
/nix/store/r6vdzip0gz5zj2pjdbmqckfsb4q7nz4m-python3-3.14.8-env/bin/python3 -B -I -S -m unittest discover -s scripts/evidence-authority-pilot -p 'test_*.py' -v
```

One shared behavioral contract runs against manual memory and real owned-filesystem adapters. Disk-specific controls cover external mutation and symlinks. Pure delta controls cover source/frontier/identity and fact-reference admission. Test fixtures are fictional; passing them is not semantic quality, live-model acceptance or an independent implementation of an oracle. Temporary fixture directories stay under ignored `.local/` and are cleaned only by their owning test.

Root first observed42 and then57 specified controls passing. Two additional regression tests then reproduced concrete admission defects: execution facts accepted as file-digest operands, and changed source bytes accepted under an unchanged prior event ID. Original source/logs are retained under `.local/delta-reproduction-001/`; operand-kind validation and retained prior-source digests address those failures. The complete65-case run passed with zero failures/errors/skips, source pins unchanged. A second failing reproduction then showed that foreign-branch/session events could enter the candidate input under a local frame. Explicit host-supplied expected session and branch checks now reject them; the source/log epoch is retained under `.local/delta-reproduction-002/`. The then-current67-case unfiltered run passed with zero failures/errors/skips and unchanged source pins. A subsequent independent source review found three further defects. Root retained the predicted failing71-case epoch (2 failure entries/3 errors), then restricted completion reads to the contract subset, made relation-proposition identity unique regardless standing, and added typed relation replacement links. The complete current76-case unfiltered run passes with zero failures/errors/skips and unchanged source pins. New positive/negative controls cover optional/unowned paths, replacement endpoints/source basis/standing/host revision and history retention. Counts are not a completeness proof. Final integrated controls/review and a genuine actual-path preflight remain required before originals.

## Candidate delta schema epoch2

Every delta requires `scope`, `base_revision`, `reviewed_new_event_ids`, `nodes`, `relations`, and `relation_replacements` (an explicit array, empty when absent). Each replacement item has ONLY `old_relation_id`, `new_relation_id`, `reason`, and nonempty unique eligible `sources`. The old relation must exist and be active in the prior head, and become withdrawn/superseded; its new distinct proposition must be a fresh active relation ID. Unknown/reused endpoints, duplicate replacements, bad sources or curator-supplied revision fields reject the whole delta. Host-stamped revision and immutable replacement history live in `Head.replacements` and incremental `previous_relation_replacements`. This makes declared correction provenance representable; it does not detect every unstated semantic replacement intention.

`Artifacts.versions_for(paths)` inspects only an explicit inventory. Optional authorization is not an input requirement; missing REQUIRED artifacts still fail explicitly, never become zero-length observations. The runtime public action wrapper must additionally bind canonical arguments/cwd/contract hash and outer launcher evidence; the shared primitive's narrower fields do not silently certify that integration.
