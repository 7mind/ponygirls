# Historian

An opt-in, evidence-linked project lab notebook for Pi 1.4.0 / Node 24+.
A tool-less worker interprets significant research, experiments, deployments,
blockers and discoveries from the governing session and its descendants.
Mechanical activity is omitted unless needed for reproduction. These are model
interpretations, not verified current state or a complete transcript backup.

## Enablement and disclosure

**Default OFF, no built-in model, no model fallback.** Load after `ponygirls-subagents`
for descendant coverage. Select an authenticated model explicitly:

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
| `on`, `off` | Override this root session, across branches/reloads |
| `inherit` | Remove the local enablement override |
| `default on`, `default off` | Change global defaults; local overrides still win |
| `default model PROVIDER MODEL THINKING` | Set global model selection |
| `model inherit` | Inherit global model selection |
| `default model inherit` | Clear writable global selection; inherit managed model, if any |
| `[default] focus TEXT`, `focus inherit` | Configure/inherit the journal objective focus |
| `status`, `journal` | Read status or the journal without inference |

A global ON requires a configured global model and approves that model. Session
consent is independent of enablement inheritance. A fork gets a new session
identity and does not inherit copied session-local approval. OFF is not a
project-wide switch: another enabled root can keep publishing to the project.
Defaults mutations serialize with capture/admission and canonical commits. A
contending command reports an ownership error rather than pretending it changed
the setting; retry it after the current short transaction finishes.

`HIST` shows enablement, `HIST …` active work, `HIST !` a fault. Click the badge or
use `status` to distinguish requested enablement, backlog, provider drain,
projection errors and coverage. After three failed attempts, use `on` in that
root to retry; no silent provider fallback occurs.

## Home Manager defaults

Optional configuration; neither setting enables Historian or grants disclosure consent:

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

Both options default to null. A configured root must be absolute; the model requires
all three nonempty/validated fields. Home Manager writes `historian-defaults.json`
only when an option is set, never the mutable `historian.json`. No credentials are
stored in these options. Model precedence is session override → writable global
override → managed default → unconfigured. Enablement/focus changes do not pin an
inherited model. Changing a managed model preserves existing approval, not approval
for the new model; use an explicit `on` after reviewing the disclosure.

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
<agentDir>/historian-defaults.json           # optional managed defaults
<agentDir>/historian/projects/<sha256-project-identity>/journal.sqlite
<agentDir>/historian/projects/<sha256-project-identity>/journal.md
```

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
retention, is bounded. Schema-1 journals upgrade to schema 2 without inventing
historical attempt counts.

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
