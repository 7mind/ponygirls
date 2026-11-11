# Ontology service

The JVM service provides authoritative PostgreSQL graph/review/capsule APIs, REST and MCP authentication, automatic bounded curation and a rebuildable RDF projection. It runs as one active coordinator. HTTP is a child of the runner-owned RDF attachment; it does not start as a standby when ownership cannot be acquired.

## Build and validate

From the repository root, use the pinned backend development shell:

```bash
nix develop .#backend --command bash scripts/backend-sbt.sh 'ontologyServer/assembly'
nix develop .#backend --command bash ontology/scripts/test-postgres.sh
```

The assembly is `ontology/server/target/ontology-server.jar`. The PostgreSQL test command starts an owned database and runs the complete discovered suite. A package build or focused test is not a substitute for that run.

## Nix packages

```bash
nix build .#ontology .#ontology-web
nix run .#ontology -- check-config /absolute/config.json
```

`ontology` combines the service JAR, a launcher using the pinned JVM, and dashboard assets. It is not an AOT/native executable. `ontology-web` builds and checks the locked frontend independently. `lib.mkOntologyPackage { inherit pkgs; }` exposes `serverArtifact`, `web`, `runtimeSource` and `sharedJavaRuntime`.

Set `http.webRoot` explicitly to `${ontologyPackage.web}/share/ontology/web` in rendered configuration to serve the packaged dashboard. `null` remains valid for API-only use; the launcher supplies no web-root environment fallback. Package construction does not enable a service or supply runtime credentials.

## Commands

```bash
java -jar ontology/server/target/ontology-server.jar check-config /absolute/config.json
java -jar ontology/server/target/ontology-server.jar migrate /absolute/config.json
java -jar ontology/server/target/ontology-server.jar serve /absolute/config.json
```

- `check-config` validates structure and owner bounds; it does not read referenced secrets, open PostgreSQL/RDF, contact a model or listen.
- `migrate` acquires only the database and repository graph. Migration 004 refuses retained pre-primary-command mutation data rather than inventing Sources/frontiers. Such data needs a separately designed cutover.
- `serve` loads runtime credentials and owned resources, initializes the repository and acquires the shared coordinator lease. Renewal begins before RDF/session/HTTP acquisition and remains active through joined cleanup. There is no automatic reacquisition or standby listener. A returned stopped-runner result is an error exit, not successful service completion.

Configuration is strict JSON with every field explicit, including null options. `server/src/test/resources/runtime-config.json` demonstrates the complete shape using synthetic paths and controlled endpoints; it is not a deployment configuration. See the [configuration boundary](../docs/drafts/20261111-2022-ontology-runtime-config.md).

Credential hash files contain exactly 64 lowercase SHA-256 hex characters with one optional newline. The cursor-key file contains 32 random bytes encoded as 64 lowercase hex characters, again with one optional newline. Model credentials are separate runtime file references. No environment expansion or secret fallback is provided. Source sharing must be explicitly enabled in the selected curator profile; disabled sharing does not fall back to another model/profile.

An explicit `webRoot` serves a built dashboard. HTTP development mode requires a literal loopback bind and matching canonical HTTP origin/port. Other HTTPS publication requires deployment-layer TLS; configuration validation does not establish network exposure or authorization to deploy.

## Evidence boundaries

External graph commands and designated captures/reviews atomically create primary activity. Internal curation, capsule preparation and delivery bookkeeping do not independently advance the primary frontier. RDF checkpoints and reports are qualified evidence, not execution permission or proof of provider use. Read-authorized catalogs include sorted explicit grants, including empty G0 scopes, without creating state.

Runtime resources stay in native Cats Resource scopes. Distage receives borrowed values and constructs the object graph; it does not close those resources again. The pinned mixed Scala/Cats graph is not routed through the incompatible `Lifecycle.fromCats` adapter.

Controlled tests exercise real Auth/HTTP/MCP, PostgreSQL, loopback model transport, Native RDF, review and capsule paths, including shutdown and ownership denial. Those results are not genuine-Human participation, semantic-quality evidence, deployment, native-ELF acceptance or browser acceptance. Pi/worker integration and final integrated acceptance remain unfinished. Nix package builds and packaged `check-config` are smoke evidence, not acceptance of the installed service against PostgreSQL or a browser.
