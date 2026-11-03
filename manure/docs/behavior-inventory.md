# Manure invariant and executable-test register

Source baseline: `e9fda183db02898aa4b2110e47febb816b2e9ffe`. This is an
inventory/target mapping, not a claim that Python or replacement suites passed.
Every discovered Python `test_*` method is listed below, including negative,
crash, race, resource-bound, credential and browser branches. Nested subTest
cases are additional assertions, not additional discovered methods. JS browser
helpers are invoked by the listed Python browser cases; standalone
`tests/browser/network-capture.test.mjs` must also remain in the check graph.

## Invariant → observed source → executable characterization → target → migration

| ID | Invariant and observed implementation | Characterization | Target and migration treatment |
|---|---|---|---|
| A | Exact canonical 32-byte base64url credentials, LF-only file allowance, no trim; auth.py is_canonical_token/load_token_file/load_hash_file/parse_cookies; server.py _auth/_api_login/_origin/_mutation_gate | server_security, client_transport/hardening, CLI, MCP, browser login | Preserve digests and cookie codecs; revalidate current live credential hashes, ambiguity before effects; generated Identity, Login/Logout/Whoami; no role privilege change |
| B | Host+port and exact endpoint Origin, trusted-peer XFP only, no XFH/XFF trust; server.py _parse_authority/_request_endpoint/_is_secure/_dispatch | server_http_opt_in/security/path_mode, browser_tls/http_opt_in/isolation | Preserve exact aliases/default ports/HTTP opt-in; no CORS; API never exposed on content origins; current JSON POST reads are still classified by command for CSRF |
| C | Immutable file/dir manifest, bounded sizes/depth/topology, empty dirs, index.html then index.htm, no listings; domain.py validate_manifest/validate_manifest_path; server.py _decode_content_path/_serve_content_path | server_lifecycle/security, client_transport/hardening | Typed File/Directory ADT; keep exact ordered paths/hashes, single-pass strict UTF-8 decoding, reserved api/__manure; import payload+manifest losslessly |
| D | Atomic quota/session reservation, owner-only incomplete mutations, all-user inspect/delete/rotate; storage.py init_artifact and mutation methods; server.py _api_* | server_limits/security, storage_durability | PG transactional lock order replaces SQLite BEGIN IMMEDIATE, not best-effort SUM; preserve owner user/token attribution and reserved bytes; no public enumeration |
| E | Write/fsync/receipt commit before ACK, reverse/concurrent chunks, idempotent re-PUT, corrupt/missing receipt reconciliation; storage.py put_chunk/reconcile | server_lifecycle, storage_durability, cli_process/resume | Same durability boundary with JDBC receipts+POSIX tree; retain uploading bytes/receipts/sidecars/global chunk size across offline migration; raw chunk stream + generated ChunkReceipt |
| F | Publish verify→publishing commit→tree fsync→rename→parent/root fsync→ready commit→cleanup; recovery covers every missing/live/staging window; storage.py publish/reconcile | storage_durability, server_lifecycle/security/limits | Preserve fence/lock/claim semantics and recover before serving; never serve partial/publishing; FinishUpload ready retry idempotent, unfinished 409; import all 3 states |
| G | Immediate expiry masked 404 content/anonymous vs 410 authenticated, patch clear/shorten/extend, activity allowlist, idle sweeper; storage.py sweep/patch_artifact; server.py _expired_fail | server_limits/path_mode, storage_durability | Preserve source binary64 epochs independently of whole-second API display; ExpiryChange Keep/Clear/Set; snapshot matched FS+SQLite/WAL with writes/sweep stopped |
| H | One-time handoff, token/password/artifact-bound grant revocation, password once only; server.py _content_grant/_content_unlock/_content_auth_ok/_api_rotate; storage grant methods | server_security/path_mode, storage_durability, browser_handoff/unlock/access_modes | Preserve hashes/bindings/original expiry; generated CreateGrant and ContentCommand; no plaintext recovery; credentials never indexed or logged; forms still 303 adapters |
| I | Descriptor-relative no-follow serving/writes/delete/sweep and physical-root exclusive lifetime claim; storage.py _resolve_parent/_rmtree_at and ArtifactStore lifecycle | storage_durability, server_security/limits/lifecycle, client_hardening | Use existing tested POSIX seam, no JVM startsWith fallback; single process/root; fail closed on alias retarget/root replacement; native acceptance remains mandatory |
| J | Raw bounded range 200/206/416 streaming, API attachment vs content inline, finite body/admission/deadline, shutdown before releasing root ownership; server.py _read_body/_check_framing/_serve_fd_range/RunningServer.close | server_limits/lifecycle/security, client_external/hardening, cli_process | Preserve malformed framing rejection before effects, partial body cannot mutate, shutdown waits chunks/publish/sweeper/streams; current raw paths only |
| K | Catalogue full-SQL filters/keysets, typed query-bound cursor, null expiry last, literal casefold search, legacy ASC route; domain.py CatalogueQuery and storage.py list_artifacts | catalogue, server_lifecycle pagination, client_realserver | Intentional replacement: single createdAt DESC catalogue, unsigned exact UTF-8 byte ordering, ROOT lowercase utf8-root-lower-v1 (see current-api vectors); no old cursor decoder. Preserve names incl NUL with bytea, no normalization |
| L | Client exact-host or origin+mount grant jar; no bearer to content; cross-origin body redirects refused, GET credentials dropped, hostile responses bounded; client.py _request/StdlibTransport/_ranged_download | client_transport/hardening/external, server_http_opt_in | Preserve hardening unchanged while replacing only DTO boundary/routes; generated current envelopes validated strictly; no old server compatibility transport |
| M | Restart-safe secret-free upload cache, manifest/source pinning, resume received ranges, ready/publishing handling, temp+range+hash fetch installation, symlink/TOCTOU refusal; client.py upload_path/_resolve_resume_state/_ranged_download/_install_staging | client_hardening/stateful/realserver, cli_resume/process | Keep cache keys/records and public CLI/MCP methods; adapt current results into existing local algorithm types, not legacy HTTP; non-generated once passwords never persisted |
| N | MCP 2025-11-25 newline JSON-RPC lifecycle, strict schemas/ids/params/errors/stdout; mcp.py main/handle_tools_call/_validate_*; cli.py env/exit mapping | mcp_protocol/hardening/environment, client_realserver official SDK | Keep MCP external protocol, no Baboon JSON-RPC replacement; CLI/MCP call current client; official SDK against replacement executable mandatory, fake transport not substitute |
| O | Dashboard escaped text/no storage, transient secrets cleared, handoff form, CSP/referrer split, isolation and low-security path warning, table/details/race UX; web/dashboard/app.js, web/unlock/unlock.js; server.py shell/header methods | all browser_* and dashboard_markup | Generated current browser codecs; preserve interactions/security assertions, both suffix modes+TLS+path cases; don't weaken browser waits or drop negative cases |
| P | New metadata-only authenticated retrieval is distinct from exact catalogue | No historical search suite; replacement needs lexical/semantic/hybrid, ACL-before-limit/count, expiry/delete/stale jobs, provider outage/shape/deadline and profile/rebuild tests | Search typed modes/countScope/provenance/evidence; no model calls on writes/catalogue/serve, no secrets/binary contents in model corpus. Future required cases are not claimed as implemented/passed |

Each row below links a complete discovered method to one or more invariant rows.
The test name is its exact scenario (not merely a happy-path suite label).
Migration means retain that scenario against the replacement adapter/executable,
except K's explicitly changed wire/casefold/ordering/cursor assertions; source
SQL/private-Python assertions become PG/JDBC checks, never silently removed.

## Complete discovered-method inventory

### `test_browser_access_modes.py` — 2 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [DashboardAccessModeTests.test_subdomain_access_transitions](../tests/test_browser_access_modes.py#L40)
- [DashboardAccessModeTests.test_path_access_transitions_controls_and_races](../tests/test_browser_access_modes.py#L43)

### `test_browser_dashboard.py` — 18 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestAssetHygiene.test_dashboard_js_never_injects_html_or_touches_storage](../tests/test_browser_dashboard.py#L52)
- [TestAssetHygiene.test_unlock_js_never_injects_html_or_touches_storage](../tests/test_browser_dashboard.py#L59)
- [TestAssetHygiene.test_unlock_shell_uses_external_assets_only](../tests/test_browser_dashboard.py#L66)
- [TestAssetHygiene.test_login_token_input_is_transient_password_field](../tests/test_browser_dashboard.py#L79)
- [TestAssetHygiene.test_unlock_form_posts_urlencoded_to_own_origin](../tests/test_browser_dashboard.py#L86)
- [TestAssetHygiene.test_grant_handoff_is_form_post_not_url](../tests/test_browser_dashboard.py#L94)
- [DashboardFlows.test_b1_login_sets_session_cookie_and_clears_token](../tests/test_browser_dashboard.py#L138)
- [DashboardFlows.test_b1_login_requires_exact_origin_http](../tests/test_browser_dashboard.py#L162)
- [DashboardFlows.test_b1_dashboard_shell_csp_allows_content_suffix](../tests/test_browser_dashboard.py#L181)
- [DashboardFlows.test_b1_api_dynamic_responses_carry_security_headers](../tests/test_browser_dashboard.py#L217)
- [DashboardFlows.test_b7_wrong_origin_mutation_with_planted_cookie_changes_nothing](../tests/test_browser_dashboard.py#L230)
- [DashboardFlows.test_d1_list_detail_delete_with_hostile_name](../tests/test_browser_dashboard.py#L263)
- [DashboardFlows.test_d1_rotate_reveals_once_and_clears_on_dismiss](../tests/test_browser_dashboard.py#L316)
- [DashboardFlows.test_a1_logout_clears_revealed_password_dom](../tests/test_browser_dashboard.py#L358)
- [DashboardFlows.test_a2_detail_failure_is_visible_in_list](../tests/test_browser_dashboard.py#L397)
- [DashboardFlows.test_b7_hostile_sibling_js_cannot_mutate_dashboard](../tests/test_browser_dashboard.py#L438)
- [DashboardFlows.test_d1_open_public_and_external_from_dashboard](../tests/test_browser_dashboard.py#L683)
- [ExpiredDeleteCase.test_a2_expired_artifact_can_be_deleted_from_list](../tests/test_browser_dashboard.py#L749)

### `test_browser_dashboard_ux.py` — 1 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [DashboardUXTests.test_catalogue_detail_and_session_flows](../tests/test_browser_dashboard_ux.py#L45)

### `test_browser_handoff.py` — 2 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [HandoffFlows.test_b2_dashboard_open_hands_off_to_content_origin](../tests/test_browser_handoff.py#L39)
- [HandoffFlows.test_b2_one_time_grant_cannot_be_reused](../tests/test_browser_handoff.py#L106)

### `test_browser_http_opt_in.py` — 1 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [HttpOptInBrowserCase.test_login_internal_handoff_external_unlock_public_and_logout](../tests/test_browser_http_opt_in.py#L12)

### `test_browser_isolation.py` — 6 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [IsolationFlows.test_b4_artifacts_cannot_read_each_other](../tests/test_browser_isolation.py#L72)
- [IsolationFlows.test_b4_content_responses_carry_isolation_headers](../tests/test_browser_isolation.py#L117)
- [IsolationFlows.test_b4_management_paths_absent_from_content_origin](../tests/test_browser_isolation.py#L141)
- [IsolationFlows.test_b4_framing_blocked_by_header](../tests/test_browser_isolation.py#L156)
- [IsolationFlows.test_b5_api_bytes_are_attachment_and_never_execute](../tests/test_browser_isolation.py#L225)
- [IsolationFlows.test_b6_reserved_prefixes_never_serve_user_content](../tests/test_browser_isolation.py#L279)

### `test_browser_path_mode.py` — 4 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [PathBrowserCase.test_internal_handoff_two_grants_and_nested_relative_assets](../tests/test_browser_path_mode.py#L19)
- [PathBrowserCase.test_external_packaged_and_builtin_password_forms](../tests/test_browser_path_mode.py#L51)
- [PathBrowserCase.test_public_canonical_mount_and_relative_assets](../tests/test_browser_path_mode.py#L75)
- [PathTlsBrowserCase.test_secure_internal_handoff_external_unlock_and_cookie_binding](../tests/test_browser_path_mode.py#L87)

### `test_browser_tls.py` — 5 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TlsSmokeCase.test_tls_edge_required_without_proxy](../tests/test_browser_tls.py#L58)
- [TlsSmokeCase.test_tls_login_sets_secure_host_cookies](../tests/test_browser_tls.py#L89)
- [TlsSmokeCase.test_tls_handoff_across_separate_domains](../tests/test_browser_tls.py#L116)
- [TlsSmokeCase.test_tls_external_unlock_round_trip](../tests/test_browser_tls.py#L160)
- [TlsSmokeCase.test_tls_hostile_planted_none_secure_cannot_mutate](../tests/test_browser_tls.py#L183)

### `test_browser_unlock.py` — 10 methods

Invariant rows: **A B H O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [UnlockFlows.test_b3_unlock_shell_round_trip_in_browser](../tests/test_browser_unlock.py#L59)
- [UnlockFlows.test_b3_wrong_password_fails_generic_without_cookie](../tests/test_browser_unlock.py#L97)
- [UnlockFlows.test_b3_rotation_kills_old_password_and_grants](../tests/test_browser_unlock.py#L164)
- [UnlockFlows.test_b3_logout_clears_grant_cookie](../tests/test_browser_unlock.py#L206)
- [UnlockFlows.test_b3_unlock_assets_served_locked_else_404](../tests/test_browser_unlock.py#L232)
- [UnlockFlows.test_b3_password_pages_use_origin_only_referrer_policy](../tests/test_browser_unlock.py#L259)
- [UnlockFlows.test_b3_browser_revocation_and_password_rotation](../tests/test_browser_unlock.py#L272)
- [UnlockFlows.test_b3_no_password_appears_in_listings_or_manifest](../tests/test_browser_unlock.py#L342)
- [UnlockRateLimitCase.test_b3_browser_rate_limit_statuses](../tests/test_browser_unlock.py#L382)
- [UnlockRateLimitCase.test_b3_unlock_rate_limited_with_retry_after](../tests/test_browser_unlock.py#L414)

### `test_catalogue.py` — 12 methods

Invariant rows: **K**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [CatalogueStorageCase.test_all_sorts_directions_ties_and_null_expiry_across_pages](../tests/test_catalogue.py#L71)
- [CatalogueStorageCase.test_unicode_literal_search_id_and_combined_filters](../tests/test_catalogue.py#L87)
- [CatalogueStorageCase.test_search_casefold_expansion_is_not_limited_to_name_length](../tests/test_catalogue.py#L104)
- [CatalogueStorageCase.test_cursor_binds_every_effective_query_option](../tests/test_catalogue.py#L110)
- [CatalogueStorageCase.test_cursor_binds_effective_not_raw_search_or_default_options](../tests/test_catalogue.py#L129)
- [CatalogueStorageCase.test_cursor_saves_boundary_value_across_mutation_and_deletion](../tests/test_catalogue.py#L138)
- [CatalogueStorageCase.test_invalid_query_and_typed_cursors_are_domain_errors](../tests/test_catalogue.py#L160)
- [CatalogueStorageCase.test_cursor_rejects_wrong_sort_value_types_before_sql](../tests/test_catalogue.py#L183)
- [CatalogueStorageCase.test_sql_filters_and_sort_are_bounded_not_fetch_all_or_offset](../tests/test_catalogue.py#L202)
- [CatalogueHttpCase.test_http_search_sort_and_legacy_defaults](../tests/test_catalogue.py#L243)
- [CatalogueHttpCase.test_http_cursor_uses_clamped_limit](../tests/test_catalogue.py#L257)
- [CatalogueHttpCase.test_http_bad_query_and_cursor_are_domain_errors](../tests/test_catalogue.py#L269)

### `test_cli_process.py` — 3 methods

Invariant rows: **E J M**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestSubprocessKillResume.test_kill_auto_resume](../tests/test_cli_process.py#L73)
- [TestSubprocessKillResume.test_kill_manual_resume](../tests/test_cli_process.py#L131)
- [TestOwnedFetchResumeRange.test_interrupted_fetch_resumes_exact_range](../tests/test_cli_process.py#L173)

### `test_cli_resume.py` — 14 methods

Invariant rows: **A E M N**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestEnvPrecedence.test_ambiguous_token_exits_2_no_network](../tests/test_cli_resume.py#L89)
- [TestEnvPrecedence.test_ambiguous_url_exits_2](../tests/test_cli_resume.py#L103)
- [TestEnvPrecedence.test_ambiguous_password_exits_2](../tests/test_cli_resume.py#L116)
- [TestEnvPrecedence.test_missing_credentials_before_network](../tests/test_cli_resume.py#L131)
- [TestEnvPrecedence.test_token_file_exact_bytes_via_cli](../tests/test_cli_resume.py#L138)
- [TestEnvPrecedence.test_empty_env_treated_as_unset](../tests/test_cli_resume.py#L150)
- [TestUploadCacheResume.test_upload_requires_access](../tests/test_cli_resume.py#L178)
- [TestUploadCacheResume.test_upload_invalid_ttl_before_network](../tests/test_cli_resume.py#L190)
- [TestUploadCacheResume.test_upload_json_stable_and_cache_no_secrets](../tests/test_cli_resume.py#L202)
- [TestUploadCacheResume.test_external_generating_call_returns_password_once](../tests/test_cli_resume.py#L226)
- [TestUploadCacheResume.test_resumed_external_prints_null_note](../tests/test_cli_resume.py#L241)
- [TestUploadCacheResume.test_source_changed_exit_2](../tests/test_cli_resume.py#L278)
- [TestUploadCacheResume.test_auto_resume_single_match](../tests/test_cli_resume.py#L301)
- [TestUploadCacheResume.test_fresh_ignores_cache](../tests/test_cli_resume.py#L336)

### `test_client_external.py` — 5 methods

Invariant rows: **H J L M**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestExternalTokenFreeFetch.test_password_to_manifest_to_ranged_files](../tests/test_client_external.py#L127)
- [TestExternalTokenFreeFetch.test_public_anon_fetch_no_password](../tests/test_client_external.py#L150)
- [TestExternalTokenFreeFetch.test_subdomain_url_nested_view_path_keeps_subdomain_routing](../tests/test_client_external.py#L161)
- [TestExternalTokenFreeFetch.test_path_mode_bare_origin_no_bearer_and_independent_grant_jar](../tests/test_client_external.py#L171)
- [TestExternalTokenFreeFetch.test_fetch_resumes_partial_temp](../tests/test_client_external.py#L185)

### `test_client_hardening.py` — 49 methods

Invariant rows: **A C E F I J L M**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestB1RedirectBody.test_307_unlock_body_refused](../tests/test_client_hardening.py#L33)
- [TestB1RedirectBody.test_308_chunk_body_refused_canary](../tests/test_client_hardening.py#L56)
- [TestB1RedirectBody.test_get_redirect_drops_creds_still_follows](../tests/test_client_hardening.py#L79)
- [TestB2Bounds.test_negative_and_nonint_sizes_rejected](../tests/test_client_hardening.py#L100)
- [TestB2Bounds.test_chunk_bytes_bounds](../tests/test_client_hardening.py#L109)
- [TestB2Bounds.test_oversized_range_ignored_before_write](../tests/test_client_hardening.py#L125)
- [TestB2Bounds.test_content_range_mismatch_rejected](../tests/test_client_hardening.py#L182)
- [TestB3Staging.test_existing_part_preserved](../tests/test_client_hardening.py#L229)
- [TestB3Staging.test_manifest_temp_collision_both_orders](../tests/test_client_hardening.py#L259)
- [TestB4Symlink.test_dest_symlink_ancestor_rejected_before_mkdir](../tests/test_client_hardening.py#L308)
- [TestB4Symlink.test_empty_manifest_through_symlink_rejected](../tests/test_client_hardening.py#L329)
- [TestB4Symlink.test_source_parent_swap_rejected](../tests/test_client_hardening.py#L347)
- [TestB5ResumeAccess.test_cached_access_mismatch_rejected](../tests/test_client_hardening.py#L428)
- [TestB5ResumeAccess.test_reports_actual_visibility](../tests/test_client_hardening.py#L439)
- [TestB5ResumeAccess.test_ready_resume_no_puts_and_retires](../tests/test_client_hardening.py#L448)
- [TestB7Credentials.test_malformed_direct_token_before_network](../tests/test_client_hardening.py#L461)
- [TestB7Credentials.test_missing_file_normalized](../tests/test_client_hardening.py#L472)
- [TestB7Credentials.test_invalid_port_before_network](../tests/test_client_hardening.py#L480)
- [TestB7Credentials.test_ipv6_origin_bracketed](../tests/test_client_hardening.py#L487)
- [TestB10Patch.test_shorten_extend_clear_bodies](../tests/test_client_hardening.py#L506)
- [TestB4SwapDeterministic.test_source_file_swapped_to_symlink_rejected](../tests/test_client_hardening.py#L556)
- [TestB4SwapDeterministic.test_fetch_final_swapped_to_symlink_refused](../tests/test_client_hardening.py#L576)
- [TestB7SecretCanary.test_transport_error_hides_authorization](../tests/test_client_hardening.py#L604)
- [TestB8TopologyHashes.test_topology_uses_valid_hashes](../tests/test_client_hardening.py#L623)
- [TestB5RecoveryManifest.test_publishing_recovery_continues_not_success](../tests/test_client_hardening.py#L635)
- [TestB5RecoveryManifest.test_server_manifest_mismatch_rejected](../tests/test_client_hardening.py#L692)
- [TestB3NamespaceOwnership.test_preexisting_namespace_contents_preserved](../tests/test_client_hardening.py#L751)
- [TestB3NamespaceOwnership.test_empty_manifest_creates_nothing_extra](../tests/test_client_hardening.py#L775)
- [TestB3NamespaceOwnership.test_fallback_payload_collision_both_orders](../tests/test_client_hardening.py#L796)
- [TestB3NamespaceOwnership.test_successful_replace_preserves_foreign_backup](../tests/test_client_hardening.py#L824)
- [TestB3NamespaceOwnership.test_replace_unreadable_regular_destination](../tests/test_client_hardening.py#L864)
- [TestB3NamespaceOwnership.test_backup_cleanup_never_unlinks_foreign_inode](../tests/test_client_hardening.py#L904)
- [TestB3NamespaceOwnership.test_backup_verify_never_unlinks_foreign](../tests/test_client_hardening.py#L965)
- [TestB4SwapHooks.test_ancestor_swap_between_init_and_read_sends_nothing](../tests/test_client_hardening.py#L1041)
- [TestB4SwapHooks.test_staging_swap_between_verify_and_install](../tests/test_client_hardening.py#L1109)
- [TestB11LongPaths.test_nested_path_over_255_roundtrip](../tests/test_client_hardening.py#L1152)
- [TestB11LongPaths.test_interrupted_long_path_resume](../tests/test_client_hardening.py#L1181)
- [TestB11LongPaths.test_slash_flatten_collision_impossible](../tests/test_client_hardening.py#L1229)
- [TestB4BoundaryHooks.test_dest_ancestor_swap_before_parent_open](../tests/test_client_hardening.py#L1260)
- [TestB4BoundaryHooks.test_staging_swap_at_rename_boundary](../tests/test_client_hardening.py#L1311)
- [TestB4BoundaryHooks.test_cleanup_preserves_owned_namespace_unrelated](../tests/test_client_hardening.py#L1369)
- [TestB3SidecarRace.test_foreign_sidecar_planted_during_claim](../tests/test_client_hardening.py#L1419)
- [TestB4AncestorSwaps.test_single_file_hash_ancestor_swap](../tests/test_client_hardening.py#L1476)
- [TestB4AncestorSwaps.test_single_file_parent_swap_redirects_nothing](../tests/test_client_hardening.py#L1494)
- [TestB4AncestorSwaps.test_cleanup_ancestor_swap](../tests/test_client_hardening.py#L1556)
- [TestB4AncestorSwaps.test_cleanup_swap_after_acquire_before_rmdir](../tests/test_client_hardening.py#L1603)
- [TestB4AncestorSwaps.test_existing_hash_swap_at_open](../tests/test_client_hardening.py#L1663)
- [TestB4ParentOpenHook.test_swap_at_install_parent_open_boundary](../tests/test_client_hardening.py#L1730)
- [TestE1FailFirstRecords.test_e1_baseline_fail_fixed_pass_records](../tests/test_client_hardening.py#L1935)

### `test_client_realserver.py` — 14 methods

Invariant rows: **A C D E G H J K L M N**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestRealServer.test_internal_roundtrip](../tests/test_client_realserver.py#L76)
- [TestRealServer.test_public_anon_fetch](../tests/test_client_realserver.py#L96)
- [TestRealServer.test_external_token_free_fetch](../tests/test_client_realserver.py#L118)
- [TestRealServer.test_chunk_resume_real_server](../tests/test_client_realserver.py#L148)
- [TestRealServer.test_grant_isolation_real_server](../tests/test_client_realserver.py#L181)
- [TestRealServer.test_cli_matrix_against_real_service](../tests/test_client_realserver.py#L245)
- [TestRealServer.test_mcp_matrix_against_real_service](../tests/test_client_realserver.py#L318)
- [TestRealServer.test_mcp_stdio_matrix_against_real_service](../tests/test_client_realserver.py#L373)
- [TestRealServer.test_cross_artifact_cookie_isolation_real_server](../tests/test_client_realserver.py#L449)
- [TestRealServer.test_grant_revocation_real_server](../tests/test_client_realserver.py#L501)
- [TestRealServer.test_pagination_filters_real_server](../tests/test_client_realserver.py#L614)
- [TestRealServer.test_ttl_updates_real_server](../tests/test_client_realserver.py#L692)
- [TestRealServer.test_mcp_stdio_management_calls_against_real_service](../tests/test_client_realserver.py#L742)
- [TestRealServer.test_official_sdk_lifecycle_against_real_service](../tests/test_client_realserver.py#L815)

### `test_client_stateful.py` — 3 methods

Invariant rows: **E L M**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestStatefulRoundtrip.test_upload_fetch_bytes_ranges](../tests/test_client_stateful.py#L278)
- [TestStatefulRoundtrip.test_killed_process_auto_and_manual_resume](../tests/test_client_stateful.py#L305)
- [TestStatefulRoundtrip.test_cli_commands_against_stateful](../tests/test_client_stateful.py#L367)

### `test_client_transport.py` — 23 methods

Invariant rows: **A C J L M**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestAmbiguityNoNetwork.test_constructor_token_and_file_ambiguous_no_network](../tests/test_client_transport.py#L79)
- [TestAmbiguityNoNetwork.test_empty_values_are_unset_not_ambiguous](../tests/test_client_transport.py#L95)
- [TestTokenFileCodec.test_exact_bytes_ok](../tests/test_client_transport.py#L102)
- [TestTokenFileCodec.test_rejects](../tests/test_client_transport.py#L112)
- [TestLoopbackHttps.test_http_non_loopback_rejected_before_network](../tests/test_client_transport.py#L133)
- [TestLoopbackHttps.test_https_non_loopback_allowed](../tests/test_client_transport.py#L143)
- [TestLoopbackHttps.test_http_loopback_allowed](../tests/test_client_transport.py#L153)
- [TestLoopbackHttps.test_is_loopback_host](../tests/test_client_transport.py#L163)
- [TestCredentialIsolation.test_bearer_only_to_api_origin](../tests/test_client_transport.py#L174)
- [TestCredentialIsolation.test_grant_jar_exact_host](../tests/test_client_transport.py#L198)
- [TestCredentialIsolation.test_cross_origin_redirect_drops_credentials](../tests/test_client_transport.py#L222)
- [TestManifestValidation.test_validate_paths](../tests/test_client_transport.py#L252)
- [TestManifestValidation.test_depth_limit](../tests/test_client_transport.py#L268)
- [TestManifestValidation.test_topology_conflicts](../tests/test_client_transport.py#L277)
- [TestTTL.test_parse](../tests/test_client_transport.py#L296)
- [TestUploadFetchRoundTripDummy.test_upload_file_then_fetch_via_api](../tests/test_client_transport.py#L314)
- [TestUploadFetchRoundTripDummy.test_upload_rejects_symlink](../tests/test_client_transport.py#L388)
- [TestUploadFetchRoundTripDummy.test_upload_dir_includes_empty_dirs](../tests/test_client_transport.py#L401)
- [TestUploadFetchRoundTripDummy.test_resume_skips_received_ranges](../tests/test_client_transport.py#L417)
- [TestUploadFetchRoundTripDummy.test_fetch_verifies_hash_and_atomic](../tests/test_client_transport.py#L477)
- [TestUploadFetchRoundTripDummy.test_fetch_refuses_symlink_overwrite](../tests/test_client_transport.py#L503)
- [TestUploadFetchRoundTripDummy.test_fetch_rejects_hostile_manifest](../tests/test_client_transport.py#L530)
- [TestLoopbackFixture.test_fixture_verifies_bearer_and_range](../tests/test_client_transport.py#L602)

### `test_dashboard_markup.py` — 7 methods

Invariant rows: **O**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [DashboardMarkupTests.test_catalogue_is_an_accessible_sortable_table](../tests/test_dashboard_markup.py#L40)
- [DashboardMarkupTests.test_infinite_scroll_has_keyboard_and_failure_controls](../tests/test_dashboard_markup.py#L46)
- [DashboardMarkupTests.test_detail_has_file_table_and_transient_password_actions](../tests/test_dashboard_markup.py#L54)
- [DashboardMarkupTests.test_detail_offers_access_modes_and_live_feedback](../tests/test_dashboard_markup.py#L60)
- [DashboardMarkupTests.test_dashboard_distinguishes_session_unavailability_from_login](../tests/test_dashboard_markup.py#L70)
- [DashboardMarkupTests.test_path_mode_notice_is_an_icon_with_a_tooltip](../tests/test_dashboard_markup.py#L76)
- [DashboardMarkupTests.test_both_shells_offer_dark_mode_without_external_assets](../tests/test_dashboard_markup.py#L89)

### `test_mcp_environment.py` — 1 methods

Invariant rows: **A N**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestMcpFixtureEnvironment.test_fixtures_ignore_ambient_client_configuration](../tests/test_mcp_environment.py#L12)

### `test_mcp_hardening.py` — 11 methods

Invariant rows: **N**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestMcpHardening.test_initialize_list_version_crashes_then_recovers](../tests/test_mcp_hardening.py#L36)
- [TestMcpHardening.test_missing_initialize_fields_rejected](../tests/test_mcp_hardening.py#L52)
- [TestMcpHardening.test_invalid_method_id_types_and_idless](../tests/test_mcp_hardening.py#L68)
- [TestMcpHardening.test_initialized_before_initialize_ignored](../tests/test_mcp_hardening.py#L90)
- [TestMcpHardening.test_limit_minimum_enforced](../tests/test_mcp_hardening.py#L104)
- [TestMcpOfficialSchemas.test_initialize_clientinfo_members](../tests/test_mcp_hardening.py#L125)
- [TestMcpOfficialSchemas.test_initialized_with_id_or_params_no_advance](../tests/test_mcp_hardening.py#L144)
- [TestMcpOfficialSchemas.test_list_meta_accepted_ping_params_rejected](../tests/test_mcp_hardening.py#L163)
- [TestMcpNullAndCapabilities.test_null_id_and_null_params_rejected](../tests/test_mcp_hardening.py#L185)
- [TestMcpNullAndCapabilities.test_capabilities_members_typed](../tests/test_mcp_hardening.py#L209)
- [TestMcpNullAndCapabilities.test_nullable_tool_args_accepted](../tests/test_mcp_hardening.py#L237)

### `test_mcp_protocol.py` — 9 methods

Invariant rows: **N**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [TestMcpProtocol.test_initialize_supported_echo](../tests/test_mcp_protocol.py#L98)
- [TestMcpProtocol.test_initialize_unsupported_offers_downgrade](../tests/test_mcp_protocol.py#L109)
- [TestMcpProtocol.test_full_lifecycle_ping_list_call](../tests/test_mcp_protocol.py#L116)
- [TestMcpProtocol.test_jsonrpc_error_shapes](../tests/test_mcp_protocol.py#L148)
- [TestMcpProtocol.test_parse_error_and_invalid_request](../tests/test_mcp_protocol.py#L165)
- [TestMcpProtocol.test_stdout_purity](../tests/test_mcp_protocol.py#L184)
- [TestMcpProtocol.test_tools_call_whoami_inprocess](../tests/test_mcp_protocol.py#L212)
- [TestMcpProtocol.test_tools_call_domain_fault_iserror](../tests/test_mcp_protocol.py#L230)
- [TestMcpProtocol.test_sdk_interop_if_available](../tests/test_mcp_protocol.py#L248)

### `test_server_http_opt_in.py` — 5 methods

Invariant rows: **A B H L**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [HttpOptInCase.test_config_default_and_strict_opt_in](../tests/test_server_http_opt_in.py#L40)
- [HttpOptInCase.test_http_login_upload_grant_fetch_logout_and_https_isolation](../tests/test_server_http_opt_in.py#L54)
- [HttpOptInCase.test_python_client_and_cli_http_require_explicit_opt_in](../tests/test_server_http_opt_in.py#L82)
- [HttpOptInCase.test_redirect_http_opt_in_keeps_bearer_origin_scoping](../tests/test_server_http_opt_in.py#L120)
- [HttpOptInCase.test_host_port_origin_and_forwarded_proto_fail_closed](../tests/test_server_http_opt_in.py#L141)

### `test_server_lifecycle.py` — 18 methods

Invariant rows: **C E F J K**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [LifecycleCase.test_f1_file_roundtrip_bytes_and_sha](../tests/test_server_lifecycle.py#L155)
- [LifecycleCase.test_f2_dir_empty_dirs_index_and_manifest_json](../tests/test_server_lifecycle.py#L193)
- [LifecycleCase.test_f2b_topology_rejections](../tests/test_server_lifecycle.py#L265)
- [LifecycleCase.test_f6_resume_status_idempotent_conflict](../tests/test_server_lifecycle.py#L324)
- [LifecycleCase.test_r1_reverse_order_chunks_publish](../tests/test_server_lifecycle.py#L403)
- [LifecycleCase.test_r1_concurrent_chunks_publish](../tests/test_server_lifecycle.py#L427)
- [LifecycleCase.test_r1_restart_with_corrupted_bytes_resumes](../tests/test_server_lifecycle.py#L461)
- [LifecycleCase.test_r6_tiny_range_never_reads_whole_file](../tests/test_server_lifecycle.py#L501)
- [LifecycleCase.test_r6_concurrent_ranged_downloads](../tests/test_server_lifecycle.py#L541)
- [LifecycleCase.test_r11_http_fault_retry_download_verifies](../tests/test_server_lifecycle.py#L579)
- [LifecycleCase.test_r11_http_actual_fsync_commit_faults_unserved_then_recover](../tests/test_server_lifecycle.py#L612)
- [LifecycleCase.test_r11_http_tree_loss_resumes_without_restart](../tests/test_server_lifecycle.py#L727)
- [LifecycleCase.test_r10_empty_file_roundtrip](../tests/test_server_lifecycle.py#L764)
- [LifecycleCase.test_r10_empty_root_and_nested_dirs_survive_restart](../tests/test_server_lifecycle.py#L781)
- [LifecycleCase.test_f7_publish_idempotent_and_publishing_conflict](../tests/test_server_lifecycle.py#L817)
- [LifecycleCase.test_f7_publish_crash_windows_reconcile](../tests/test_server_lifecycle.py#L835)
- [LifecycleCase.test_f8_pagination_order_cursor](../tests/test_server_lifecycle.py#L863)
- [LifecycleCase.test_f8b_uploading_bytes_409_and_hash_mismatch](../tests/test_server_lifecycle.py#L902)

### `test_server_limits.py` — 29 methods

Invariant rows: **A D F G I J**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [LimitsCase.test_ttl_immediate_cutoff_and_sweep](../tests/test_server_limits.py#L127)
- [LimitsCase.test_ttl_patch_shorten_extend_clear](../tests/test_server_limits.py#L160)
- [LimitsCase.test_r5_oversized_mutations_rejected_without_effect](../tests/test_server_limits.py#L201)
- [LimitsCase.test_r5_oversized_delete_preserves_artifact](../tests/test_server_limits.py#L241)
- [LimitsCase.test_r5_oversized_logout_preserves_grants](../tests/test_server_limits.py#L275)
- [LimitsCase.test_r5_stalled_body_preserves_state_password_grants](../tests/test_server_limits.py#L308)
- [LimitsCase.test_r5_malformed_framing_and_canary](../tests/test_server_limits.py#L439)
- [LimitsCase.test_oversized_json_body_413](../tests/test_server_limits.py#L486)
- [LimitsCase.test_chunk_size_cap_and_alignment](../tests/test_server_limits.py#L494)
- [LimitsCase.test_quota_reservation_concurrent_subset](../tests/test_server_limits.py#L536)
- [LimitsCase.test_session_caps_429](../tests/test_server_limits.py#L567)
- [LimitsCase.test_login_throttle_and_mutation_rate_limit](../tests/test_server_limits.py#L582)
- [LimitsCase.test_r15_expiry_status_by_authentication](../tests/test_server_limits.py#L611)
- [LimitsCase.test_r15_activity_allowlist](../tests/test_server_limits.py#L641)
- [LimitsCase.test_idle_sessions_swept_and_activity_definition](../tests/test_server_limits.py#L676)
- [LimitsCase.test_max_connections_503_with_retry_after](../tests/test_server_limits.py#L707)
- [LimitsCase.test_r7_worker_bound_and_graceful_shutdown](../tests/test_server_limits.py#L741)
- [LimitsCase.test_r7_close_orders_after_inflight_chunk_commit](../tests/test_server_limits.py#L805)
- [LimitsCase.test_r7_close_orders_after_inflight_publish](../tests/test_server_limits.py#L848)
- [LimitsCase.test_r7_close_waits_sweeper_and_streaming](../tests/test_server_limits.py#L890)
- [LimitsCase.test_r7_stuck_worker_close_raises_and_retains_ownership](../tests/test_server_limits.py#L965)
- [LimitsCase.test_r16_sweeper_and_handler_faults_hide_canaries](../tests/test_server_limits.py#L1026)
- [ConfigCase.test_unknown_keys_fail_closed](../tests/test_server_limits.py#L1090)
- [ConfigCase.test_users_required_and_chunk_range](../tests/test_server_limits.py#L1095)
- [ConfigCase.test_dashboard_disabled_and_assets](../tests/test_server_limits.py#L1105)
- [ConfigCase.test_direct_dataclass_construction_compat](../tests/test_server_limits.py#L1142)
- [ConfigCase.test_r9_competing_server_same_data_dir](../tests/test_server_limits.py#L1176)
- [ConfigCase.test_r12_direct_construction_validated](../tests/test_server_limits.py#L1194)
- [ConfigCase.test_production_cookie_names_and_secure](../tests/test_server_limits.py#L1250)

### `test_server_path_mode.py` — 9 methods

Invariant rows: **B C G H**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [PathModeCase.test_public_root_relative_assets_nested_redirects_and_ranges](../tests/test_server_path_mode.py#L31)
- [PathModeCase.test_internal_grants_coexist_bind_artifacts_and_revoke](../tests/test_server_path_mode.py#L52)
- [PathModeCase.test_external_client_public_and_password_rotation](../tests/test_server_path_mode.py#L87)
- [PathModeCase.test_handoff_exact_origin_artifact_binding_and_single_use](../tests/test_server_path_mode.py#L115)
- [PathModeCase.test_custom_unlock_shell_rewrites_only_actual_root_url_attributes](../tests/test_server_path_mode.py#L128)
- [PathModeCase.test_expiry_hides_content_and_manifest](../tests/test_server_path_mode.py#L150)
- [PathConfigCase.test_original_positional_constructor_keeps_subdomain_default](../tests/test_server_path_mode.py#L161)
- [PathConfigCase.test_ambiguous_artifact_shaped_api_hostname_rejected_in_path_mode](../tests/test_server_path_mode.py#L171)
- [PathConfigCase.test_suffix_optional_only_for_path_mode_and_mode_validated](../tests/test_server_path_mode.py#L178)

### `test_server_security.py` — 41 methods

Invariant rows: **A B C D F H I J**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [SecurityCase.test_internal_authed_ok_anon_denied](../tests/test_server_security.py#L142)
- [SecurityCase.test_external_password_flow_and_rotation](../tests/test_server_security.py#L165)
- [SecurityCase.test_public_anon_ok](../tests/test_server_security.py#L257)
- [SecurityCase.test_grants_rejected_for_external_and_public](../tests/test_server_security.py#L268)
- [SecurityCase.test_every_user_lists_inspects_deletes](../tests/test_server_security.py#L279)
- [SecurityCase.test_incomplete_mutation_owner_only](../tests/test_server_security.py#L294)
- [SecurityCase.test_r17_noncanonical_provisioned_digest_never_authenticates](../tests/test_server_security.py#L338)
- [SecurityCase.test_r17_noncanonical_token_file_rejected](../tests/test_server_security.py#L398)
- [SecurityCase.test_ambiguous_credentials_no_side_effects](../tests/test_server_security.py#L407)
- [SecurityCase.test_login_requires_exact_origin_and_sets_dev_cookie](../tests/test_server_security.py#L420)
- [SecurityCase.test_bearer_allows_absent_origin_rejects_mismatch](../tests/test_server_security.py#L458)
- [SecurityCase.test_single_use_grant_and_wrong_origin](../tests/test_server_security.py#L467)
- [SecurityCase.test_content_host_rejects_api_and_unknown](../tests/test_server_security.py#L494)
- [SecurityCase.test_unknown_init_top_level_field_rejected](../tests/test_server_security.py#L503)
- [SecurityCase.test_unknown_patch_field_rejected](../tests/test_server_security.py#L513)
- [SecurityCase.test_dir_entry_with_size_rejected_as_invalid_path](../tests/test_server_security.py#L530)
- [SecurityCase.test_r12_duplicate_host_rejected](../tests/test_server_security.py#L561)
- [SecurityCase.test_r12_malformed_authorities_rejected](../tests/test_server_security.py#L569)
- [SecurityCase.test_r12_duplicate_origin_forbidden](../tests/test_server_security.py#L578)
- [SecurityCase.test_r12_unsupported_method_gated](../tests/test_server_security.py#L604)
- [SecurityCase.test_r12_production_port_enforced](../tests/test_server_security.py#L617)
- [SecurityCase.test_d2_referrer_policy_split](../tests/test_server_security.py#L696)
- [SecurityCase.test_f2_shell_assets_while_locked](../tests/test_server_security.py#L728)
- [SecurityCase.test_r13_live_parent_swap_never_exposes_outside](../tests/test_server_security.py#L810)
- [SecurityCase.test_bad_host_sets_no_cookies](../tests/test_server_security.py#L850)
- [SecurityCase.test_tls_required_without_proxy_proto](../tests/test_server_security.py#L864)
- [SecurityCase.test_f4_publishing_staging_window_owner_only](../tests/test_server_security.py#L910)
- [SecurityCase.test_f4_stuck_publishing_keeps_409](../tests/test_server_security.py#L965)
- [SecurityCase.test_f4_publishing_live_window_owner_only](../tests/test_server_security.py#L997)
- [SecurityCase.test_f4_publishing_missing_tree_returns_to_uploading](../tests/test_server_security.py#L1040)
- [SecurityCase.test_r3_token_removal_kills_grants_and_handoffs](../tests/test_server_security.py#L1094)
- [SecurityCase.test_r3_credential_replacement_same_labels_kills_grants](../tests/test_server_security.py#L1114)
- [SecurityCase.test_r3_logout_revokes_server_side_grants](../tests/test_server_security.py#L1133)
- [SecurityCase.test_r2_crlf_filename_rejected_at_init](../tests/test_server_security.py#L1163)
- [SecurityCase.test_r2_unicode_and_special_filenames](../tests/test_server_security.py#L1178)
- [SecurityCase.test_r2_dir_redirect_encoding](../tests/test_server_security.py#L1219)
- [SecurityCase.test_r13_unexpected_live_files_never_served](../tests/test_server_security.py#L1254)
- [SecurityCase.test_r13_symlinked_live_serves_nothing](../tests/test_server_security.py#L1272)
- [SecurityCase.test_r4_rejected_patch_leaves_grants_unchanged](../tests/test_server_security.py#L1291)
- [SecurityCase.test_r14_content_error_and_control_headers](../tests/test_server_security.py#L1314)
- [SecurityCase.test_security_headers_api_and_content](../tests/test_server_security.py#L1378)

### `test_storage_durability.py` — 51 methods

Invariant rows: **C D E F G H I J**. Target: preserve scenario under current protocol;
K-only legacy wire/cursor expectations are replaced explicitly.

- [ReceiptCoalescingSuite.test_coalesce_and_idempotent_reput](../tests/test_storage_durability.py#L38)
- [ReceiptCoalescingSuite.test_gap_ranges_sorted](../tests/test_storage_durability.py#L49)
- [StorageCase.test_bytes_without_row_and_row_without_bytes_reconcile](../tests/test_storage_durability.py#L87)
- [StorageCase.test_publish_window_live_present_commits_ready](../tests/test_storage_durability.py#L110)
- [StorageCase.test_publish_window_neither_tree_returns_to_uploading](../tests/test_storage_durability.py#L123)
- [StorageCase.test_ready_stray_staging_cleaned](../tests/test_storage_durability.py#L133)
- [StorageCase.test_orphan_live_tree_without_row_deleted](../tests/test_storage_durability.py#L149)
- [StorageCase.test_concurrent_init_quota_subset](../tests/test_storage_durability.py#L160)
- [StorageCase.test_sweep_expired_idle_orphans_grants](../tests/test_storage_durability.py#L182)
- [StorageCase.test_r1_failed_receipt_commit_retry_safe](../tests/test_storage_durability.py#L194)
- [StorageCase.test_r10_interrupted_publish_empty_root](../tests/test_storage_durability.py#L225)
- [StorageCase.test_r8_sweep_vs_publish_invariants](../tests/test_storage_durability.py#L243)
- [StorageCase.test_r8_init_vs_delete_leaves_no_debris](../tests/test_storage_durability.py#L278)
- [StorageCase.test_r8_quota_failure_leaves_no_storage](../tests/test_storage_durability.py#L345)
- [StorageCase.test_r4_unlock_rotate_race_never_honors_old_password](../tests/test_storage_durability.py#L356)
- [StorageCase.test_r9_second_claim_fails_first_unaffected](../tests/test_storage_durability.py#L400)
- [StorageCase.test_r9_claim_handoff_after_close](../tests/test_storage_durability.py#L424)
- [StorageCase.test_r11_publish_faults_recover_without_restart](../tests/test_storage_durability.py#L434)
- [StorageCase.test_r11_lost_p5_retry_completes](../tests/test_storage_durability.py#L468)
- [StorageCase.test_r11_lost_p5_restart_recovers](../tests/test_storage_durability.py#L493)
- [StorageCase.test_r11_recovery_fsync_fault_keeps_publishing](../tests/test_storage_durability.py#L511)
- [StorageCase.test_r11_live_path_fsync_commit_order](../tests/test_storage_durability.py#L599)
- [StorageCase.test_r11_recovery_path_fsync_commit_order](../tests/test_storage_durability.py#L622)
- [StorageCase.test_r11_recovery_data_dir_fault_keeps_publishing_unserved](../tests/test_storage_durability.py#L647)
- [StorageCase.test_r11_recovery_ready_commit_fault_keeps_publishing_unserved](../tests/test_storage_durability.py#L674)
- [StorageCase.test_r11_missing_trees_rebuild_resumable](../tests/test_storage_durability.py#L697)
- [StorageCase.test_r13_symlink_staging_blocked_and_never_served](../tests/test_storage_durability.py#L720)
- [StorageCase.test_r11_chunk_write_fault_maps_and_retries](../tests/test_storage_durability.py#L756)
- [StorageCase.test_r13_symlinked_parent_restart_touches_nothing_external](../tests/test_storage_durability.py#L789)
- [StorageCase.test_r13_symlinked_staging_root_restart](../tests/test_storage_durability.py#L816)
- [StorageCase.test_r9_simultaneous_start_single_winner](../tests/test_storage_durability.py#L839)
- [StorageCase.test_r9_sigkill_releases_claim](../tests/test_storage_durability.py#L881)
- [StorageCase.test_r9_failed_sqlite_startup_releases_claim](../tests/test_storage_durability.py#L936)
- [StorageCase.test_r7_stuck_lock_close_raises_and_retains_ownership](../tests/test_storage_durability.py#L952)
- [StorageCase.test_r7_closed_store_rejects_use](../tests/test_storage_durability.py#L989)
- [StorageCase.test_r11_empty_root_loss_restart_recovers](../tests/test_storage_durability.py#L998)
- [StorageCase.test_r11_reconcile_uploading_live_fsync_commit_order](../tests/test_storage_durability.py#L1021)
- [StorageCase.test_r11_sigkill_chunk_receipt_resumes_truthfully](../tests/test_storage_durability.py#L1115)
- [StorageCase.test_r11_sigkill_publish_lost_p5_recovers_ready](../tests/test_storage_durability.py#L1190)
- [StorageCase.test_r13_top_level_roots_symlinked_reconcile_sweep_safe](../tests/test_storage_durability.py#L1251)
- [StorageCase.test_r13_top_level_staging_symlinked_init_fails_closed](../tests/test_storage_durability.py#L1292)
- [StorageCase.test_r9_alias_paths_contend_for_one_claim](../tests/test_storage_durability.py#L1307)
- [StorageCase.test_r9_parent_alias_retarget_keeps_physical_binding](../tests/test_storage_durability.py#L1358)
- [StorageCase.test_r9_root_replacement_fails_closed_before_touching](../tests/test_storage_durability.py#L1470)
- [StorageCase.test_r9_startup_replacement_with_active_db_fails_closed](../tests/test_storage_durability.py#L1599)
- [StorageCase.test_r9_failed_startup_closes_before_releasing](../tests/test_storage_durability.py#L1680)
- [StorageCase.test_r9_post_close_admission_no_touch](../tests/test_storage_durability.py#L1754)
- [StorageCase.test_r9_reconcile_cleanup_holds_ownership](../tests/test_storage_durability.py#L1822)
- [StorageCase.test_r9_close_failure_retains_handle_and_claim](../tests/test_storage_durability.py#L1901)
- [StorageCase.test_topology_validation_matrix](../tests/test_storage_durability.py#L1943)
- [StorageCase.test_a1_pagination_sql_bounded_limit_plus_one](../tests/test_storage_durability.py#L1956)

Total: **27 files, 353 discovered methods**. Baseline inventory generated
from Python AST, not imported test modules; dependency-skipped and failure cases
remain represented. Runtime counts/parameterizations must be recorded separately.

## Required replacement evidence not supplied by this register

Full historical domain/security/browser/client scenarios adapted to Scala service;
codec goldens in Scala/TS/Python; Unicode/NUL/epoch conversion fixtures; real PG
quota and receipt/publish/sweep races; all publish/receipt SIGKILL windows; JVM and
native no-follow/claim/range/TLS/cookie acceptance; matched snapshot importer
resumability/grants/expiry and rollback-boundary rehearsals; metadata retrieval
ACL/profile/provider/outage tests; official MCP SDK + Chromium complete suites.
No production switch, credential rotation, source-data deletion or legacy test
retirement is authorized by generation or a subset passing.

## Current-target migration status (2026-11-03)

Original 353 discovered Python methods remain; no server/storage tests were
removed. The tree now has 30 `test_*.py` files / 371 discovered methods, adding
8 current-codec + 6 current-client + 4 target-harness safety methods. Node browser
boundary has 7 cases; network capture has 9 (including new command-only logging).
The original inventory above remains baseline provenance, not a claim that old
REST callbacks are supported by the new client.

* `browser_fixtures.py` now owns an actual target subprocess and a unique opted-in
  disposable PostgreSQL database, seeds only through typed current commands/raw
  chunks, and has no Python server/storage imports. Browser Python probes and
  access-modes/dashboard-UX helpers use current DTOs; private clocks are replaced
  by real minimum-60-second TTL expiry probes. Original browser scenario methods,
  negative controls, race interactions, bytes/hash checks and deadlines remain.
* `test_client_realserver.py` (14 methods) now starts the target executable;
  it no longer mutates a private SQLite connection for expiry. Public API
  60-second expiry preserves expired-but-unswept pagination assertions.
* `test_cli_process.py` (3 methods) now uses the target executable and genuine
  child CLI SIGKILL/resume. Audit/delay is client-transport-only, **after** actual
  receipt ACK; no fake backend ACK can satisfy the assertions. Interrupted fetch
  still proves exact resumed Range and byte identity.
* Browser cross-origin JSON commands now require preflight. The two hostile
  browser tests explicitly assert blocked current-API preflight, never call this
  a dispatched-cookie 403 proof. Retained URLencoded Login/Logout form adapters
  still prove actual cookie dispatch + wrong-Origin 403 (including planted
  None/Secure over TLS). Targeted authenticated CreateGrant/Delete 403 and exact
  victim byte/session preservation remain direct current-API HTTP complements.
  This is the intentional current transport change, not a SameSite/preflight
  shortcut claimed as proof of an authenticated mutation guard.
* Additional insecure-HTTP regression: the dashboard uses CSPRNG getRandomValues
  to build canonical v4 UUIDs; randomUUID is secure-context-only. The dedicated
  check removes randomUUID and still exercises request-ID generation.

Fresh static/component checks: Python current protocol/client/harness safety,
markup and asset hygiene: **31 methods, 0 failures/errors/skips**; Node current
boundary/network capture: **16 cases, 0 failures/skips**. All Python test sources
compile; all browser `.mjs` sources parse. These do not execute PostgreSQL,
Chromium, the replacement executable, native code or official MCP SDK.

**Not yet executed:** all actual-target/browser/CLI-process scenarios above.
The deliberate realserver smoke prerequisite probe fails (not skips) because
`MANURE_TEST_SERVER_COMMAND_JSON` is absent in this worktree environment. The
owned provider/JNI environment has not been started here. No full service or
migration acceptance is claimed.

**Still requires adaptation:** historical `test_client_transport.py`,
`test_client_external.py`, `test_client_stateful.py`, fake-REST portions of
`test_client_hardening.py`, CLI/MCP fake-transport helpers and the original
server/storage suites must be rehosted against the current typed fixture or
replacement adapter as appropriate. The exploratory historical hardening run
recorded 8 failures and 18 error reports/49 methods, all retained for migration;
those old callbacks are not a compatibility target and are not excluded from
release acceptance. Realserver/browser adapters need actual runner execution
and any resulting defects fixed before acceptance. Nothing here retires the
Python source tests or authorizes a production switch.
