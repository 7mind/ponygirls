# Fenced projection owner

`GraphRepository.projections(settings)` shares the authoritative memory/PostgreSQL owner. A configured Service principal needs current Read grants for its declared scopes; derived bookkeeping grants no graph-mutation authority. The existing curation coordinator remains the only lease owner. Projection operations use coordinator-then-scope locking and fresh owner time after blocking locks.

## Acquisition and reconciliation

Sessions pin actor, target/incarnation, fence, sorted scopes and batch size. Stable opening replay preserves the original session; changed parameters conflict. A new acquisition must reconcile its configured heads even when the same incarnation has older checkpoints.

Each issued head batch retains its exact targets and fixed scope interval. Remaining work is derived from this session's unique, contiguous head-acknowledgment prefix. Partial acknowledgment never shrinks or resamples the issued batch. A cursor alone, outbox acknowledgments, or older-session checkpoints cannot establish completion. Work includes exact historical snapshots, including canonical G0 without creating a graph publication.

Batch limits bound returned work, not all integrity-validation SQL reads.

## Acknowledgment and replay

A new acknowledgment requires live ownership, an issued next head or actual outbox target, and a complete observed RDF snapshot/checkpoint matching authoritative history. A newer observed generation may explicitly supersede an older requested target; neither must still equal today's head.

A new observation below the current checkpoint rejects as stale. A definite stale rejection permits re-observation and a new immutable request; uncertain requests must first be resolved or replayed unchanged. Exact recorded replay remains available after expiry and does not refresh timestamps, progress or readiness.

Checkpoint presence and generation must agree with the greatest validated accepted observation for that instance/scope across sessions. Its witness must be an acknowledgment establishing that exact point. Equal-generation witnesses are not ordered by timestamps. A coherently restored older checkpoint or a deleted checkpoint is corruption, even when an older witness is individually valid.

Acknowledgment insertion, checkpoint update and head-progress settlement commit atomically. They change no graph generation, primary frontier, coverage or primary eligibility. An internal observation object is not cryptographic proof of physical RDF I/O; the runtime must obtain it from the actual attached adapter.

## Outbox and remaining work

The legacy unfenced acknowledgment API is removed. `outboxSnapshots` is read-only publication inventory. Migration 006 drops the global published flag and creates session, acknowledgment and instance-qualified checkpoint tables; it does not backfill qualified evidence from that flag. Scheduling uses the qualified facade after head reconciliation.

Controls include shared memory/PostgreSQL reconciliation/replay/monotonicity tests, real local RDF observations, late-write rollback, forged progress, coherent checkpoint rollback/deletion and expiry while queued behind coordinator or scope locks. Service tests show that another incarnation's valid acknowledgment cannot establish local readiness.

The [bounded projection step and runner resource lifecycle](20261111-1912-ontology-projection-runtime.md) are implemented separately. Main/configuration, worker/Pi integration, packaging and full live acceptance remain unfinished. No deployment or migration of a live service is authorized by this implementation.
