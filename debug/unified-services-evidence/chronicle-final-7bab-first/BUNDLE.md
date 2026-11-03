# First complete post-adoption Chronicle acceptance attempt

Frozen source: `7bab3c1a5d20e518b8f500a32b46628ee98fbfc6`. Native ELF SHA-256: `04dd2eaeb172c3f426b209b96901abad2ddf353644493c19c94bf5e69b3cdde1`.

All 16 planned stages executed; **14 passed, two failed**. The aggregate command exited1 and is not accepted as a complete pass. Both native and JVM workflow failures occurred at configuration decoding before server startup. A subsequent separately retained decoder probe identified missing `annotation.requestPolicy`; the correction/follow-up is separate evidence, never a rewrite of these results.

Passing stages include full web147 and collector125 Node cases, both typechecks, frontend build, protocol16 TypeScript groups plus17 Scala cases/3suites, all20 real browser entrypoints (311 reported assertion signals), relevance172 Python plus29 Node cases, actual native recovery and JVM assembly. These are distinct scopes; relevance harness tests do not establish real-model quality, and a browser-stage pass is not a blanket native-browser claim. Full960-case/112-suite PostgreSQL acceptance is retained separately, not rerun or double-counted here.

The parent copied and SHA-verified212 exact original artifacts, identified by `bundle-manifest.json`. Generated XML/log bytes, including whitespace, remain unchanged. Dependency caches, generated credentials, full temporary PostgreSQL directories and binaries are excluded. The source/provenance manifests and runner/observer are included. Historical absolute paths are evidence of the original invocation, not a portable launcher promise.

No deployment, production data, real credentials or live model service was used. Cleanup remained restricted to the runner's owned temporary/session fixtures.
