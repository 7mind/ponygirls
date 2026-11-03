# Haystack — decisions log

This file records user-approved implementation decisions and deviations.

1. **In-repo placement.** The service lives in this repo under `haystack/`
   (approved 2026-10-07), not in a separate flake/repo. The dependency
   direction is preserved in adapted form: server code and packaging under
   `haystack/` + thin `nix/{pkg,nixos,hm}` shims wired into the root flake.
   There is no service-flake input anywhere; the server runtime closure must
   not contain harness packages; the client HM module stays `nix/hm/haystack.nix`.
2. **Name: haystack** (user-christened 2026-10-07).
   Module `smind.services.haystack`, cookie `__Host-haystack`,
   env `HAYSTACK_TOKEN`, MCP entry `haystack`.
3. **No launch preflight** (approved 2026-10-07). The originally planned bounded bearer
   `whoami` gate before harness launch is dropped: launches proceed with
   configured URL/token-file and failures surface at MCP call time.
   Accepted residual risks: late detection of wrong identity / namespace
   skew / dead server. Retained: exact-byte token reader, no fallback
   credentials, server `whoami` for diagnosis, "memory may be absent" agent
   context. Step 8/9 gates verify start-without-server and call-time failure
   surfacing instead of preflight behavior.
4. **Lossless JSON (option i).** All JSON paths preserve large integers,
   decimals, Unicode, and null with no silent rounding (approved 2026-10-07).
   Mechanism: a shared domain codec uses `lossless-json@4.3.1` validation
   and serialization. Native JSON source-context revival materializes exact
   `LosslessNumber` values while preserving prototype-named object keys.
   Arbitrary JSON crosses MCP/HTTP/PG as raw text. The prototype-key
   preservation regression was reproduced and corrected on 2026-10-08.
5. **Stack (superseded2026-11-03 by approved unified-services port).** Independent Scala3.9/distage/cats-effect/http4s/JDBC native service + Baboon0.0.198 one current1.0.0 API; React remains owned client. Official Node MCP SDK is a test client, not a production server/proxy. Frozen TS domain sources are admission-characterization tooling only.
6. **MCP protocol pin.** SDK `1.32.1`, protocol `2025-11-25`, stateless
   (no session id, no GET stream). The 2026-07-28 revision is not in this
   SDK and is not implemented (spike-proven, S1).
7. **Model-backed trials.** Allowed: Pi on glm/kimi/xiaomi/muse within
   existing allowances; Claude/Codex on sonnet / sol 6.1 at low effort
   (approved 2026-10-07). Live GitHub artifacts are never test data.
8. **Tags (2026-10-08).** Documents carry an optional `tags` string array
   (≤64 entries of ≤128 chars, no NUL, no leading/trailing whitespace;
   absent ≡ `[]`) with exact case-sensitive `tag:`/`tags:` search, text
   indexing (each tag its own segment), completion + current generated `POST /api/v1/values`,
   and a GIN index on `COALESCE(document->'tags','[]')` (migration
   `0003-tags`). Summaries carry `tags`. Backwards compatible: old rows
   without `tags` read as `[]` and match `NOT tag:x`.

9. **Current contract/cutover (2026-11-03).** No old wire API/codecs/cursors
   or JavaScript digest parity required. Preserve acknowledged data/history,
   static credentials/authorization and uncertain-write reconciliation. One
   explicit new replay digest; retain old rows and refuse cross-format identity.
   See [API](api.md), [config](../server/README.md), [assertion register](port-contract-inventory.md).
10. **Retrieval approval.** Exact Boolean metadata browsing remains provider-free.
    Content retrieval explicitly selects lexical/semantic/hybrid; operator-approved
    metadata/string pointers only. Shared transactional projection/outbox and lease
    worker, strict published profile/policy/space; no hidden model fallback.
