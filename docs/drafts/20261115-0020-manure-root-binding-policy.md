# Plain-host root binding policy

This note is design documentation, not deployment, migration or state-edit authority.
The implementation base is local `930022a0`; prototype `516d5851` was unavailable.

## Options and decision

- Keep strict device/inode identity: unchanged default, but device renumbering refuses.
- Opt into inode continuity: narrowly relax persistent physical ownership comparison,
  accepting the operator's assumption that the configured filesystem is still the
  original. Matching inode numbers are not volume identity: another filesystem,
  inode reuse or a clone can defeat this check.
- Disable persistent physical ownership: expose only as `unsafe-off` for disposable
  deployments. Wrong-root attachment is then explicitly possible.
- Add a local authority: deferred. ZFS dataset GUID/statfs IDs require a separately
  qualified clone/fencing and trust-boundary contract; they are not automatically
  independent authority.
- Rewrite the binding on drift: unnecessary and deferred. Retain historical bytes;
  opting back into strict mode can refuse until the original tuple matches again.

Use `"root_binding":{"mode":"strict"}`, `inode-anchored` or `unsafe-off`.
Absent configuration means strict. Explicit null, unknown modes/fields and malformed
objects refuse. Non-strict modes emit an enumerated stderr warning on each runtime
acquisition, including schema-only migrate; check-config remains non-operational.

## Ownership and preserved invariants

Config owns policy selection; RootOwnership owns startup acceptance and retains a
separate exact session observation. Main owns persistence of the accepted binding.
RootBinding equality and the portable migration/receipt algorithms remain unchanged.
A global inode-only equality change would weaken unrelated imported/portable paths
and still conflict with Main's byte-exact persistence assertion.

`inode-anchored` accepts only a matching inode for existing plain physical bindings,
retains the original row, and creates an ordinary physical binding on legitimate
first adoption. `unsafe-off` creates, updates and deletes no root_owner row; existing
physical rows are ignored for persistent ownership, not erased. Neither mode relaxes
exact descriptor/lease root checks during a process lifetime, no-follow confinement
or cooperating-process locks. “Off” does not mean disabling filesystem safety locks.

Reject non-strict configuration with root_authority or migration_receipt_dir. Also
reject non-strict runtime state containing an imported destination, portable binding
or migration receipt. Marker and temporary preparation state still refuse. This
prevents changing configuration to downgrade a protected root, including when its
control path/authority configuration has been removed.

Imported OWNER/COMPLETE/PAYLOAD tuples, hashes and first-adoption inventory checks,
portable marker/authority verification, SQLite refusal and tamper refusal retain
their existing contract. Only persistent plain physical-root identity is weakened.
The empty-catalogue gate remains: in unsafe-off an old row cannot authorize adoption
of unknown nonempty staging/live data. Consequently unsafe-off may refuse orphan
cleanup after the last metadata row was deleted; it deliberately lacks the trusted
binding that permits that recovery in strict/inode-anchored modes. Schema-only
migrate still never adopts a root or starts payload recovery.

## Verification contract

Retain RuntimeSuite's strict device-renumbering refusal unchanged. Add deliberate
opt-in acceptance and inode-negative cases, byte-preservation and mode-transition
checks, unsafe-off no-binding and empty-catalogue cases, protected-state/marker
refusals, and actual target startup/upload/fetch/restart coverage. These are specified
policy additions, not relaxation of default expectations. Runtime cases use owned
PostgreSQL and real directories to verify durable effects; parser cases need no
external credentials. No new database abstraction/dummy is warranted for testing
byte-exact existing SQL persistence.

Required final evidence: full manure-backend check, test-target.sh jvm full with the
registry-guarded owned PostgreSQL helper, and full native inventory with source/artifact
binding. Record actual commands/counts/failures and unavailable prerequisites; no
build-only or scripted result establishes live-host recovery or deployment.

## Execution evidence (2026-11-15)

- Fail-first parser check rejected the new field with `bad-envelope`; after parser
  support alone, six runtime policy assertions failed for the intended reasons
  (device drift refused, unsafe-off still bound/swept, and missing downgrade guard).
- Final `nix build --no-link -L .#checks.x86_64-linux.manure-backend` passed:
  backend17 suites/212 cases, storage2 suites/33 cases, zero failures/errors/skips.
  Exact current derivation: `dad36xl4vkvgnmaz388zmqj3rcj269al`;
  receipt: `/nix/store/caw6v2ra0h8k2bsf4gvwc27l5jy8cbsq-manure-complete-jvm-backend-filesystem`.
  Strict device-drift refusal and all19 portable migration cases remain unchanged
  in expectation; new migration assertions additionally deny policy downgrades.
- NixOS/HM checks `manure-nixos-eval`, `agentic-services-hm-eval`, and `manure-hm-eval`
  passed, including realized non-strict JSON, strict omission and import incompatibility.
- Target inventory was deliberately extended by exactly the three new process tests;
  the first target attempt correctly refused their omission before executing cases.
- Native compilation initially stopped at a pre-existing inconsistent Graal guard.
  Q67 separately authorized correcting only that guard to the existing25.4.4.1.1
  toolchain/hosted-feature ABI, not upgrading dependencies. The extended
  `manure-toolchain-routing` check compares both guards with the actual pinned
  release; its fail-first failed, then the correction passed. Acceptance-policy
  checks also passed. Full process-run receipts are recorded separately below
  when available; none of this is production deployment evidence.
- Full native then exposed a pre-existing favicon-test DNS defect. Q68 authorized
  correcting its browser transport without weakening assertions. A first document
  fetch correction exposed intentionally strict directory CSP and was rejected.
  The corrected helper probes status/MIME through an isolated Chromium tab, closes
  it in `finally`, and retains real image decoding in the original document.
  A controlled local reproduction independently verifies Node DNS refusal,
  document fetch refusal, Chromium navigation success, image decoding, unchanged
  original URL and continued enforcement of the original policy. Both focused
  path/subdomain viewer cases pass. No production CSP or browser deadline was relaxed.
- Earlier full runs are retained: native373 cases/1 DNS failure, then373/2 CSP
  failures; JVM373/1 dashboard deep-link timeout, then373/2 CSP failures, then373/1
  missing TLS login-cookie failure. All had zero errors/skips. The dashboard timeout
  did not recur, and both focused TLS cases passed with sanitized per-step diagnostics
  after the missing-cookie failure. Their intermittent causes remain unestablished;
  no guessed correction or deadline change was made. These runs are not presented
  as final acceptance.
- Final `nix build --no-link -L .#checks.x86_64-linux.manure-native` passed:
  39 modules/373 cases, zero failures/errors/skips/expected failures/unexpected
  successes; exact inventory equality. Four Node suites passed35 cases, and the
  TypeScript codec gate passed. The current runtime-input manifest was independently
  compared with the native build binding and matched.
  Receipt: `/nix/store/wkrkyjxfhis1fd8k2ln51llf877lz1si-manure-native-full-target`.
  ELF SHA256: `4e1345b72b8c9f8ce15d5ad4d0776242548411221e403918b6d0cc24ddba1101`.
- Final uninstrumented `manure/scripts/test-target.sh jvm full`, launched through
  `manure/scripts/run-owned-target.sh` inside `nix develop .#chronicle`, passed:
  39 modules/373 cases, zero failures/errors/skips/expected failures/unexpected
  successes, exact inventory equality; all35 Node cases and the codec gate passed.
  Runtime879.979 seconds. The JAR, runtime-source, test-source, runner and viewer-asset
  manifests were independently checked against the final working tree.
  Receipt: `.worktrees/wt-ponygirls-root-binding/manure/backend/target/target-runs/20261115T011756Z-jvm.hLVrop`.
  JAR SHA256: `d84fe3ca3d262a36962a041b793c7abf03ccccb848655584736a9babc9d9c07f`.
  The explicit owned-PG descriptor was
  `/nix/store/kib9arik3q5gvf1vvgf1wkwl5anq75zc-manure-owned-pg-env.json`;
  launcher/helper were immutable store copies of `with-owned-postgres.py` and
  `provision-owned-database.py`. The public tool descriptor is retained beside
  the local task evidence; its SDK path resolves the current pinned1.32.2 dependency,
  not the absent historical1.32.1 path. No administrator-as-runtime fallback.

Executions preceded the final commit: manifests and immutable source closures, not
pre-commit HEAD alone, establish tested input identity. Final backend test source:
`/nix/store/zsn192iw0s7g3ryhrj1072i14wncql4v-manure-target-tests-source`;
native runtime source: `/nix/store/m9v20jx6dr58l9bca5wmigvs85r7lb7q-manure-native-source`.
The task worktree and local logs are retained under Q69. The standalone module
worker worktree was removed only after its clean commits were integrated.
No push, live database edit, deployment or service restart was performed.
