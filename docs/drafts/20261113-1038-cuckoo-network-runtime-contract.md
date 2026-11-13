# Cuckoo network runtime contract (Q63)

Q63 revision 2 was read through decisions/get at 2026-11-13T10:35:48Z. The user
selected per-task consent: separately choose the configured encoder/critic model
and approve the selected task's visible transcript snapshots, including subsequent
snapshots and model-written search queries. Grants remain bounded, revocable and
separate from persistent feature switches. This authorizes that product policy;
it is not permission to send this development session or credentials to providers.
All acceptance runs remain synthetic/owned HTTP.

## Shared ownership

`task-consent.ts` owns live task grants and operation permits. Native receipts are
accounting only and do not restore live grants on restart. Approvals bind exact
project, session, navigation/configuration scope, task ID and model/configuration
binding. A task label/assignment is model-authored; approval is of this task ID,
not proof that future assignments have the same human meaning. The operator sees
that future-content/query policy explicitly. Only the selected task's snapshots
are eligible; no ambient/system/developer/thinking history is harvested.

Tasks and snapshots come from the current native branch. Projection always applies
existing corrections. Grants expire after 30 minutes, have a bounded operation
count (256 encoder calls or 32 critic calls), and are revoked by explicit revoke,
observed feature configuration changes, navigation, reload or shutdown. These
are runaway/resource limits, not spending approval gates. Monotonic elapsed time
enforces lease duration; civil timestamps are for receipts/display and can shorten,
never extend, the live lease. Snapshot inventory is
bounded to 128 records and 1 MB of exact text; exceeding bounds is an explicit
error, not silently incomplete retrieval.

The existing exact-input candidate grants are still materialized per operation
from the host-owned task grant. Model arguments cannot create task grants or choose
endpoints/credentials. Task consent is allowed to admit a new bounded query text
and new task snapshots; this is not the evaluation harness's unconditional
self-approval behavior.

## Shared APIs (parent implements)

```typescript
type NetworkFeature = 'vectors' | 'critic';
interface TaskModelBinding {
  readonly id: string;
  readonly label: string;
  readonly destination: string; // operator-only; never included in tool output
  readonly digest: TextDigest;
}
interface TaskConsent {
  readonly version: 1;
  readonly id: string;
  readonly feature: NetworkFeature;
  readonly taskId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly scopeKey: string;
  readonly binding: TaskModelBinding;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly maxOperations: number;
  readonly policyId: 'operator-approved-task-snapshots-v1';
}
interface TaskSnapshot {
  readonly record: SnapshotRecord;
  readonly status: RecordStatus;
  readonly sourceStatus: SourceResolution['status'];
}
interface TaskData {
  readonly consent: TaskConsent;
  readonly label: string;
  readonly snapshots: readonly TaskSnapshot[];
}
interface TaskOperationPermit {
  readonly id: string;
  readonly consentId: string;
  readonly feature: NetworkFeature;
  readonly signal: AbortSignal;
}
class CuckooTaskConsents {
  constructor(pi: ExtensionAPI, features: CuckooFeatures,
    clock: () => number, newId: () => string, projectId: (cwd: string) => string,
    elapsedClock: () => number);
  approve(ctx: ExtensionContext, feature: NetworkFeature,
    bindings: () => readonly TaskModelBinding[]): Promise<TaskConsent | null>;
  current(ctx: ExtensionContext, feature: NetworkFeature): TaskConsent | null;
  data(ctx: ExtensionContext, feature: NetworkFeature, binding: TaskModelBinding): TaskData;
  reserve(ctx: ExtensionContext, feature: NetworkFeature, binding: TaskModelBinding): TaskOperationPermit;
  check(ctx: ExtensionContext, permit: TaskOperationPermit, binding: TaskModelBinding): TaskData;
  revoke(ctx: ExtensionContext, feature: NetworkFeature): void;
  remaining(ctx: ExtensionContext, feature: NetworkFeature): number;
}
```

`approve` is TUI/operator-only: choose task and binding, preview current snapshots
and explicit future-content policy, then separate bounded Cancel-default approval.
It rechecks current task/scope/model after every await; newly added snapshots are
covered only under the explicitly displayed per-task policy. Appending a receipt
must be observed before a live grant is made. `reserve` consumes one operation and
returns an unforgeable live object; `check` refreshes all authority/projection.
`revoke` is allowed even when the feature is off. Failed/uncertain operations are
not automatically refunded or retried.

`CuckooFeatures` additionally exposes `ownerKey(ctx): string`: session/navigation/
shutdown ownership only. Its existing `scopeKey` also changes with feature
configuration and remains the grant/applicability key. Journal callbacks use
ownerKey plus actual session/prefix checks; config disable must still permit an
already-dispatched request's genuine settlement record on its original owner.

## Provider services (parent implements)

```typescript
interface EncoderProfile {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly normalization: 'unit' | 'raw';
  readonly credentialEnv: string;
}
interface EncoderProfileStore {
  readonly path: string;
  read(): readonly EncoderProfile[];
}
interface CuckooNetworkServices {
  readonly encoderProfiles: EncoderProfileStore;
  readonly embeddingTransportPolicy: 'https' | 'owned-loopback-http';
  readonly credential: (name: string) => string | undefined;
  readonly fetch: FetchFunction;
  readonly clock: CriticClockPort;
  readonly ids: CriticIdPort;
}
```

Encoder profiles are strict global `<agentDir>/cuckoo-encoders.json` version 1,
`encoders: EncoderProfile[]`; only credential environment names, never values.
HTTPS only in production profiles. Tests inject owned-loopback profiles through
an explicit test transport dependency, not an arbitrary insecure production flag.
Neither project preferences nor model arguments choose credential sources/routes.
Read/resolve credentials only after a live grant is checked. No model or endpoint
discovery network requests occur during selection or feature enablement.

Critic selection uses the existing `ctx.modelRegistry` catalog (respect scoped
models), rejects virtual/unsupported/off-incompatible and known prohibited models,
and binds exact provider/model/catalog configuration and expected request URL.
The native SDK resolves its own auth; never inspect auth files or create another
ModelRuntime. A URL/configuration mismatch fails before handoff; no fallback.

## Vector runtime

`CuckooVectors(features, consents, services)` registers `cuckoo_search` and exposes
operator `command(args, ctx)` for approve/revoke/status. Tool accepts taskId,
query text and bounded topK, no authorization/configuration fields. It indexes only
approved task snapshot.text, uses current source/status projection, serializes
index changes, and returns metadata/digests, never vectors. Require the tool taskId
to match live consent. Exact record/query approvals are derived only within that
grant. Each encode has a reserved permit and rechecks it at actual fetch handoff
and after awaits. Publish an index/result only while its owner/scope/grant still
matches. Revoke discards the live index; no silent lexical fallback.

## Critic runtime

`CuckooCritic(pi, features, consents, services)` exposes approve/revoke/status and
an ordinary-run start / synchronous ordinary-boundary hook. It uses latest active
artifact plus bounded active evidence snapshots of the selected task, not ambient
history, task labels, check-output text or hidden blocks. The controller's new
explicit data policy is `operator-approved-task-snapshots-v1`; retain old synthetic
receipts honestly. Per-operation child grants bind exact bundles/model/prompt and
are backed by the task consent; parent operation limits span those child grants.

Determine ordinary continuation before Cuckoo proposes an inquiry. Check completed,
nonaborted, existing ordinary continuation, no pending user messages, and no
pending/resuming inquiry/inquiry drafts. The original ordinary final response is
finished even if checkpoint scheduling later requests a continuation. Completion
only records status/advice; safe-boundary delivery appends advisory context without
changing continuation. Never call triggerTurn on completion/agent_settled.

Separate task consent lifetime from current-run applicability. A later explicit
user run may continue the same approved task, but old advice must not be revived.
Keep core dedup and unresolved admission across reload. Owner-invalid late journal
writes fail rather than entering a new session/branch. Uncertain old admission
needs explicit trusted reconciliation; no automatic retry/release. Provide a
bounded operator reconciliation path with honest provider-work-unknown wording if
needed; a checkbox is never reconciliation.
