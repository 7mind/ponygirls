# Objective steward: a minimal mixed-initiative design

Status: research/design candidate, 2026-11-07. Not implemented, activated, or behaviorally validated. The user reports Historian is useful despite additional tokens. The goal here is better human understanding and informed control, not token minimization. This request authorizes research, not a new background writer, service deployment, or adoption of M1.

## Recommendation

Build one bounded **epistemic steward** around the existing Historian pattern:

1. Maintain a small, source-linked view of the session's objectives and typed working notes.
2. Keep the worker's fulfillment claims separate from the steward's assessments and explicit Human acceptance.
3. Let the steward directly maintain its OWN derived records and append challenges/proposals about others' records. Notify the worker with exact references.
4. Do not silently rewrite Human intent, another actor's completion history, or execution permissions.

This is a hybrid, not a choice between unrestricted graph mutation and disposable prose. The graph holds the disagreement and proposed correction; a short message directs attention to it. A worker ignoring prose cannot make the disagreement disappear from the user's view.

**First boundary:** automatic maintenance of instances under a small prescribed vocabulary, not autonomous ontology/schema evolution. New concepts/types can be proposed later. We do not need a general reasoner, a second Supervisor, or a second execution-goal controller.

## 1. What exists locally

Source inspection at repository base `cdf3d12a0813bb68ee357333930bbd6440a92333`, not a claim about the user's currently loaded extensions or fresh runtime acceptance.

- Historian has a bounded same-root history feed, fresh tool-less background Agent, durable SQLite evidence/cursors, revision-checked episode publication and a human journal/status panel.
- It does NOT currently provide an ontology store, model-callable journal tool, main-context feedback, objective registry, editing UI, or global objective hotkey.
- Its sanitizer drops `custom` state entries, tool-result `details`/`structuredContent`, and custom-message `details`. A typed graph/objective feed needs an explicit versioned adapter, not an assumption that those fields already reach the worker.
- Main capture uses `getEntries()`, not `getBranch()`. Historical chronology is not the current branch's governing intent. Activation/late-attachment boundaries can exclude earlier evidence.
- Codex-goals already owns one operational goal per saved session, with `/goal`, lifecycle tools, revision-CAS storage, and its continuation controller. Its README correctly calls completion a model claim, not independent verification.
- Codex-goals has no multiple-objective graph, acceptance evidence or claim/assessment/Human-acceptance separation. Forks retain GoalId in a different session envelope: identity must include sessionId, not GoalId alone.
- Its `update_goal` input names only status, not goalId/expectedRevision. Host CAS protects the loaded transaction, not stale model intent about an earlier goal. This is a source-level contract limitation, not a reproduced runtime defect or an implementation change in this work.

**Composition:** keep Codex-goals as the owner of operational execution state. Observe it through a new narrow snapshot/change bridge; no supported cross-extension accessor was found. Do not open another FileGoalStore writer or let the steward resume, clear or complete that goal. The ontology can hold several semantic objectives without becoming another autorun loop.

## 2. Prior art: mechanisms to borrow, not efficacy claims

Primary public sources were retrieved during this research on 2026-11-07. These are source-level mechanisms; no package was installed, benchmark reproduced, or deployed behavior verified. Long-page excerpts were selective; no whole-paper review is claimed.

| Prior art | Relevant mechanism | What it does not establish |
|---|---|---|
| [Mastra Observational Memory](https://mastra.ai/docs/memory/observational-memory), [reference](https://mastra.ai/reference/memory/observational-memory) | Observer creates observations; Reflector consolidates them; background buffering and working-memory hooks. Continuation hints are configurable, including disabling response suggestions when another agent owns control flow. | Faithful objectives, correct consolidation, or Human acceptance. Its memory performance claims are not our evaluation. |
| [Letta memory/dreaming](https://docs.letta.com/configuration/memory/), [MemFS](https://docs.letta.com/concepts/memfs) | Background memory subagents, Git history/worktrees, user-inspectable memory; optional Agent review before applying updates. | Agent review is explicitly not Human approval. A merge/history mechanism does not establish semantic correctness. |
| [LangMem background processing](https://langchain-ai.github.io/langmem/background_quickstart/), [delayed processing](https://langchain-ai.github.io/langmem/guides/delayed_processing/) | Namespaced extraction and ReflectionExecutor debounce/replacement of pending work. | Durable scheduling, authorization or complete interpretation. The quickstart's awaited call alone does not prove nonblocking behavior. |
| [Graphiti](https://github.com/getzep/graphiti) | Incremental episode-to-entity/relation extraction, prescribed and learned types, temporal history and source-episode provenance. | Publisher language about ground truth is not authenticated intent or verified fulfillment. Application access control remains application work. |
| [OpenHands events](https://docs.openhands.dev/sdk/arch/events) | Typed immutable events and derived state/history projections. | Immutable records can preserve incorrect claims; they do not independently validate goals. |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents), [interactive mode](https://code.claude.com/docs/en/interactive-mode) | Background specialists, tool restrictions, task-list visibility and persistent-memory patterns. | Visible task status is not independent fulfillment or Human acceptance. No exact hook-gate guarantee is relied on here. |
| [Horvitz, CHI 1999](https://www.microsoft.com/en-us/research/publication/principles-mixed-initiative-user-interfaces/), [paper](https://erichorvitz.com/chi99horvitz.pdf) | Automation combined with direct manipulation, attention to uncertain intent, user control and efficient correction. | This is design precedent, not validation of a modern LLM ontology steward. |
| [Doyle, 1979, abstract](https://dspace.mit.edu/entities/publication/5377b306-4ecc-4687-b1f5-78cbb4a0543a) | Recorded justifications, assumptions, revision and explanations. | We have not read/validated the full system or selected a general truth-maintenance engine. |
| [CRITIC](https://arxiv.org/html/2305.11738v4), [intrinsic self-correction limits](https://arxiv.org/abs/2310.01798) | External evidence can inform critique/revision; intrinsic reasoning self-correction can fail or degrade on tested tasks. | Neither paper proves an infallible reviewer, supplies new Human intent, or establishes this product's oversight benefit. |

The useful combination is versioned observation, typed source links, a visible task view, and mixed-initiative correction. No source establishes that this combination already solves our problem. Retrieval limits are retained in local research notes; an unrelated-body blackboard-paper fetch was excluded rather than cited as evidence.

## 3. Minimal logical model

Use the [data/API candidate](20261102-1947-llm-epistemics/data-api-candidate.md) as the baseline, not a new global schema. The following are logical roles/profile requirements, NOT fields already accepted by Pilot U's wire schema.

| Role | Minimal information | Relationship to existing candidate |
|---|---|---|
| Session objective | exact objective/binding revision; source references; stated-request versus inferred interpretation; acceptance or unresolved acceptance; session scope | Outcome + governing-context Binding |
| Typed scratchpad | author; statement/hypothesis/question/decision/defect; objective/context links; basis; revision | Existing semantic node kinds, not hidden chain-of-thought capture |
| Fulfillment claim | claimant; exact objective/binding; fulfilled/not-fulfilled/inconclusive conclusion; cited basis | Typed Review refinement; do not misuse Task progress as Outcome completion |
| Assessment | assessor; exact claim/objective revisions; supported/challenged/inconclusive; reason; checked sources and coverage | Separate Review refinement |
| Issue/proposal | affected references; explanation; proposed replacement/diff; expected heads; pending/accepted/rejected/obsolete disposition | Conflict + attributed proposal/decision records |

Claims and assessments are different records even when the same model family produces them. Pending review is a processing state, not a positive verdict. A challenge for missing evidence does not prove the underlying claim false. A supported assessment means support within its stated scope, not universal verification.

### Do not collapse these axes

- **Wanted/current:** the source-bound intent and its governing revision.
- **Work progress:** tasks active/blocked/completed against their own acceptance.
- **Worker claim:** what the worker says about objective fulfillment.
- **Steward assessment:** supported, challenged or inconclusive, with scope/coverage.
- **Human action:** explicit correction/acceptance/closure if supplied; merely opening a panel is none of these.

Human acceptance is optional, not a form the user must approve after every event. An explicit captured request is Human source material; the agent's normalized summary and added acceptance criteria remain interpretations. Automatic objective extraction is not automatic Human ratification or execution permission.

## 4. Correction authority: hybrid by default

| Change | Initial policy |
|---|---|
| Invalid reference/type/CAS/authentication | Reject mechanically at API admission; do not ask an LLM to bless invalid data. Preserve the failed attempt. |
| Deterministic derived index/projection rebuild | Controller-maintained, with explicit input versions. No semantic inference hidden as normalization. |
| Steward's own extracted notes, interpretations and assessments | Steward may revise directly under its identity; retain history and source lineage. |
| Another actor's claim, objective interpretation, or scratchpad | Append challenge and typed replacement proposal; notify that actor. Do not overwrite its historical assertion. |
| Human source, adopted criteria, permissions or acceptance | No autonomous rewrite or manufactured adoption. Ask for a scoped decision when genuinely ambiguous/material. |
| Canonical ontology/schema evolution | Propose separately; no automatic new governing types/axioms in the first slice. |

This permits automatic ontology INSTANCE maintenance without granting unrestricted semantic authority. The steward can immediately correct its own account of a new user statement, while the UI still shows what the worker claimed and why it is challenged.

The controller must check the EFFECT of edges, not just ownership of a newly created record. A reviewer must not bypass permissions by creating its own `adopts`, `delegates`, `requires`, `withdraws` or `supersedes` edge that changes someone else's governing intent. Owned challenges/reviews are allowed; authority-changing relations need the corresponding authority.

Semantic deduplication, merging entities, and rewriting another agent's notes are proposals initially. A deterministic duplicate of the same captured source ID is different from a model deciding two concepts mean the same thing. More aggressive edits to unratified agent notes could later be explicitly delegated; they are not needed for the first test.

### Why not prose only?

Prose-only correction depends on the worker noticing, interpreting and persisting every request, and can disappear in compaction. Direct unrestricted mutation can conceal disagreement, clobber current work and turn a reviewer's mistake into canonical intent. The hybrid keeps durable structured disagreement plus a short actionable explanation. It is a recommendation, not a demonstrated comparative win.

## 5. What the user sees

Proposed `/objectives` command and a configurable, nonconflicting hotkey open a READ-ONLY projection. This is UI, not a proposed fourth graph tool. No LLM call or execution wake-up is needed merely to inspect it.

```text
PRIMARY: Preserve informed human control [stated request / interpreted account]
  Work: report delivered
  Worker: claims fulfilled, binding B7
  Steward: CHALLENGED -- token cost does not answer oversight benefit
  Human acceptance: not recorded
  Evidence: message M42; claim C9; review R12

NEXT: Data/API candidate [stated request]
  Work: completed
  Worker: claims fulfilled
  Steward: supported within listed file/link checks

Coverage: active branch through E174; current tail E181; review pending
```

Defaults show primary/current objectives AND claimed-fulfilled objectives. They do not silently hide a disputed objective because the worker marked it done. Expand a row for original source, interpretation, acceptance, linked notes, claim/assessment, missing coverage and change history. Do not expose the whole graph by default.

User actions distinguish correcting an interpretation, changing intent, dismissing an inferred item, accepting a result and accepting closure with remaining uncertainty. They create attributed events, not edits to old messages. Optional explicit acceptance remains separate from either agent's assessment. Opening, scrolling, notification delivery and silence do not mean acceptance.

A compact badge shows pending/challenged/stale coverage, including worker/provider errors. A native Codex-goal being complete is displayed as operational state, not automatically as this objective's verified fulfillment. Its existing `/goal` control remains the execution owner; this view must not auto-resume it.

The registry/view must include typed objectives submitted by the user/worker even when the steward has not assessed them. A model not extracting an objective from free prose is still possible; processing a source range does not prove complete semantic coverage. Keep unknown/missing coverage visible rather than treating an empty list as proof of no objectives.

## 6. Background loop and feedback

```text
finalized authorized source/typed event + active-context marker
  -> bounded immutable input window + exact graph/goal snapshots
  -> one observer/steward job per root, coalescing pending work
  -> schema/reference/ownership/source-version checks
  -> atomic steward-owned records or correction proposals
  -> objective projection + durable issue inbox
  -> bounded attributed feedback at a safe agent boundary
```

A bare bounded Agent, not a general Supervisor child, is sufficient initially. Host/controller code builds the authorized evidence window and validates proposed operations; the model gets no arbitrary filesystem/network/execution authority. Extend the same-root history service deliberately, not by scanning all sessions with the same cwd.

A versioned typed adapter must whitelist graph operations/goal snapshots and necessary structured fields. Do not simply forward all dropped `details` or parse prose as an authoritative typed state event. Link sanitized source back to immutable originals with explicit clipping/coverage. Never collect hidden model reasoning as a scratchpad.

Every job carries input range/source identity, active branch/context, objective/claim/governing revisions and its own lease. Check relevant expected heads before publishing a current correction. Unrelated graph writes should not force a whole-job restart merely because a global generation advanced. Old assessments may remain valid historical records for their old subjects; do not transfer them to a new binding.

New events coalesce behind a running job. Persist source checkpoint and resulting records consistently; incomplete/error work cannot advance coverage as successfully reviewed. Aborts are not provider drain; fence late returns and ownership release. Surface failed/partial/draining state instead of a reassuring healthy badge. Scheduling is eventual, not a promise of checking every decision before the worker finishes.

Reviewer output is not a new user objective and must not recursively trigger itself. Use origin/event IDs, stable issue versions, deduplication and explicit acknowledgement/disposition. A transport enqueue receipt is not model understanding, agreement or resolution.

### Safe worker notification

Pinned Pi 1.4.0 documents actionable boundaries and a retained `enqueueMessage` API with explicit trigger/delivery choices. Its acceptance can mean committed OR pending context, not fsync or completed recipient processing. Do not call arbitrary recursive `prompt`, rewrite context to conceal history, or abort the worker merely to deliver a criticism.

Default: inject a bounded issue delta at the next safe active boundary; when the worker is settled/paused/closed, retain an inbox item and UI badge for the next authorized interaction. No automatic restart of completed work. An optional wake-up/continuation policy would require separate explicit consent and bounded liveness rules; it is not necessary for the first slice. Always retain a readable fallback for missed notices.

## 7. Scope, forks and startup

Start with one root and its authorized descendants. Keep project publication, source-read permission and write authority separate. A shared graph record does not grant access to another root's raw transcript. Do not key operational goals by GoalId alone across forks.

The session-objective projection must say which branch/context governs it. Historian's all-entry chronology includes abandoned branches; it is not automatically the active objective set. Codex-goals intentionally retains its session goal across navigation, so show that session-global operational state separately. After a branch/fork/context change, invalidate the old current-view checkpoint and rebuild/mark pending; do not silently merge objectives or propagate approval.

Enabling midway needs a visible bootstrap boundary. Current Historian activation policy is not permission to backfill every earlier session entry. Initially use an explicit controlled session/start boundary, current authorized goal snapshot, and user-pinned objectives. Additional history import must be scoped/authorized. If earlier evidence is unavailable, display partial coverage.

## 8. Smallest workable slice

A proposed implementation sequence, NOT work performed here:

1. Freeze a small typed session profile and role policy: objective/binding, typed notes, fulfillment claims, assessments and issues/proposals. Reuse existing kinds where suitable; make new Review refinements explicit.
2. Add the opt-in typed event/snapshot adapters, active-context marker and bounded startup behavior. Compose with the current goal owner rather than duplicating its store/controller.
3. Give the main agent bounded graph read/apply access for its objectives, notes and claims. Enforce provenance, exact refs, revision preconditions, idempotency and capability rights at the host/API boundary.
4. Add one Historian-style background job that writes its own curation/assessments and proposed corrections. Initial checking uses supplied authorized observations; it does not run tests or independently inspect a deployment.
5. Add `/objectives`, source/detail expansion, pending/error coverage and a bounded issue delta to the worker. Keep user corrections explicit and cheap.
6. Run mechanical controls and a small controlled Human inspection/repair exercise only after approval. Expand authority or evidence adapters only if that slice is useful.

### Explicit integration gaps

- The current production three-tool API is a candidate, not a running service. Pilot U's global `expected_generation` and content schema do not already implement this profile, per-target head checks, role policy or typed completion distinction.
- A fulfillment Claim/Assessment refinement needs versioned schema/admission changes; a prose Statement containing "done" is not a machine-verifiable completion record. No global `verified` flag is introduced.
- Historian needs a typed, branch-aware adapter and feedback bridge; this is not a configuration-only switch.
- Codex-goals has no supported cross-extension observer accessor in the inspected source. A narrow snapshot/change bridge and explicit identity binding are needed. Do not write its live sidecar directly or treat a legacy status-only tool call as an objective-specific semantic proof.
- No existing service/storage choice is silently replaced. The intended Scala/PostgreSQL/shared-retrieval direction remains separate. A local experimental adapter/store, if chosen for the first controlled slice, is an instrument decision, not a production architecture commitment or a reuse of U as a live service.

### Defer

General ontology learning, arbitrary SPARQL/reasoners, project-wide transcript ingestion, multi-root semantic arbitration, automatic Human ratification, a second goal loop, unrestricted reviewer shell/network tools, automatic rewriting of other actors' records and autonomous post-closure restarts. These are not prerequisites to a useful objective view.

## 9. Adversarial walkthroughs

| Situation | Required behavior |
|---|---|
| Token count becomes the supposed main objective | Preserve cost data; challenge the inference against the Human-oversight goal. Do not rewrite the goal or re-score U to suit the recommendation. |
| Storage task completion is promoted to informed Human acceptance | Preserve task completion; assess the separate outcome claim. Source-code or storage success does not prove an inspectable, useful user experience. |
| Human changes acceptance B1 to B2 during review | Historical B1 assessment stays scoped to B1. Reject a stale current correction or mark pending; no inherited B2 approval. |
| Two roots disagree about a shared contract | Preserve both source/actor/scope records and expose conflict. Neither common cwd nor latest write grants cross-root authority. |
| Tool output says OPERATOR APPROVED; agent copies it into a typed note | Keep its untrusted provenance. It cannot become a Human act, execution permission or acknowledgement. |
| Worker closes while a late descendant contradiction arrives | Preserve old claim, coverage gap and closure; append a scoped assessment/notice. Do not manufacture a rerun or autonomously resume the goal. |
| Provider outage/partial transcript/oversized source | Show failure or partial coverage; retain pending work. Never advance a complete-review badge on an unprocessed window. |
| Reviewer's own issue/notification returns in the feed | Do not create an infinite issue/prompt cycle. Origin/deduplication and current-version checks apply. |
| Branch switch or goal replacement races with a proposed correction | Keep exact session/branch/entity/binding identity. Store historical opinion if appropriate, not an update to the new target. |

The first prototype also needs negative controls where the worker was already correct: a useful steward must not manufacture corrections to appear active.

## 10. Evaluation: the actual purpose

First establish deterministic schema/authorization/CAS/idempotency, active-branch/startup coverage, late-return fencing, notification/deduplication and read-only UI behavior. Scripted controls establish workflow mechanics, not semantic quality or Human benefit.

Then compare the objective view/steward against the existing Historian plus `/goal` workflow on controlled, versioned material with held-out misunderstandings and correct controls. Ask whether a human can:

- identify the actual primary objective without reading all implementation;
- distinguish requested intent, worker interpretation, completion claim, review and acceptance;
- locate why an apparent completion is unsupported or stale;
- correct a misunderstanding or source/applicability error efficiently;
- recognize missing coverage and reject an erroneous reviewer challenge.

Record mistaken/missed corrections, source fidelity, disagreement resolution, time/interaction burden and whether the view remains useful enough to keep enabled. Do not replace these with a token count, another code-test pass rate, self-rated helpfulness or agreement between agents. Report latency/token/resource overhead separately; no invented financial cap is required. Extra model work can be a win if it materially improves the human's understanding and control.

No new trial was run in this research task. The user's Historian experience is relevant reported experience, not a controlled general-benefit result. No raw private sessions should be uploaded to research services or used with a new provider without scoped consent.

## 11. Decisions needed before implementation

Recommended defaults for discussion, not adopted policy:

1. Start with appended reviews/proposals and direct stewardship of its own account, not write access to another actor's semantics.
2. Keep current operational `/goal` ownership; semantic multi-objective tracking is a projection over the graph, not another execution driver.
3. Use one opt-in root with explicit bootstrap/branch coverage and transcript/typed-observation checking first.
4. Deliver active-boundary feedback plus durable next-interaction inbox; no post-closure auto-wake.
5. Keep the first vocabulary prescribed. Evaluate Human inspection/repair benefit before broadening ontology learning, cross-root scope or verifier powers.

A different correction delegation or wake policy is possible, but must specify ownership, reversibility, target identity, acknowledgement and execution authority before it is enabled.

## Local source anchors and research provenance

Repository paths below are relative to this repository; these are source observations, not current activation/test results:

- `nix/pkg/pi-extensions/ponygirls-historian/src/{controller,evidence,feed,worker,store}.ts`: capture/coverage/worker/publication seams; particularly evidence sanitizer and all-entry capture.
- `nix/pkg/pi-extensions/ponygirls-historian/index.ts` and README: existing commands/panels/configuration, not an objective registry.
- `nix/pkg/pi-extensions/ponygirls-codex-goals/src/{goal,tools,store,runtime}.ts` and index: single-goal record, status-only model tool, writer lock/CAS, navigation/fork and continuation ownership.
- Pinned Pi1.4.0 docs `extensions.md`, `sdk.md`, `tui.md`, related session/message/RPC docs and async/UI examples; SDK `dist/core/extensions/types.d.ts` and `dist/core/agent-session.js`: retained boundary/enqueue contracts. Acceptance is not a recipient-processing guarantee.
- [Earlier Historian design](20261106-1312-historian.md), [implementation report](20261106-1326-historian-implementation.md), [reliability report](20261106-1805-historian-reliability.md), [completion/panel acceptance](20261106-2314-historian-completion-panel.md): historical evidence, not fresh live acceptance for this proposal.
- [Existing M1](20261102-1947-llm-epistemics/agent-memory-m1.md) is a design candidate, not an installed dependency of this proposal.

Two read-only workers supplied source feasibility, minimal-core analysis and synthesis of parent-fetched public-source observations. They are advisory Agent analyses, not independent model-family evidence or Human approval. The first minimal-core return was stored-truncated; its missing adversarial tail was requested separately rather than assumed read. A placeholder-only draft materialization was caught before review; it was preserved locally and replaced with actual text. No review of that placeholder is counted as design acceptance. Research notes retain these limits.
