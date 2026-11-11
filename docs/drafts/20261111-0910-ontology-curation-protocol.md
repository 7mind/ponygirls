# Ontology curation protocol foundation

This is an implemented protocol/domain/storage/transport slice, **not a completed live curation service**. Durable repository operations for attempts, leases, recovery and publication are implemented. The automatic coordinator loop, concrete service composition and worker sidecar remain unfinished. No deployment, Human study or private-source model traffic is authorized or established by these checks.

## Ownership and coordinates

PostgreSQL is the authoritative transaction owner. RDF remains rebuildable derived data. The pure curation guards describe allowed transitions; they do not acquire leases, authenticate callers, read durable state or commit graph changes.

A claim pins the coordinator fence, scope, graph generation G, retained primary frontier F, previous covered frontier C, profile/schema identities, admission limits and exact graph/source-cut digests. Eligibility requires F > C, F greater than every prior attempted frontier, and no active attempt. A failed frontier is not automatically retried after restart or profile changes. A later primary frontier includes the full still-uncovered interval (C,F]. External graph_apply trigger classification remains unresolved; this slice does not change it.

Each attempt retains its own admission limits. Historical validation, journal loading, material reconstruction and recovery use those pinned limits; lowering current configuration does not turn valid retained records into corruption. New claims use the new limits.

CurationMaterial reconstructs the entire ordered source cut and graph seed. Source records must correspond to their exact frozen graph definitions. The input manifest pins every seed/source record and the deterministic UTF-8 input encoding, digest and byte count. Capacity failure is explicit; no source truncation or hidden subset is substituted.

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

Automatic renewal/polling, execution cadence/concurrency, profile selection, source-sharing authorization and frozen reader composition remain runtime responsibilities. Configuration must be explicit; digest labels are not attestations.

## Status and verification limits

The API/UI distinguish the current G/F/C, last publication generation and the latest attempt's pinned coordinates and journal stage. Equal C/F means source coverage, not review of subsequent graph edits.

The same repository contract runs against memory and owned PostgreSQL. Additional controls exercise queued lease expiry, clock rollback, old-fence recovery, late SQL failure rollback, discarded commit acknowledgements, retained-limit changes, historical cuts and canonical-but-miswired or extra records. Separate loopback-provider checks cover transport ordering, deadlines and input/response linkage. Browser tests use built assets and scripted APIs. These checks do not establish an automatically running curation service, real-backend browser acceptance, semantic classification quality, Human benefit or deployment.
