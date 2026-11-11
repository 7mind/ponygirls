# Ontology curation protocol foundation

This is an implemented protocol/domain/transport slice, **not a completed live curation service**. Durable attempts, lease acquisition/recovery, authoritative publication, concrete service composition and the worker sidecar remain unfinished. No deployment, Human study or private-source model traffic is authorized or established by these checks.

## Ownership and coordinates

PostgreSQL remains the intended transaction owner. RDF remains rebuildable derived data. The pure curation guards describe allowed transitions; they do not acquire leases, authenticate callers, read durable state or commit graph changes.

A claim pins the coordinator fence, scope, graph generation G, retained primary frontier F, previous covered frontier C, profile/schema identities and exact graph/source-cut digests. Eligibility requires F > C, F greater than every prior attempted frontier, and no active attempt. A failed frontier is not automatically retried after restart or profile changes. A later primary frontier includes the full still-uncovered interval (C,F]. External graph_apply trigger classification remains unresolved; this slice does not change it.

CurationMaterial reconstructs the entire ordered source cut and graph seed. Source records must correspond to their exact frozen graph definitions. The input manifest pins every seed/source record and the deterministic UTF-8 input encoding, digest and byte count. Capacity failure is explicit; no source truncation or hidden subset is substituted.

## Journal, input and candidate correspondence

The stages are RequestPrepared, DispatchPossible and ResponseObserved, with consecutive request ordinals. Their meanings are deliberately different:

- RequestPrepared retains the normalized JSON request prepared by the adapter.
- DispatchPossible is recorded before the HTTP invocation; it does not prove sending or provider receipt.
- ResponseObserved retains the parsed, normalized JSON response accepted by the transport. It is not the original raw HTTP body and is not evidence of model reasoning or use of the input. Non-success or malformed outer responses may leave no response-stage record.

Every prepared request must carry the exact sealed input bytes in the protocol's initial user message, following the system message. Continuations preserve that input boundary. The request's own digest is not a substitute for this correspondence check.

Audit keys replay identically without changing their original timestamps. A conflicting replay fails. The first journal time cannot precede sealing, later stages cannot move backwards, and publication time cannot precede its final response. Clock rollback fails closed. An outstanding DispatchPossible stage yields journal uncertainty; other stages do not prove an absence of unrecorded external activity.

AuditedProposal carries the exact final response ordinal and normalized-response digest. Candidate validation decodes the retained final response and compares its actual proposal, rather than allowing another proposal to borrow that response's digest. Publication planning revalidates the live fence, exact G/F/C, frozen material, request/input correspondence and response/proposal correspondence. An empty proposal plans G+1 and C=F without creating a fictitious graph node or advancing primary F.

## Remaining persistence obligations

The future owner must enforce one fenced coordinator, explicit lease/cadence/capacity configuration, fresh owner-side time after potentially blocking locks, and one transaction for graph/history/input receipt/attempt/outbox publication. Model and network operations stay outside transactions. Profile selection, source-sharing authorization and frozen reader ownership remain explicit service responsibilities; their digest labels are not attestations.

Terminal failures and stale results must be committed as outcomes, not thrown away with their transaction. Infrastructure failures can leave recording uncertain. Exact committed replay returns the original publication without another provider invocation. Recovery must fence old owners and preserve unanswered-dispatch uncertainty, never automatically redispatch the same frontier.

## Status and verification limits

The API/UI distinguish the current G/F/C, last publication generation and the latest attempt's pinned coordinates and journal stage. Equal C/F means source coverage, not review of subsequent graph edits.

Tests cover pure state/material invariants and controlled loopback-provider transport ordering, deadlines and exact input/response linkage. Browser tests use built assets and scripted APIs. These checks do not establish durable curation, real-backend browser acceptance, semantic classification quality, Human benefit or deployment.
