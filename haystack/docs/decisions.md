# Haystack — decisions log (normative deviations from the plan)

Plan: `docs/drafts/20261007-1828-agent-memory-implementation-plan.md`.
This file records user-approved deviations. Everything not listed here
follows the plan as written.

1. **In-repo placement.** The service lives in this repo under `haystack/`
   (approved 2026-10-07), not in a separate flake/repo. The dependency
   direction is preserved in adapted form: server code and packaging under
   `haystack/` + thin `nix/{pkg,nixos,hm}` shims wired into the root flake.
   There is no service-flake input anywhere; the server runtime closure must
   not contain harness packages; the client HM module stays `nix/hm/haystack.nix`.
2. **Name: haystack** (user-christened 2026-10-07).
   Module `smind.services.haystack`, cookie `__Host-haystack`,
   env `HAYSTACK_TOKEN`, MCP entry `haystack`.
3. **No launch preflight** (approved 2026-10-07). Plan §7.7's bounded bearer
   `whoami` gate before harness launch is dropped: launches proceed with
   configured URL/token-file and failures surface at MCP call time.
   Accepted residual risks: late detection of wrong identity / namespace
   skew / dead server. Retained: exact-byte token reader, no fallback
   credentials, server `whoami` for diagnosis, "memory may be absent" agent
   context. Step 8/9 gates verify start-without-server and call-time failure
   surfacing instead of preflight behavior.
4. **Lossless JSON (option i).** All JSON paths preserve large integers,
   decimals, Unicode, and null with no silent rounding (approved 2026-10-07).
   Mechanism (spike-proven, S2): `lossless-json@4.3.1` as the single JSON
   codec; arbitrary JSON crosses MCP/HTTP/PG as raw text, parsed exactly
   once at the application layer.
5. **Stack.** TypeScript + official MCP SDK + React on current Node LTS
   (approved 2026-10-07).
6. **MCP protocol pin.** SDK `1.32.1`, protocol `2025-11-25`, stateless
   (no session id, no GET stream). The 2026-07-28 revision is not in this
   SDK and is not implemented (spike-proven, S1).
7. **Model-backed trials.** Allowed: Pi on glm/kimi/xiaomi/muse within
   existing allowances; Claude/Codex on sonnet / sol 6.1 at low effort
   (approved 2026-10-07). Live GitHub artifacts are never test data.
