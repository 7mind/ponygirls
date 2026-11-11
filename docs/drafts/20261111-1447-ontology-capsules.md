# Qualified capsule projection and delivery

## Implemented boundary

The Baboon contracts, pure Scala projection/delivery policy and memory/PostgreSQL capsule ledger are implemented. Service composition, worker/Pi integration and real-backend browser acceptance remain separate unfinished work. A capsule is a bounded derived account, not semantic completeness, truth, execution permission or evidence of model use.

`CapsuleProjection` owns deterministic selection, exact record/receipt closure, qualifications, text and payload digest. `RecordLinks` shares structural references with presentation construction; `RelationValidation` preserves ordinary authoring restrictions and checks retained captured actions against canonical review evidence. Placing these guarantees in a caller would permit different consumers to omit evidence or classify malformed records as stale.

## Selection and evidence

- Semantic work context is explicitly configured, not inferred from a native session or branch. Missing reported context stays Unknown.
- Current Outcome/Constraint accounts remain visible, including unresolved or unbound intent. Work-context selections retain retired/stale contracts without inventing fallback work.
- Exact prerequisites and current invalidating assessment-account revisions remain inspectable. Historical consumption does not acquire current-selection requirements.
- Structural validation precedes stale-warrant qualification. Capacity failure rejects the whole projection rather than silently truncating it.
- Complete source receipts can contain operations beyond the selected graph-record subset. Selecting a work context is not redaction of its shared input receipt.
- Human-basis labels follow authenticated Human-contributor receipts and explicit evidence paths. A transcript UserMessage label is not Human authentication. Derived presentations are not primary observations.
- Reported inherited cuts remain source-scoped. Authorization precedes referenced history lookup; inherited foreign graph bodies are not automatically expanded into the capsule.

## Baselines and changes

`CapsuleBaseline.validated` is the only baseline constructor. It rebuilds the retained projection from material and a validated predecessor; a recomputed digest alone cannot admit arbitrary text. Comparison also requires the same owner, scope, work context and exact reported native origin. Unknown origin is not a wildcard. Preparation cannot precede its baseline.

Changes compare **retained account revisions**, not projected-root membership. If a replacement binding is selected, the selection account changes; prior binding-local progress is not thereby deleted, cancelled or transferred. A still-retained account head can remain the comparison endpoint after leaving the projected root set. Optional endpoints do not authorize synthesizing removals from filtering. Reasons are copied from recorded accounts, not generated causal explanations.

## Delivery observations

`DeliveryEngine` checks current Read, retained ownership, capsule identity/digest, work context, reported origin and inherited-cut correspondence. A delayed delivery can be recorded after the graph changes. It is qualified as changed graph/coverage, not rejected as an attempt to admit fresh work.

The capsule payload digest and client-reported full-boundary digest are distinct. The latter's bytes have not been received or verified by this server. Client time remains reported time, including a future client clock; server receipt time is separate. Neither receipt asserts provider-wire inclusion, model consumption or physical execution. Preparation and delivery do not create primary activity.

## Persistence ownership and bounds

The read-boundary prerequisite is implemented separately: `CurationReadModel` returns a coherent graph/status pair through a read-only context. Public status now takes only the scope lock, not the coordinator lock. Retained-cut validation binds historical G/F/C and publication generation, validates positively named evidence and explicit journal prefixes, and preserves earlier active observations after later transitions—even at equal timestamps. Included publication times are checked independently of the latest observed attempt. Missing historical metadata observations are not reconstructed from current rows. The capsule ledger uses this boundary within its existing scope transaction.

`GraphRepository.capsules(settings)` creates a configured facade over the same repository-owned ledger. Canonical prepare/delivery requests have owner-scoped replay keys; retries preserve original artifacts, observations and ingress. Memory stages both ledger maps before assignment; PostgreSQL uses the existing scope transaction and auxiliary tables from migration 005. Neither path creates graph/input/outbox activity.

Baseline traversal counts the requested artifact and all ancestors. New preparation reserves a slot for itself, preventing an artifact that immediately exceeds its own configuration's read budget. `maxMaterialSnapshots` counts distinct capsule assembly cuts, not total internal SQL reads or recursive integrity work. Historical validation uses retained projection limits. Configuration reductions may exceed operational traversal capacity, but do not make retained artifacts corrupt. Delivery/read/replay do not require that the context remain enabled for new preparation.

Bind historical G/F/C and publication generation to their authoritative records. Mutable attempt summaries are retained server observations; do not reconstruct their earlier state from today's terminal attempt or infer ordering from equal timestamps. Preserve original ingress/time on replay. Avoid scope-to-global coordinator lock inversion. An authorized empty G0 preparation must not invent graph/history activity.

## Verification scope

Shared memory/PostgreSQL tests cover projection against repository material and ledger behavior: exact replay, credential rotation, disabled new contexts, bounded ancestry/material cuts, inherited namespace revocation, concurrency and historical attempt observations. PostgreSQL controls cover late-insert rollback, reconstructed-adapter response-loss recovery, resealed projection/cycle corruption, and scope-locked observations while a command queues. Empty G0 artifacts do not create scope/history rows. Browser checks still use scripted APIs, not the concrete unfinished backend.

Q56 revision 2, read on 2026-11-11, separately requires external graph commands to retain primary command Sources and advance the frontier atomically. Internal curator publication remains non-primary. That new increment is not implemented by this capsule milestone and grants no deployment or Human-study authority.
