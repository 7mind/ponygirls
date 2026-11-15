# Persistent account backend validation — 2026-11-15

Local source/verification only; no push, deployment, real credential migration,
or native/browser acceptance claim.

## Fail-first observations

All reproductions used the pinned `nix develop .#chronicle` environment and an
owned disposable PostgreSQL cluster/root. No production credentials or data.

- `manureServer/testOnly manure.HttpSuite -- --tests *account*`: new anonymous
  account settings route returned 404 instead of required 401 before the account
  slice existed (1 expected failure). Captured in
  `manure/backend/target/auth-fail-first.log`.
- `manureServer/testOnly manure.HttpSuite -- --tests *stale*`: token issue ignored
  a stale settings actor and returned 200 instead of 409 (1 expected failure).
  Captured in `manure/backend/target/auth-actor-fail-first.log`. Final tests also
  exercise an actual owner-A settings actor with owner-B's current cookie for
  issue/revoke/logout, and missing/duplicate/malformed actor headers.
- `manureServer/testOnly manure.HttpSuite -- --tests *reauthentication*`:
  replaying a revoked browser cookie blocked the public shell with 401 instead
  of 200 (1 expected failure). Captured in
  `manure/backend/target/auth-recovery-fail-first.log`.
- `manureServer/testOnly manure.AccountsMemorySuite manure.AccountsPostgresSuite -- --tests *publication*`:
  revoking the runtime token after the initial finish transaction still committed
  publication and returned Ready instead of unauthorized (2 expected failures).
  Captured in `manure/backend/target/auth-publication-fail-first.log`. The fix
  revalidates credentials in the transaction committing publication intent;
  already-committed publication recovery is unchanged.
- The independent artifact-input manifest fixture failed after adding the new
  compiled `shared/service-auth` input to its expected set (4 cases, 6 subtest
  failure reports). Adding that source subtree to the generator made all 4 cases
  pass, including location independence and excluded-input controls.

The focused account/publication/HTTP run after corrections passed 41/41 with no
ignored cases; more tests were then added before the full run below. A read-only
review identified the publication-intent gap, verified its correction and
reported no remaining concrete findings; it did not execute the full run.

## Final full JVM / PostgreSQL / filesystem run

Exact command from repository root:

```bash
nix develop .#chronicle --command bash manure/scripts/test-backend.sh
```

- Backend: **18 suites, 221 tests, 0 failures, 0 errors, 0 skipped**.
- Descriptor/native JNI storage: **2 suites, 33 tests, 0 failures, 0 errors,
  0 skipped**.
- Assembly completed, with a single compiled Baboon runtime owner verified.
- Receipt: `manure/backend/target/validation-runs/20261115T004020Z.jLbNNW`.
- Receipt `source.sha256` SHA-256:
  `2d54cb569826a4d70e47208a7ef1eb4e335519a3a4221532306ef9a130b36306`.
  It includes both `shared/service-auth` and `shared/lossless-json` inputs.
- Assembly SHA-256:
  `07647d4a3d35cdce16a9c64e877d79fe131f3fc70c902062201f80fc5560bcd9`.

The run binds the task sources plus shared auth commits e614ab90, c57cde81,
796e9408 and 942356ce, locally cherry-picked as 8d336a65, 5cfc2b52,
bfbfa5cc and ece264d7 respectively. The receipt was generated before committing
the Manure slice; its source manifest, not the earlier HEAD alone, is the input
binding.

Behavior includes durable restart sessions/runtime tokens; no clock deadline;
logout replay; disabled/removed/password-replaced users; password-only humans;
configured-token immutability; one-time issued secrets; cookie/bearer separation;
wrong Origin/Host/content context; bounded duplicate-safe JSON/credentials;
transactional actor checks; runtime token/grant/delivery revocation; existing
path-navigation negatives; and physical-root/concurrency/migration regressions.

Additional checks:

```bash
python3 -m unittest discover -s manure/tests -p test_artifact_source_manifest.py -v
python3 -m compileall -q manure/tests/browser_fixtures.py manure/tests/test_browser*.py
```

The manifest suite passed **4/4**, no skips. The new Python password fixture also
passed **6/6 selected actual-target HTTP cases**, no skips: exact login Origin,
API security headers and planted-cookie wrong-Origin mutation for both sibling
and separate content origins. These used the built JVM artifact and owned PG;
they were not browser executions. Chromium/UI and native executable acceptance
remain an integration responsibility after the shared web assets are combined.
