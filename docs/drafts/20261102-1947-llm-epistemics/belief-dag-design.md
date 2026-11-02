# Belief DAG: format, invariants and dialogue — design draft

Status: draft for review; documentation only, nothing built. Design half of
decision Q11 (belief-DAG format and dialogue, with a pilot specified
separately). Sources: [journal](journal.md) J4–J10, [hypotheses](hypotheses.md),
[references](references.md). Uncited statements are design proposals; effect
claims are hypotheses. Open choices are marked **OC-n** and listed in §11.

## 1. Purpose and scope

The human interfaces with agents through a compact, high-level *belief DAG*
of goals, domain assumptions, key decisions and obstacle resolutions in the
human's vocabulary (B1, J10). Spec, code, tests and evidence form an *agent
layer* the human does not read routinely; tooling checks it against ratified
beliefs and reports alarms, a capped queue and one audit item (J5, J6).
Beliefs hold R and W, the hidden spec is S, the agent layer carries
S ∧ W ⊢ R [R51]; refinement and obstacles follow goal-oriented RE [R52];
claims, evidence and defeaters follow assurance cases [R53, R47]. The novelty
is economic (hypothesis, J10): agents make that layer cheap to maintain.

Design aims: (A1) the human ratifies beliefs, not spec items, tests or code;
(A2) every agent-layer artefact is accountable to a belief or a recorded
decision; (A3) the human-facing surface is bounded per component and per
change; (A4) nothing below a ratified belief settles a conflict with it (the
J10 field instance is the counterexample A4 answers).

Non-goals: a requirements-management tool or full KAOS/GSN notation; a
whole-graph visualisation (J6, [R49]); mandatory formalisation (it is per node
and proportional to risk, J7 mitigation 2); defence against an adversarial
agent (threat model: J2's imitative, goal-pressured, non-adversarial agent);
replacing J2 test ratification (J2-ratified tests stay, as agent-layer
evidence ranked below beliefs, §3); any efficacy claim. The Q11 pilot tests
H-T5 on example §9a, B2 on example §9b, whether the dialogue caps hold at
belief level, and the M1 measures of §8.

## 2. Data model

### 2.1 Node kinds

Common fields: `id`, `kind`, `component`, `origin` ∈ {human, agent:<model
family>, imported}; imported legacy artefacts have authority `unknown` (J2).

| Kind | Layer | Meaning | Required fields |
|---|---|---|---|
| goal (R) | human | optative property of system or world, one observable sentence [R51] | `statement`, `observers`, `failures` (scope of the claim), `scenarios` (2–3 before ratification) |
| assumption (W) | human | indicative property taken as given; where unstated beliefs hide (J10) | `statement`, `guarantor` (who or what makes it true), `monitor` (how a violation would be noticed, or `none`) |
| decision | human | choice among alternatives that constrains refinement; includes disclosed agent defaults (J4) | `statement`, `alternatives` (≥1 rejected), `rationale`, `consequence` (low/medium/high) |
| obstacle | human | condition under which a goal or assumption fails [R52] | `statement`, `obstructs`, `resolution` ∈ {handled, assumed-away, accepted-risk, open}, `resolved_by` unless open or accepted |
| obligation | agent | checkable refinement: what the machine must do (part of S) | `statement`, `refines`, `check` (how it is falsified), optional `formal` (artefact path) |
| evidence | agent | result of an attempted falsification | `method`, `target`, `oracle_author`, `artefact`, `subject_digest` (code checked), `result`, `negative_control` |
| spec item | agent | interface, protocol step, data format | `text` or `ref`, `traces_to` |
| code reference | agent | path plus symbol or region | `ref`, `traces_to` |

A scenario is a given/when/then trace in observable terms, stored as a field
and covered by the node's digest (**OC-1**: separate nodes instead).

### 2.2 Edge kinds

| Edge | From → to | Semantics |
|---|---|---|
| `refines` AND | child goal or obligation → parent goal | children together with the group's `assumes` entail the parent |
| `refines` OR | alternative groups → parent goal | exactly one group is `chosen`; the group records the deciding decision (`by: <id>`) |
| `assumes` | goal, obligation or refinement group → W | the entailment holds only under W |
| `obstructs` | obstacle → goal or W | if the obstacle occurs, the target is false |
| `resolves` | goal, W, decision or obligation → obstacle | handles the obstacle, assumes it away, or decides on it |
| `contradicts` | any ↔ any | recorded conflict; written by tooling (failed check) or by the agent (tension detection) |
| `evidences` | evidence → obligation, goal or W | `pass` supports, `fail` contradicts |
| `traces-to` | spec item, code reference, test, obligation → obligation, goal or decision | upward accountability |

All edges except the symmetric `contradicts` must be acyclic.

### 2.3 Asserted fields and derived status

*Asserted* (versioned text by a person or an agent): kind, statement,
scenarios, edges, resolution, evidence records, ledger entries (human only,
§3). *Derived* (computed, never stored as truth or hand-edited), as in J6,
following a justification-based truth maintenance system [R48]:

| Axis | Values | Computed from |
|---|---|---|
| authority | ratified · stale · proposed · rejected · unknown | latest ledger entry for the id versus the current digest (§7) |
| formalisation | informal · scenario-backed · formal | informal: statement only; scenario-backed: ≥2 ratified scenarios; formal: a refining obligation has a formal artefact that replays every ratified scenario (**OC-14**) |
| evidence strength | none · tested · fault-injected · model-checked | strongest passing, non-stale, independent evidence on the node or its chosen refinement; fault-injected (implementation) and model-checked (model) shown side by side, not ranked (**OC-3**) |
| independence class | human · human-ratified · other-family · mechanical · same-generator | author of the *oracle*, not the executor: a fault injector running an agent-phrased oracle is same-generator; mechanical = generic oracle (type checker, sanitiser, mixture checker derived from a ratified scenario) (**OC-2**) |
| support | supported · unsupported · contradicted | contradicted: a failing evidence or `contradicts` edge on the node; supported: chosen refinement complete, assumed W not violated, every obstacle resolved, every leaf obligation has passing independent evidence; otherwise unsupported |

Only evidence whose oracle class is not same-generator raises the evidence
strength of a ratified node; same-generator evidence is shown as a change
detector, outside the bridge to intent (J4, C8).

## 3. Invariants enforced by tooling

| # | Invariant | Enforcement | On violation |
|---|---|---|---|
| I1 | Agents never ratify, reject or retract; only a human-invoked command appends to the ledger. | ledger path write-guarded by a harness `tool_call` handler [L3]; pre-commit and turn-end checks as backstop for shell edits (J6) | commit refused; alarm |
| I2 | Precedence: no spec item, test, docstring, comment or observed behaviour outranks a ratified belief, and none is evidence of intent. | policy text; `contradicts` derivation; report check (**OC-12**) | alarm; the agent may argue the belief is wrong but escalates (symmetric non-authority, J2) |
| I3 | Traceability: every agent-layer element of consequence has a `traces-to` path to a goal, W or decision. Orphans become proposed candidate decisions; only consequential ones enter the queue (J5 attenuation criterion). | trace check per change (**OC-10**) | candidate decision, else a count |
| I4 | Digest binding: a ratification binds a digest of the node's normalised content; any later edit makes the node stale until re-ratified; evidence bound to an older subject digest stops counting. | digest recomputed on every check | stale ratified node is an alarm |
| I5 | Retraction propagates: rejecting, retracting or staling a node marks its dependents (children, nodes assuming it, obligations and evidence tracing to it) unsupported until re-verified [R48]. | propagation on every check | dependents appear in the next delta |
| I6 | Caps (§4, §5) hold; exceeding one is a defect report and splits the change (J7 mitigations 1, 3). | lint | defect report, never a longer view |

Precedence (entrenchment, J5), highest first: (1) ratified human-layer nodes
and scenarios; (2) ratified agent-layer items, e.g. J2-ratified tests; (3)
`unknown` legacy items; (4) everything proposed or agent-written, including
spec, tests, docstrings and current behaviour. A lower level never settles a
conflict with a higher one. Conflicts within (1) or between (1) and (2) are
alarms for the human (**OC-13**); within (4) J2's rule applies (resolve and
report when a higher item settles it, otherwise ask).

## 4. Layers and compactness

*Human layer*: goals, W, decisions, obstacles with resolutions and scenarios,
plus derived badges; default ≤12 nodes per component, ≤7 of them goals
(**OC-4**). A parent component sees a child only through the goals and W the
child exports (information hiding [R40]). Working memory holds about four
chunks [R18]; views show ≤7 rows, grouped by goal. *Agent layer* (hidden):
obligations, spec items, code references, evidence, unratified tests, trace
links, orphans below the consequence threshold. It surfaces only through
alarms, queue items, the audit path or a neighbourhood view at depth 2.

Views (refining J6; no whole-graph view):

| View | Content | Bound |
|---|---|---|
| ranked queue (primary) | alarms (algedonic: contradicted or stale ratified nodes, failed falsification, violated W monitor, missed prediction), each one line; then candidate decisions, tensions, B2 disagreements and open obstacles ranked by consequence and proximity to ratified nodes (**OC-11**); then one audit item; then counts | ≤7 non-alarm items per change (J7) |
| per-change delta | human-layer nodes whose derived status changed (before → after per axis), new candidate decisions, stale ratifications, prediction hits and misses | human-layer nodes only |
| neighbourhood | one node with parents, children, W, obstacles and decisions at depth 1, obligations at depth 2; impact set: what retracting it would leave unsupported | ≤7 rows per depth |
| coverage map | per component or directory: share of code references tracing to ratified beliefs, to proposed nodes only, or to nothing | one row per component; table, not node-link [R49] |

Queue items render as "when X, then Y" claims with ids and one-letter exits
(§5), never as code (J2 point 5, [R43]).

## 5. Dialogue protocol: from a prompt to a ratified belief set

Stages S0–S7 precede generation; generation starts when every goal in scope is
ratified or explicitly deferred.

| Stage | The agent | Cap per round (**OC-5**) |
|---|---|---|
| S0 intake | reads the prompt and the ratified neighbourhood of the affected components | — |
| S1 restate | restates the prompt as candidate goals in the human's words; maps each to existing nodes (reuse, revise, new); names what is out of scope | ≤5 new nodes |
| S2 refine | asks questions whose answers change a scenario outcome or a W, e.g. "atomic for which observers, under which failures?" (J10) | ≤3 questions |
| S3 obstacles | proposes obstacles per goal from catalogues — quality characteristics [R59], quality-attribute scenarios [R60], the user's skills — each with a proposed resolution kind | ≤3 shown per goal; rest counted |
| S4 tensions | checks small sets of beliefs for joint unsatisfiability ("atomic" + "lock-free" + "multi-file" + "network filesystem", J10); reports the minimal conflicting set and options | ≤2 |
| S5 assumptions | turns everything the intended refinement relies on but S does not enforce into W, with guarantor and monitor | within the S1 cap |
| S6 scenarios | 2–3 per goal: nominal, failure or boundary, optionally "must not" | 3 per goal |
| S7 ratify | presents the batch; the human answers per node | ≤7 per batch |

At most three rounds before generation; scope still unresolved is split off,
not reviewed at greater length (J7 mitigation 1). Optionally the human records
1–3 predictions before generation (J6 step 1; §8).

**How the agent asks.** One question per item, tied to a node id, in closed
form, with the agent's default and the consequence of each option:

```
Q1 [G-atomic] Atomic under which failures?
   a) process crash (default)
   b) also power loss: adds O-power and an fsync obligation; slower writes
```

An unanswered question leaves its default as a proposed decision. Level
filter (hypothesis, J10, H-T5): a question is admissible only if an answer
changes a scenario outcome or a W; signatures and other spec-level choices
are not asked and become candidate decisions if consequential.

**The agent may not** ratify, reject or retract; edit a ratified node (it
proposes a revision); paraphrase a ratified belief without quoting id and
statement; cite unratified tests, docstrings, comments or current behaviour
as intent; resolve a tension, accept a risk or choose a high-consequence OR
alternative; exceed a cap; ask what the repository can answer. It should
propose alternatives that keep ratified beliefs intact and continue work the
conflict does not touch (J8, cost of the gate; J10).

**Revision flow (J5).** Each conflict between a generated artefact or a check
result and a ratified belief leaves the queue by one exit, with a recorded
reason:

| Exit | Direction of fit | Effect |
|---|---|---|
| ratify | revise the belief: the generated behaviour becomes intended | new or edited node, new digest; the old one is superseded |
| reject | revise the code: the belief stands | the agent adds a belief-level check that fails on the current code, then fixes the code |
| revise intent | the human changes the goal deliberately | edited node, re-ratified; I5 marks dependents for re-verification |

`defer` keeps the item queued and counts against the cap.

## 6. Validating belief → spec refinement while the spec stays hidden

Hiding the spec is sound only if refinement links are checked by more than
the generator's say-so (J10); LLM-written TLA+ was semantically correct in at
most 8.6 % of cases across 30 models [R56].

| Channel | Mechanism | Independence and limits | What reaches the human |
|---|---|---|---|
| V1 traceability | I3 in both directions: a goal without obligations is `unrefined`; an untraced agent element is a candidate decision | mechanical, checks structure, not faithfulness | coverage map; consequential candidates in the queue |
| V2 independent refinement (B2) | a second model family receives only the ratified human-layer nodes and produces obligations plus expected outcomes for each scenario and for edge cases it proposes; tooling localises disagreements to belief ids | other-family; errors correlate across models [R7], so agreement is weak evidence (C4) | a disagreement as one question about the belief (underspecification), not about code |
| V3 belief-level falsification | fault injection, model checking of compact models [R55], property tests phrased in the belief's terms ("kill the process between any two writes; a reader never sees a mixture", J10); obstacles are the defeaters to eliminate [R47] | oracle replays ratified scenarios; a check counts only after it fails on a planted violating variant (negative control) | failures as alarms; passes as badges |
| V4 sporadic audit (System 3*) | per session, one random path belief → obligation → spec → code → evidence among nodes the tooling calls supported, shown directly, bypassing reports (J5, J6) | human | exactly one audit item; findings logged; persistent findings raise sampling (J6 step 6) |

The negative-control rule targets the J10 failure: a test that passes on an
implementation violating the belief is no evidence for it. Depth follows risk
(J7 mitigation 2, **OC-6**): trivial changes V1; standard changes V1 and V3 on
touched beliefs; critical components V1–V4. The human sees alarms, the capped
queue and the audit item; everything else is counts.

## 7. Storage format

Plain text in the repository, reviewable in diffs (J6). Proposal (**OC-8**):

- `beliefs/<component>.yaml` — human-layer nodes. Agents may write proposals
  here; the diff shows them.
- `beliefs/<component>.trace.yaml` — agent layer: obligations, evidence
  records, trace links; regenerable and not routinely reviewed.
- `beliefs/ledger.log` — append-only, write-guarded (I1), one line per act,
  `<utc> <ratify|reject|retract> <id> sha256:<digest> by=<user> [reason]`,
  e.g. `2026-11-03T10:12Z ratify G-atomic sha256:3f9c0a… by=<user>`.

Authority is derived from the ledger and the current digest, so no
ratification marker sits in a file agents edit; this removes J2's laundering
by imitation. The digest is SHA-256 over canonical JSON (sorted keys,
collapsed whitespace) of `kind`, `statement`, `scenarios`, `observers`,
`failures`, `guarantor`, `resolution`, the node's own edges and, for a goal,
the ids in its human-layer refinement. Agent-layer links are excluded, so
regenerating obligations does not stale a belief (**OC-7**).

Example (abridged from §9b):

```yaml
component: config-store
nodes:
  - id: G-atomic
    kind: goal
    origin: human
    statement: An update of the config set {a, b, c} is atomic.
    observers: readers in other processes; the writer after restart
    failures: process crash; concurrent readers   # power loss: see O-power
    refinement: {and: [G-crash, G-isolate],    # children's refines edges
                 assumes: [W-rename, W-onefs, W-readers]}
    scenarios:
      - writer killed after new a, before new b -> reader sees old {a, b, c}
      - reader reads during an update -> all old or all new, never a mix
  - id: W-rename
    kind: assumption
    origin: agent:family-a
    statement: rename(2) on one local filesystem replaces the target atomically.
    guarantor: POSIX filesystem semantics
    monitor: startup check that store and pointer share one device id
  - id: O-power
    kind: obstacle
    origin: agent:family-a
    obstructs: G-crash
    statement: power loss after the rename, before the directory fsync
    resolution: accepted-risk
```

Alternatives: Markdown with YAML front matter per node (room for rationale,
more files); one Markdown table per component (readable, weak structure);
code-comment markers (rejected: imitation, staleness, J2); a database
(rejected: not reviewable in diffs).

## 8. Measures for the human side (replacing raw NASA-TLX)

Raw NASA-TLX did not discriminate in the P-D trial and measures momentary
load, not loss of coherence (J10). Replacements, unvalidated (M1; n = 1):

| Measure | Recorded | Cost per use | Known limits |
|---|---|---|---|
| explain-back [R13] | after a session, from memory, the human lists the component's key beliefs; scored for recall of ratified goals and W, intrusions, contradictions | 2–3 min plus scoring | recall of the ledger, not of the system; practice effects; agent scoring is testimony (C3), self-scoring is biased |
| prediction with confidence | 1–3 questions per change ("killed between writes: what does a reader see?"), answer plus confidence 50–100 %; graded by execution where possible; accuracy, Brier score, calibration over time (J6, P2) | ~1 min per question | agent-chosen questions favour salient points (C13); few items per week give wide intervals |
| resumption lag [R58] | time from return after an interruption ≥ N min to the first action that references a node | none (passive log) | confounded by task and interruption type; "first action" needs a fixed definition (**OC-9**) |
| lost-thread marks | one keystroke when the human notices a lost thread; timestamp and current view; rate per active hour | ~1 s | under-reported exactly under high overload; reactivity |
| belief churn | ratified-node revisions and retractions per week, by exit (§5) and by age at revision | none (ledger) | ambiguous: learning or instability; early revisions may indicate rubber-stamping |
| escapes | defects found later that violate a ratified belief (validation escape) or touch no belief (attenuation escape), with the filter that dropped them | ~5 min triage per defect | rare and late; depends on later discovery |

Rubber-stamping itself is measured by the canary catch rate (§10).

## 9. Worked examples

### 9a. "Background-task notices always wake the harness" (J10 field instance)

Reconstructed from J10's summary only [L6]; ids, scenarios and T are
illustrative. Human layer: `G-wake` (ratified liveness goal; user: "it's
unacceptable if a task finishes but nothing happens until user types
something"): a finished background task's notice is processed without waiting
for user input. Scenarios: (1) harness idle → a turn starts within T; (2) a turn
is running → the notice is processed when it ends, with no input; (3) two
tasks finish together → both notices processed, none dropped. `W-api`: the
extension interface can start a turn programmatically (monitor: scenario 1).
`O-busy` (notice arrives during a turn or compaction) obstructs G-wake and is
handled by scenario 2's obligation. S2 question the agent should ask: "while
the user types a draft, wake now or after it is sent?"

Agent layer before the fix (J10): five delivery paths do not wake the
harness; for three, agent-written tests assert hand-off to the next input.

| Element | Authority | Trace | Derived |
|---|---|---|---|
| tests asserting hand-off to the next input | proposed (agent-written) or unknown | none to a ratified node → orphans | passing evidence, oracle class same-generator, for candidate decision `D-hold`: "hold notices until the next input" |
| `D-hold` | proposed | — | `contradicts` G-wake scenario 1 → alarm (I2) |
| `G-wake` | ratified | — | contradicted on five paths, three of them pinned by tests |

In the field the agent called the three paths "deliberate: the design hands
the notice to your next input, and the existing tests check that it does" —
unratified artefacts cited as intent against a ratified belief (I2; H-T5).
The design requires one alarm:

```
ALARM G-wake contradicted: 5 delivery paths do not start a turn (p1–p5).
  p1–p3 are pinned by tests t1–t3 asserting hand-off to the next input; they
  trace to no ratified belief and are not evidence of intent (D-hold, proposed).
  Proposed exit: reject — fix p1–p5, replace t1–t3 by checks of scenarios 1–3.
  Alternative: ratify D-hold, revise G-wake.   Exits: r=reject a=ratify v=revise
```

After `reject` (the user's actual choice, J10): per path, a timing check
completes a task in that path's harness state and asserts a turn without input
within T; the oracle comes from the ratified scenarios; negative control: the
pre-fix code fails it on all five paths. t1–t3 are rewritten or removed and
reported in J2's format (test id, old assertion, new assertion, belief relied
on).

### 9b. "A multi-file update is atomic"

Neighbourhood of `G-atomic` after S1–S7 (11 human-layer nodes, under the cap):

| Id | Kind | Statement (abridged) | Status / resolution |
|---|---|---|---|
| G-atomic | goal | an update of {a, b, c} is atomic for readers in other processes and after restart | ratified |
| G-crash | goal (AND) | after a process crash at any point, the next reader sees the old or the new set | ratified |
| G-isolate | goal (AND) | a concurrent reader never observes a mixture | ratified |
| D-pointer | decision (closes OR) | write the new set into a fresh version directory, then switch a pointer by rename; rejected: in-place writes with a journal; one bundle file | ratified |
| W-rename | W | rename(2) within one local filesystem replaces the target atomically | ratified |
| W-onefs | W | store and pointer live on one local filesystem, not a network filesystem | ratified; monitor: device-id check |
| W-readers | W | readers resolve the pointer once per read of the set | ratified; guarantor: shared reader library |
| O-gap | obstacle → G-crash | crash between the writes of a and b | handled by D-pointer (the old set is untouched) |
| O-power | obstacle → G-crash | power loss, unlike a process crash, can lose the rename or file contents without fsync | accepted risk (answer a to Q1, §5) |
| O-writers | obstacle → G-atomic | two concurrent writers | open: handle (exclusive lock, new goal) or assume away (W: single writer) |
| O-nfs | obstacle → W-rename | a network filesystem may not rename atomically | assumed away by W-onefs |

S4 tension: had a belief placed the store on a network share, S4 would report
the minimal set {G-atomic, W-rename, that belief}; W-onefs is one resolution.

Agent layer (hidden), obligations: `ob-fresh` (write only into a fresh
version directory, never the one the pointer names); `ob-switch` (one rename
on the same filesystem); `ob-readers` (the reader library opens all files
through one resolved version); `ob-gc` (delete old versions after a grace
period — an agent default with no ratified source, hence a candidate
decision: a slow reader may hold a deleted version). Answer b to Q1 would add
`ob-order` (fsync files, directory, rename, fsync parent).

Evidence, all with the negative control "an in-place writer fails":

| Id | Method | Status |
|---|---|---|
| E-crash | SIGKILL the writer at each syscall boundary of the update, restart, check scenario 1 | fault-injected (process crash only); mechanical oracle derived from the scenario |
| E-race | readers loop over a manifest of version and checksums while the writer updates | tested (stress); same oracle class |
| E-power | block-level fault injection or VM snapshot replay | not built while O-power is an accepted risk; G-crash shows no power-loss evidence |
| E-model | optional small protocol model, model-checked for "no mixed read" [R55] | counts only if it replays both scenarios and finds the in-place violation [R56] |

V2: if the second family's refinement of G-isolate lets readers open files by
path, the disagreement reaches the human as a question about the belief ("may
readers bypass the pointer?"), which W-readers answers.

First queue after generation: O-writers (handle or assume away), the `ob-gc`
candidate decision, one audit path; everything else is counts.

## 10. Risks and open questions

| Risk | Mechanism | Mitigation (source) or status |
|---|---|---|
| ledger inflation | agents enumerate; a small bug became 4 user stories with 16 acceptance criteria in spec-driven tools [R45] | caps (I6); overflow splits the change; kill criterion "ledger grows faster than it is pruned" (J7 mitigations 1, 3, 5); pruning procedure **open** |
| rubber-stamping | ratification under volume approves testimony (J2 point 5); P-D trial: 1.5 s per code item, an instrument trial only (J10) | scenario rendering, batches ≤7, consented canary items — planted wrong scenarios (J7 mitigation 4, [R50]); early churn as a signal; belief-level canary design **open** |
| unfaithful refinement | the hidden spec misrepresents the belief [R56]; J10 field instance | V1–V4 and negative controls; residual: obligations faithful to 2–3 scenarios but not to the belief, since scenarios undersample it — **open** |
| correlated errors | refinement, tests and reviewers share failure modes [R7] (C4, C11) | oracle-author rule, second family (B2), mechanical oracles, human audit (V4); residual correlation unmeasured — **open** |
| cost of formalisation | formal models are expensive and often wrong when LLM-written [R56] | scenario-backed by default; formal only where critical or cheap (J7 mitigation 2, [R55]); cost model **open** |
| level mismatch persists | agents privilege concrete artefacts (H-T5; one field instance, no fixture yet) | I2 in policy, alarm on `contradicts`, report check (OC-12); efficacy is a Q11 pilot question |
| elicitation is testimony | the agent discloses salient defaults; omissions are invisible to mutation (C13, C15) | obstacle catalogues (S3), V2 disagreements, escape log; **partly open** |
| silent replacement | the first artefact becomes the belief (J5, [R41]) | dialogue precedes generation; predictions before generation |
| gate blocks progress | escalation stops all work (J8) | the agent proposes alternatives that keep ratified beliefs intact |
| guard bypass | shell edits to the ledger | pre-commit backstop (J6); adversarial agents out of scope (J2) |
| tacit intent | intent forms on seeing artefacts [R14] | the `revise intent` exit; telling new intent from correction **open** |

## 11. Open choices for the reviewer

| # | Choice | Default in this draft |
|---|---|---|
| OC-1 | scenarios as node field or separate nodes | field |
| OC-2 | when a check counts as `mechanical` | generic oracle or one derived mechanically from a ratified scenario |
| OC-3 | evidence strength as an ordinal or a set of flags | ordinal, with fault-injected and model-checked unranked |
| OC-4 | caps per component and view; obligations visible at depth 2 | ≤12 nodes, ≤7 goals, ≤7 rows, ≤7 queue items; yes |
| OC-5 | dialogue caps and rounds | ≤5 nodes, ≤3 questions, ≤3 obstacles shown, ≤2 tensions, 2–3 scenarios, ≤3 rounds |
| OC-6 | who sets the risk class that selects validation depth | unspecified |
| OC-7 | digest scope | own content plus human-layer refinement ids; agent links excluded |
| OC-8 | storage syntax | YAML per component plus an append-only ledger |
| OC-9 | operational definition of resumption lag | first action referencing a node |
| OC-10 | traceability granularity and consequence threshold for orphans | unspecified (module, public symbol or diff hunk) |
| OC-11 | queue ranking function | consequence × proximity to ratified nodes |
| OC-12 | how I2 is checked in agent reports | unspecified (pattern lint, reviewer model, or policy only) |
| OC-13 | ratified belief versus J2-ratified test | alarm, no automatic precedence |
| OC-14 | formalisation thresholds | scenario-backed: ≥2 ratified scenarios; formal: replays all |
