# Manure CURRENT release inventory and invariant register

## Authority and scope

Machine-readable authority: [`../tests/current-test-inventory.json`](../tests/current-test-inventory.json).
Runner: [`../scripts/target-suite.py`](../scripts/target-suite.py).
Contract: sole `manure.api/1.0.0`, including `SearchHit.embeddingSpace` after
`embeddingProfile`; [current API](current-api.md).

This register replaces the earlier historical AST-method listing as the release
selector. **A historical method count is not coverage proof.** Current cases are
actual `unittest` discovery IDs, including inherited browser matrices, and exact
Node test names. No declaration means no silent omission: a new root/nested
`test_*.py` or `*.test.mjs`, a missing registered module, an added/missing/duplicate
case ID, an import resolving outside the assigned source, or a missing concrete
mapping causes the inventory self-check to fail.

The frozen register currently declares **33 CURRENT Python modules /334 case
IDs**, **17 Node cases** across both browser-boundary/CDP suites, and the
**74-vector generated TypeScript codec check**. These are declared inventory
sizes, **not execution/pass counts**. All client, CLI, MCP, browser, offline and
actual-target modules are included; there is no six-core-only release gate.

**Seven old Python-server/SQLite implementation test modules are architecture-
retired from the CURRENT selector, not their domain/security/durability
requirements.** Their grouped requirements map to concrete current Python,
Scala/PG and filesystem tests below, with real gaps left open. Their source is
retained. The public Python server entrypoint is now **retired/fail-closed** in parent
`5f3905ec`: the console registration is removed and module `main` returns2 with
a constant message before parsing/config/credentials/network/storage effects.
Historical helper imports remain unsupported source-format/migration seams.
This does not authorize production activation, old-state deletion, migration or
credential rotation.

## CURRENT Python modules (unfiltered in `full`)

| Module | Declared cases | Required execution inputs |
|---|---:|---|
| `test_artifact_source_manifest` | 4 | owned copied-source CLI; no compiler/service |
| `test_browser_access_modes` | 2 | target, browser |
| `test_browser_dashboard` | 29 | target, browser |
| `test_browser_dashboard_ux` | 1 | target, browser |
| `test_browser_handoff` | 4 | target, browser |
| `test_browser_http_opt_in` | 1 | target, browser |
| `test_browser_isolation` | 15 | target, browser |
| `test_browser_path_mode` | 4 | target, browser |
| `test_browser_tls` | 5 | target, browser |
| `test_browser_unlock` | 34 | target, browser |
| `test_catalogue_casefold_oracle` | 1 | controlled historical SQLite oracle; NOT target acceptance |
| `test_cli_process` | 3 | target |
| `test_cli_resume` | 14 | controlled local/pure |
| `test_client_external` | 5 | controlled local/pure |
| `test_client_hardening` | 49 | controlled local/pure |
| `test_client_realserver` | 14 | target, sdk |
| `test_client_secret_files` | 8 | controlled local/pure |
| `test_client_stateful` | 3 | controlled local/pure |
| `test_client_transport` | 23 | controlled local/pure |
| `test_credential_preflight` | 8 | controlled local/pure |
| `test_current_client` | 6 | controlled local/pure |
| `test_current_protocol` | 9 | controlled local/pure |
| `test_current_target_harness` | 4 | controlled local/pure |
| `test_current_test_inventory` | 14 | controlled local/pure |
| `test_dashboard_markup` | 7 | controlled local/pure |
| `test_mcp_environment` | 1 | target |
| `test_mcp_hardening` | 11 | controlled local/pure |
| `test_mcp_protocol` | 9 | sdk |
| `test_offline_conversion` | 30 | offline-postgres |
| `test_retired_server_entrypoint` | 5 | controlled local/pure |
| `test_target_durability` | 8 | target |
| `test_target_migration` | 2 | target |
| `test_target_search` | 1 | target |

`test_offline_conversion` uses Python ArtifactStore to create synthetic historical
states and, in one complementary test, restores PG rows into a disposable SQLite
copy for a historical source-format recovery rehearsal. This is explicitly **not
proof of the replacement backend**. `test_target_migration` separately exercises
the real configured executable after import, restart, original grants, resumable
sessions, source preservation and writable fix-forward boundaries. No legacy
HTTP/API adapter or Python backend fallback is used for target serving.

Current CLI/client/MCP controlled peers are current generated-command test seams,
not legacy REST translators. Actual-target and official-SDK legs remain mandatory;
fake peers do not substitute for them.

## Gate behavior and prerequisites

```
python3 manure/scripts/target-suite.py --check-inventory
# Owning orchestrator: frozen source/artifact + disposable provider, supervised
# in the background for the complete unfiltered application suites:
manure/scripts/test-target.sh jvm full
manure/scripts/test-target.sh native <absolute-ELF> <matching-source-manifest> full
```

`--check-inventory` validates registration, exact IDs and concrete references
without executing tests; it always reports `releaseAcceptance:false`. It does
not claim missing prerequisites are available or that open invariants passed.

`full` always discovers **all CURRENT** cases and executes both Node suites plus
the generated-codec check. No optional-file append or environment selector can
remove current modules. Exact declared IDs must match executed IDs. There must
be positive execution counts and **zero skips, expected failures, unexpected
successes, failures or errors**. Missing prerequisites fail explicitly before
execution (`classification:prerequisite-failed`, expected inventory retained,
zero executed tests, not a skipped/pass suite). A newly unregistered module is
an inventory error, never an automatically retired or ignored test.

Full HTTP/target execution requires the least-privilege owned helper route:

- `MANURE_TEST_PROVISION_COMMAND`: absolute executable path, **not JSON argv**;
- `PONYGIRLS_OWNED_FIXTURE_ROOT/provider.json`: owned marker;
- `PONYGIRLS_TEST_PROVISION_SERVICE=manure`;
- `PG_PROVIDER`: absolute trusted code path, not an ambient PG connection;
- explicit target launcher, pinned Node/SDK/Playwright/Chromium/openssl tools,
  and required offline PG binaries.

The runner only checks configuration/path/executable presence; it neither
provisions a database nor reads credential-file contents. TargetServer and the
owning provider perform bounded provisioning/lifecycle operations. Full mode
**does not accept or retain admin-only `MANURE_TEST_JDBC_*`/`ALLOW_CREATEDB`
fallback**. Legacy owned-JDBC opt-in is diagnostic `core`/`focused` only.

Before importing test modules, the runner keeps only explicit tool/test-provider
inputs, resets HOME/XDG under the fresh receipt, prepends this assigned source to
PYTHONPATH, and discards ambient client/model/PG/proxy configuration. `PG_PROVIDER`
is the explicit code-path exception; PGHOST/PGUSER/PGPASSWORD/PGPASSFILE/
PGSERVICE* are not retained. Migration tests create their own owned PGSERVICEFILE
after the guard. Discarded variable **names**, not values, are recorded.

`core` and `focused` remain explicit iterative diagnostics. They can exit0 for
successful scoped tests but always report `releaseAcceptance:false`; neither is
release evidence. Focused names must resolve to declared CURRENT cases, cannot
select retired implementations and cannot overlap/duplicate IDs.

Full summary separates `currentTestSuccess` from `releaseAcceptance`.
**Any `openInvariantGaps` forces full exit NONZERO even if every current test
passes.** Closing a gap requires concrete replacement assertions/source review,
then an explicit register update—not deletion because the old Python test no
longer imports. Native/JVM/provider/consumer gates below are separately mandatory;
a passing CURRENT gate for one artifact is not global service completion.

Fresh receipts preserve inventory, registry/input SHA binding, prerequisite
errors, full logs, and fsynced per-case outcomes. Subtest failures include their
trace immediately, before final unittest summary, so an interrupted long run
does not lose their cause. Existing evidence is never overwritten/filtered into
a pass. An interruption is not an exit status or completed full suite.

## Architecture-retired implementation modules

| Module | Architecture reason | Retained invariant groups |
|---|---|---|
| `test_catalogue` | Direct SQLite/old REST test architecture only; required casefold/effective-query/valid-long-query behavior is retained, not replaced by ROOT lowercase. | `catalogue-current` |
| `test_server_http_opt_in` | Constructs the retired Python HTTP server/config; current HTTP/TLS/browser target tests replace its transport. | `origins`, `credentials`, `manifest-serving` |
| `test_server_lifecycle` | Constructs Python server/SQLite internals; preserve lifecycle/receipt/publish/range invariants through real replacement adapters. | `manifest-serving`, `receipts`, `publication-import`, `range-client` |
| `test_server_limits` | Constructs Python socket/thread/semaphore/storage internals; requirements remain current, with explicit unresolved lifecycle/concurrency groups. | `quota-session`, `expiry-activity`, `admission-shutdown`, `credentials`, `filesystem-lifetime` |
| `test_server_path_mode` | Imports Python HTTP/config; current generated target/path/TLS browser scenarios replace transport-specific assumptions. | `origins`, `manifest-serving`, `grants-secrets`, `expiry-activity` |
| `test_server_security` | Imports Python server/SQLite hooks; domain/security rules remain current including adjudicated shared incomplete authority. | `shared-authority`, `credentials`, `origins`, `manifest-serving`, `grants-secrets`, `filesystem-lifetime` |
| `test_storage_durability` | Direct Python ArtifactStore/SQLite internals are not the replacement PG/FS service. Synthetic source-state construction remains permitted ONLY in migration tests. | `receipts`, `publication-import`, `quota-session`, `expiry-activity`, `filesystem-lifetime`, `admission-shutdown`, `grants-secrets` |

Only this explicit frozen implementation allowlist may be architecture-retired;
new/current client/CLI/MCP/browser modules cannot be relabeled to escape full.
The exact original test sources remain in the tree for audit, migration fixtures
and any still-needed characterization, not as a production compatibility oracle.

## Invariant → source → concrete current assertion → migration/gap treatment

The JSON contains exact file markers and qualified test IDs, all validated.
Mapped assertions must execute in their owning gate; presence is not a claim
that an unfiltered artifact/runtime suite passed. No historical AST method count
or legacy wire parity is used as coverage proof.

### credentials

Canonical exact token/password/hash bytes; source ambiguity/configuration precedes any file/network I/O, bounded server secret-file acquisition.

**Source:** `manure/manure/auth.py` (`def is_canonical_token`); `manure/manure/client.py` (`def check_secret_pair_ambiguity`); `manure/CONTRACT.md`.

**Concrete target assertions:**
- [`test("canonical token and strict credential byte rules preserve original hashes"`](../../manure/backend/src/test/scala/manure/DomainSuite.scala).
- [`test("server hash-file reader rejects FIFO without waiting for a writer"`](../../manure/backend/src/test/scala/manure/SecretBoundarySuite.scala).
- [`test("managed symlink reference allowed; oversized/CRLF/malformed hashes refuse bounded"`](../../manure/backend/src/test/scala/manure/SecretBoundarySuite.scala).
- [`test_credential_preflight.CredentialPreflightTests.test_all_pairs_are_preflighted_before_reading_another_pairs_file`](../../manure/tests/test_credential_preflight.py).
- [`test_credential_preflight.CredentialPreflightTests.test_common_pairs_reject_fifo_before_read`](../../manure/tests/test_credential_preflight.py).
- [`test_client_secret_files.ClientSecretFileTests.test_ambiguity_still_precedes_any_file_open`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_growth_after_fstat_still_has_bounded_actual_reads`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_nonregular_missing_and_dangling_references_are_sanitized`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_resolved_regular_leaf_raced_to_fifo_never_blocks_or_reads`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_sole_fifo_reference_rejects_helpers_constructor_cli_and_mcp`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_symlink_to_fifo_rejects_but_managed_regular_symlinks_work`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_token_exact_ascii_codec_and_single_optional_lf`](../../manure/tests/test_client_secret_files.py).
- [`test_client_secret_files.ClientSecretFileTests.test_url_reference_transport_bound_utf8_and_strip_semantics`](../../manure/tests/test_client_secret_files.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

See [portable client bounded regular references](client-secret-files.md): the8 CURRENT regressions reproduce sole-FIFO blocking and bounded reads using only owned synthetic inputs; the corrected broad diagnostic passed161 methods with0 skips.

### shared-authority

Every live authenticated manager lists/inspects/manifests/status/deletes/rotates any artifact including incomplete states; only chunk/publish/incomplete PATCH are owner-only; ready PATCH is shared.

**Source:** `manure/CONTRACT.md` (`6.5 Incomplete-session ownership`); `manure/manure/server.py` (`def _api_info`); `manure/tests/test_server_security.py` (`def test_every_user_lists_inspects_deletes`).

**Concrete target assertions:**
- [`test("NUL/Unicode metadata, exact reservations and complete upload/publish/read/delete"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test_client_realserver.TestRealServer.test_grant_revocation_real_server`](../../manure/tests/test_client_realserver.py).
- [`test("shared incomplete reads and abort coexist with owner-only upload mutations"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("any manager may rotate an incomplete external password without advancing activity"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test_target_durability.TargetDurabilityTests.test_reverse_and_concurrent_receipts_server_sigkill_after_ack_resume`](../../manure/tests/test_target_durability.py).

**Adjudication:** Corrected in parent69494c01: positive shared incomplete reads/list/status/abort and rotation coexist with owner-only upload mutations in both Memory and real-PG ArtifactsContract. This fixes the regression; it is not a policy change. All current transport/native gates remain mandatory.

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### origins

Exact Host/port and Origin, trusted-peer XFP only; cookie/bearer ambiguity; same-origin management, separated content, no CORS and explicit low-security HTTP/path modes.

**Source:** `manure/manure/server.py` (`def _parse_authority`); `manure/manure/server.py` (`def _check_origin_api_mutation`); `manure/CONTRACT.md` (`5.8 Edge trust boundary`).

**Concrete target assertions:**
- [`test("host/origin/cookie-bearer ambiguity and static module containment"`](../../manure/backend/src/test/scala/manure/HttpSuite.scala).
- [`test("generated management mutations require exact Origin for cookie but absent allowed bearer"`](../../manure/backend/src/test/scala/manure/HttpSuite.scala).
- [`test_browser_tls.TlsSmokeCase.test_tls_hostile_planted_none_secure_cannot_mutate`](../../manure/tests/test_browser_tls.py).
- [`test_browser_dashboard.DashboardSiblingCase.test_b7_hostile_sibling_js_cannot_mutate_dashboard`](../../manure/tests/test_browser_dashboard.py).
- [`test_browser_http_opt_in.HttpOptInBrowserCase.test_login_internal_handoff_external_unlock_public_and_logout`](../../manure/tests/test_browser_http_opt_in.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### manifest-serving

Immutable ordered file/directory manifest, topology/path/resource bounds, empty directories/files, index preference/no listing, strict decoding, mounted redirects and MIME/attachment/isolation behavior.

**Source:** `manure/manure/domain.py` (`def validate_manifest`); `manure/manure/server.py` (`def _decode_content_path`); `manure/manure/server.py` (`def _serve_content_path`).

**Concrete target assertions:**
- [`test("manifest canonical path and topology bounds reject every traversal form"`](../../manure/backend/src/test/scala/manure/DomainSuite.scala).
- [`test("directory-only, zero-byte and nested manifests preserve real empty topology"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("raw chunks/download byte ranges stream current contract and no secret in manifests"`](../../manure/backend/src/test/scala/manure/HttpSuite.scala).
- [`test_browser_path_mode.PathBrowserCase.test_public_canonical_mount_and_relative_assets`](../../manure/tests/test_browser_path_mode.py).
- [`test_browser_isolation.IsolationSiblingCase.test_b5_api_bytes_are_attachment_and_never_execute`](../../manure/tests/test_browser_isolation.py).
- [`test_browser_isolation.IsolationSeparateCase.test_b6_reserved_prefixes_never_serve_user_content`](../../manure/tests/test_browser_isolation.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### receipts

Chunk bytes+file/parent fsync precede receipt commit and ACK; aligned/tail/idempotent/conflicting receipt rules, truthful restart progress, reverse/concurrent chunk admission and pinned source validation.

**Source:** `manure/manure/storage.py` (`def put_chunk`); `manure/tests/test_server_lifecycle.py` (`def test_r1_concurrent_chunks_publish`); `manure/tests/test_storage_durability.py` (`def test_r11_sigkill_chunk_receipt_resumes_truthfully`).

**Concrete target assertions:**
- [`test("chunk ACK follows file+parent fsync and durable receipt commit; retry heals corrupt bytes"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("chunk alignment, tail, overflow and single byte ranges remain bounded"`](../../manure/backend/src/test/scala/manure/DomainSuite.scala).
- [`test_client_realserver.TestRealServer.test_chunk_resume_real_server`](../../manure/tests/test_client_realserver.py).
- [`test_cli_process.TestSubprocessKillResume.test_kill_manual_resume`](../../manure/tests/test_cli_process.py).
- [`test_target_durability.TargetDurabilityTests.test_reverse_and_concurrent_receipts_server_sigkill_after_ack_resume`](../../manure/tests/test_target_durability.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### publication-import

Verify→publishing commit→tree/rename/parent/root fsync→ready commit→cleanup; never serve partial/publishing; ready retry idempotent; matched offline snapshot retains all states/receipts/grants/IEEE epochs and writable fix-forward boundary.

**Source:** `manure/manure/storage.py` (`def publish`); `manure/manure/storage.py` (`def reconcile`); `manure/CONTRACT.md` (`6.3 Publish ordering and crash windows`).

**Concrete target assertions:**
- [`test("each publish crash window remains unserved then restart reconciles ready or resumable"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("hash mismatch repairs receipts before reporting and never serves a partial ready tree"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test_target_migration.TargetMigrationTests.test_actual_target_import_resume_crash_windows_original_grants_restart_and_fixforward`](../../manure/tests/test_target_migration.py).
- [`test_offline_conversion.PostgresContracts.test_process_death_after_commit_retries_without_duplicate_rows`](../../manure/tests/test_offline_conversion.py).
- [`test_offline_conversion.PostgresContracts.test_killed_sql_connection_rolls_back_import_transaction`](../../manure/tests/test_offline_conversion.py).
- [`test_target_durability.TargetDurabilityTests.test_server_sigkill_after_rename_before_ready_commit_recovers`](../../manure/tests/test_target_durability.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### quota-session

Atomic aggregate reservation and per-user/global session bounds with consistent PG lock ordering: concurrent initializations admit only fitting subset and rejected/faulted operations leave no storage/reservation debris.

**Source:** `manure/manure/storage.py` (`def init_artifact`); `manure/tests/test_server_limits.py` (`def test_quota_reservation_concurrent_subset`); `manure/tests/test_storage_durability.py` (`def test_r8_quota_failure_leaves_no_storage`).

**Concrete target assertions:**
- [`test("NUL/Unicode metadata, exact reservations and complete upload/publish/read/delete"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("failed PG commit during content resource acquisition closes the pinned file"`](../../manure/backend/src/test/scala/manure/AcquisitionFailureSuite.scala).
- [`test("concurrent PostgreSQL admissions reserve exactly the quota-fitting subset"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).
- [`test("concurrent PostgreSQL per-user session cap is exact across independent managers"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).
- [`test("concurrent PostgreSQL global session cap applies in the same admission transaction"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).
- [`test("runtime role is least privilege and actual MetadataTxn waits on the PG advisory lock"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### expiry-activity

Original-precision expiry cuts authorization immediately (410 authenticated API,404 anonymous/content); TTL shorten/extend/clear; only init/ACK/publish/PATCH refresh activity; sweeper handles idle uploads/orphans/grants without racing publish.

**Source:** `manure/manure/server.py` (`def _expired_fail`); `manure/manure/storage.py` (`def sweep`); `manure/tests/test_server_limits.py` (`def test_r15_activity_allowlist`).

**Concrete target assertions:**
- [`test("expiry uses original float64 boundary; publishing is not idle-swept"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test_client_realserver.TestRealServer.test_ttl_updates_real_server`](../../manure/tests/test_client_realserver.py).
- [`test_client_realserver.TestRealServer.test_pagination_filters_real_server`](../../manure/tests/test_client_realserver.py).
- [`test_browser_dashboard.ExpiredDeleteCase.test_a2_expired_artifact_can_be_deleted_from_list`](../../manure/tests/test_browser_dashboard.py).
- [`test("any manager may rotate an incomplete external password without advancing activity"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).

**New concrete but not-yet-green assertions:** ArtifactsContract activity
allowlist and failed-publish/startup cases from `ffbdd5f5` (Memory and real PG).

**OPEN—blocks full release acceptance:**
- P2 activity fix and success-only user publish/startup-preservation behavior now implemented; parent reported corrected Memory/PG unit run green. Keep OPEN pending observed source-bound allowlist/failed-publish execution and real sweep SQL callback/lock proof. The new6f6369b0 active-sweep target assertion is registered, not yet claimed passing.

### grants-secrets

One-time artifact/principal-bound handoff, password/token-digest-bound grants and original expiry; revoke on logout/credential replacement/rotation/visibility/delete; password once only, no raw response/log/URL leaks.

**Source:** `manure/manure/server.py` (`def _content_auth_ok`); `manure/manure/storage.py` (`def revoke_credential_grants`); `manure/CONTRACT.md` (`7.5 Password/hash non-leak rule`).

**Concrete target assertions:**
- [`test("external password one-time disclosure, original grant expiry/binding and rotation"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("single-use handoff and token-bound content grant revoke at logout and credential change"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test("grant capacity keeps newly issued grant even when its hash sorts below timestamp-tied predecessor"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).
- [`test_browser_access_modes.DashboardAccessModeTests.test_path_access_transitions_controls_and_races`](../../manure/tests/test_browser_access_modes.py).
- [`test_browser_isolation.TestCurrentErrorEnvelope.test_current_command_fixture_projection_never_replaces_received_fault_bytes`](../../manure/tests/test_browser_isolation.py).
- [`test_browser_unlock.UnlockSeparateCase.test_b3_no_password_appears_in_listings_or_manifest`](../../manure/tests/test_browser_unlock.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### filesystem-lifetime

Descriptor-relative no-follow operations, regular-file checks, bounded non-following cleanup, physical-root identity/alias ownership and retained claim until all file/worker leases release; linked native parity required.

**Source:** `manure/manure/storage.py` (`def _resolve_parent`); `manure/tests/test_storage_durability.py` (`def test_r9_root_replacement_fails_closed_before_touching`).

**Concrete target assertions:**
- [`test("kernel claims contend across processes, inode rename aliases, and failed root close"`](../../manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala).
- [`test("kernel claims release after owning process is killed, without lockfile cleanup"`](../../manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala).
- [`test("existing opens reject symlinks, directories and FIFO without blocking"`](../../manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala).
- [`test("cleanup unlinks symlinks and never descends into their targets"`](../../manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala).
- [`test("wrong payload root cannot silently attach existing PG metadata"`](../../manure/backend/src/test/scala/manure/RuntimeSuite.scala).
- [`test("symlink payload parent/leaf cannot redirect writes, hashes, serving or deletion"`](../../manure/backend/src/test/scala/manure/ArtifactsContract.scala).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### range-client

Finite streamed range reads with exact206/416 semantics; credentials/grants remain origin/host/mount scoped; cross-origin body replay refused; source/destination inode pinning, hash verification, secret-free resume cache and foreign staging files preserved.

**Source:** `manure/manure/client.py` (`def _request`); `manure/manure/client.py` (`def _ranged_download`); `manure/manure/client.py` (`def _install_staging`).

**Concrete target assertions:**
- [`test_client_hardening.TestB1RedirectBody.test_307_unlock_body_refused`](../../manure/tests/test_client_hardening.py).
- [`test_client_hardening.TestB4ParentOpenHook.test_swap_at_install_parent_open_boundary`](../../manure/tests/test_client_hardening.py).
- [`test_client_hardening.TestB3NamespaceOwnership.test_backup_verify_never_unlinks_foreign`](../../manure/tests/test_client_hardening.py).
- [`test_client_external.TestExternalTokenFreeFetch.test_path_mode_bare_origin_no_bearer_and_independent_grant_jar`](../../manure/tests/test_client_external.py).
- [`test_cli_process.TestOwnedFetchResumeRange.test_interrupted_fetch_resumes_exact_range`](../../manure/tests/test_cli_process.py).
- [`test_current_client.CurrentClientTests.test_full_upload_fetch_empty_dirs_hashes_ranges_and_secret_free_cache`](../../manure/tests/test_current_client.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### admission-shutdown

Malformed/oversized/stalled requests cannot mutate or revoke before body validation; finite API/unlock/login throttle and max-connections admission; graceful close orders after active chunk/publish/stream/sweeper or retains claim on failure.

**Source:** `manure/manure/server.py` (`def _check_framing`); `manure/tests/test_server_limits.py` (`def test_r5_stalled_body_preserves_state_password_grants`); `manure/tests/test_server_limits.py` (`def test_r7_close_orders_after_inflight_chunk_commit`).

**Concrete target assertions:**
- [`test("bounded body, duplicate JSON and framing fail before initialization effects"`](../../manure/backend/src/test/scala/manure/HttpSuite.scala).
- [`test_browser_unlock.UnlockRateLimitCase.test_b3_browser_rate_limit_statuses`](../../manure/tests/test_browser_unlock.py).
- [`test("root close refuses live pinned handles and retains claim after unlink and root rename"`](../../manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala).
- [`test_target_durability.TargetDurabilityTests.test_shutdown_drains_active_chunk_and_stream_and_releases_claim`](../../manure/tests/test_target_durability.py).
- [`test_target_durability.TargetDurabilityTests.test_connection_admission_returns_503_while_body_worker_active`](../../manure/tests/test_target_durability.py).
- [`MaxActiveRequests`](../../manure/backend/src/main/scala/manure/Main.scala).

**OPEN—blocks full release acceptance:**
- 6f6369b0 now implements actual active-publish, active-sweep and stalled-JDBC shutdown/physical-claim assertions with owned PG waits and unchanged production defaults. OPEN until source-bound actual execution proves all new methods green; no runtime/native pass is implied by registration.

### catalogue-current

Preserve CONTRACT7.1 Python Unicode casefold literal matching, no Unicode normalization/whitespace trim/truncation or extra query-length cap; bind cursors to the effective casefold-equivalent query/options. Retain exact UTF8 unsigned-byte text ordering, NUL/Unicode source strings, all sorts/ties/null expiry and typed exact keysets; no historical wire decoder is required.

**Source:** CONTRACT§7.1; `manure/tests/test_catalogue.py`; [current API requirements](current-api.md); `Catalogue.scala`.

**Concrete current sort/keyset/SQL assertions (not approval of ROOT matching):**
- [`test("metadata UTF8 NUL and IEEE754 timestamp bits roundtrip without normalization"`](../../manure/backend/src/test/scala/manure/DomainSuite.scala).
- [`test_client_realserver.TestRealServer.test_pagination_filters_real_server`](../../manure/tests/test_client_realserver.py).
- [`test_browser_dashboard_ux.DashboardUXTests.test_catalogue_detail_and_session_flows`](../../manure/tests/test_browser_dashboard_ux.py).
- [`test_current_client.CurrentClientTests.test_typed_catalogue_patch_management_and_search`](../../manure/tests/test_current_client.py).
- [`test(s"all metadata shared; $sort/$direction byte order, ties, NULL-last keyset traversal"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("normative full Unicode casefold matches independently expected historical values"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala). **Source now corrected in3e4bd126; compiled/native closure still pending.**
- [`test("expiry authorization and state/visibility filtering happen before keyset LIMIT"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("cursor binds every effective option and enforces typed count/time/text/null positions"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("deleting a cursor boundary does not require a boundary-row lookup"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("put/rename atomically refreshes bytea name matching without changing source bytes"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("integer keysets preserve adjacent counts beyond IEEE754 precision"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("timestamp keysets retain adjacent source binary64 values and NULL expiry tails"`](../../manure/backend/src/test/scala/manure/CatalogueContract.scala).
- [`test("forward catalogue projection bootstrap/backfill preserves original bytea and timestamp bits"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).
- [`test("trusted catalogue SQL has one keyset LIMIT and literal bytea parameters, never user SQL"`](../../manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala).

**Adjudication:** Review correction: the earlier claim that ROOT-lowercase replacement was an intentional approved change is withdrawn. ROOT is a functional regression against original CONTRACT7.1. The dual27-case and PG6-case matrices prove sorting/SQL/quota/locks, not permission to change casefold or reject valid long queries.

**New CURRENT complementary oracle:**
`test_catalogue_casefold_oracle.HistoricalCatalogueCasefoldOracleTests.test_owned_sqlite_uses_full_casefold_for_eleven_supported_queries`.
This only uses owned historical ArtifactStore/SQLite, independently expected
supported queries and its real SQL casefold function—no HTTP/main and **not
replacement-target acceptance**. Independent dual/PG and native tests remain
mandatory. The source table is now pinned Unicode16 full fold (`3e4bd126`);
all-scalar JVM proof is not native proof.

**OPEN—blocks full release acceptance:**
- Full Unicode16 fold, effective-folded query fingerprint and removal of the unapproved1024 cap are now implemented with independent dual assertions; actual-source executable scalar probe is registered in6f6369b0. Catalogue remains OPEN until compiled corrected full assertions and source-bound actual-native all-scalar proof are observed; no closure from source presence.

### cli-mcp

Owned CLI/MCP remain restart-safe, credential-hermetic and stdout-clean; MCP2025-11-25 JSON-RPC lifecycle/errors/schemas plus official SDK against controlled peer AND actual target. All current client modules execute unfiltered.

**Source:** `manure/manure/cli.py` (`def main`); `manure/manure/mcp.py` (`def main`); `manure/CONTRACT.md` (`10. MCP stdio`).

**Concrete target assertions:**
- [`test_mcp_protocol.TestMcpProtocol.test_full_lifecycle_ping_list_call`](../../manure/tests/test_mcp_protocol.py).
- [`test_mcp_protocol.TestMcpProtocol.test_sdk_interop_if_available`](../../manure/tests/test_mcp_protocol.py).
- [`test_mcp_environment.TestMcpFixtureEnvironment.test_fixtures_ignore_ambient_client_configuration`](../../manure/tests/test_mcp_environment.py).
- [`test_client_realserver.TestRealServer.test_official_sdk_lifecycle_against_real_service`](../../manure/tests/test_client_realserver.py).
- [`test_cli_process.TestSubprocessKillResume.test_kill_auto_resume`](../../manure/tests/test_cli_process.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

### retrieval-current

Authenticated ready/unexpired metadata+manifest-path corpus only; lexical/semantic/hybrid explicit, no hidden model work/fallback; ACL/filter before limit/count/evidence, actual source/generation/policy/profile/space and provenance, stale/fenced publication and profile cutover.

**Source:** `manure/backend/src/main/scala/manure/Search.scala`; `manure/models/manure.baboon` (`embeddingSpace: opt[str]`).

**Concrete target assertions:**
- [`test("metadata-only management retrieval filters ready/expiry and excludes payload secrets"`](../../manure/backend/src/test/scala/manure/HttpSuite.scala).
- [`test_current_protocol.CurrentProtocolTests.test_search_goldens_distinguish_published_space_from_lexical_head`](../../manure/tests/test_current_protocol.py).
- [`shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/AuthorizedCandidateTest.scala`](../../shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/AuthorizedCandidateTest.scala).
- [`shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/PublicationFenceTest.scala`](../../shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/PublicationFenceTest.scala).
- [`test_target_search.TargetSearchTests.test_metadata_only_heartbeat_publication_modes_outage_and_profile_space`](../../manure/tests/test_target_search.py).

**Mapped/implemented in `a12c3c58`:** negative visibility/kind/creator filters
in all three modes; exact Name evidence plus a separately queried best
ManifestPath/text/pointer, finite scores and consistent source/generation/space;
real API60s TTL with a5s controlled HTTP model query crossing expiry, followed
by empty semantic and lexical results. No fake clock or expiry-row mutation.
Existing heartbeat/not-ready/outage/cutover/delete/secret-exclusion and actual
close/restart assertions remain. This closes the outstanding semantic adapter
assertion clause, not live-provider relevance/quality.

Receipt `20261103T101950Z-jvm.MRR5I7` was re-read at
`2026-11-03T10:24:25Z`: focused actual JVM/helper-PG1 method,0 failures/errors/
skips, exit0, `currentTestSuccess:true`, `releaseAcceptance:false`. Its recorded
search test source SHA exactly matches integrated `a12c3c58`. Full unfiltered
current/native/runtime gates remain mandatory; active publish/sweeper/stuck
worker lifetime is still a separate open group.

### retired-server-activation

Portable Python cannot activate the legacy SQLite HTTP server; refuse before parser/config/credentials/storage/network/write/subprocess. Current CLI and actual MCP stdio remain usable; historical helper imports are effect-free and unsupported as runtimes.

**Source:** `manure/manure/server.py` (`def main(`); `manure/pyproject.toml`.

**Concrete target assertions:**
- [`test_retired_server_entrypoint.RetiredServerEntrypointTests.test_portable_cli_registration_and_help_remain_usable`](../../manure/tests/test_retired_server_entrypoint.py).
- [`test_retired_server_entrypoint.RetiredServerEntrypointTests.test_portable_mcp_registration_and_real_stdio_remain_usable`](../../manure/tests/test_retired_server_entrypoint.py).
- [`test_retired_server_entrypoint.RetiredServerEntrypointTests.test_public_module_refuses_before_parser_config_credentials_database_or_network`](../../manure/tests/test_retired_server_entrypoint.py).
- [`test_retired_server_entrypoint.RetiredServerEntrypointTests.test_python_server_console_script_is_not_registered`](../../manure/tests/test_retired_server_entrypoint.py).
- [`test_retired_server_entrypoint.RetiredServerEntrypointTests.test_unsupported_historical_helpers_remain_importable_without_effects`](../../manure/tests/test_retired_server_entrypoint.py).

**Treatment:** concrete replacement assertions implemented/registered; their unfiltered owning adapter/artifact/runtime execution remains mandatory. No new legacy compatibility is introduced.

`test_target_search.py`, `test_target_durability.py` and
`test_retired_server_entrypoint.py` are explicitly CURRENT, never optional-file
appendages. The retirement boundary's five methods exercise real scrubbed child
entrypoints/stdio and effect guards, while retaining portable CLI/MCP usability.
The real PG admission and dual catalogue matrices now map quota/session and
all-sort/keyset/SQL assertions, but do not close the newly adjudicated functional
casefold/effective-query/length regression. The application rejection middleware and
fixture cleanup correction now have concrete source and the registered actual
503 assertion; full release execution remains mandatory.

## Separately required artifact/runtime gates

- **backend-jvm-pg-fs**: Unfiltered manureServer+manureStorage suite inventory and exact source/report binding, zero skips. Command: `manure/scripts/test-backend.sh`.
- **jvm-current-full**: All CURRENT tests against the frozen JVM artifact, helper-owned runtime role and complete invariant mappings. Command: `manure/scripts/test-target.sh jvm full`.
- **native-current-full**: The SAME CURRENT inventory against the actual source-bound native artifact, including HTTP/TLS/PG/FS/browser/import/restart. Command: `manure/scripts/test-target.sh native <absolute ELF> <matching source manifest> full`.
- **native-filesystem-parity**: Complete linked-native filesystem behavior inventory, not JVM-only evidence.
- **provider-nix-isolation**: One owned PG provider with service-isolated roles/databases, least-privilege helper provisioning/drop, Nix/runtime/credential/restart graph validation; not proved by an admin-only test fallback.
- **shared-consumer-regressions**: Shared runtime/retrieval changes require full owned Chronicle/Haystack regressions per their instructions; Manure subset is not consumer evidence.

## Current component verification and historical evidence

The embedding-space slice used pinned Baboon0.0.198 (executable SHA checked),
regenerated Scala/TypeScript/Python/browser outputs and repeated generation with
identical generated-source hashes. Scala2.13 `manureContracts/compile` succeeded;
15 current Python codec/client methods,8 browser-boundary Node cases and74
crosslanguage vectors passed for that slice. It did not compile the service's
new Search constructor or prove actual semantic retrieval; those are owner gates.

Inventory self-check and its regression cases verify unknown root/nested Python
and Node modules fail, missing/duplicate IDs fail, retired implementations retain
requirements, full includes all current client families, skips/xfail/missing
execution cannot pass, subtest traces are durable, evidence cannot be overwritten,
and helper/provider environment separation is explicit. The local focused
inventory/credential/current-codec diagnostic executed37 methods with0
failures/errors/skips and correctly reported **releaseAcceptance:false**.
At the first inventory checkpoint `599b2c6b`, a full invocation without
provider/browser prerequisites exited1 with293 expected and0 executed tests—not
a full-suite result. After the parent import/search integration the declared
CURRENT count after durability registration is312, not a completed312-test run. Open gaps remain as listed.

Parent receipt `20261103T094915Z-jvm.hd5INM` was read after integration:1
focused actual-target search method,0 failures/errors/skips and exit0. This is
the controlled-provider JVM search slice, **not full release acceptance**.
The latest inventory self-tests again passed14 methods after source integration.

Historical receipts are scoped history, not current acceptance: client fixture
source `3f5bba81` had145 Python methods/16 Node cases/73 vectors; the credential
correction `b27444a7` had153 methods with0 failures/errors/skips under env-i,
after bounded synthetic FIFO fail-first reproduction (8 methods/33 failing
controlled cases). Their evidence directories were
`/tmp/manure-contract-evidence.Dc9gQ7` and
`/tmp/manure-credential-preflight.6uqNS2`. The earlier actual-target full run
`20261103T011209Z-jvm.btZ4In` was explicitly **INTERRUPTED**, with no authoritative
exit status/final summary; failure markers were not converted into a completion
claim. Those inputs differ from this register and must not be reused as full
current release evidence.

No current full JVM/native/browser/PG run is claimed by this inventory change.
The parent supervises frozen full runs after integration and fills remaining
invariant gaps. Python historical helpers and acknowledged state remain
preserved; public legacy activation is blocked by the new retirement guard.
Separately authorized production activation is not implied.

After parent `5f3905ec` integration and explicit retirement registration, a
35-method focused retirement/client-secret/preflight/inventory diagnostic
passed0 failures/errors/skips. The declared inventory is now31 modules/325
methods, not a completed325-method run. Three invariant clauses remain open after the concrete `a12c3c58` search closure;
full acceptance still cannot be inferred from this component diagnostic.

CURRENT oracle promotion `ca04d8b0` adds1 declared method (11 owned historical
supported queries):32 modules/326 exact IDs. This is complementary source
behavior evidence, not an HTTP/target/full/native acceptance substitute.
The native scalar probe is a separately mandatory pure parent-owned gate;
activity and active publish/sweeper/stuck-worker lifetime remain open.

Source `6f6369b0` adds4 CURRENT actual-executable/lifecycle methods to
`test_target_durability`: now8 methods in that module and330 exact CURRENT IDs
in32 modules. The scalar command uses the actual source-bound executable;
active publish/sweep/SQL-deadline cases use owned service-role triggers and
physical dev/inode kernel claim probes. All remain unexecuted by registration:
no native/current acceptance is claimed. Production JDBC defaults/identity are
not changed by the explicit owned test-fixture deadline override.

### Compiled-source manifest location identity

`test_artifact_source_manifest` is CURRENT with4 exact methods. Independent
fixture SHA+relative-path expectations include build/dependency/lock/schema,
Scala/main resources/generated/native/shared runtime inputs. Identical copied
checkouts beneath ordinary, `target` and `.git` ancestors now yield byte-identical
manifests from any cwd; only repository-relative build/git components are
excluded. Mutating ignored outputs, docs/tests and the generator itself leaves
compiled identity unchanged. No production/credential/network inputs are used.

Baseline `7a101763`:4 methods/2 failures/0 errors/skips (both ancestor bugs).
After the relative-parts fix,19 manifest/inventory/historical-oracle methods
passed0 failures/errors/skips. The real ordinary-checkout manifest was captured
before/after and compared byte-for-byte equal. There is no count padding or
fixed103/107 acceptance count. Correct earlier Nix-store/native ELF source
manifests are NOT invalidated: ordinary-path selection is unchanged and the
generator is not a compiled input. Only archives affected by the ancestor bug
need their previously incomplete manifest regenerated. These component checks
are not full runtime/native acceptance; existing three blockers remain open.
