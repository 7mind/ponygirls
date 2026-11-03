# Unified services: acceptance status

Production-code pin: `be4cb86972c820ea2ae0e2c6f886057f0604c2ec`.

**Not deployed or integrated into the original main checkout.** The final NixOS9 revalidation passed; Git-history integration requires Q11. This document records verified evidence, not activation permission.

## Implemented boundary

Chronicle, Haystack and Manure remain independent processes, databases, credentials and authorization domains. They share the Scala/distage/cats-effect/http4s/JDBC infrastructure, canonical Baboon runtime and bounded retrieval components. No cross-service authority or legacy serving adapter is introduced.

NixOS uses one stock PostgreSQL provider; Home Manager uses one user provider. Database readiness/migrations remain separate per application. Ordinary private credential files and explicitly validated systemd-loaded credentials have different trust paths. Interrupted migrations are not successful serve termination.

Pinned dependencies were retained. User-authored downstream lock changes were preserved; this task did not select new pins.

## Application evidence

Evidence paths below are relative to `debug/unified-services-evidence/`. Counts belong to their named inventories; unlike inventories are not summed into a synthetic total.

| Service | Verified scope | Evidence |
|---|---|---|
| Chronicle |960 PostgreSQL cases/112 suites, zero failures/errors/skips; web147; native and JVM final workflows each1/1, including restart/recovery/backup behavior |`chronicle-full-7bab3c1a/`, `chronicle-workflows-final/` |
| Haystack |705 PostgreSQL cases/31 suites; native and JVM transport34; complete browser61 atomic checks/36 journeys/1 markup check; additional native wide-pointer4 |`haystack-pointer-domain-d7bbc273/`, `haystack-native-final-63e83da0/`, `haystack-current-final-d7/` |
| Manure | JVM and native each335 Python cases/33 modules, plus17 Node and74 TypeScript cases; installed clients8; additional native wide-manager12 |`manure-final-62d5f987/`, `manure-installed-clients-f74080ef/`, `manure-native-wide-62d5f987/` |
| Manure deployment fixture | Actual full contained native VM passed. Unchanged stop/restart/resume, exact bytes/SHA/cache checks and final four-image attachment/backing checks completed |`manure-original-full-6587-success/` |

The Manure VM has138 linear top-level driver calls, **not138 test cases**. Its successful runtime deleted XML before inspection; no XML count is claimed. Its observed successful stop classification is not an explicitly logged numeric143 in that successful serial.

Final native artifact SHA256:

- Chronicle: `04dd2eaeb172c3f426b209b96901abad2ddf353644493c19c94bf5e69b3cdde1`.
- Haystack: `d001828b20d7dd3efaef5d822a1ceeae843e1c46aec9b16699aa9242b7bd553f`.
- Manure: `9318c06043c06b95e7cc4ceafbc6c9b3f22bd685dd43bb01896497d175f7a835`.

Later stop-policy changes did not change application/native inputs. Source-bound earlier application execution is retained as earlier execution, not relabeled as a fresh run at the final metadata pin.

## Shared infrastructure and deployment lifecycle

- Shared runtime:9 suites/34 cases. Shared retrieval:8 suites/55 cases, including PostgreSQL/HTTP boundaries. Lossless JSON36 and current filesystem29 cases have separate inventories.
- Foundation/provider batch: eight source-bound realizations, with exact inventories and credential/provider/harness scopes in `foundation-provider-b092de10/`. Trusted Nix realization reuse is not described as every derivation having executed afresh.
- Actual current Home Manager lifecycle: all7 mandatory cells/four phases/faults passed at source658; `hm-postgres-lifecycle-65879bdd/`. The later Chronicle NixOS-only change leaves HM behavioral inputs unchanged; its receipt remains source658.
- Final actual NixOS lifecycle: all9 original cells/four phases/faults passed at final sourcebe4, zero errors/omissions/invalid fixtures. Parent verified the full receipt against the original inventory and immutable test-script names; `nixos-postgres-lifecycle-be4cb869/`, receipt SHA256 `6a422fdf8766a20753826f4c83456fc5d30f524062c20e250bf00f510cc7075a`. Runtime job `bgt-43dfb39d43b27b8f` ended0 with separate visible-namespace cleanup proof; this is actual guest execution, not driver-build inference.
- Complete applicable x86_64 no-build checks passed for all three repositories using immutable local overrides: Ponygirlsbe4, nix-config01b11, Paddock91bd. See `final-no-build-be4cb869/`. aarch64-linux/Darwin were omitted; no runtime/build claim for those architectures.

## Shutdown contracts

Haystack's resource-scoped TERM/INT handler has an explicitly tested normal0 contract. Manure and Chronicle use the verified normal143 serve termination contract. Only the relevant long-running units recognize143; migrations/fatal1/137/SIGKILL are not admitted as successful termination.

Chronicle's native143 was observed after an attested owned ready child received pidfd SIGTERM. The pinned systemd classifier rejected it under the original empty success set; the expected red1 is preserved in `chronicle-native-shutdown-red-65879bdd/`. The narrow NixOS serve correction and34 module assertions/22 controlled cases are recorded separately in `chronicle-serve-status-be4cb869/`.

Normal exit143, signal termination15, manager clean-exit classification and actual resource/drain completion are distinct observations. The idle Chronicle status probe proves no active-finalizer behavior; earlier workflow evidence and Manure's four shutdown/drain cases retain their own scope.

## Limits and preservation

- The shared retrieval adversarial semantic experiment returned0/12 while lexical/hybrid and the index-disabled prelimit comparison returned12. No universal ANN recall, graph-cause or exact-fallback claim is made; see the retrieval validation documentation.
- HM services share a Unix UID; SQL role ACLs do not isolate credential bytes from same-UID processes. Manure path hosting remains the documented low-security/shared-origin model.
- KVM-or-TCG policy and KVM-inaccessible preflight do not establish the selected accelerator; selected acceleration remains unknown in the Manure receipt.
- Manure's supervisor proves its prospective owned subtree; the lifecycle Nix-client observer states only its visible-namespace scope. Neither establishes whole-host absence.
- Historical failed/application/setup/cleanup outcomes remain unchanged. Raw confidential logs/configuration/argv/PG contents stay private; approved copies or explicitly hashed omissions are distinguished.
- Private VM archives omit filesystem socket nodes. Exact metadata preservation/review of those specific ephemeral nodes is required before cleanup; compare0 alone is not an exact entry-set proof. No blanket omission or deletion exemption is granted.

## Remaining work

Finish private evidence/authorized cleanup and resolve Q11 before any history reconciliation. No push, pin update, production migration, credential rotation or activation is authorized by this acceptance summary. Detailed provenance and original outcomes remain in `20261103-0017-unified-services-execution.md` and the named bundles.
