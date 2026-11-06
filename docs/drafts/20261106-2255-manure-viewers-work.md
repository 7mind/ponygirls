# Manure convenient viewers — implementation and validation

## Scope

Formatted standalone Markdown, image/SVG, PDF, Mermaid and Graphviz views;
Mermaid/Graphviz Markdown fences; original downloads; agent-facing documentation.
No production deployment was requested or performed.

Standalone roots negotiate HTML viewers; non-HTML clients and ranges retain
original bytes. Directory static paths remain unchanged; directory members have
explicit `/__manure/view/<encoded-path>` URLs. Trusted assets and typed raw
routes retain artifact authorization, expiry and revocation checks.

Pinned browser renderers are bundled locally: marked, DOMPurify, Mermaid,
Graphviz WASM and PDF.js. Checked/unchecked Markdown tasks retain static,
accessible indicators; uploaded form inputs remain forbidden. CSP permits the
renderer-required inline styles, not inline scripts. Mermaid has finite source/
edge bounds but runs on the main thread, without a hard interrupt guarantee.

## Final validation

All counts below are successful final-input evidence, not the earlier diagnostic
runs. Final asset tree:
`/nix/store/dxm8qv5p38mak2ivjfnzqihc0bkk32q1-manure-viewer-0.1.0/share/manure/web/viewer`.

- Backend: `nix develop .#chronicle --command bash manure/scripts/test-backend.sh`.
  Reused worker receipt `20261106T231246Z.5cEWRX` after independently verifying all
  154 source SHA-256 entries against integrated inputs: 15 backend suites/166
  cases and 1 storage suite/32 cases; zero failures, errors or skips.
- Complete JVM target: pinned shell + `manure/scripts/run-owned-target.sh`, owned
  least-privilege PostgreSQL provider, `jvm full`. Receipt
  `20261106T234304Z-jvm.7v0qWb`: **341/341 Python cases**, zero failures/errors/
  skips, **17/17 registered Node cases**, 74 codec vectors and TypeScript
  goldens. Both routing modes passed all 16 new real-browser viewer scenarios.
  Runner inputs, test inputs and final viewer hashes were independently checked.
- Complete installed native target:
  `nix build --no-link .#checks.x86_64-linux.manure-native`.
  Receipt `/nix/store/mzbfkhq6wgzafzb9j7br6y1zbf87dhz9-manure-native-full-target`:
  **341/341 Python cases**, zero failures/errors/skips, **17/17 Node cases** and
  codec goldens. Exact browser-harness source and installed viewer hashes checked.
- Frontend: pinned Node **24.21.0**, Chromium **156.0.8078.47**;
  `node --test test/*.test.mjs test/*.browser.mjs` from `manure/web/viewer`:
  **14/14**, zero failures/skips/cancellations (11 Node + 3 browser cases).
- Installed CLI/MCP/assets: `.#checks.x86_64-linux.manure-client`, **9/9**,
  zero failures/errors/skips. Package
  `/nix/store/lp3smq7s8724aq855kfq4cwmkbqzx2jq-manure-0.2.0`.
- Nix policy/module checks passed: `manure-nixos-eval`, `manure-hm-eval`,
  `agentic-services-hm-eval`.

The full owned-target command used the public descriptor created by
`nix/tests/owned-postgres-environment.nix`, `nix/tests/with-owned-postgres.py`,
`nix/tests/provision-owned-database.py`, and a realized public tools descriptor.
The old descriptor's SDK store path was absent; the project's locked official
MCP SDK **1.32.1** was realized via `nix/pkg/manure/test-dependencies.nix` and its
name/version verified. No unpinned replacement was used.

## Reproductions retained

- Pending PDF `getPage()` had no deadline. Whole page acquisition/rendering now
  shares a deadline, terminates the worker on timeout and cleans late replies.
- Mermaid 12 root `htmlLabels` overrides the deprecated flowchart option;
  sanitization had removed all labels. Root text labels are secured and tested.
- Actual renderer inline styles were blocked by CSP; styles only are permitted.
  Blocked hostile-handler diagnostics are retained separately, exempted only
  for explicitly hostile fixtures; execution, dialogs, unauthorized requests
  and surviving `on*` attributes remain failures. Diagnostic origin is not
  asserted to be established.
- Portrait Fit left a 400×4000 image inside 904×461 available space. Fit now
  constrains both axes, preserving actual-size/zoom behavior and aspect ratio.
- Legal percent filenames were rejected. Resource validation now matches the
  server's single-pass decoding, artifact-root reservations and mount scope.
- GFM checkbox removal lost task state. Static visual/accessibility indicators
  now preserve both states without enabling uploaded inputs.

## Evidence and delivery

Local receipts/screenshots are preserved separately by run under the ignored
`debug/manure-viewers` task directory; preserve them in the main checkout before
removing the owned task worktrees. Source-bound cached evidence is identified
above rather than presented as fresh execution. Earlier incomplete/failed
preflights and reproductions are not counted as final passes.

Codegraph refused access due to foreign/unknown PID namespace ownership; direct
source inspection was used. Pending Q28/Q29 concern other worktrees and grant
no authority to remove them. Merge only this task's commits, retain unrelated
main-checkout changes, verify exact integrated input bindings, then remove only
this task's clean worktrees. Do not push or deploy implicitly.

An optional upload of a public synthetic screenshot returned
`unavailable: network error`; no artifact URL was confirmed and its remote
mutation outcome is unknown. No upload retry or publication success is claimed.

Delegated reusable-procedure analysis checked installed skills and remote draft
overlap. Inert `corporate-activity:skill-draft-trusted-artifact-previews` r1 was
saved and verified; it is not installed or activated.
