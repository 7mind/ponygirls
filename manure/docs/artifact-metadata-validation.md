# Artifact metadata and compact catalogue validation

Base: `13ea8585`. Final tested application/test source:
`236b7a580191f72d1ac33f55e86f0e4bc63fe310`.

## Behavior

- Explicit upload tags, hostname and project path; no automatic host/cwd collection.
- Exact conjunctive metadata filters in catalogue and all retrieval modes; repeated
  `tag:` requires every tag. Catalogue text includes folded literal metadata;
  retrieval retains PostgreSQL lexical semantics and typed field evidence.
- Migration5 preserves existing artifacts with empty/absent metadata, frozen
  prior migrations and restricted imported-database runtime ownership.
- Compact catalogue rows and accessible inline copy-link buttons. Clipboard denial
  or absence offers selected, read-only URL text. Copy never issues a grant,
  opens content or copies a password. Expired/incomplete/unavailable links stay disabled.

```bash
manure upload ./report.md --access internal --tag release --tag report \
  --hostname build-host --project-path /work/example
```

Example search: `tag:release tag:report hostname:build-host project:/work/example`.
Retrieval additionally requires search text and an explicit retrieval mode.

## Final executions

All counts below have zero failures, errors and skips. Fresh inventory/XML or
explicit Node inventory checks matched. Inputs were hash-checked after integration.

| Check | Suites | Cases/vectors |
|---|---:|---:|
| Manure backend, owned PostgreSQL and real filesystem | 16 | 197 |
| POSIX storage JVM | 2 | 33 |
| Full JVM target, browser, CLI, official MCP SDK and imports | complete registered inventory | 370 |
| Node protocol/query/upload/capture checks | 4 | 35 |
| Generated TypeScript codec fixtures | — | 76 vectors |
| Shared retrieval core | 1 | 6 |
| Shared retrieval PostgreSQL | 5 | 31 |
| Haystack full backend | 31 | 705 |
| Chronicle full backend | 114 | 972 |

Primary commands, from the repository root in the pinned shell:

```bash
nix develop .#chronicle --command bash manure/scripts/test-backend.sh
nix develop .#chronicle --command bash manure/scripts/run-owned-target.sh \
  /absolute/owned-provider.json /absolute/with-owned-postgres.py \
  /absolute/provision-owned-database.py jvm full
nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh
```

The target command used an explicit tools descriptor, owned least-privilege
PostgreSQL provisioning, pinned Chromium/Playwright and the current locked official
MCP SDK1.32.2. Viewer assets were supplied explicitly from the unchanged built
viewer tree. The shared/Haystack run used an isolated owned PostgreSQL fixture
and `haystack/scripts/test-postgres-scala.sh` with the full shared and Haystack tasks.
Generation was repeated using pinned Baboon0.0.200 and the locked TypeScript
compiler; generated-file hashes were unchanged and all76 fixtures passed.

JVM JAR SHA256:
`1a18acc111b1a1332b24546fc83f0b70bf6e37e995a3530221eaa11190a76922`.
Local receipts: `debug/20261111-manure-metadata/` in the original checkout;
not published. Final target receipt: `target-final/`; backend:
`backend-final-integrated/`; impacted services: `backend-filter-shared-receipt/`
and `backend-filter-chronicle-receipt/`.

## Fail-first and superseded runs

Preserved failed reproductions covered expression-budget insufficiency, legal
metadata pages exceeding the old transport cap, unsupported37-filter conjunctions,
missing imported-table runtime privileges, stale browser DTO constructors and
exact wire/sort expectations. Fixes retain finite expression/text/transport/filter
bounds, complete assertions and least-privilege negative controls. Controlled
embedding test labels were separated to preserve the original name/path evidence
witnesses without changing application ranking.

An initial target preflight ran zero cases because a historical tools descriptor
referenced an absent SDK path; the rerun used the current checkout's locked SDK.
A subsequent full run failed with stale fixtures/expectations, an incorrect
lexical substring assumption and the ownership omission; its reports remain
preserved. An interrupted Chronicle run and a shared-fixture socket-path setup
failure were not counted as passes; fresh complete retries supplied the table above.

This is JVM/application/browser evidence, not native-ELF parity, NixOS/Home Manager
acceptance, live-provider relevance quality, production migration or deployment.
The sole-current API requires coordinated server/owned-client upgrades.
