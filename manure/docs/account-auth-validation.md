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

## Shared replacement ownership follow-up

The follow-up adopts shared `AccountSql.loginReplacing` from c3bef1d0 (locally
cherry-picked as 220cc29a). Shared account code owns the target/prior owner lock
order, successful insertion and valid previous-session invalidation. Manure
maps both returned credentials back to exact public IDs and uses only the
returned prior credential for grant deletion in the same metadata transaction.
No HTTP/browser/Python change is included. This is ownership consolidation,
not a claimed Manure deadlock reproduction: `auth.current` already acquires all
configured owner locks in sorted order.

Before the adapter change, the expanded dual contract passed **16/16** against
memory and PostgreSQL. It covers a cross-owner replacement with NUL-containing
public IDs, actual removal of the prior session's pending/redeemed grant rows,
preservation of an independent target-owner session/grant, failed password
preserving the old session/grants, and stale/malformed/unknown/API-token cookie
values being ignored without revoking independent credentials.

A fresh full run used the same exact `test-backend.sh` command above:

- Backend: **18 suites, 223 tests, 0 failures/errors/skips**.
- Storage: **2 suites, 33 tests, 0 failures/errors/skips**.
- Assembly completed and the single Baboon runtime owner check passed.
- Receipt: `manure/backend/target/validation-runs/20261115T005355Z.nl7FyE`.
- Receipt `source.sha256` SHA-256:
  `1a3a24793819a2f9bf9d373af29d9c2b51914250b79854b8a543e3a49ba07a1a`.
- Assembly SHA-256:
  `95420a572f732d8247e2940b032a2eb7b4e7e0ec5733ed6658658d3c1b221d1a`.

`sha256sum --check --quiet` verified every receipt input against the final task
sources. This follow-up does not establish native or browser acceptance.

## Domain dispatch after asynchronous input

A bounded controlled-http4s/owned-PG regression first admitted a valid browser
cookie, paused the `Whoami` request body after credential admission, committed
independent account logout, then released the body. Before correction it
returned **200 instead of required 401** (one expected failure), recorded in
`manure/backend/target/auth-dispatch-fail-first.log`. The test uses Deferred
ordering, a 10-second timeout, and Resource cleanup that releases/cancels the
held request; it does not rely on sleeps or production data.

The common domain-command dispatch boundary now resolves the captured secret
using its captured credential kind after envelope input/decoding, requires the
same complete captured Identity, and only then executes the original command.
It does not adopt another principal or validate after command execution.
Unauthorized responses do not renew the captured cookie. Existing artifact
transaction-local authorization remains unchanged. The corrected regression
returns 401 Unauthorized without Set-Cookie; anonymous Version/Capabilities,
public-shell recovery and successful generated/form logout acknowledgements
remain covered by the full suite.

A fresh full `nix develop .#chronicle --command bash manure/scripts/test-backend.sh`
run passed **18 backend suites / 224 tests** and **2 storage suites / 33 tests**,
with **zero failures, errors or skips**. Assembly and single compiled Baboon
runtime-owner verification also passed. Read-only review found no actionable
correctness/security defect; its role was source review, not test execution.

- Receipt: `manure/backend/target/validation-runs/20261115T014720Z.lwODNg`.
- Receipt `source.sha256` SHA-256:
  `73474b9ed66271b53a3d52c04aab222b5cc278d830017757e1d476f9c0982086`.
- Assembly SHA-256:
  `716231984bb513c698c4eebf0348a95c719e6c5896c9ba2320738523150d15a7`.

Every receipt input was verified with `sha256sum --check --quiet`. This is JVM /
PostgreSQL / filesystem evidence, not a new browser or native acceptance run.
