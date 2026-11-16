# Historian

An opt-in, evidence-linked project lab notebook for pinned Pi 1.5.2 / Node 24+.
A tool-less worker interprets significant research, experiments, deployments,
blockers and discoveries from the governing session and its descendants.
Mechanical activity is omitted unless needed for reproduction. These are model
interpretations, not verified current state or a complete transcript backup.

## Enablement and disclosure

**Default OFF, no extension-level model default, no model fallback.** Load after
`ponygirls-subagents` for descendant coverage. Home Manager supplies the managed
model below; otherwise select an authenticated model explicitly:

```text
/historian model PROVIDER MODEL THINKING
/historian on
/historian status
/historian journal
/historian off
```

`on` approves disclosure to that configured provider: eligible sanitized evidence
from this session family, plus recent shared project-journal interpretations.
It does not approve forwarding other roots' raw histories. Redaction is best
effort, not universal secret detection. Do not enable for data that may not be
sent to the selected provider. Changing the model does not approve a different
model automatically. Thinking is explicit: `off|minimal|low|medium|high|xhigh`.

Controls mirror `/context-archive`:

| Command | Effect |
| --- | --- |
| `settings` | Stage session/trusted-project/global configuration in the shared dialog |
| `project on` | Explicitly request runtime-local approval for effective project ON, including unchanged requested ON |
| `on`, `off` | Override this root session, across branches/reloads |
| `inherit` | Remove the local enablement override |
| `default on`, `default off` | Change global defaults; local overrides still win |
| `default model PROVIDER MODEL THINKING` | Set global model selection |
| `model inherit` | Inherit project/global model selection |
| `default model inherit` | Clear writable global selection; inherit managed model, if any |
| `[default] focus TEXT`, `focus inherit` | Configure/inherit the journal objective focus |
| `status`, `journal` | Read status or the journal without inference |

Bare `/historian` remains a status view. In `settings`, Tab selects scope, Space
stages enablement, `e` edits a complete model/focus, `r` stages inheritance, Ctrl-S
applies that scope, and Esc discards unsaved drafts. Managed model and journal root
are read-only metadata. A checkbox is intent, not consent: ON Apply uses a separate,
bounded, Cancel-default disclosure confirmation for the complete staged model.
Declining does not save the draft. Native session writes can leave a prefix if a
later append fails; errors do not claim rollback.

Project preferences live at `<cwd>/.pi/historian.json`, independently of the shared
journal identity. Only trusted project files participate. Project ON requires a
private live grant for this runtime and exact configuration/model; the file and
native audit receipts cannot grant or restore approval. Restart, observed OFF,
trust/source/configuration changes or read faults revoke the grant. Restoration of
old bytes or a copied receipt requires fresh confirmation. Project ON shadowed by
a session override does not receive a future grant. New capture begins at a fresh
boundary after such intervals; already captured pending evidence is retained.

Global/session textual ON commands retain their existing explicit approval
semantics without adding another dialog. Settings remain independent of task goals,
verification, and other extensions' permissions.

Command arguments autocomplete subcommands, defaults, available providers/models,
and thinking levels. Focus remains free text (with session `inherit` completion).
Status panels group configuration, activity, diagnostics and coverage with semantic
theme colors; journal headings, evidence metadata and coverage notices are visually
distinct. Use arrows/Page Up/Page Down/Home/End to scroll and Escape or `q` to close.
Stored Markdown and non-TUI output remain unstyled.

A global ON requires a configured global model and approves that model. Session
consent is independent of enablement inheritance. A fork gets a new session
identity and does not inherit copied session-local approval. OFF is not a
project-wide switch: another enabled root can keep publishing to the project.
Defaults mutations serialize with capture/admission and canonical commits. A
contending command reports an ownership error rather than pretending it changed
the setting; retry it after the current short transaction finishes.

`HIST` shows enablement, `HIST …` active work, `HIST !` a fault or requested ON awaiting approval. Click the badge or
use `status` to distinguish requested enablement, backlog, provider drain,
projection errors and coverage. After three failed attempts, use `on` in that
root to retry; no silent provider fallback occurs.

## Chronicle summary uploads

Summary upload is a separate, **global-only opt-in, default OFF**. `/historian on`
approves the capture model, not upload; Chronicle approval does not enable capture
or approve a model. The existing scoped capture settings dialog is unchanged.

```text
/historian chronicle configure URL ABSOLUTE_TOKEN_FILE
/historian chronicle settings
/historian chronicle on
/historian chronicle status
/historian chronicle off
/historian chronicle retry
```

`configure` stores a disabled destination, with an installation namespace generated
by the command and no credential approval pin. It accepts an HTTPS origin or full
`/api/ingest` URL; HTTP is allowed only for loopback. URL credentials, queries and
fragments are rejected. The bearer must be in a private runtime file at an absolute
path outside `/nix/store`; never put the bearer in a command, URL or Nix expression.
`settings` edits only global upload settings, not session/project capture settings.
`on` explicitly approves the destination, reads the private bearer file and stores
its SHA-256 `tokenHash` fingerprint. That fingerprint is not the secret bearer;
the bearer itself is never written to the preferences file.

Approval applies only to **newly committed episode revisions after upload is ON**,
across active and future project journals. There is no journal scanner, historical
backfill or upload of revisions committed while upload was OFF or its settings were unavailable. Invalid upload settings are reported visibly; local summaries still publish without enqueueing or spending inference retries. The canonical
commit and durable enqueue share the short authorization transaction; they use the
stored credential pin without opening the bearer file. Missing or rotated
credentials therefore do not prevent local summary publication.

The delivery pump runs only while Pi is active, without model inference.
`/historian off` stops new local capture/publication as before, but already-authorized queued
summaries can still drain while Chronicle upload is ON. `/historian chronicle off`
explicitly pauses upload and retains pending items. It cannot retract a request
already admitted or data already accepted by Chronicle.

Each queued payload has a stable UUID and at most three automatic delivery
attempts, durably counted across reloads. Pending items remain bound to the endpoint,
namespace and approved bearer fingerprint. OFF, a destination change or a different
bearer fingerprint pauses incompatible pending work rather than silently rerouting
it. Each network attempt reopens the current token-file path and checks the pin;
moving the same credential file does not change its binding. For token rotation,
explicitly approve again; old pending items are not reassigned to the new credential.
A changed credential/destination starts an isolated wire source namespace, even for
the same Chronicle owner, because an Ingest-only bearer cannot establish owner
continuity. Earlier streams remain separate archived sources; there is no automatic
merge or backfill. `retry` retries the same approved binding and exact payload, not
permission to send old work somewhere else. Permanent rejections and oversized
payloads stop visibly; other episodes continue. Status counts refer to the current
configured bearer binding, including while OFF; pending other bindings are reported
separately. Status does not open the credential file.

Payloads contain summary text, summary/provenance metadata and evidence references,
**never raw evidence bodies**. Summary redaction is best effort, not a guarantee
that summaries contain no secrets. Chronicle's configured providers and ACL/sharing
rules apply after ingestion. Review the destination and its downstream disclosure
policy before enabling; capture-provider consent is not Chronicle consent.

Upload settings live only in `<agentDir>/historian-chronicle.json`. Version 1 requires
all fields, including `enabled`, `endpoint`, `tokenFile`, `collectorNamespace` and
`tokenHash` (null until approved). Disabled settings may be incomplete; nonempty
values still must be valid. ON requires a complete destination and lowercase
SHA-256 pin. Namespaces must be nonblank Unicode scalar text of at most 256 UTF-16
code units. Reading settings never creates files, generates a namespace, opens a
bearer file or contacts a server. A malformed file fails closed; it does not fall
back to another destination. A writable global document replaces the entire managed
destination, including explicitly empty fields. Project files cannot select upload
routes or credentials. Cooperating commit/enqueue and ON/OFF updates use the same
short synchronous global lock. Dialog Apply compares its displayed configuration
inside that lock; each delivery admission rechecks ON and the exact binding there.
No lock spans a dialog or asynchronous network wait. A request admitted before OFF
can still be accepted afterward; cancellation is best effort. Arbitrary
external file replacement is not made atomically revocable by that lock.

## Home Manager defaults

Home Manager defaults to `openai-codex/gpt-6.1-sol` with `medium` effort. It does
not enable Historian or grant disclosure consent. Explicit configuration or overrides:

```nix
programs.pi.historian = {
  journalRoot = "/home/alice/.local/state/pi/historian";
  model = {
    provider = "openai-codex";
    id = "gpt-6.1-sol";
    thinking = "medium";
  };
};
```

The journal root defaults to null (`<agentDir>/historian`). Set
`programs.pi.historian.model = null;` to opt out of the managed model default.
A configured root must be absolute; a model requires all three nonempty/validated
fields. Home Manager writes `historian-defaults.json` whenever either effective
option is non-null, never the mutable `historian.json`. No credentials are
stored in these options. Model precedence is session override → trusted project
override → writable global override → managed default → unconfigured. Enablement/focus changes do not pin an
inherited model. Changing a managed model preserves existing approval, not approval
for the new model; use an explicit `on` after reviewing the disclosure.

The optional Chronicle destination is independent of the model and journal root:

```nix
programs.pi.historian.chronicle = {
  endpoint = "https://chronicle.example";
  tokenFile = "/run/user/1000/chronicle-token";
  collectorNamespace = "historian-alice-workstation";
};
```

It defaults to null. When non-null, all three fields are required. Supply a stable
namespace across rebuilds; Home Manager never generates one. Home Manager writes
only `{ version = 1; endpoint; tokenFile; collectorNamespace; }` to the separate
`historian-chronicle-defaults.json`, never mutable `historian-chronicle.json`,
`enabled`, `tokenHash` or bearer contents. Managed defaults alone always remain OFF
and unapproved. Runtime global settings fully override them; capture/model changes
do not alter upload settings. Provision the private bearer file separately and
make it available at that runtime path inside any sandbox.

The root is the parent of `projects/<identity>/`. It is read when constructing a
session controller (restart/reload to change it). Existing journals and pending
evidence are **not migrated**. Keep it outside repositories and explicitly bind a
custom location read-write in a sandbox. Stable session ownership remains under
`<agentDir>/historian/projects/<identity>/` across root changes; a custom journal
also has its own lease. An undrained old request blocks a replacement controller,
even when its requested storage root differs.

## Scope, recovery and storage

Canonical Git common directories identify projects, so linked worktrees share a
journal; independent clones do not. Outside Git, canonical cwd is the identity.
Default storage is outside the repository:

```text
<agentDir>/historian.json                    # writable preferences
<agentDir>/historian-defaults.json           # optional managed capture defaults
<agentDir>/historian-chronicle.json          # private global upload settings
<agentDir>/historian-chronicle-defaults.json # optional managed upload destination; never ON
<agentDir>/historian/projects/<sha256-project-identity>/journal.sqlite
<agentDir>/historian/projects/<sha256-project-identity>/journal.md
```

Global v1 files remain readable without a migration write. Global mutations write
sparse v2: absent enabled/model/focus fields inherit, while generation and approval
metadata remain domain-owned. Legacy model `null` still means inheritance; the
shared dialog uses an explicit inherit operation, not a generic null sentinel.
Project v1 stores sparse intent plus UUID revision/activation tokens and rejects
approval fields. Cooperating mutation and capture/commit paths acquire locks in
fixed global → canonical project-target order, including across agent directories.
No lock spans a dialog, feed read or provider inference. Arbitrary external file
replacement is not made atomically revocable by those locks.

Directories are private, database/projection files are mode 0600. SQLite is
canonical; Markdown is a recoverable projection, not an editable source of truth.
A SQLite lease excludes a second publisher for the same root, including across
OS processes. Process death releases the lease. Different roots publish under
transactions and optimistic episode revisions; no publication transaction spans
inference. Shared journal context contains only the latest 12 episode revisions.

There is **no historical backfill**. Enablement, new attachments and late source
availability establish discard boundaries. Captured, authorized pending evidence
survives OFF, cancellation and restart; raw offline/disabled/preactivation history
does not become newly authorized. OFF fences new canonical revisions, requests
cancellation and preserves existing journal entries. It cannot retract a provider
request already admitted. Admission precedes asynchronous SDK/authentication work:
a request admitted while ON can first reach the provider after global OFF succeeds.
This is a capture/admission/publication fence, not an atomic network-submission
revocation or provider-side erasure guarantee. A provider that has not drained
retains ownership and blocks overlapping retries. Projection recovery can run while OFF without
another model request. Global changes are observed at reconciliation boundaries.

Restored native histories retain predecessor identity but exclude their entire
reconstructed prefix, measured after SDK migration and confirmed mailbox replay.
Unknown replay outcomes fail the reload before source publication/new task
dispatch. Reloads without checkpoints also exclude confirmed mailbox reconstruction.
If replayed notes exist only in SDK memory and no finalized native file establishes
the boundary, reload fails with `RECOVERY_OWNER_UNCONFIRMED` before new inference;
accepted notes remain retained, but that task does not run. The pinned SDK does
not expose a public setup-only flush operation; guessing a zero-byte boundary
would disclose the replay when the next user message materializes the file.
Original sources are read independently. First deliveries queued while
a child was unloaded can also fall within this excluded prefix: their recipient
history is omitted, even if sender-side evidence exists. This is an explicit
coverage limitation, not implicit permission to disclose reconstructed history.

## Attempts and output validation

`status` separates the current three-attempt retry streak from durable per-session
admission totals in the selected journal and the latest ten attempt receipts. Receipts retain attempt/batch
identity, a context digest, provider/model/effort, objective version, audit times,
monotonic duration, safe outcome/category, and available numeric response/usage
metrics. They do not retain arbitrary rejected response/error bodies or duplicate
raw evidence. Receipt metadata remains for the journal's lifetime; the display, not
retention, is bounded. Schema-1/2 journals upgrade to schema 3 without inventing
historical attempt counts or upload eligibility. A persisted journal UUID and durable
summary outbox preserve source identities and exact pending request bytes.

- Counts are controller **admissions**, not wire requests; prerequisite failures
  can submit nothing, and SDK/provider retries can occur within one admission.
- `validated` means output passed validation, **not that publication succeeded**.
  A commit receipt links its attempt when publication occurs.
- `recovered` counts failed attempts with a later validated response for that same
  batch, not necessarily a published revision. Success does not erase failures.
- A new lease holder marks abandoned `running` attempts `interrupted`: outcome,
  elapsed duration and usage remain unknown. Cancellation/deadline is not drain.
- Usage is SDK-reported telemetry, not an independent measurement of actual usage.

Objective v2 requires exactly a `{ "proposals": [...] }` envelope, exact nested
fields, valid references and bounded proposals. There is no JSON repair/salvage.
The qualified `openai-codex/gpt-6.1-sol` / `openai-codex-responses` binding requests
strict `text.format` JSON schema over **SSE**. Other configured bindings explicitly
use prompt-only JSON with the same local validator. A schema/provider rejection
never removes the schema or switches model/transport as a fallback. Actual endpoint
probes establish acceptance, schema-conditioned output and invalid-schema rejection,
not decoding internals or universal semantic correctness. Claim-level citation
instructions require literal sources and matching action results; structural
validation still cannot prove entailment.

The pinned Codex adapter does **not** send `maxTokens` as a wire limit. The worker's
180-second deadline and streaming character bound remain operative safeguards;
input reservation/output-token hints are not an enforced Codex generation cap.

## Evidence and limitations

- Native session/entry identities and raw digests bind evidence. Copies are not
  new execution. Claims require citations; valid citations do not prove entailment.
- Observations, reports, hypotheses and decisions remain distinct. Revisions
  preserve corrections; a successful command is not a verified postcondition.
- The worker has no tools, filesystem reader, MCP, delegation, project instructions
  or discovered extensions. It receives only bounded evidence and published context.
- Hidden thinking, system instructions and Historian self-activity are excluded.
  Missing, nested, unsupported and truncated evidence produces coverage notices.
  Nested tool internals and external artifacts are not fetched automatically.
- Pending sanitized bodies remain durable. After processing, only bodies cited by
  accepted claims are retained; receipts keep refs/digests rather than duplicate
  batches. This is logical retention, **not guaranteed forensic erasure**.
- Capture is paged, with at most 10,000 pending events; uncaptured cursors stay put.
  Input/output/runtime/retry limits are explicit. No fixed freshness guarantee is
  made under sustained backlog. Recent coverage notices are bounded to 100 per root.
- Polling/backoff uses monotonic time. Source/recording timestamps are audit labels,
  not proof of causality or current external-system state.
- Scripted tests establish transport, persistence and authorization contracts,
  **not semantic relevance or faithfulness**. A live, held-out synthetic evaluation
  still requires an explicitly selected/approved provider. No existing private
  history is used by the test suite.

## Validation

Use the pinned SDK/shared packages, not unpinned npm installs:

```bash
nix build --no-link .#checks.x86_64-linux.ponygirls-historian
nix build --no-link .#checks.x86_64-linux.ponygirls-subagents
```

The Historian check runs TypeScript, every `tests/*.test.mjs`, and real Pi loader
checks against the packaged extension. Local equivalents are `tsc -p tsconfig.json`
and `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs` with the same pinned
SDK links. Store contracts exercise memory/real SQLite; process tests exercise
ownership, process death and shared publication. Runtime tests use in-process
scripted providers with no live network. The supervisor suite includes real SDK
checkpoint/reload/migration and reconstruction-boundary checks.
