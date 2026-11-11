# Ontology curation protocol foundation

This is an implemented protocol/domain/storage/transport slice, **not a completed live curation service**. Durable repository operations and the automatic curator lifecycle are implemented and exercised with controlled providers. Concrete service composition, RDF runtime topology and the worker sidecar remain unfinished. No deployment, Human study or private-source model traffic is authorized or established by these checks.

## Ownership and coordinates

PostgreSQL is the authoritative transaction owner. RDF remains rebuildable derived data. The pure curation guards describe allowed transitions; they do not acquire leases, authenticate callers, read durable state or commit graph changes.

A claim pins the coordinator fence, scope, graph generation G, retained primary frontier F, previous covered frontier C, profile/schema identities, admission limits and exact graph/source-cut digests. Eligibility requires F > C, F greater than every prior attempted frontier, and no active attempt. A failed frontier is not automatically retried after restart or profile changes. A later primary frontier includes the full still-uncovered interval (C,F]. External graph_apply trigger classification remains unresolved; this slice does not change it.

Each attempt retains its own admission limits. Historical validation, journal loading, material reconstruction and recovery use those pinned limits; lowering current configuration does not turn valid retained records into corruption. New claims use the new limits.

Claims also retain a fixed owner-clock admission deadline, derived from the explicitly configured attempt duration after ownership locks. Lease renewal does not extend it. New sealing, request preparation, possible dispatch and publication require owner time strictly before the cutoff. Exact acknowledgments remain readable afterward. An already-dispatched response observed late may be retained and terminalized atomically, but cannot publish. This is an admission cutoff, not a promise that an already-admitted transaction physically commits before that instant or that cancellation revokes external effects.

CurationMaterial reconstructs the entire ordered source cut and graph seed. Source records must correspond to their exact frozen graph definitions. The input manifest pins every seed/source record and the deterministic UTF-8 input encoding, digest and byte count. Capacity failure is explicit; no source truncation or hidden subset is substituted.

## Runtime input and profile boundary

CuratorModel exposes the profile pin derived inside its resource from the configuration, policy/request template and schema values it actually captures. Credential references are included, never credential contents. A pin describes configuration, not observed provider/model identity. Changing a schema accessor after construction cannot silently change the captured request or its pin.

FrozenCurationReader reuses GraphQueries through a narrow read-only repository contract. It never substitutes the live head for its retained snapshot. Pagination stays at the pinned generation; explicit receipts must match scope, exact reference and generation. Missing context remains unavailable rather than being fetched from a newer cut.

RepositoryCurationAudit serializes each attempt's callbacks and uses the confirmed prepared-request digest for later stages. Replayed preparation/possible-dispatch acknowledgment is not permission to call the provider again. Any hook error or cancellation stops that adapter invocation, including uncertain acknowledgments before or after storage commit. Stop transitions are coordinated with callback serialization, and in-flight hooks recheck stopped state before returning continuation. The automatic lifecycle now composes this adapter with the model and repositories; full application composition remains separate.

## Cycle kernel and supervised cleanup

CurationCoordinator.cycle operates under a caller-owned fence and serializes cycles. It performs one bounded recovery batch, defers new claims if recovery remains, then scans a bounded scope batch. Only a fresh Claimed result reaches model invocation. Replayed claims do not authorize invocation or terminalize existing work. Partial observed outcomes remain in the report if a later step fails.

Claim-recording uncertainty stops further admission. Publication uncertainty is reconciled by inspecting retained state and, when needed, one exact candidate replay; it never causes another model invocation. Known terminal and Published outcomes survive cleanup. Diagnostics failure is itself observable in the stop state.

SupervisedCurationCleanup owns its operation. A budget alarm stops/reports further admission, then waits for that operation to settle; it neither detaches it nor fabricates a failure or completion. Cancellation remains cooperative. Reporting failure does not cancel owned cleanup or erase an observed result. Combined operation/reporting failure remains distinct from operation-only uncertainty.

CurationRunner owns a fresh kernel and owner identity, acquires one lease, renews independently and polls serialized cycles. Renewal loss halts admission and signals work cancellation before diagnostics. Shutdown settles/joins work while renewal remains owned, then joins renewal before supervised lease release. It never automatically reacquires or changes profiles. Release uncertainty remains uncertainty even when an observer later proves release committed; diagnostic failure is retained separately rather than discarded.

## Journal, input and candidate correspondence

The stages are RequestPrepared, DispatchPossible and ResponseObserved, with consecutive request ordinals. Their meanings are deliberately different:

- RequestPrepared retains the normalized JSON request prepared by the adapter.
- DispatchPossible is recorded before the HTTP invocation; it does not prove sending or provider receipt.
- ResponseObserved retains the parsed, normalized JSON response accepted by the transport. It is not the original raw HTTP body and is not evidence of model reasoning or use of the input. Non-success or malformed outer responses may leave no response-stage record.

Every prepared request must carry the exact sealed input bytes in the protocol's initial user message, following the system message. Continuations preserve that input boundary. The request's own digest is not a substitute for this correspondence check.

Audit keys replay identically without changing their original timestamps. A conflicting replay fails. The first journal time cannot precede sealing, later stages cannot move backwards, and publication time cannot precede its final response. Clock rollback fails closed. An outstanding DispatchPossible stage yields journal uncertainty; other stages do not prove an absence of unrecorded external activity.

AuditedProposal carries the exact final response ordinal and normalized-response digest. Candidate validation decodes the retained final response and compares its actual proposal, rather than allowing another proposal to borrow that response's digest. Publication planning revalidates the live fence, exact G/F/C, frozen material, request/input correspondence and response/proposal correspondence. An empty proposal plans G+1 and C=F without creating a fictitious graph node or advancing primary F.

## Pure publication admission

CurationPublisher now produces an uncommitted publication value: the proposed graph snapshot, Curation input receipt, terminal attempt and publication receipt. Only the repository transaction makes that value authoritative.

Ordinary Admission retains its existing constructor and graph-command identity rules. A separate internal CurationAdmission supplies Curation provenance to the same semantic admission engine. It requires an Agent contributor, Service recorder and submitter, scoped Read and Mutate grants, and an Internal `curation.publish` trace. The public repository's graph_apply path cannot select this admission type. New operation-record identities are disjoint from ordinary commands even for the same request UUID and alias; revisions of existing entities retain their identity semantics.

For empty deltas, all graph collections remain unchanged; only generation and coverage advance. An input receipt and terminal attempt are still produced. For nonempty deltas, existing protected-source, applicability, selection, gate and authority rules remain in force. A rejected late operation returns no partial publication. Neither path advances the primary frontier or manufactures a Source.

CurationReceipts validates canonical publication input and its receipt-local identity, scope, generation, timestamp, attribution, internal context and proposal digest. Published attempts must refer to their deterministic Curation input identity. These local checks do not replace the persistence owner's attempt/journal/history/material correspondence checks.

## Transaction ownership and remaining runtime

CurationRepository is a facade of the existing graph owner. Shared CurationStore policy runs through an application-specific transaction context, not an independent graph writer. Memory stages affected maps and commits them under its existing monitor, using an explicit Clock. PostgreSQL locks the coordinator row before the scope and obtains database time after blocking locks. Graph, history, input receipt, terminal attempt and outbox commit atomically. No model or network operation occurs inside these transactions.

The singleton lease retains a monotonic fencing epoch across release. Identical live-owner acquisition returns the original lease without renewing it. Recovery marks older active fences Interrupted and preserves unanswered-dispatch uncertainty. Terminal domain rejection and staleness are committed outcomes; storage mutations occur outside that rejection catch so a late storage failure rolls back the entire publication. Infrastructure failures can leave recording uncertain.

Exact committed publication replay validates the retained result and returns the original receipt before fresh-head admission. Claim replay is a distinct result, not a new work grant. Replayed request or dispatch audit entries acknowledge retained evidence; the future runtime adapter must not interpret them as permission for another provider invocation.

Head, history and projection-outbox validation use the published-attempt inventory bounded by the requested generation. At a publication generation the snapshot must match its retained revision exactly. Later snapshots must preserve the exact content and multiplicity of records attributed to each Curation input, while legitimate later ordinary edits remain allowed. Receipt/attempt validation reconstructs the recorded graph outcome; it does not fabricate historical credentials or a lease.

Renewal/polling, cadence and batch bounds are explicit runtime configuration; only serialized cycle execution is supported. Profile selection, source-sharing authorization and frozen reader composition are wired into the runtime boundary. Full application configuration and service/Pi deployment remain separate work; digest labels are not attestations.

## Status and verification limits

The API/UI distinguish the current G/F/C, last publication generation and the latest attempt's pinned coordinates, admission deadline and journal stage. Equal C/F means source coverage, not review of subsequent graph edits.

The same repository contract runs against memory and owned PostgreSQL. Additional controls exercise queued lease expiry, clock rollback, old-fence recovery, late SQL failure rollback, discarded commit acknowledgements, retained-limit changes, historical cuts and canonical-but-miswired or extra records. Separate loopback-provider checks cover transport ordering, deadlines and input/response linkage. Browser tests use built assets and scripted APIs. Controlled tests exercise the automatic lifecycle against both stores and real loopback HTTP providers. They do not establish a deployed application, real-backend browser acceptance, semantic classification quality or Human benefit.
