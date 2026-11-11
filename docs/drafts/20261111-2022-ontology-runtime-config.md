# Runtime configuration boundary

The typed decoder is implemented; Main and its CLI/resource wiring remain separate work. `ontology/server/src/test/resources/runtime-config.json` is a complete controlled fixture, not a deployment configuration.

Configuration is bounded strict UTF-8 JSON with exact required keys. Nullable options must appear explicitly as null. Integer fields reject strings, fractions, exponents and overflow. Durations are explicit positive millisecond integers, subject to their actual owner bounds. References are absolute paths; decoding does not test existence, read secrets, open PostgreSQL/RDF, contact a model or start a listener. No environment expansion, guessed cadence, defaults or credential fallback is provided.

The listener record is new Config-owned data for the HTTP server: host, port, connection/header limits, shutdown duration and nullable webRoot. `HttpApi` still takes webRoot directly and retains its existing 30-second body policy.

Validation reuses owner contracts and checks cross-boundaries: session limits, roles/grants, maintained primary-writer/capsule scopes, projection coverage, curation labels versus actual admission limits, cycle limits versus repository bounds, and renewal versus lease duration. Auth origins must already have canonical serialized authority/port spelling; configuration is rejected rather than normalized. Checks use literal parsing, not DNS. Read-only grants can include empty scopes under Q57.

Auth structural validation is separate from runtime credential loading. Runtime Auth construction still checks digests, and authentication continues to reread them for revocation. Config rendering and errors avoid exposing supplied values.

## Pinned DI ownership constraint

A probe of izumi 1.2.25 `Lifecycle.fromCats` under the pinned mixed Scala/Cats graph reproduced a release-time `NoSuchMethodError`. A locally compiled mirror addressed that ABI call, but the stronger gated-acquisition cancellation probe still waited for DI provisioning. No dependency upgrade or speculative adapter was retained.

The selected runtime design keeps resources in native Cats `Resource` scopes and injects borrowed values through distage `fromValue`. DI must not close them again. Six controls verify cancellation before/after allocation, handoff, nested acquisition failure, release failure/order and cancellation ExitCase. The actual HTTP/RDF resources must remain under the runner-owned attachment, not eager outer creation of another RDF store.

This establishes configuration and ownership-boundary behavior, not Main, deployment or integrated browser acceptance.
