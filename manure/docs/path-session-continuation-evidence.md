# Path-session continuation diagnostic evidence

2026-11-08 UTC; base `0f1f6f2f`, dedicated
`wt-ponygirls-manure-session-continuation` worktree. No live endpoint,
credentials, deployment, native-runtime acceptance or full-suite claim.

## Reproduction and design

Before changing `Http.scala`, extended the existing path-browser test with real
anchor clicks from `localhost` to `127.0.0.1`, on fresh Internal root, nested and
viewer targets after dashboard login. The alternate-origin document is a local
BadHost response with a test-created anchor; no server Host/Origin validation
is relaxed. The owned JVM/PG/Chromium test failed with navigation timeouts:
`backend/target/target-runs/20261108T224756Z-jvm.XDnWfF` (1 test, 1 failure,
0 errors/skips). The original fixture disabled viewers, so its viewer timeout
alone was not viewer-specific evidence; the final fixture enables the unchanged
real bundled viewer. Root/nested failures reproduce the original bug.

A strict-CSP, script-free HTML meta refresh establishes a local document before
one canonical same-origin retry. Chromium demonstrably resends the unchanged
Strict management cookie on that retry. The nonsecret marker only bounds the
retry; it never authorizes access. Without a session it stops at a 401 sign-in
link to dashboard artifact details. A valid session follows the existing scoped
grant exchange. Stale content cookies do not prevent that session recheck.

## Final focused checks

Pinned `nix develop .#chronicle`; disposable owned PostgreSQL/filesystem and
source-built JVM. Public tool/provider descriptors are under the main checkout's
`debug/manure-browsing-password-202611`; Chromium 156 / playwright-core 1.64.1.

- `bash scripts/backend-sbt.sh 'manureServer/testOnly manure.HttpSuite'`,
  inside the disposable PG/JNI setup from `manure/scripts/test-backend.sh`:
  **20 passed, 0 failures/errors/skips**, receipt
  `backend/target/validation-runs/20261108T225501Z.Ywkv9f`.
  (An earlier typo selecting `manureStorage/testOnly manure.HttpSuite` ran zero
  tests and is not evidence.)
- `manure/scripts/run-owned-target.sh <provider.json> <with-owned-postgres.py>
  <provision-owned-database.py> jvm focused`, with
  `MANURE_TARGET_DIAGNOSTIC_TESTS_JSON` selecting all four existing
  `test_browser_path_mode` methods: **4 passed, 0 failures/errors/skips**,
  receipt `backend/target/target-runs/20261108T225636Z-jvm.aKjmgU`.
  CDP cookie-name assertions prove Strict management cookie withheld on the
  cross-site first request and dispatched on the marker retry. Root/viewer
  start without grants; nested starts with a legitimately issued then revoked
  HttpOnly grant cookie which is actually dispatched. Also checks bounded
  no-session reload/sign-in, existing deep bookmarks, handoff, public pages,
  packaged/builtin External forms and TLS cookie scope.

HTTP controls cover absent/unknown/replayed marker values, session-authorized
query stripping, encoded paths, unknown artifact, invalid path, hostile/null
Origin, invalid/explicit bearer, raw/download bytes and content API with marker
plus management cookie. These remain blackbox behavioral checks over controlled
local dependencies, not mocks or external services.

Final affected source SHA-256 (documents excluded):

```
0370c5534e9c090a344c7c08ee7866964cb165430994983a648f676dbb441468  backend/src/main/scala/manure/Http.scala
fd56fe3355537ff117338259046e968c16cb9069337225dbc81053eec2b8f596  backend/src/test/scala/manure/HttpSuite.scala
d7ead4c462584f1e6476dab7fce8c0b51dc5e5712c82d796bc4809ad20daef07  tests/test_browser_path_mode.py
```

Full final integrated validation remains the governor's responsibility. No
DomainSuite assertion or unrelated main-branch changes are included here.
