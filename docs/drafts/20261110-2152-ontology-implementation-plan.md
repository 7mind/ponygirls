# Ontology application — implementation plan

Status: full implementation authorized by answered Q55 revision 3. Implement the full live service, RDF projection, curator/worker integration and Human UI first; introduce the Human into the loop afterward. No deployment or Human-study launch is authorized by this implementation request.

## 1. Confirmed direction

- Scala + distage/izumi + logstage server; preserve explicit effect and lifecycle boundaries.
- Baboon for versioned client/server models and generated Scala/TypeScript codecs.
- PostgreSQL is authoritative for domain records, exact source/version bindings, Human acts, heads, CAS and idempotency.
- React + TypeScript + Vite client; Playwright browser checks.
- RDF4J as a derived, revision-bound and rebuildable RDF layer where the selected scope needs it. Do not introduce a second authoritative head or invent cross-database atomicity.
- **Light and dark themes with automatic system-preference detection.** Follow the current OS/browser preference at first paint and while the page is open.
- CLEF is not a default dependency or acceptance/authority gate.
- No deployment, production-data ingestion, migration of another application, Human recruitment or new measured scientific pilot follows automatically from implementation.

## 2. Selected scope and preserved alternative

Q55 selected B below. A is retained only to show the rejected narrower scope; it is not the implementation target.

**A — Human-review pilot application:** controlled snapshot/evidence ingestion, an intent/constraint/evidence view and an equally capable source-linked notes view, exact presented-version Human judgments, durable persistence/history, and UI/theme/browser acceptance. No automatic live curator or worker integration is claimed. RDF can be constructed from an exact snapshot without a persistent triplestore deployment.

**B — Full live ontology service and sidecar:** the complete versioned domain and three graph APIs, protected event/observation capture, atomic curator deltas, qualified projections actually delivered to workers, PostgreSQL/outbox/RDF projection, and the Human review client. Controlled snapshots are useful test fixtures, not a substitute for live maintenance. Adapter/source selection and runtime integration require concrete contracts before dependent code.

The earlier Human-pilot proposal deliberately allowed A without first building B. The Human explicitly selected full implementation first, then their participation. Do not implement a snapshot client and label it the full service. Application namespace/directory: `ontology`. Preserve completed research originals; engineering acceptance uses new controlled inputs.

## 3. Repository precedent and placement

Observed source baseline: `73af7417dc855418d40f4e0a19055928a9445756`.

| Responsibility | Existing precedent | Proposed ownership |
|---|---|---|
| Generated contracts | `rites/models/`, `rites/scripts/generate.sh`, `build.sbt` contract modules | New application's model/generation boundary; one canonical compiled Baboon runtime |
| Transactions/migrations | `shared/service-runtime` | Reuse shared transaction engine; domain schema and admission stay in the application |
| DI/resources | Service plugins and `CatsIOInjector` | Application plugin with injected contracts and lifecycle-owned resources; no parallel ambient runtime |
| Frontend/tooling | `chronicle/web`, `haystack/web` | New application-local React/Vite package and locked dependencies |
| Theme | `chronicle/web/src/theme.css`, `theme.ts`, `public/theme-init.js` | Application root semantic color tokens; CSS system-preference resolution, not per-component state |
| Validation | Existing service repository contracts, real PostgreSQL runners, generated-code and browser checks | Full application acceptance; shared/regression checks for any modified common inputs |

Placement alternatives:

- Keep application UI and theme policy in the application, rather than importing Chronicle's source or extracting a new shared UI package. A new shared abstraction is not justified by this task; unrelated Chronicle behavior must remain unchanged.
- Use the shared transaction/runtime owner instead of embedding JDBC lifecycle/admission logic in routes. Host admission is not a frontend responsibility.
- Keep RDF behind a query/projection boundary rather than using it to determine source truth or Human approval. PostgreSQL remains the commit owner.
- The existing pinned stack uses Cats Effect IO/http4s and a shared ABI adapter; the design requests BIO-style boundaries. Before implementing the server, resolve and document the concrete effect composition against pinned dependencies. Do not silently claim existing services are already BIO-polymorphic or migrate them as a side effect.

Selected application dependencies now include RDF4J 6.1.0 (compatible with the pinned Java 25 environment) and lossless-json 4.3.3 at the browser JSON boundary. Baboon remains pinned at 0.0.198 with a single Scala 2.13 generated-runtime boundary consumed by Scala 3 services. Generator name collisions were reproduced and resolved by renaming unpublished model types, not patching generated code. Concrete service boundaries use Cats Effect IO/http4s and the shared CatsIOInjector/logstage composition; this is not a claim of BIO-polymorphic implementation.

## 4. Automatic light/dark theme contract

### Behavior

- Default semantic palette is light. `@media (prefers-color-scheme: dark)` supplies dark values.
- Declare appropriate `color-scheme` so native controls and scrollbars follow the resolved scheme.
- CSS owns resolution, allowing correct first paint before React and automatic updates without JavaScript listeners or local-storage access.
- No manual selector or persisted override is required by the current request. If later requested, add explicit system/light/dark preference semantics and pre-render initialization; do not rely on a post-mount effect that flashes the wrong palette.
- All components use semantic tokens: canvas, surface, text/muted text, borders, links, focus, selection, disabled state, warnings/errors/success and any code/diff rendering.
- Source-versus-assertion, stale-versus-current and uncertainty distinctions must remain textual/structural; color alone must not encode authority or correctness.
- Keep readable foreground/background combinations, keyboard focus, selected rows, dialogs and popovers in both themes. Target WCAG AA text contrast (4.5:1 normal, 3:1 large) and applicable 3:1 control/focus contrast.

### Verification

Browser tests must run against the built application:

1. Set light before navigation: confirm computed canvas, text, controls and `color-scheme`.
2. Set dark before navigation: same checks, including a first-render check without waiting for React initialization; no light-only bootstrap surface.
3. Change media preference while open, in both directions: computed styles update without reload; view, focus and unsaved judgment state survive.
4. Exercise evidence/source panels, revisions/diffs, warnings, empty/error/disabled states, dialogs and keyboard focus in both modes.
5. Check declared token contrast and inspect actual rendered screens at desktop and narrow widths. Token checks alone are not visual acceptance.
6. Confirm missing storage access cannot affect automatic mode; CSS-only resolution has no storage dependency.

Do not create a generic theme controller solely to duplicate browser media-query behavior.

## 5. Implementation milestones after scope selection

1. **Freeze a runnable acceptance contract.** Map each selected feature to its owner, boundary, success outcome and error path. Finalize the application namespace and first public Baboon contract; declare version negotiation and supported-version behavior. Verify against focused examples before generator changes.
2. **Domain and persistence.** Build typed service/repository contracts, a hand-written dummy and PostgreSQL implementation. Keep actual identity/presentation/source fields host-owned; make acceptance, rejection, need-more-evidence and intent revision distinct. Verify shared behavior plus actual transactions, CAS, replay, rollback, restart and scoped read isolation.
3. **API and generated client.** Generate models/codecs with the pinned compiler; expose only the selected endpoints. Verify Scala/TypeScript roundtrips, malformed/version rejection, exact error/status mapping and bounded pagination. A transport success is not domain acceptance.
4. **Review UI and automatic theme.** Implement source-linked views, exact revision/history inspection and explicit judgment actions. Preserve the source snapshot actually presented. Run typechecks, state/behavior tests and complete browser acceptance including §4.
5. **Scope-specific integration.** For A, exercise controlled snapshot-to-presentation-to-Human-act persistence; explicitly document no live curation. For B, implement ingestion, source-frontier ownership, curator delta admission, RDF outbox/projection checkpointing and real worker delivery. Scripted tests establish mechanisms; selected live acceptance needs its own source/model/permission boundary and does not launch the Human study.
6. **Delivery.** Run full final suites with fresh report directories, review actual outcomes, bind results to source identity, commit only task changes, integrate safely and preserve evidence before removing owned worktrees. No fast-subset-only completion claims.

## 6. Acceptance boundaries by layer

- **Domain:** unchanged definition versus changed governing context; task completion versus outcome satisfaction; source capture versus interpretation; revoked/unknown authority remains explicit.
- **PostgreSQL:** one atomic mutation and idempotency result; uncertain commit is not a silent retry; durable exact presentation/act binding and history.
- **RDF if used:** exact entity/revision/reference/literal roundtrip, scoped queries, rebuild, checkpoint publication, lag and crash/replay. Shape conformance is not faithful intent or authorization.
- **Human client:** record the actual Human operation and displayed contract; never treat agent-authored approval text or a new compilation as adoption of an unseen version.
- **Full sidecar only:** failed curation leaves honest lag, not advanced coverage; graph delivery is attributed data and cannot become a new primary source, permission or recursive curation trigger.
- **Evaluation:** implementation acceptance is distinct from measured Human benefit. No inference from green software tests to improved Human judgments.

## 7. Current state

Q55 revision 3 is answered and recorded. Task branch/worktree: `feature/ontology-implementation`, `.worktrees/wt-ponygirls-ontology-implementation`.

Implemented foundation: generated contracts, deterministic admission, explicit semantic applicability separate from access namespace, nested atomic authoring, scoped binding selection/retirement, explicit assessment applicability-use accounts and typed gate witnesses, binding-local task and question/review progress, memory/PostgreSQL repositories, source capture/input receipts, generation-bound captured source frontiers, separate occurrence/contribution/ingress provenance with qualified reported inheritance, scoped queries, authentication, and revision-bound RDF4J projection. HTTP/MCP routing and the review UI are implemented against a service interface, not yet a complete live service. The latest owned PostgreSQL/RDF/HTTP regression (`.local/wire-schema-full-003`) ran 312 cases in 39 suites with zero failures/errors/skips; the shared model-HTTP suite ran 25 cases in three suites. The curator HTTP adapter has controlled loopback transport checks and an explicit cancellable response-audit path; existing accounting callers retain their cancellation-masked behavior. Deadlines remain cooperative, so production audit/JDBC timeout and uncertain-write handling are still required. These checks do not establish full application acceptance.

Exact review actions now have separate Review/Choose/Adopt contracts and pure preparation/publication engines. Preparation reserves a derived Source without changing the graph or primary frontier. A proposed linked action publishes distinct service-authored presentation content and Human-account activity, with exact manifest selection and retained-publication reuse checks. These engines are now wired into atomic memory/PostgreSQL repository transactions, with retained presentation/judgment reads, actor/request replay across credential rotation, primary-kind separation and validated interpretation evidence. A concrete review service/controller is still pending. Selected-Decision requirements now name a work context and require a selected current binding at transaction end; other contexts remain unaffected and retirement preserves historical requirements. Captured executions now distinguish inputs from outputs. Produced can reference an exact retained execution output, including failed or partial execution, without inventing Task completion or acceptance. Contribution context is retained independently of cited sources and actual server ingress; missing native metadata remains Unknown, remote native metadata remains ReportedNative, and public inputs cannot mint ServiceRequest origins. Reported inheritance pins exact historical cuts and typed references, with all source namespaces authorized before history lookup. Parent/root/epoch consistency is not proof of actual inheritance or native attestation. Source-event replay does not create a second contribution, and unchanged request replay preserves its original receipt. Reproduced receipt/context and graph-Source/capture mismatches are rejected by shared reader validation. Controlled PostgreSQL tests cover late-write rollback, discarded post-commit responses, kind/link/namespace/manifest/publication corruption and append-between-read races. Judgment queries remain on their pinned cut, and protected-action inventories reject unbacked edges and reverse-index misclassification. ServiceCall/ReviewCall carry trusted transport context; concrete service enforcement and curation receipt content validation remain part of the unfinished integration. Question/review Open/Resolved work state was added independently of answers/assessments. Selection is keyed by access namespace, declared work context and definition identity; retirement preserves historical progress and never falls back to an older binding. The live service implementation, curation persistence, curator/worker coordination, Pi integration, trusted host instrument, packaging and final integrated acceptance remain unfinished. Checked executable codec metadata and compiler components now produce wire schemas and a finite predecode validation plan for Scala, the browser and MCP. Integer bounds are checked before narrowing, and raw numeric lexemes cannot silently round into valid integer fields. Representation fixtures cover 187 registered types and all ADT members; this is not semantic or authorization proof. See [wire-contract generation](20261111-0751-ontology-wire-contract.md). Browser/client testing passed 71 client/parser/schema/action tests, fourteen theme/review/provenance/evidence-role check groups and three recovery/correlation scenarios using owned scripted API fixtures. Same-actor session restoration retains uncertain judgments without changing their request identity; scope-loader cancellation and judgment-history correlation have regression coverage. Exact action acknowledgements and distinct target labels for same-definition alternatives are checked. Light/dark desktop and narrow screenshots, including the choice controls, were inspected. These tests must be followed by real-backend acceptance. Q56 leaves the primary-trigger treatment of external graph commands pending; that dependent behavior remains unchanged while source/review curation and schema work proceed independently. No private model calls or Human study have run. The harness rejects prepared writer workspaces because no workspaceRoots are granted; Root remains the sole writer, with read-only source reviewers. No writer isolation bypass. Application tests may use owned PostgreSQL and controlled model transports; no private transcript ingestion, deployment or Human study.
