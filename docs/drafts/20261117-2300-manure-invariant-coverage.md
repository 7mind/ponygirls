# Manure invariant coverage note (extracted from the retired test inventory)

Unit U14 of the test overhaul (`docs/drafts/20261117-2140-test-overhaul-plan.md` §6.4, §7) deleted
`manure/tests/current-test-inventory.json`, its runner gate and the seven retired Python-server test modules
(`test_catalogue`, `test_server_http_opt_in`, `test_server_lifecycle`, `test_server_limits`, `test_server_path_mode`,
`test_server_security`, `test_storage_durability`). Those modules never ran; their only role was to name, through the
inventory's `invariantGroups`, the requirements that current tests must carry. This note preserves that mapping once:
for every invariant group of the inventory at commit `0171ac39`, the current tests (`targetRefs`) that guard it.
The `sourceRefs` (retired Python implementation and its tests) are not repeated; the deleted files remain in git history
at `0171ac39`.

Status is checked mechanically against the tree of the commit that last edited this note: a Python test ID must be
discovered by `unittest`, a Scala/other reference must still contain its marker. Each reference removed by U14 names
the commit group that removed it and its surviving guard. The note is a historical record, not an inventory to maintain.

## Groups

### `credentials`

Canonical exact token/password/hash bytes; source ambiguity/configuration precedes any file/network I/O, bounded server secret-file acquisition.

- `manure/backend/src/test/scala/manure/DomainSuite.scala` :: `test("canonical token and strict credential byte rules preserve original hashes"` — present
- `manure/backend/src/test/scala/manure/SecretBoundarySuite.scala` :: `test("server hash-file reader rejects FIFO without waiting for a writer"` — present
- `manure/backend/src/test/scala/manure/SecretBoundarySuite.scala` :: `test("managed symlink reference allowed; oversized/CRLF/malformed hashes refuse bounded"` — present
- `test_credential_preflight.CredentialPreflightTests.test_all_pairs_are_preflighted_before_reading_another_pairs_file` — present
- `test_credential_preflight.CredentialPreflightTests.test_common_pairs_reject_fifo_before_read` — present
- `test_client_secret_files.ClientSecretFileTests.test_ambiguity_still_precedes_any_file_open` — present
- `test_client_secret_files.ClientSecretFileTests.test_growth_after_fstat_still_has_bounded_actual_reads` — present
- `test_client_secret_files.ClientSecretFileTests.test_nonregular_missing_and_dangling_references_are_sanitized` — present
- `test_client_secret_files.ClientSecretFileTests.test_resolved_regular_leaf_raced_to_fifo_never_blocks_or_reads` — present
- `test_client_secret_files.ClientSecretFileTests.test_sole_fifo_reference_rejects_helpers_constructor_cli_and_mcp` — present
- `test_client_secret_files.ClientSecretFileTests.test_symlink_to_fifo_rejects_but_managed_regular_symlinks_work` — present
- `test_client_secret_files.ClientSecretFileTests.test_token_exact_ascii_codec_and_single_optional_lf` — present
- `test_client_secret_files.ClientSecretFileTests.test_url_reference_transport_bound_utf8_and_strip_semantics` — present

### `shared-authority`

Every live authenticated manager lists/inspects/manifests/status/deletes/rotates any artifact including incomplete states; only chunk/publish/incomplete PATCH are owner-only; ready PATCH is shared.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("NUL/Unicode metadata, exact reservations and complete upload/publish/read/delete"` — present
- `test_client_realserver.TestRealServer.test_grant_revocation_real_server` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("shared incomplete reads and abort coexist with owner-only upload mutations"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("any manager may rotate an incomplete external password without advancing activity"` — present
- `test_target_durability.TargetDurabilityTests.test_reverse_and_concurrent_receipts_server_sigkill_after_ack_resume` — present

### `origins`

Exact Host/port and Origin, trusted-peer XFP only; cookie/bearer ambiguity; same-origin management, separated content, no CORS and explicit low-security HTTP/path modes.

- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("host/origin/cookie-bearer ambiguity and static module containment"` — present
- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("generated management mutations require exact Origin for cookie but absent allowed bearer"` — present
- `test_browser_tls.TlsSmokeCase.test_tls_hostile_planted_none_secure_cannot_mutate` — present
- `test_browser_dashboard.DashboardSiblingCase.test_b7_hostile_sibling_js_cannot_mutate_dashboard` — present
- `test_browser_http_opt_in.HttpOptInBrowserCase.test_login_internal_handoff_external_unlock_public_and_logout` — present
- `test_browser_dashboard.DashboardSeparateCase.test_b7_hostile_sibling_js_cannot_mutate_dashboard` — present

### `manifest-serving`

Immutable ordered file/directory manifest, topology/path/resource bounds, empty directories/files, index preference/no listing, strict decoding, mounted redirects and MIME/attachment/isolation behavior.

- `manure/backend/src/test/scala/manure/DomainSuite.scala` :: `test("manifest canonical path and topology bounds reject every traversal form"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("directory-only, zero-byte and nested manifests preserve real empty topology"` — present
- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("raw chunks/download byte ranges stream current contract and no secret in manifests"` — present
- `test_browser_path_mode.PathBrowserCase.test_public_canonical_mount_and_relative_assets` — present
- `test_browser_isolation.IsolationSiblingCase.test_b5_api_bytes_are_attachment_and_never_execute` — present
- `test_browser_isolation.IsolationSeparateCase.test_b6_reserved_prefixes_never_serve_user_content` — present

### `receipts`

Chunk bytes+file/parent fsync precede receipt commit and ACK; aligned/tail/idempotent/conflicting receipt rules, truthful restart progress, reverse/concurrent chunk admission and pinned source validation.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("chunk ACK follows file+parent fsync and durable receipt commit; retry heals corrupt bytes"` — present
- `manure/backend/src/test/scala/manure/DomainSuite.scala` :: `test("chunk alignment, tail, overflow and single byte ranges remain bounded"` — present
- `test_client_realserver.TestRealServer.test_chunk_resume_real_server` — present
- `test_cli_process.TestSubprocessKillResume.test_kill_manual_resume` — present
- `test_target_durability.TargetDurabilityTests.test_reverse_and_concurrent_receipts_server_sigkill_after_ack_resume` — present

### `publication-import`

Verify→publishing commit→tree/rename/parent/root fsync→ready commit→cleanup; never serve partial/publishing; ready retry idempotent; matched offline snapshot retains all states/receipts/grants/IEEE epochs and writable fix-forward boundary.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("each publish crash window remains unserved then restart reconciles ready or resumable"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("hash mismatch repairs receipts before reporting and never serves a partial ready tree"` — present
- `test_target_migration.TargetMigrationTests.test_actual_target_import_resume_crash_windows_original_grants_restart_and_fixforward` — present
- `test_offline_conversion.PostgresContracts.test_process_death_after_commit_retries_without_duplicate_rows` — present
- `test_offline_conversion.PostgresContracts.test_killed_sql_connection_rolls_back_import_transaction` — present
- `test_target_durability.TargetDurabilityTests.test_server_sigkill_after_rename_before_ready_commit_recovers` — present
- `test_target_migration.TargetMigrationTests.test_first_adoption_rejects_replaced_payload_root_without_blessing` — present

### `quota-session`

Atomic aggregate reservation and per-user/global session bounds with consistent PG lock ordering: concurrent initializations admit only fitting subset and rejected/faulted operations leave no storage/reservation debris.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("NUL/Unicode metadata, exact reservations and complete upload/publish/read/delete"` — present
- `manure/backend/src/test/scala/manure/AcquisitionFailureSuite.scala` :: `test("failed PG commit during content resource acquisition closes the pinned file"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("concurrent PostgreSQL admissions reserve exactly the quota-fitting subset"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("concurrent PostgreSQL per-user session cap is exact across independent managers"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("concurrent PostgreSQL global session cap applies in the same admission transaction"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("runtime role is least privilege and actual MetadataTxn waits on the PG advisory lock"` — present

### `expiry-activity`

Original-precision expiry cuts authorization immediately (410 authenticated API,404 anonymous/content); TTL shorten/extend/clear; only init/ACK/publish/PATCH refresh activity; sweeper handles idle uploads/orphans/grants without racing publish.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("expiry uses original float64 boundary; publishing is not idle-swept"` — present
- `test_client_realserver.TestRealServer.test_ttl_updates_real_server` — present
- `test_client_realserver.TestRealServer.test_pagination_filters_real_server` — present
- `test_browser_dashboard.ExpiredDeleteCase.test_a2_expired_artifact_can_be_deleted_from_list` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("any manager may rotate an incomplete external password without advancing activity"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("only successful PATCH and chunk including duplicate ACK refresh idle activity; reads and rejected mutations do not"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("failed publish mark and startup recovery are not successful-publish activity; ready commit and idempotency are exact"` — present
- `test_target_durability.TargetDurabilityTests.test_shutdown_waits_active_sweep_callback_then_restart_removes_orphan_tree` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("real PG sweep revalidates stale idle page after durable receipt commit and actual advisory wait"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("real PG sweep revalidates stale idle page across P2-to-P5 process gate without a long SQL transaction"` — present

### `grants-secrets`

One-time artifact/principal-bound handoff, password/token-digest-bound grants and original expiry; revoke on logout/credential replacement/rotation/visibility/delete; password once only, no raw response/log/URL leaks.

- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("external password one-time disclosure, original grant expiry/binding and rotation"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("single-use handoff and token-bound content grant revoke at logout and credential change"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("grant capacity keeps newly issued grant even when its hash sorts below timestamp-tied predecessor"` — present
- `test_browser_access_modes.DashboardAccessModeTests.test_path_access_transitions_controls_and_races` — present
- `test_browser_isolation.TestCurrentErrorEnvelope.test_current_command_fixture_projection_never_replaces_received_fault_bytes` — present
- `test_browser_unlock.UnlockSeparateCase.test_b3_no_password_appears_in_listings_or_manifest` — present

### `filesystem-lifetime`

Descriptor-relative no-follow operations, regular-file checks, bounded non-following cleanup, physical-root identity/alias ownership and retained claim until all file/worker leases release; authority-enabled startup refuses unbound or unmigrated roots before schema/adoption; linked native parity required.

- `manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala` :: `test("kernel claims contend across processes, inode rename aliases, and failed root close"` — present
- `manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala` :: `test("kernel claims release after owning process is killed, without lockfile cleanup"` — present
- `manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala` :: `test("existing opens reject symlinks, directories and FIFO without blocking"` — present
- `manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala` :: `test("cleanup unlinks symlinks and never descends into their targets"` — present
- `manure/backend/src/test/scala/manure/RuntimeSuite.scala` :: `test("wrong payload root cannot silently attach existing PG metadata"` — present
- `manure/backend/src/test/scala/manure/ArtifactsContract.scala` :: `test("symlink payload parent/leaf cannot redirect writes, hashes, serving or deletion"` — present
- `manure/backend/src/test/scala/manure/RuntimeSuite.scala` :: `test("already-bound empty metadata reopens after last-row deletion and recovers its orphan staging"` — present
- `manure/backend/src/test/scala/manure/RuntimeSuite.scala` :: `test("nonempty payload root with no import/metadata fails closed, no orphan sweep adoption"` — present
- `manure/backend/src/test/scala/manure/RootMigrationSuite.scala` :: `test("authority-enabled startup refuses an unbound root before schema or adoption effects"` — present
- `test_target_root_identity.PortableRootStartupTests.test_opted_in_unbound_root_refuses_before_schema_or_adoption` — present
- `test_target_root_identity.PortableRootStartupTests.test_opted_in_legacy_root_refuses_and_default_auth_payload_remain_usable` — present
- `test_target_root_identity.PortableRootStartupTests.test_plan_command_reports_its_own_error_stage` — present
- `test_target_root_identity.PortableRootStartupTests.test_apply_command_reports_its_own_error_stage` — present

### `range-client`

Finite streamed range reads with exact206/416 semantics; credentials/grants remain origin/host/mount scoped; cross-origin body replay refused; source/destination inode pinning, hash verification, secret-free resume cache and foreign staging files preserved.

- `test_client_hardening.TestB1RedirectBody.test_307_unlock_body_refused` — present
- `test_client_hardening.TestB4ParentOpenHook.test_swap_at_install_parent_open_boundary` — present
- `test_client_hardening.TestB3NamespaceOwnership.test_backup_verify_never_unlinks_foreign` — present
- `test_client_external.TestExternalTokenFreeFetch.test_path_mode_bare_origin_no_bearer_and_independent_grant_jar` — present
- `test_cli_process.TestOwnedFetchResumeRange.test_interrupted_fetch_resumes_exact_range` — present
- `test_current_client.CurrentClientTests.test_full_upload_fetch_empty_dirs_hashes_ranges_and_secret_free_cache` — present

### `admission-shutdown`

Malformed/oversized/stalled requests cannot mutate or revoke before body validation; finite API/unlock/login throttle and max-connections admission; graceful close orders after active chunk/publish/stream/sweeper or retains claim on failure.

- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("bounded body, duplicate JSON and framing fail before initialization effects"` — present
- `test_browser_unlock.UnlockRateLimitCase.test_b3_browser_rate_limit_statuses` — present
- `manure/server/src/test/scala/manure/storage/FilesystemBehavior.scala` :: `test("root close refuses live pinned handles and retains claim after unlink and root rename"` — present
- `test_target_durability.TargetDurabilityTests.test_shutdown_drains_active_chunk_and_stream_and_releases_claim` — present
- `test_target_durability.TargetDurabilityTests.test_connection_admission_returns_503_while_body_worker_active` — present
- `manure/backend/src/main/scala/manure/Main.scala` :: `MaxActiveRequests` — present
- `test_target_durability.TargetDurabilityTests.test_shutdown_waits_active_publish_and_keeps_physical_claim_until_ready_commit` — present
- `test_target_durability.TargetDurabilityTests.test_shutdown_waits_active_sweep_callback_then_restart_removes_orphan_tree` — present
- `test_target_durability.TargetDurabilityTests.test_shutdown_retains_claim_until_stalled_jdbc_worker_hits_its_configured_deadline` — present

### `catalogue-current`

Preserve CONTRACT7.1 Python Unicode casefold literal matching, no Unicode normalization/whitespace trim/truncation or extra query-length cap; bind cursors to the effective casefold-equivalent query/options. Retain exact UTF8 unsigned-byte text ordering, NUL/Unicode source strings, all sorts/ties/null expiry and typed exact keysets; no historical wire decoder is required.

- `manure/backend/src/test/scala/manure/DomainSuite.scala` :: `test("metadata UTF8 NUL and IEEE754 timestamp bits roundtrip without normalization"` — present
- `test_client_realserver.TestRealServer.test_pagination_filters_real_server` — present
- `test_browser_dashboard_ux.DashboardUXTests.test_catalogue_detail_and_session_flows` — present
- `test_current_client.CurrentClientTests.test_typed_catalogue_patch_management_and_search` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test(s"all metadata shared; $sort/$direction byte order, ties, NULL-last keyset traversal"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("normative full Unicode casefold matches independently expected historical values"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("expiry authorization and state/visibility filtering happen before keyset LIMIT"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("cursor binds every effective option and enforces typed count/time/text/null positions"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("deleting a cursor boundary does not require a boundary-row lookup"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("put/rename atomically refreshes bytea name matching without changing source bytes"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("integer keysets preserve adjacent counts beyond IEEE754 precision"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("timestamp keysets retain adjacent source binary64 values and NULL expiry tails"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("forward catalogue projection bootstrap/backfill preserves original bytea and timestamp bits"` — present
- `manure/backend/src/test/scala/manure/PostgresAdmissionSuite.scala` :: `test("trusted catalogue SQL has one keyset LIMIT and literal bytea parameters, never user SQL"` — present
- `test_catalogue_casefold_oracle.HistoricalCatalogueCasefoldOracleTests.test_owned_sqlite_uses_full_casefold_for_eleven_supported_queries` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("pinned Unicode16 full fold agrees with every scalar Python oracle and fixed string vectors"` — present
- `test_target_durability.TargetDurabilityTests.test_all_scalar_casefold_probe_runs_in_actual_source_bound_executable` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("current casefold-equivalent queries share the same typed cursor and next page"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("literal queries beyond 1024 UTF16 units remain accepted and results stay bounded"` — present
- `manure/backend/src/test/scala/manure/CatalogueContract.scala` :: `test("unpaired UTF16 query surrogates still reject before metadata lookup"` — present

### `cli-mcp`

Owned CLI/MCP remain restart-safe, credential-hermetic and stdout-clean; MCP2025-11-25 JSON-RPC lifecycle/errors/schemas plus official SDK against controlled peer AND actual target. All current client modules execute unfiltered.

- `test_mcp_protocol.TestMcpProtocol.test_full_lifecycle_ping_list_call` — present
- `test_mcp_protocol.TestMcpProtocol.test_sdk_interop_if_available` — present
- `test_mcp_environment.TestMcpFixtureEnvironment.test_fixtures_ignore_ambient_client_configuration` — present
- `test_client_realserver.TestRealServer.test_official_sdk_lifecycle_against_real_service` — present
- `test_cli_process.TestSubprocessKillResume.test_kill_auto_resume` — present

### `retrieval-current`

Authenticated ready/unexpired metadata+manifest-path corpus only; lexical/semantic/hybrid explicit, no hidden model work/fallback; ACL/filter before limit/count/evidence, actual source/generation/policy/profile/space and provenance, stale/fenced publication and profile cutover.

- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("metadata-only management retrieval filters ready/expiry and excludes payload secrets"` — present
- `test_current_protocol.CurrentProtocolTests.test_search_goldens_distinguish_published_space_from_lexical_head` — present
- `shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/AuthorizedCandidateTest.scala` :: `(file)` — present
- `shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/PublicationFenceTest.scala` :: `(file)` — present
- `test_target_search.TargetSearchTests.test_metadata_only_heartbeat_publication_modes_outage_and_profile_space` — present
- `manure/backend/src/test/scala/manure/WideAudienceAuditSuite.scala` :: `test("accepted 4096-byte manager ID preserves publication, lexical authorization, raw creators and startup ACL backfill"` — present

### `retired-server-activation`

Portable Python cannot activate the legacy SQLite HTTP server; refuse before parser/config/credentials/storage/network/write/subprocess. Current CLI and actual MCP stdio remain usable; historical helper imports are effect-free and unsupported as runtimes.

- `test_retired_server_entrypoint.RetiredServerEntrypointTests.test_portable_cli_registration_and_help_remain_usable` — present
- `test_retired_server_entrypoint.RetiredServerEntrypointTests.test_portable_mcp_registration_and_real_stdio_remain_usable` — present
- `test_retired_server_entrypoint.RetiredServerEntrypointTests.test_public_module_refuses_before_parser_config_credentials_database_or_network` — present
- `test_retired_server_entrypoint.RetiredServerEntrypointTests.test_python_server_console_script_is_not_registered` — present
- `test_retired_server_entrypoint.RetiredServerEntrypointTests.test_unsupported_historical_helpers_remain_importable_without_effects` — present

### `compiled-source-location-identity`

The same selected compiled source bytes have byte-identical SHA+relative-path manifests independently of checkout ancestors/cwd. Exclude only repository-relative target/.git components and noncompiled tooling, never legitimate source because an absolute ancestor is named target/.git. No count padding or blanket native-artifact invalidation.

- `test_artifact_source_manifest.ArtifactSourceManifestTests.test_git_ancestor_is_not_confused_with_repository_relative_git_metadata` — present
- `test_artifact_source_manifest.ArtifactSourceManifestTests.test_manifest_matches_independent_selected_hashes_and_relative_paths_from_any_cwd` — present
- `test_artifact_source_manifest.ArtifactSourceManifestTests.test_nested_build_metadata_and_generator_itself_never_enter_compiled_identity` — present
- `test_artifact_source_manifest.ArtifactSourceManifestTests.test_target_ancestor_cannot_change_selected_compiled_inputs` — present

### `current-full-validation`

All CURRENT cases and mandatory Node/TypeScript gates must complete successfully against EACH frozen source-bound JVM/native artifact. Historical141 remains failed8F9E; scoped corrections close only its specific defects. No mode/global release success before complete fresh actual335+17+74 execution without skips or filtering.

- `test_browser_dashboard.DashboardSeparateCase.test_b7_hostile_sibling_js_cannot_mutate_dashboard` — present
- `test_browser_dashboard.DashboardSiblingCase.test_b7_hostile_sibling_js_cannot_mutate_dashboard` — present
- `test_browser_dashboard_ux.DashboardUXTests.test_catalogue_detail_and_session_flows` — present
- `test_browser_path_mode.PathTlsBrowserCase.test_secure_internal_handoff_external_unlock_and_cookie_binding` — present
- `test_browser_unlock.UnlockBuiltinSiblingCase.test_b3_logout_clears_grant_cookie` — present
- `test_browser_unlock.UnlockBuiltinSiblingCase.test_b3_rotation_kills_old_password_and_grants` — present
- `test_browser_unlock.UnlockBuiltinSiblingCase.test_b3_unlock_assets_served_locked_else_404` — present
- `test_browser_unlock.UnlockRateLimitCase.test_b3_logout_clears_grant_cookie` — present
- `test_browser_unlock.UnlockRateLimitCase.test_b3_rotation_kills_old_password_and_grants` — present
- `test_browser_unlock.UnlockRateLimitCase.test_b3_unlock_assets_served_locked_else_404` — present
- `test_browser_unlock.UnlockSeparateCase.test_b3_logout_clears_grant_cookie` — present
- `test_browser_unlock.UnlockSeparateCase.test_b3_rotation_kills_old_password_and_grants` — present
- `test_browser_unlock.UnlockSeparateCase.test_b3_unlock_assets_served_locked_else_404` — present
- `test_browser_unlock.UnlockSiblingCase.test_b3_logout_clears_grant_cookie` — present
- `test_browser_unlock.UnlockSiblingCase.test_b3_rotation_kills_old_password_and_grants` — present
- `test_browser_unlock.UnlockSiblingCase.test_b3_unlock_assets_served_locked_else_404` — present
- `test_client_realserver.TestRealServer.test_grant_revocation_real_server` — present
- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("content form redirects have exactly zero framed body bytes and preserve cookie and location effects"` — present
- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("locked external landing alone prompts; unknown assets and revoked file grants are never a 200 password form"` — present
- `manure/backend/src/test/scala/manure/HttpSuite.scala` :: `test("anonymous capabilities advertise the exact policy used by current catalogue cursors"` — present

### `owned-fixture-boundary`

Validate explicit public provider/tools descriptors before owned fixture/helper invocation. Actual NUL/newline tool paths reject exit2 before any PG/service/fixture effects; valid five tool pins remain usable.

- `test_current_target_harness.TargetHarnessSafetyTests.test_tools_descriptor_control_characters_refuse_before_owned_fixture_invocation` — present

