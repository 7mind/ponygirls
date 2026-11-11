# Concrete service boundary

`DefaultOntologyService` composes the same authoritative repository with its query and capsule facades. Recorder identity, clock, server-ID allocation, scope catalog and exact local RDF observation are explicit dependencies. Scope/capability checks precede effects; review calls additionally retain their Human cookie and exact scope requirements. Authentication and credential revalidation remain in the HTTP/MCP boundary, not client DTOs.

External apply delegates to repository primary-command publication. The service does not invoke the shared admission engine as an alternative write path or trigger extra maintenance. Capsule/delivery timestamps remain repository-owned; other existing publication APIs receive the injected service clock. Caller replay identities and ingress are preserved.

## Scope catalog decision

Q57 is pending. `ScopeCatalog` is a required interface, with no production policy implementation or silent default. Tests inject explicit fixture names. This does not select granted-name or persisted-only advertisement on the user's behalf.

## Exact local RDF observation

`LocalExactRdfReadiness` probes the attached RDF resource for the sampled authoritative revision and compares complete snapshots. `Some(G)` means that local instance matched that exact sampled cut when observed. `None` means the exact cut was not verified locally; it does not establish absence, lag direction, health at another generation, publication activity or replica-wide readiness.

Only typed projection-lag becomes None. Content mismatch and unexpected failures propagate. The RDF owner now rejects a nonempty target dataset lacking its generation checkpoint, and rejects negative checkpoints before mismatch classification. This is not an integrity audit of every nonmatching generation, nor a fenced publication/checkpoint protocol.

Scope summaries use coherent curation status plus its exact historical graph (canonical G0 where applicable), not a newer head. RDF I/O occurs after the authoritative transaction closes. Global outbox acknowledgment is not used as local readiness evidence. An advancing head or projection does not justify combining different cuts.

## Acceptance and remaining work

Shared memory/PostgreSQL service contracts exercise real HTTP/MCP authentication, service delegation, graph queries, primary-command replay, cookie review and capsule/delivery persistence. Real Memory/Native RDF controls exercise exact, absent, older/newer, mismatched and corrupted projections. These are not browser acceptance results.

Main/configuration, resource lifecycle composition, fenced target/incarnation projection, worker/Pi integration, packaging and real-backend browser acceptance remain unfinished. No deployment or Human-study authorization is implied.
