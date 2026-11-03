# Unified services — active goal ledger

Goal `703a26f8-76a4-4af7-9b6e-624a0abb2f83`: user requested “set yourself a goal and continue until all 3 services are unified and ported”. Goal active; do not finish at another foundation-only milestone.

Task base `e9fda183db02898aa4b2110e47febb816b2e9ffe` (2026-11-03 UTC). Main checkout clean at start. Preserve concurrent epistemics documentation. Source plan: [unified service stack](20261102-1915-unified-service-stack.md). Previous foundation/POSIX work is complete and tested; its receipts are historical exact-input evidence, not full-port acceptance.

## Operational completion criteria

Three independent Scala/distage/cats-effect/http4s/JDBC/Baboon services; one current API per domain and updated owned clients; shared runtime/model/retrieval implementations with both Chronicle search paths preserved; Haystack lossless/history/replay/auth/WS/query invariants; Manure PostgreSQL metadata plus durable filesystem upload/publish/grant/recovery and restart-safe offline conversion; one per-host PostgreSQL provider with three isolated roles/databases and updated Nix/downstream consumers; full JVM, native, client, browser, migration/recovery and retrieval validation. No legacy Node/Python server proxy counts as a port. No placeholders or untested critical paths count as completion.

Live activation, production data migration, credential rotation and old-state deletion remain separately gated. Q10 is pending and concerns activation; this goal is not its answer. Work on disposable fixtures and migration tooling/rehearsals proceeds. Do not mark the goal complete if required implementation/validation remains.

## Ownership/worktrees

All under main checkout `/home/pavel/work/flakes/ponygirls/.worktrees/`:

| Branch/worktree suffix | Owner | Files |
|---|---|---|
| unified-services | parent | integration, execution ledger, reviews, downstream integration |
| unified-runtime | runtime/build worker | `build.sbt`, `project/`, dependency lock/config, `shared/service-runtime`, `shared/baboon-runtime`, common contract/runtime generation helpers |
| haystack-port | Haystack worker | `haystack/**` (new Scala server, models/generated, owned web/client changes, tests/docs) |
| manure-port | Manure worker | `manure/**` (new backend, models/generated, FS seam extensions, client/MCP/web/tests, offline importer) |
| retrieval-shared | retrieval worker | `shared/{retrieval-core,retrieval-postgres,model-http}/**`, Chronicle embedding/search/publication source/tests required by extraction |
| unified-nix | Nix worker | `nix/**`, `flake.nix`, shared service/native/PG validation scripts not owned by service workers |

Writers use explicit absolute precreated worktrees (`isolation:none` harness routing limitation), never default/main cwd. Any delegated concurrent writer needs another dedicated worktree under main `.worktrees/`, not the same tree. Read-only reviewers can share. Component commits must be integrated and final result tested before main fast-forward; clean worktrees removed after evidence preservation.

## Cross-worker contract

- Pinned versions stay: Scala 3.9.0, generated Scala 2.13.18, distage1.2.25, http4s0.23.38, cats-effect3.7.1, JDBC42.7.14, Baboon0.0.198 and current Nix input pins. No BIO/ZIO conversion. No new dependencies unless required and graph-compatible.
- User explicitly overrides the Baboon skill's generic historical-version guidance: ONLY current contract, no retained APIs/codecs/cursor chains or JS digest parity requirement. Preserve stored data/credentials/acknowledged writes, not old wire shapes.
- New projects: `serviceRuntime` (`shared/service-runtime`, namespace `ponygirls.runtime`), `modelHttp` (`shared/model-http`), `retrievalCore` (`shared/retrieval-core`), `retrievalPostgres` (`shared/retrieval-postgres`); shared retrieval namespace `ponygirls.retrieval`. `haystackServer` base `haystack/server`; `manureServer` base `manure/backend`, depending on existing `manureStorage` base `manure/server`. This keeps tested filesystem primitives independently buildable. Contracts: `haystackContracts` / `manureContracts` at each service's generated/.build, Scala2.13; existing Chronicle `contracts` remains current.
- Runtime/build owner must first prove one compiled Baboon runtime, not MergeStrategy.first over divergent runtime definitions. Prefer pinned generator support; otherwise verified identical root runtime sources compiled once and excluded from each domain. Publish actual API/config sketch early to parent/service workers; do not guess each other's signatures.
- Provisional shared JDBC seam: typed config with explicit JDBC URL/user/runtime password-file and finite connection/admission/statement/lock/idle-transaction bounds; IO blocking transaction callback `Connection => A`, atomic caller-owned projection transactions, lifecycle-scoped ownership. Runtime worker defines exact names and communicates them before consumers depend on them.
- Service writers own their current `.baboon` schemas and generation scripts; build/runtime owner coordinates common runtime equivalence. Raw upload/download stays streaming; MCP retains required JSON-RPC protocol. Arbitrary Haystack JSON must use validated lossless payloads, not lossy f64/catch-all DTOs. No production model calls in ordinary writes/catalogue/serving.
- Existing POSIX library is proven x86_64-linux static-musl and JVM, with explicit procfs/network-namespace/root UTF8/lifecycle assumptions. Manure may extend the root-scoped seam for metadata/worker lifetime without weakening those contracts. No fallback to old Python storage/JVM path checks.
- Retrieval preserves both Chronicle contracts; extraction must not change annotation/prompt/content policy, ACL-before-limit, old-generation publication, profile identity or candidate-window count semantics. Shared SQL adapters are trusted/bound, never user SQL fragments. New service embeddings index only approved metadata/string leaves, never credentials/passwords/binary contents.
- Every package/validation receipt states exact scope and source/artifact binding. New relevant changes invalidate old evidence. Full Chronicle validation per AGENTS.md after affected changes; full required real adapters cannot skip. No summary-only/empty inventory acceptance.

## Milestones

1. [in progress] Runtime/build/Baboon multi-domain layout and current service contract inventories.
2. [in progress] Haystack complete backend/current clients and behavior characterization.
3. [in progress] Manure complete PG/filesystem service/current clients/import/recovery.
4. [in progress] Shared retrieval/model implementations and unchanged Chronicle adapters.
5. [in progress] Shared PG/Nix packages/modules/provisioning and tests.
6. [pending] Integrate actual shared seams, hybrid adapters and downstream Paddock/Nix-config consumers.
7. [pending] Full application/native/browser/migration/recovery/security/retrieval validation, address failures without weakening assertions.
8. [pending] Independent reviews, source/evidence audit, safe main integration and worktree cleanup; only then complete goal.

## Current observations

Codegraph still refuses daemon PID-namespace ownership, so direct source inspection is used. No ledger MCP discovered; this committed file is the progress ledger. No live deployment or production-data observation is claimed. Available processors observed128; deliberate compiler/test parallelism remains memory-bounded and per-module DB tests serial where needed.
