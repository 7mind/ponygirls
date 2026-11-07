# Data structure and MCP API candidate

**Primary reference for the current structure/API candidate.** Saved at the user's
request from the schema summary presented on 2026-11-07. This designation makes the
candidate easy to find; it does not finalize a production schema or authorize
implementation, migration or deployment.

There are **two layers**: the proposed production contract and the concrete Pilot-U
implementation. They are not identical. M1 remains an additional unimplemented
design candidate; its proposed memory extensions are not silently included here.

## 1. MCP schema

### Proposed production surface

```typescript
graph_find(filter, page)
graph_read(targets, include, page)
graph_apply(request_id, expected_heads, operations)
```

The production tool envelopes and filtering types are **not yet a finalized JSON
Schema**. See [service intent](mcp-service-intent.md).

### Concrete Pilot-U surface

The following is compact explanatory notation. The linked implementation and
JSON-Schema generator define the exact experimental wire contract.

```typescript
graph_find({
  kind: string,
  query: string,             // ≤128 characters; literal substring search
  cursor: string | null,
  limit: integer            // 1..32
})

graph_read({
  view: "current" | "history" | "binding_context",
  targets: Ref[],            // unique; ≤64
  cursor: string | null,
  limit: integer            // 1..32
})

graph_apply({
  request_id: string,        // [A-Za-z0-9_.:-]{1,128}
  expected_generation: integer, // snapshot CAS, NOT production expected_heads
  operations: Operation[]   // 1..32; atomic and idempotent
})
```

All fields are required; extra fields are rejected. Pagination must retain
identical arguments; generation changes invalidate cursors.

**Mutation operations:**

| `op` | Fields besides required `alias` |
|---|---|
| `create` | `kind, content, scope` |
| `revise` | `ref, content, scope` |
| `relate` | `kind, from[], to[], detail, why, scope` |
| `revise_relation` | `ref, from[], to[], detail, why, scope` |
| `bind` | `definition, context[], select` |
| `state` | `subject, previous, phase, result, resolution, evidence[], uncertainty` |

Revisions replace complete content, not partial fields. `new:alias` references an
earlier operation in the batch. Physical artifacts come from controlled
capture/execution, not arbitrary `create artifact` calls.

Local experimental sources:
[tool declarations](/home/pavel/work/epistemics-pilots/runner/tools_u.ts) and
[JSON-Schema generator](/home/pavel/work/epistemics-pilots/runner/schema_u.py).
These paths refer to the separate research checkout, not a deployed MCP service.

## 2. Data schema

### Record structure

Compact structural notation, not a complete compilable TypeScript definition.
`Ref` denotes an exact immutable record reference; `EntityId` denotes stable entity
identity. `Content<Kind>` and `RelationDetail` are expanded by kind below and by the
linked experimental field definitions.

```typescript
type Provenance = {
  contributor: Ref;
  recorder: Ref;
  input: Ref;                 // input receipt
};                            // system-sealed, not caller-supplied

type Definition = Provenance & {
  ref: Ref;
  type: "definition";
  entity: EntityId;            // stable identity
  revision: integer;
  kind: Kind;
  scope: string;
  content: Content<Kind>;
};

type Relation = Provenance & {
  ref: Ref;
  type: "relation";
  entity: EntityId;
  revision: integer;
  kind: RelationKind;
  from: Ref[];
  to: Ref[];
  detail: RelationDetail;
  why: string;
  scope: string;
};

type Binding = Provenance & {
  ref: Ref;
  type: "binding";
  definition: Ref;
  context: Ref[];
};

type StateEvent = Provenance & {
  ref: Ref;
  type: "event";
  subject: Ref;                // binding
  previous: Ref | null;
  phase: "planned" | "active" | "blocked" | "completed" | "cancelled";
  result: "fulfilled" | "not_fulfilled" | "inconclusive" | null;
  resolution: string | null;
  evidence: Ref[];
  uncertainty: string;
};
```

Supporting records are **Actor** (`actor_kind`) and **Receipt**
(`contributor, recorder, input_digest`), each with its own record reference/type.

### Definition content

Every kind includes `text`; additional current experimental fields are:

| Kind | Additional content |
|---|---|
| `outcome` | `acceptance[], acceptance_question, force` |
| `constraint` | `polarity, force` |
| `task` | `acceptance[], acceptance_question, execution` |
| `statement` | `modality` |
| `hypothesis` | `prediction` |
| `defect` | `observed, expected, reproduction, affected[], correction` |
| `question` | `alternatives[], answer, escalation` |
| `decision` | `alternatives[], rationale` |
| `review` | `findings[], subjects[], basis[], uncertainty, assessment` |
| `source` | `context[], raw_digest` |
| `artifact` | `digest, media_type, locator` |
| `conflict` | `subjects[], status, resolution, uncertainty` |

Important enums:

- `force`: `required | preferred | unresolved`
- `execution`: `delegated | human_required`
- `correction`: `implementation | interpretation | intent_change | mixed | unresolved`
- Review `assessment`: `unassessed | supported | contradicted | mixed`
- Question `escalation`: `none | human_required | unresolved`

Acceptance is either nonempty clauses or an explicit unresolved question—not an
implicit empty acceptance.

### Relations

```text
quotes, interprets, infers, assumes, supports, challenges
adopts, chooses, delegates, supersedes, withdraws
contributes_to, depends_on, requires, decomposes, assigned_to
planned_output, produced, answers, assesses
```

Typed relation details distinguish:

- `depends_on`: completion versus fulfillment; current versus historical consumption.
- `decomposes`: joint (`all`), alternative, or navigation grouping.
- `delegates`: bounded actors, operations and outcomes.
- `adopts` / `chooses`: exact presentation and interpreted-account versus
  captured-action origin.

**Central invariant:** definition, governing-context binding, work progress,
factual warrant, and Human adoption are separate. There is no universal `verified`
or `done` field.

Sources: [shared schema](cq4-node-schema.md),
[semantics](cq4-unified-graph-semantics.md),
[review checkpoint](schema-intent-review.md),
[experimental contract](experimental-contract-t1.md), and
[concrete field definitions](/home/pavel/work/epistemics-pilots/runner/graph_t.py).
This overview does not replace the detailed invariants or the exact wire schema.
