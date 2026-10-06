# TASS: Target/Actual State Separation

Use TASS to build controllers for systems whose state is observed indirectly
and changed through commands that may be delayed, duplicated, rejected, or
have no observable effect.

TASS makes epistemic gaps between intent, command execution, observations, and
physical state explicit; it prevents decisions from treating missing or
insufficient evidence as established knowledge.

The governing rule is:

```text
target intent != command attempt != observation != inferred convergence != decision
```

Do not write a command into actual state. Do not treat a matching value as
confirmation until the observation is applicable to the current target. Do
not turn missing evidence into a diagnosis of actuator failure.

## Establish the Boundary

Before changing a controller, identify:

1. controllable entities and read-only observations;
2. target sources and precedence rules;
3. command transports and their delivery guarantees;
4. observation sources, ordering information, and correlation capabilities;
5. persisted records, derived views, and clock semantics;
6. safety constraints and the conditions under which doing nothing is allowed.

State material assumptions when the transport or device protocol cannot
establish ordering, correlation, or delivery. Do not silently promote those
assumptions into observed facts.

TASS is unnecessary for local state with a single authoritative writer and no
independently observed external process. A normal state machine is sufficient
there.

## Separate the Epistemic Layers

Keep these layers distinct in code, logs, tests, and explanations:

| Layer | Meaning |
|---|---|
| Physical state | What the external system is actually doing; ordinarily not directly available to the controller. |
| Evidence | Accepted observation records and their provenance. |
| Inference | Derived freshness, applicability, convergence, aggregates, and diagnoses. |
| Decision | A rule that authorizes a command, evidence request, deferral, or fault response. |

In TASS, `actual` means an accepted observation or an explicitly derived view
of observations. It is not observer-independent physical state. Declare each
view's question and dependencies. Keep target-independent last-observed state
separate from target-relative applicability and convergence.

Recomputation may change a derived view without adding or retracting evidence.
It must not rewrite the underlying observation records.

## Persist Records; Derive the Entity View

Prefer primary records similar to the following domain types:

```text
TargetRecord
  entity
  targetRevision
  value
  source
  setAt

CommandAttempt
  entity
  targetRevision
  attemptId
  command
  plannedAt
  dispatchState

ObservationRecord
  observationId
  entity
  value
  source
  observedAt
  receivedAt
  sourcePosition
  correlation
  validation
```

Represent unavailable protocol information explicitly, for example
`Unsequenced` rather than a fabricated sequence number and `Uncorrelated`
rather than an absent required value.

Derive the convenient entity view from these records, the current clock,
knobs, and topology:

```text
EntityView
  target
  latestObservedObservation
  latestApplicableObservation
  freshness
  convergence
  outstandingCommand
  retryDue
```

The view may be cached, but it must be reproducible from its declared primary
inputs. If the implementation stores a derived value, record enough revision
information to detect an invalid cache.

### Target Revisions

Every active target has a revision. Increment it whenever a change can
invalidate a prior command, confirmation, or decision: value, tolerance,
owner precedence, deadline, or another material target condition. An
identical request may retain the revision only when the domain defines it as
idempotent in every material respect.

A target change supersedes command attempts for earlier revisions. This is
logical supersession, not cancellation of effects already sent to the external
system. It does not mutate or invalidate the factual content of earlier
observations.

Allow explicit target release when the domain supports relinquishing control.
Do not encode “no longer controlling” as a neutral target such as `Off` unless
the domain defines those states as equivalent. No target also does not prove
that passive behavior is safe; independent safety obligations may remain.

### Observations

Preserve at least the distinction between:

- when the source says the state was observed;
- when the controller received the record;
- the source's sequence or revision, when available;
- correlation with a target revision or command attempt, when available;
- whether boundary validation accepted, rejected, or could not resolve it.

Receiving a record later does not make its observed state later. Do not let a
retained, duplicated, or out-of-order message replace a newer observation
merely because it arrived last.

Scope source positions to a declared stream and incarnation, such as a device
boot or producer epoch. A sequence reset after restart is not evidence that
the new reading is older. Do not compare counters from independent streams or
incarnations as though they shared an order. Declare how incarnation changes
are established and how delayed records from prior incarnations are handled.
If the protocol cannot establish that order, preserve the uncertainty.

Define dominance and merge rules before selecting a latest observation. For
incomparable sources, use an explicit precedence or fusion policy, or retain
an unresolved result; do not fabricate a total order.

Observation acceptance, abstract recomputation, and evidence retraction are
different operations:

- acceptance adds a validated record;
- recomputation changes a derived view while retaining the evidence;
- retraction withdraws previously accepted evidence under an explicit policy.

Do not implement retraction by silently deleting whichever reading obstructs
the desired decision.

## Freshness, Applicability, and Convergence

Do not combine these concepts in one state machine.

### Freshness

Freshness measures age relative to a domain threshold:

```text
Freshness = Unknown | Fresh(age) | Stale(age)
```

Declare the age basis. Measurement freshness requires a validated observation
time or a protocol-established age bound. Receipt freshness measures only time
since receipt; it does not establish measurement freshness. If measurement age
cannot be established, report `Unknown` for that question. When only an age
bound is available, use a conservative bound and expose that basis.

Fresh does not mean reliable, ordered, correlated, or true. Stale does not
mean false. Associate freshness with an identified observation, threshold, and
age basis. At a fixed clock and policy, target changes do not alter that
observation's freshness, although a target-relative view may select a different
observation or none.

### Applicability

Applicability states whether an observation may answer a particular question:

```text
Applicability = Applicable(basis) | Inapplicable(reason) | Unresolved(reason)
```

Applicability is question-relative. A pre-command observation may be usable
for “what was last observed?” while being unusable for “was this command's
effect observed?” A protocol may establish applicability through a command
identifier, target revision, source sequence, trustworthy observation time,
or a documented weaker assumption.

If the protocol supplies none of these, report the correlation limit. Arrival
after a command alone does not establish that the observation was produced
after the command.

### Convergence

Derive convergence only from the current target and observations applicable
to the convergence question:

```text
Convergence =
  NoTarget
  | Indeterminate(reason)
  | Matching(targetRevision, observationId)
  | Mismatching(targetRevision, observationId)
```

Matching means that a qualifying observation satisfies the target's declared
comparison rule. It does not by itself prove that the command caused the
state. Keep transport acknowledgment, command-effect observation, and target
convergence separate when the distinction matters.

A newer applicable mismatch under the declared observation ordering must end
convergence and re-enter reconciliation. A delayed, dominated mismatch must not
reopen reconciliation merely because it arrived after convergence.

Correlation with an older command revision does not by itself make an
observation irrelevant to current state. A newer observation of a superseded
command's delayed effect can establish drift from the current target without
confirming that target's command attempt.

Do not leave an entity permanently `Confirmed` after observed drift. Prefer
`Converged` or `Matching` to “system at rest”: future stability requires a
separate decision over a declared horizon.

## Decisions and Effects

A core is a pure transition function:

```text
core(event, ledgerSnapshot, knobsSnapshot, clock, topology)
  -> (effects, ledgerUpdates, diagnostics)
```

No I/O occurs inside a core. All required inputs are explicit. The core may
return:

| Outcome | Meaning |
|---|---|
| `Quiescent(until, basis)` | Deferring corrective action is justified until a declared horizon. |
| `RequestEvidence(question)` | Acquire evidence relevant to a current decision. |
| `Execute(command, targetRevision, snapshotRevision)` | Issue an operational effect for the indexed target and decision inputs. |
| `Undecided(reason)` | Available evidence or procedure does not authorize a stronger conclusion. |
| `Fault(kind)` | Evidence, protocol, storage, or runtime invariants were violated. |
| `Infeasible(scope, basis)` | No admissible policy in an explicitly declared scope can satisfy the target. |

Most controllers should use `Undecided` or `Fault` when retry or search limits
are exhausted. Use `Infeasible` only when the stated policy scope was actually
exhausted; a timeout or unsupported operation is not an impossibility result.

Classify effects by purpose:

- **Epistemic:** request a sensor refresh, run a diagnostic, or acquire another
  observation.
- **Operational:** command an actuator or change an external target.
- **Coordination:** schedule or cancel a timer.
- **Publication:** expose state or diagnostics to another component.

An epistemic effect may also perturb the world. A diagnostic that cycles a
relay is both evidence-seeking and operational and must satisfy the same safety
constraints as ordinary actuation.

### Quiescence

Returning no command is not evidence that doing nothing is safe. A quiescent
decision must account for:

- the current effective target;
- convergence and evidence validity;
- freshness expiry before the next reconciliation;
- scheduled timers and pending target changes;
- expected disturbances and relevant safety constraints;
- an explicit reevaluation horizon.

Revalidate the decision when any indexed target, evidence, knob, topology, or
safety input changes.

## Command Dispatch and Retry

Returning a command effect, persisting it, dispatching it, receiving a
transport acknowledgment, and observing its external effect are distinct
events. Represent only the events the runtime can actually observe.

Before dispatch, revalidate the effect's target revision and indexed decision
inputs, including clock-dependent validity and safety constraints. Cancel
undispatched effects for superseded or released targets and reconcile again
when their authorization is no longer valid. Coordinate this check with target
and policy updates through a serialized handoff or a declared concurrency
policy; an unchecked gap between validation and dispatch permits a stale effect
to escape. A storage transaction does not make external actuation atomic.

Commands already dispatched may still execute after supersession or release.
Declare transport ordering and any actuator-side fencing or cancellation
capability. Idempotence makes repeated execution equivalent within its declared
scope; deduplication suppresses repetition within its key scope. Neither
prevents an obsolete command from overriding a newer one. Without effective
fencing or cancellation, expose the residual in-flight uncertainty and define
an evidence, reconciliation, or safety response rather than claiming that
supersession revoked the command.

Where possible, persist command intent and an outbox entry atomically, then
dispatch idempotently. Even with an outbox, define crash recovery for both
windows:

- state persisted but command not dispatched;
- command dispatched but dispatch state not persisted.

A pending outbox entry after restart does not prove that its command was never
sent. If recovery cannot distinguish these windows, preserve dispatch
uncertainty. Revalidate authorization before replay and apply the declared
fencing or uncertainty policy; canceling an entry does not revoke a command
that may already be in flight.

Every retry policy must declare:

- attempt deadlines and backoff;
- a stopping or escalation condition;
- whether the command is idempotent or carries a deduplication key;
- applicable rate, wear, and safety limits;
- when to request evidence instead of reissuing actuation;
- how a new target revision supersedes outstanding attempts.

Do not make unbounded retry the generic default. It is admissible only when
repetition remains safe and bounded in effect under explicit domain
assumptions.

Use the normal observation path to evaluate convergence after a command. Do
not create a second fictitious truth channel. However, absence of a qualifying
observation does not identify the cause: the command may be delayed or lost,
the actuator may have failed, the observation may be delayed or lost, or an
external actor may have changed the state. Retry policy is a decision under
that uncertainty, not a diagnosis.

## Ledger, Knobs, and Time

Keep primary ledger state separate from derived views.

Primary state normally includes:

- target set, supersession, and release records;
- command attempts and observable dispatch transitions;
- accepted observation records and required provenance;
- timer registrations and firings;
- explicit faults, retractions, and decision records needed for audit.

Derived state normally includes:

- current target and outstanding attempt;
- latest applicable observation;
- freshness, applicability, and convergence;
- retry deadlines and cross-entity aggregates;
- UI projections and reconciliation status.

Retain rejected or unresolved observations when they are needed to diagnose
boundary failures. Apply an explicit retention policy rather than assuming an
unbounded event history.

Keep user-modifiable knobs outside the controller-owned ledger. Record the
knob revision or input snapshot used for a decision when later audit or
revalidation requires it. If a knob changes desired state rather than merely
decision policy, model the resulting effective target explicitly instead of
hiding intent inside a parameter.

Use monotonic time for live deadlines and backoff. Use a persistable civil or
epoch timestamp for audit records. A process-local monotonic instant cannot be
restored meaningfully after restart; recovery must recompute deadlines under a
declared policy. Treat device-provided timestamps as untrusted until the
protocol establishes clock quality.

## Multi-Entity Controllers

A core may derive one entity's target from observations of other entities.
Record the source and inputs of that derivation so that ownership and
causality remain inspectable.

When cores form a DAG:

- declare every read and write dependency;
- evaluate a tick against a coherent snapshot or define merge/conflict rules;
- prevent downstream cores from reading a mixture of old and new upstream
  revisions;
- reject dependency cycles or implement them as an explicit iterative
  reconciliation algorithm with a termination policy.

Do not mutate user intent through controller-owned bookkeeping. Do not let a
user write derived ledger state directly.

## Validation and Failure Policy

Validate observations, commands, and target requests at system boundaries.
Fail fast on internal invariant violations.

If accepted evidence is contradictory or its consistency cannot be resolved,
do not exploit the contradiction to authorize arbitrary action. Return an
observable evidence fault, request relevant evidence, or execute a separately
declared conservative safety policy. State the residual uncertainty.

Do not invent numerical confidence. If the system uses probabilistic sensor
fusion, identify the model, inputs, calibration, and decision threshold. A
decision threshold authorizes action under that model; it does not make the
inferred state certain.

## Testing

Put most controller tests in Behavioral-Active Blackbox Atomic or Group form:
drive the public core interface with event sequences and assert returned
effects, public entity views, and diagnostics. Use a deterministic clock.

Property- or model-based sequence tests should cover these invariants:

1. Setting or releasing a target never rewrites observation records.
2. Returning, enqueueing, or dispatching a command never fabricates observation
   evidence or overwrites last-observed values. Derived observation views may
   recompute when their declared command-related inputs change.
3. Only explicit evidence transitions change the accepted evidence set.
   Derived views may change when their declared inputs change, but recomputation
   never rewrites observation records.
4. A superseded target revision cannot be confirmed by an old command attempt.
5. A retained, duplicated, or out-of-order observation cannot replace a newer
   applicable observation.
6. A matching but inapplicable observation cannot establish convergence.
7. A newer applicable mismatch under the declared observation ordering reopens
   reconciliation; a delayed, dominated mismatch does not.
8. Freshness decay changes no observation value. At a fixed clock, threshold,
   and age basis, target changes do not change a given observation's freshness.
9. Retry respects idempotence, deduplication, deadlines, stopping conditions,
   and supersession.
10. Retry exhaustion produces the declared escalation, not fabricated
    infeasibility or success.
11. Quiescence expires and is revalidated when an indexed input changes.
12. Contradictory or unresolved evidence follows the declared failure or safe
    policy.
13. Crash recovery follows its declared replay policy; uncertainty around a
    non-idempotent effect is surfaced rather than silently replayed.
14. Queued effects are revalidated before dispatch. Supersession or release
    cancels undispatched attempts; delayed in-flight effects follow the declared
    fencing or uncertainty policy.
15. Source restarts, incomparable source positions, and unknown measurement
    age follow their declared ordering and freshness policies.

Put transports, clocks, persistence, and device protocols behind narrow
interfaces. Write one black-box contract suite and run it against both:

- a small hand-written in-memory dummy for fast deterministic runs;
- the production adapter with a controllable broker, database, filesystem, or
  device simulator for full verification.

The production leg is a communication test, not a substitute for the cheap
core suite. If its environment is unavailable, mark it explicitly skipped;
full-verification CI must fail if a required production leg is skipped.

Add targeted production-adapter tests for exact transport semantics that a
dummy should not imitate: retained delivery, duplicate delivery, reconnect
ordering, broker acknowledgment, persistence crash windows, stale outbox
entries, delayed superseded effects, source restarts, and concurrency.
Prefer behavioral assertions over call-sequence mocks. Use an interaction mock
only when the interaction protocol itself is the behavior under test.

## Review Checklist

Before completing TASS work, verify:

- target, command, observation, inference, and decision are not collapsed;
- every target and command attempt has sufficient revision identity;
- freshness is separate from validity and applicability;
- confirmation states its comparison and applicability rules;
- observed drift is represented and triggers reconciliation;
- retry safety and stopping behavior are explicit;
- quiescence has a horizon and invalidation inputs;
- primary records and derived views are classified consistently;
- persisted and monotonic time are not confused;
- command dispatch revalidates authorization and has explicit crash,
  duplication, ordering, and superseded in-flight effect semantics;
- tests cover event reordering, supersession, drift, retry, and restart;
- claims are limited to the transport, evidence, and policy scope actually
  checked.

Do not import theorem-prover machinery, arbitrary semantic predicates, or
proof certificates into an ordinary controller merely because they inspired
these constraints. Use formal artefacts only when the project requests them or
the safety case requires machine-checked assurance.
