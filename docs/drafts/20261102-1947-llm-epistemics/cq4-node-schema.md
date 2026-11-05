# CQ4: compact epistemic nodes

**Recommendation:** one grounds-first record; no mandatory Goal/Milestone hierarchy
or agent-authored role/standing/warrant roll-ups. Permit changed-field revisions.
This is a design preference with bounded feasibility evidence, **not an empirical
schema winner, production implementation or migration plan**.

CQ4 already has protected evidence origins, authenticated mutation provenance,
revision-pinned reviews and support/contradiction links. Its epistemic layer is
**incomplete, not absent**. Preserve those protections and its concurrency /
transactional guarantees. [Pinned source review](cq4-source-review.md).

## Agent-authored record

```typescript
type Node = {
  kind: "statement" | "task" | "defect" | "hypothesis" |
        "question" | "decision" | "review";
  text: string;
  scope: string;
  state: "open" | "closed" | "withdrawn";
  grounds: Ground[];
};

type Ground = {
  rel: "quotes" | "interprets" | "adopts" | "delegates" |
       "chooses" | "assumes" | "infers" | "supports" | "challenges";
  from: Ref[];
  why: string;
};
```

`Ref` is a system-provided immutable source/context handle, exact node revision or
content-bound artifact reference—not a floating current head or file path.
Stable untyped ID, revision, authenticated mutation audit, source capture and
history are **system-owned**, not agent-authored epistemic verdicts.

- **kind:** semantic use, not pipeline stage. Positive desired outcomes are
  statements, not discarded because there is no Goal class. Task acceptance/results,
  defect observed/expected/reproduction and hypothesis resolution remain explicit
  in text, assisted by templates rather than fourteen wire shapes.
- **scope:** applicability, conditions and material limits. Preserve governing
  purpose, artifact role, authorized phase and exit criterion through exact source
  context; fixture requirements do not authorize building the fixture.
- **state:** lifecycle only. Closure records its resolution—success, failure,
  refutation or inconclusiveness—and residual uncertainty in text/grounds. Closed
  does not mean true, approved, implemented or verified. Withdrawal is not success.
- **grounds:** attributed accounts, not proofs. Formulation/source lineage, later
  adoption, delegated means and factual warrant remain distinct. An agent proposal
  can become adopted without becoming originally human-authored. Adoption does not
  establish truth or actual execution; chosen means cannot redefine outcomes.

One `infers.from` array contains joint premises; separate inference grounds are
alternative routes. Other relations have one reference; immutable context retains
proposal/answer association. Losing one route does not remove independently grounded
intent or automatically defeat an alternative. References alone do not establish
entailment, human consent or evidence applicability.

## Mutation and graph rules

```text
create(record) -> allocated exact reference
revise(exact_ref, changed_fields, reason) -> new exact reference
```

Omitted fields survive; supplied arrays replace explicitly. Supplying all fields is
allowed. Stale revisions fail rather than silently merge. The service owns atomicity,
request identity/replay and immutable history. A ground change revises its declaring
record, not another statement's authorship. Optional worksets/groupings are query views,
not mandatory containers or execution-admission facts.

Agents cannot manufacture privileged Human/Host source origins. Keep CQ4's actual
authentication, collector-controlled evidence paths and exact review applicability;
model text quoting an operator is not an operator act. OperatorAction may share Task
shape only if human action, confirmation and observed completion remain separately
enforced. Lossless migration of all existing ledger behavior is unproven.

Exact backward revision references give a **revision-reference DAG**, not necessarily
a noncircular justification. A2 ← B1 ← A1 can recycle an unsupported premise. No truth
propagation, complete dependency discovery or readiness rule follows from typed edges.
Logical-cycle and joint/alternative reasoning efficacy remain untested here.

## Why this recommendation is bounded

Pilot Q froze 24 four-stage sessions: **19 valid, five retained operationally invalid**,
no replacements. Original readers and later source-based adjudication remain separate.
All arms exhibited or left room for unsupported inferences; required roll-ups also
contradicted binding requirements in two faceted sessions. No semantic advantage or
equivalence was established. There were no fully adequate FR–GR resource pairs.

Three adequate GR–GA pairs showed mixed resources: two publisher pairs used fewer
mutation bytes/tool calls/reported total tokens with amendment; the CSV pair used
more. Thus expose amendment without promising universal savings. A smaller required
surface is a design choice, not a human-attention, model-family or global-optimality
result. Full evidence: local `~/work/epistemics-pilots/results/pilot-q/report.md` [J30].

Ideas/Memories can use Statements/Decisions; Research/Upstream work can use Tasks with
linked findings; Handoffs can use statements plus remaining work. Keep these as
proposed mappings, not proof that every CQ4 status, dispatch or operational role is
safely replaced. CQ4's existing `Claim` is a concurrency lease, not this epistemic
statement. Source snapshot: `4d9b44aec6f7360abd448bb3412733449386c5e1`.
