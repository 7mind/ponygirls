# Evolving-session corpus

`fixtures/session-001.json` is wholly fictional, not private history. Its 24
immutable raw events have 12 checkpoints, one after each pair.

At each checkpoint supply **only the raw source prefix and previous model graph**
(empty initially). Do not supply future events, this document, the oracle,
pretyped objectives, expected tags, or accepted state. Ontology, intent, links,
and concept identity update directly and automatically, not through actor
approval or intent-editing proposals. Source logs never change.

`fixtures/session-001-oracle.json` was authored before model outcomes, for scoring
only. Keys are not model node IDs. Identity references require the model's same
node across checkpoints, including corrections and withdrawals. All selector fields are present. Nulls and empty lists are unconstrained;
sources are alternatives. No literal spellings are required. Ranges and nulls
permit alternative defensible tags and granularity.

These are **mechanical graph-shape checks, not semantic entailment proofs**.
Relation minima cannot forbid a false prerequisite edge; constrained concept
counts cannot prove complete alias unification. Independently review side-task
independence and alias semantics. Evidence, completion claims, human assessment,
and actual objective truth must not be conflated. Final uncertainty is deliberate.

Offline validation covers exact schemas, types, roles/enums, size bounds, pairwise
prefixes, unique keys, source scope, relation endpoints, and backward identity
references. No live evaluation was run.
