# Directory browsing diagnostic evidence

Source base: `51993848b545d9184622a1db8405117011a563b3`, plus this task's
changes. No deployment or native-runtime acceptance was performed.

## Behavior and test choice

No-index directories list immediate manifest children, directories first, with
parent navigation, segment-encoded links and escaped labels. An immediate regular
`readme.md` (case-insensitive) uses the existing local Markdown viewer below the
listing. Selection prefers `README.md`, then `readme.md`, then lexicographic
filename order for other case variants. No renderer, iframe,
authorization rule or uploaded static-site content is changed. Explicitly disabled
viewers retain listing/raw navigation. `index.html` takes precedence over
`index.htm`; either prevents directory presentation.

The installed constructive-test-taxonomy skill applies directly: the new
http4s request tests are Behavioral-Active / Blackbox / Good Communication
(owned PostgreSQL/filesystem), with regression provenance for the no-index 404.
Browser checks are Behavioral-Active / Effectual / Good Communication, observing
real rendering and prohibited external-resource attempts. Existing viewer safety
and byte-preservation checks are reused rather than duplicating a Markdown
renderer. This is an application-specific composition of existing behavior,
not a new reusable-skill candidate; no generic skill was invented.

## Runs (observed 2026-11-08 UTC)

All commands ran from the dedicated task worktree in the pinned
`nix develop .#chronicle` shell. Receipt directories are fresh and preserve
previous test reports; they are generated, uncommitted artifacts under
`manure/backend/target/`.

- Before the fix, `manureServer/testOnly manure.HttpSuite -- --tests *no-index*`
  using `test-backend.sh`'s owned PG/JNI setup reproduced root **404 instead of
  200**: 1 suite, 1 case, 1 failure, 0 errors/skips.
  Receipt: `validation-runs/20261108T221830Z.Rl7V12`.
- Final focused command:
  `nix develop .#chronicle --command bash /tmp/manure-browse-focused.sh`.
  The temporary diagnostic copies `manure/scripts/test-backend.sh`'s PG/JNI
  setup, substitutes `bash scripts/backend-sbt.sh 'manureServer/testOnly manure.HttpSuite'`,
  and omits the full-suite inventory postcheck (not applicable to this selection).
  **1 suite, 15 cases, 0 failures/errors/skips**; exit 0.
  Receipt: `validation-runs/20261108T222303Z.sg4HpF`, with `source.sha256`,
  `git-head`, tool versions and run log. Final XML is in
  `manure/backend/target/test-reports/TEST-manure.HttpSuite.xml`.
- Real browser diagnostic: `nix develop .#chronicle --command bash -c '…;
  bash manure/scripts/test-target.sh jvm focused'`, exporting
  `MANURE_TARGET_DIAGNOSTIC_TESTS_JSON='["test_browser_viewers"]'`, tools from
  `manure/scripts/acceptance-tools-x86_64-linux.json`, and
  `MANURE_TEST_VIEWER_DIR=/home/pavel/work/flakes/ponygirls/manure/web/viewer/dist`.
  The unchanged prebuilt viewer assets were reused explicitly; the runner records
  their exact digests and dependency-lock digests, not a fresh viewer build.
  **2 Python cases, 18 real-browser checks (9 each path/subdomain),
  0 failures/errors/skips**, exit 0. Receipt:
  `target-runs/20261108T222336Z-jvm.K7z7ec`, including source/test/asset manifests,
  XML, summary and JVM assembly SHA-256
  `2352a386e66c6842f8b33a36b189aee582ba2f17420bc0b210f5ebb5229ae637`.

Earlier diagnostics are retained: an initial wrong-project selection ran zero
cases; an intermediate README fixture used an incorrect relative template path
(14/15 passed); another successful focused suite inherited an inapplicable
full-inventory postcheck and that wrapper exited 1. None is full-suite evidence.

Original diagnostic snapshot input SHA-256 (before the lowercase follow-up):

| Input | SHA-256 |
| --- | --- |
| `manure/backend/src/main/scala/manure/Http.scala` | `c00e16abfb640033cb4d062341bab2d4c28bf243800168e071051ad74815d262` |
| `manure/backend/src/test/scala/manure/HttpSuite.scala` | `b942b53ccaeb631f7842b82ae9b44c2c3ba95efc30fad1c7c65c5980ffc6adec` |
| `manure/tests/test_browser_viewers.py` | `02da31cfd678ea4b9f1dbd5e5b499a86efc0d39aefb181ac4436bf4e436778f2` |
| `manure/tests/browser/viewers.mjs` | `19fc0b0446147db24c503cf3d36f789a2912391b0d29c1ab657dd7b9c68c4d8d` |

These are focused diagnostics, **not full release acceptance**. The coordinating
agent owns the final combined, unfiltered `manure/scripts/test-backend.sh` and
owned-provider full target run after integrating the independent navigation-auth
changes. Source/JVM results do not establish native behavior or deployment.

## Lowercase README follow-up

Based on task commit `48b6d5ad`. Before the fix, the new case in
`manureServer/testOnly manure.HttpSuite` reproduced a missing Markdown preview
for `lower/readme.md`: 1 suite, 16 cases, 1 failure, 0 errors/skips.
Receipt: `validation-runs/20261108T222643Z.ZDTKR8`.

After case-insensitive immediate-file selection and deterministic preference:

- Same pinned-shell focused command `/tmp/manure-browse-focused.sh`:
  **1 suite, 16 cases, 0 failures/errors/skips**, exit 0.
  Receipt: `validation-runs/20261108T222734Z.D6aaxJ`.
  New cases cover lowercase, uppercase precedence, lowercase precedence over
  mixed-case variants, lexicographic fallback, nested exclusion and directory
  exclusion.
- Same pinned-shell `test-target.sh jvm focused` browser selection and explicitly
  reused unchanged viewer assets: **2 Python cases, 18 real-browser checks,
  0 failures/errors/skips**, exit 0. The nested directory fixture now contains
  lowercase `nested/readme.md`; both path and subdomain browsers verify actual
  rendered heading and exact viewer metadata, not just template strings.
  Receipt: `target-runs/20261108T222757Z-jvm.imlqHC`.

Follow-up diagnostic source SHA-256:

| Input | SHA-256 |
| --- | --- |
| `manure/backend/src/main/scala/manure/Http.scala` | `a8dc4aff1597b13387a1df338e1178f0f46ea7d9deb4e947eef23a9e1de2c8f1` |
| `manure/backend/src/test/scala/manure/HttpSuite.scala` | `7acebdf51bfc08c4d982a73447803473185ed11d37659da90310cd02743add8e` |
| `manure/tests/test_browser_viewers.py` | `291a7e2f50ff27f31f27b0f8b503aa9958cf3c37d0a8617e7775f4e987b1b507` |
| `manure/tests/browser/viewers.mjs` | `4421c533b2ef46896a1f664f19390d207b4f14bf44298cccac6eca2e75998457` |

Full integrated validation remains the coordinating agent's separate gate.
