# Owned projection runtime

`SerialProjectionStep` performs at most one pinned head-reconciliation batch or one pending-publication batch per advance. It validates returned work, publishes the exact historical snapshot, obtains an actual RDF observation and submits an immutable acknowledgment. A publication return value alone is not evidence for acknowledgment.

Unknown publication results receive one observation, not another immediate write. Known pre-write validation failures stop as rejected. Unknown ACK results use receipt inspection and at most one exact replay; a definite stale rejection allows one re-observation with a new request identity. Earlier confirmed results remain in the report if later work fails.

Reports retain pending target/stage and, when allocated, the ACK input and observation before effects. A pending descriptor does not prove dispatch or that work remains physically running. Cancellation joins owned work, retains uncertainty and may inspect an existing ACK once without admitting a new one. Reports are chronological: an unconfirmed cancellation event may be followed by a confirmed retained receipt. A stopped advance does not erase its prior report. Failure recording precedes stop signaling; diagnostic IO comes afterward.

## Resource ownership

The mandatory factory owns the actual RDF resource and projection session. Session bootstrap preserves one ID/fence/instance for a bounded retry and validates the returned binding. Acquisition and close observations use explicit budgets; budget expiry reports an overrun and joins owned work rather than claiming it vanished.

The runner owns, in order:

1. shared coordinator lease;
2. renewal fiber;
3. worker fiber containing RDF/session acquisition, the supplied child resource, and the bounded loop;
4. worker/child/RDF finalization;
5. renewal cancellation and join;
6. lease release attempt.

The worker and stop-signal race starts before bootstrap finishes. Ownership loss halts admissions and signals cancellation before diagnostics. Renewal remains alive through work cleanup and RDF close. `ProjectionAttachment.rdf` is the object that later service/HTTP composition must use—never a second MemoryStore or global handle. `ResourcesReady` means resource acquisition completed, not projection catch-up or semantic readiness.

Initial head reconciliation precedes model work. Each eligible loop iteration advances projection before and after a curation cycle; a stopped cycle does not admit new projection work.

## Cleanup evidence

RDF close observations are retained before errors propagate, including when cancellation dominates the fiber outcome. Child-resource acquisition/finalizer failures are separately recorded. Fiber cancellation, join and worker failures are not silently discarded. Cleanup uncertainty remains distinct from a successful close whose diagnostic failed: the latter retains positive closure evidence and reports diagnostic failure without manufacturing `CleanupUncertain`.

Budgets are observation/admission controls, not hard physical revocation. In-flight RDF writes cannot be revoked by lease expiry; authoritative new ACKs remain fenced and a later acquisition reconciles actual state.

Shared adapter controls use actual PostgreSQL/memory owners and RDF, plus controlled failures/interleavings. Main/configuration, real HTTP child deployment, worker/Pi integration, packaging and full live acceptance remain unfinished. No deployment authorization is implied.
