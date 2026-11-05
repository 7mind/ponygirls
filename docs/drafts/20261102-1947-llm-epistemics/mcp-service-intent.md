# Graph MCP — service intent and current phase

Recorded 2026-11-05 from the user's current request. This is intent/planning, not
an implemented service or a decision that RDF has won.

## Agreed starting surface

The user accepted a three-tool starting proposal over the
[shared project graph](cq4-node-schema.md):

- `graph_find(filter, page)`: bounded discovery, exact references and previews.
- `graph_read(targets, include, page)`: batched records, governing context, sources,
  progress/history; navigation resolves and returns exact references.
- `graph_apply(request_id, expected_heads, operations)`: atomic revision-checked,
  idempotent operations over definitions, relations, bindings and state events.

Preserve caller-derived attribution, protected human/collector capture, immutable
history and explicit errors. No tool that turns an Agent declaration into actual
Human approval, host observation, verified truth or execution permission.

Compact JSON was the **provisional** model-facing default; deterministic lossless
plaintext was the proposed comparator. Canonical machine data/output schemas are
separate from rendering. No format advantage or optimal tool count was established.
The proposed16-session JSON/plaintext MCP comparison has NOT run and is now paused.

## Intended implementation stack

For a subsequent custom service, the user prefers the repository's Scala ecosystem:

- distage/izumi for composition and resource lifecycle;
- BIO-style effect boundaries;
- logstage structured logging;
- PostgreSQL;
- reuse of the shared retrieval/filtering library for lexical, vector and typed
  attribute search, rather than a new query language or duplicate retrieval stack.

Observed at research commit `a8a530ba13a6837d16783a116b98bdf05b7bf459`:
`shared/retrieval-core` defines `RetrievalMode.Lexical/Semantic/Hybrid`,
`RetrievalQuery` and currently typed attribute **equality** filters.
`shared/retrieval-postgres` composes live visibility/attribute constraints with
candidate retrieval in caller-owned transactions. `shared/model-http` and
`shared/service-runtime` are related shared modules. `build.sbt` wires these into
Chronicle, Haystack and Manure. This is source inspection, not a fresh backend run.

The inspected runtime also has a Cats Effect IO adapter (`CatsIOInjector`); BIO is
recorded as requested direction, not a claim that every current service is already
BIO-polymorphic. No existing service/effect stack is being migrated by this request.
Reuse must preserve app-owned authorization, exact source versions and publication
boundaries; search hits/similarity do not establish authority or factual support.

## RDF evaluation comes first

The user's newer instruction pauses custom MCP/service implementation: first model
this schema with RDF, optionally SHACL, and run bounded pilots to assess benefit.

Evaluate separately:
1. domain/identity/provenance mapping and exact roundtrip;
2. query and validation expressiveness, including SHACL's limits;
3. agent consumption of an RDF serialization versus equivalent JSON information,
   with any authoring/feedback differences explicitly scoped and controlled.

A bounded experimental adapter is an instrument, not the selected service stack.
Temporary standard RDF tooling does not supersede the Scala intent. RDF does not
require silently replacing PostgreSQL or the shared hybrid retrieval library with
a triplestore/SPARQL endpoint; any material architecture tradeoff needs a separate
explicit decision. No production data, migration, deployment or fixture application
construction is authorized by an encoding experiment.

RDF/SHACL conformance, named-graph labels and ontology terms cannot authenticate a
human act, prove entailment, discover all missing context or establish human efficacy.
