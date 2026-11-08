# Artifact browsing, browser sessions and password retrieval validation

Validated application/test source: `edc2478fb193db3e7d2a4ee47f5ece806df6e5ed`.
This document is added afterward; it changes no compiled or test inputs.
No live artifact, browser credential, production database or deployment was used.

## Delivered behavior

- Directories without `index.html` or `index.htm` list immediate files and
  directories, with encoded links, downloads, parent navigation and empty-directory
  handling. Existing index pages remain unchanged. Case-insensitive `readme.md`
  selection renders through the existing bundled Markdown viewer.
- Path-hosted internal document navigation exchanges a live human dashboard
  session for the ordinary artifact-scoped grant. Cross-site links first use a
  bounded, inert same-origin continuation because Strict session cookies can be
  withheld on the initial request. Strict cookies, exact Origin validation,
  subdomain isolation and raw/API authorization boundaries are unchanged.
- Uploads have a password Copy button. External artifact details can retrieve
  and copy the current password without rotating it or revoking grants. Q38
  explicitly authorized retrieval by every registered user. Historical hash-only
  records require one explicit rotation; retrieval never rotates automatically.
  Passwords remain absent from metadata, manifests, search, sidecars, logs and
  browser storage. The dedicated PostgreSQL secret table and backups require
  credential-grade protection; no separate encryption key is configured.

## Final checks

Commands ran in the pinned `nix develop .#chronicle` environment with owned
PostgreSQL clusters and pinned Chromium/Node dependencies. Fresh report directories
retain earlier reports rather than hiding failed runs.

| Check | Result | Evidence |
| --- | --- | --- |
| `bash manure/scripts/test-backend.sh` | 15 backend suites / 186 cases; 1 storage suite / 32 cases; 0 failures, errors or skips | `final-backend/` |
| Owned-provider `bash manure/scripts/test-target.sh jvm full` | All 359 registered Python cases, including real-browser, migration, durability and recovery checks; 0 failures, errors or skips | `final-target/summary.json`, `inventory.json`, `outcomes.jsonl`, `run.log` |
| Full target Node gates | 32 cases across current protocol, network capture, query expressions and upload; 0 failures or skips | `final-target/node-*.log` |
| Full target TypeScript codecs | All 76 vectors passed; removed/future-version and strict framing checks retained | `final-target/typescript-goldens.log` |
| Actual assembly/resource binding | Every packaged SQL resource matches source; frozen migration 1 matches its original bytes | `final-assembly-binding.json` |

All paths in the evidence column are under the retained local archive
`debug/manure-browsing-password-202611/`. The final target runner was
`run-final-target.sh`; its explicit provider/tool descriptors are retained there.
It invokes `manure/scripts/run-owned-target.sh` with the repository's owned
PostgreSQL wrapper and paired restricted-runtime provisioning helper.

The backend run was fresh against `7f29cb95`. Its 218-case evidence is explicitly
**reused**, not claimed as another fresh execution: the subsequent correction
changed only Python fixture ownership/assertions and documentation. Every recorded
backend input was rechecked byte-for-byte (`backend-input-reuse-check.log`).
The complete target run was fresh against `edc2478f`.

The JVM assembly SHA-256 was
`455fd10f1aa8b11165699916cb6b5dbd11a8db105a44c8f0f400e55b12a7cb75`.
Compiled inputs, test inputs, viewer assets and assembly digest were checked
against the final reports. Viewer assets were reused unchanged from the explicit
main-checkout `manure/web/viewer/dist` directory; the runner records their hashes
and dependency locks. This is not a claim of a fresh viewer build.

## Reproductions, corrections and review

Fail-first evidence includes no-index 404, missing lowercase README preview,
missing upload/current-password Copy controls, internal navigation without a
grant, and real Chromium cross-site navigation with its Strict session withheld.
Regressions found during integration were reproduced before correction:
external password forms bypassed by navigation preflight; generated optional
password values needing explicit null normalization; stale 74-versus-76 codec
inventory; and imported secret-table ownership omitted from the restricted
runtime handoff. The latter was narrowed to a failing real PostgreSQL privilege
assertion before adding that table to the explicit handoff. Both focused migration
cases then passed, followed by the complete 359-case target run.

Earlier passing, failing and diagnostic receipts remain in
`pre-retrieval-backend/`, `pre-retrieval-target/`, `retrieval-first-backend/`,
`migration-handoff-receipts/` and `worker-receipts/`. They are historical evidence,
not substitutes for the final run. Independent source reviewers found no remaining
substantive defects after the corrections; their static reviews did not replace
execution. Reusable-skill analysis found no distinct candidate beyond the existing
Manure, Baboon and testing skills.

These are source/JVM/browser results. Native-runtime acceptance, installed-package
behavior and production deployment have **not** been established.
