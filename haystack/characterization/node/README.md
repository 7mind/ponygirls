# Frozen pre-port admission characterization (not a server)

These are byte-identical baseline TypeScript domain/ItemService/memory sources,
kept ONLY to reproduce acknowledged historical JSON admission fixtures. They
have no HTTP listener, MCP transport, PostgreSQL adapter or executable entrypoint.
There is no production fallback. Scala owns the current service and API.

`npm run build:characterization -w server` compiles this source only for
`node scripts/generate-historical-fixtures.mjs`, from `haystack/` in the pinned
shell. Fixture manifests retain the **original baseline source path labels**;
those source SHA256 values remain unchanged after relocation. The generator
maps those labels to these frozen files. `evidence/mcp-adapter.ts.txt` is inert
source evidence of the old MCP raw-string UTF16 cap, not executable code.

The superseded import-dependent Node backend tests and entrypoint are retired;
assertion coverage is in `server/src/test/scala`, `server/tests-current`, and the
owned browser suites. See `docs/port-contract-inventory.md` for the map. Never
change these frozen sources to make a historical fixture agree with new policy.
