# Cuckoo feature controls and runtime integration

## Delivered behavior

Code: `7663dcf9f09638479d9ea0c687cb11acc556b040`

Verified source tree: `225a1a9d30aee04dd4ee43cea1575092e3db921b`

All seven capabilities are available through normal Cuckoo loading. New features
remain off by default. `/cuckoo settings` provides staged master/feature
checkboxes, policy editing, effective-source/dependency information and independent
session → trusted project → global → built-in precedence. Apply changes only the
selected scope; reset inherits; closing discards unsaved drafts. Existing
reflection recall/history and explicitly requested inquiries remain available
while master is off. Legacy global/session policy meanings are preserved.

| Feature | Runtime behavior |
|---|---|
| Evidence/work products | Exact selected visible transcript snapshots and typed claims |
| Corrections | Explicit corrections and dependency invalidation; disabling new corrections does not erase existing effects |
| Verifiers | Trusted bounded workers on exact artifacts/evidence; scoped findings, not whole-task correctness |
| Reader | Bounded enumeration/inspection and exact text paging |
| Transfer | Operator-selected files, complete reference closure, immutable preview and separate destination confirmation; model gets read-only historical access |
| Vectors | Per-task encoder consent, exact snapshot/query transmission, current-projection retrieval and explicit coverage/accounting |
| Critic | Per-task configured-model consent, tool-free bounded advice, native admission journal and safe-boundary-only handoff |

Q63 selected per-task consent. The checkbox is not that consent. The operator
separately chooses a task and configured destination and approves the future-data
policy. Grants cover snapshots assigned to that task ID, including subsequent
snapshots; vectors also admit model-written queries. Assignment/labels are not
semantic or human-authority attestations. The host does not harvest ambient,
system, developer or hidden-reasoning blocks.

Network consent has a 30-minute monotonic lease and declared operation/inventory
limits. Transfer has a separate exact-packet 15-minute lease. Revocation and
observed scope/configuration changes fence later work without claiming remote
provider cancellation. Receipts do not restore grants after restart. Critic
completion never starts another primary-model turn; unresolved admission requires
explicit reconciliation when no live client is known.

See `nix/pkg/pi-extensions/ponygirls-cuckoo/README.md` for encoder configuration,
commands, migration of the old `audit-memory.ts` entry and operational bounds.

## Verification

Pinned environment: Node 24.22.2, TypeScript 7.0.2, Pi SDK 1.5.2; tmux 3.8 for
owned PTY scenarios. No Anthropic inference or real private-data experiment.

| Check | Observed result |
|---|---|
| `tsc -p tsconfig.json` in the package | Passed |
| `node --test tests/*.test.mjs` | 508 tests passed; 0 failures/cancellations/skips |
| `nix build .#checks.x86_64-linux.ponygirls-cuckoo --no-link -L --option builders ''` | Packaged run executed all 508 tests, 0 failures/skips |
| `nix build .#checks.x86_64-linux.subagents-policy-shape --no-link -L --option builders ''` | Passed |
| Actual Pi composition with owned encoder/critic HTTP endpoints | Scoped vector query and critic SSE workflow passed; no unapproved main-prompt marker in critic payload; advice committed once within three existing primary turns |
| Native session/filesystem workflows | Persistence/reload, exact transfer, grant refusal/revocation, ledger recovery and explicit reconciliation checked |
| Real PTY, regular/fullscreen, 120×40 and 80×24 | Scope precedence, Apply/reset/cancel, policy editing, scrolling, resize, keyboard and SGR mouse controls verified |
| Real operator dialogs | Complete source/consent previews, visible fixed controls, Cancel default, explicit synthetic approval and revocation verified |
| Packaged Nix TUI | Checkbox activation, task/model selection and bounded confirmation passed; default cancellation sent zero HTTP requests |

The owned UI fixtures had no real credentials. Each Pi process exited normally
with status 0; its in-process fixture server closed, and each private tmux server
was removed and verified unreachable. PTY/SGR checks establish rendered cell and
application gesture behavior, not physical mouse or font-rasterization behavior.

Local detailed receipts and captures are under
`.local/cuckoo-feature-controls/validation/` and
`.local/cuckoo-feature-controls/pty-run/`; they are not private-source publications.
The final source tree was checked against the tested index tree before committing.

## Defects corrected during implementation

Fail-first evidence was retained for substantive findings, including superseded
preference repair, foreign-session setting interpretation, missing mouse press
targets, whitespace dropped by prose wrapping, clipped native confirmation chrome,
long session-derived branch IDs, approval/abort callback reentrancy, wall-clock
lease extension, critic model drift, aborted-inquiry applicability, inactive
history loading, reconciliation cancellation, and a final vector handoff after
a synchronous authorization overran its deadline.

A persistence hypothesis was rejected when the pinned SDK demonstrably persisted
the user-only native session; no restriction was added for that disproven premise.
Reviewers inspected source only. Their findings were independently reproduced and
checked by the parent; final focused reviews reported no remaining actionable
findings in their reviewed slices.

## Limits

This is functional integration and controlled workflow acceptance, **not evidence
of improved model reasoning or answer quality**. The previous comparison remains
unchanged and showed no final-answer gain. Requested/configured/reported model
identities are not weight attestation. No push, deployment, real provider grant or
private session transmission is part of this task. The unrelated concurrent yolo
commit `780df67dcbaaa630cfc32d09f79e9c5ead4404b6` was preserved in the task branch.
