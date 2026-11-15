# Shared accounts and Haystack workspace validation

## Delivered behavior

- Shared password, opaque browser-session and token-lifecycle mechanisms for
  Haystack/Manure; shared password/cookie/account representations with Chronicle's
  existing scoped-token and authorization owners retained.
- Common `/api/account/v1` boundary and framework-independent account UI in all
  three applications: password login, native settings dialog, issue/revoke owned
  runtime tokens, visible immutable configured tokens, one-time secret recovery.
- Browser sessions have no server-side idle or absolute expiry. Persistent
  HttpOnly cookies are refreshed on use; browser-imposed retention/eviction remains
  outside server control. Explicit logout/revocation/account-security changes are
  still enforced. Legacy bearer-as-cookie login is rejected in Haystack/Manure.
- User-sensitive mutations bind the intended owner inside their existing
  transaction. Reconciliation and multi-owner session replacement use coherent
  fences/lock ordering. Asynchronous inputs and queued replies retain current
  authority checks. Application-specific scopes and resource access remain local.
- Haystack uses a sidebar-free header/workspace toolbar and responsive records
  table while preserving navigation, expressions, live updates, editing/history,
  attention workflows and uncertain-write recovery.

## Verification

All counts below are successful source-bound runs, not an assertion that one layer
substitutes for another. Earlier failed reproductions and interrupted runs remain
archived separately; no stale XML or skipped cases were used to construct a pass.

| Layer | Result |
|---|---|
| Shared auth memory + real PostgreSQL | 32 cases, 4 suites, no failures/errors/skips |
| Haystack real PostgreSQL/JVM backend | 715 cases, 34 suites, no failures/errors/skips |
| Haystack production JVM process contracts | 42 cases, exact inventory, no failures/errors/skips |
| Haystack static-musl native process contracts | 42 cases, 4 suites, no failures/errors/skips |
| Haystack canonical combined browser/HTTPS | 81 JUnit leaf cases (82 Node), 58 browser cases, 1 markup case; exact inventories, all three stages exit0, no failures/errors/skips |
| Manure current-main integrated JVM backend | 237 cases, 19 suites, no failures/errors/skips |
| Manure storage/JNI | 33 cases, 2 suites, no failures/errors/skips |
| Manure complete native target | 375 Python cases, exact inventory, no failures/errors/skips; 35 additional Node cases plus TypeScript goldens passed |
| Manure actual JVM/owned-PG/Chromium browser corpus | 103 cases passed; final shared-client source bound separately from later main integration/native acceptance |
| Manure real controlled-provider retrieval browser | Controlled provider/outage/no-provider scenario passed |
| Chronicle full unfiltered real PostgreSQL backend | 999 cases, 116 suites, no failures/errors/skips |
| Chronicle actual native account/static smoke | 25 checks passed; owned non-superuser PG, no external model requests |
| Chronicle dashboard | Typecheck, 147 Node cases, build and complete unfiltered browser command passed |
| Chronicle protocol/collector/relevance | Required codec/version, collector typecheck/test and relevance Python commands passed |
| Shared account browser controller | 22 controlled Chromium cases passed |
| Declarative service account contract | 42 contract cases; 22 filesystem provisioner cases; existing module/proxy checks passed |
| Paddock migration/deployment tooling | 274 Python cases; source-bound Nix checks and private offline replay verified |

The final Haystack canonical combined receipt is archived under
`haystack-final-jvm-combined-20261115T021957Z/report/receipt.json`. It includes actual
HTTPS proxy backend-stop/API503 behavior, restart/session/logout, full preview
restart and source/artifact/actual-package-root byte equality before and after.

## Commands and evidence

Representative complete commands, run with pinned tools:

```bash
nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh
nix develop .#chronicle --command bash haystack/scripts/test-postgres-scala.sh haystackServer/assembly
nix develop .#chronicle --command bash manure/scripts/test-backend.sh
nix develop .#chronicle --command bash -c 'cd chronicle/web && npm run typecheck && npm test && npm run build && npm run test:browser'
nix build --no-link .#checks.x86_64-linux.manure-native
```

Haystack's executable and browser runners use explicit actual artifact paths/kinds,
owned PostgreSQL, pinned Chromium, fresh inventories and the evaluated NixOS proxy
JSON with its real packaged asset root. No local-dist/canned policy replacement was
used. The pinned nginx metadata-collision hypothesis was rejected by actual
same-size/mtime Nix-package testing; only direct http4s stable-entry freshness
required correction. Hashed-asset caching remains covered.

The native Manure guard was aligned with the unchanged locked Graal CE 25.4.4.1.1
and existing hosted feature/probe; exact version checking was retained. Current
main independently supplied the same correction and physical-root ownership work;
both features and their tests were preserved and the merged backend/modules rerun.

Complete receipts, source/artifact hashes, inventories and retained failure logs:
`/home/pavel/work/flakes/debug/20261115-auth-settings-validation`.
Native Manure receipt:
`/nix/store/1ixdcqiy76lvcsav0323ncg58d7zlzir-manure-native-full-target/receipt.json`.

## Credential preparation and delivery boundary

The reviewed human accounts are declarative. Existing machine/API credential
bytes and IDs were preserved, including historical attribution and API-only
`operator` identities. The actual runtime-values/Secret pair is private; hashes
verify across all three services and identical offline replay does not rehash or
rewrite output. Encrypted hash sources are retained in Paddock; plaintext and
complete credential payloads are not committed.

Nothing was pushed or deployed. Paddock's Ponygirls input pin was not changed to an
unpublished revision. A later authorized rollout must first use compatible packages
and revalidate the prepared source-bound configuration. Native/JVM/local-browser
acceptance is not production, TLS-ingress, model-provider or deployment acceptance.
