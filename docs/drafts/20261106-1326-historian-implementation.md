# Historian implementation ledger

Status: implementation and mechanical validation complete. Integration receipt below.
User authorized implementation after Q25. Initial base:
`1ec22b0e659c42b0f4c8f3781c0d84f6cc28d7a5`; fast-forwarded to
`32034dab6687c349f9c1c24410611c9cead94e3a` before final implementation checks.

## Confirmed scope

Q25 revision 2, read with decisions.get in this session: shared project journals
across sessions, kept outside the repository. Global defaults/session overrides
remain separate from project journal scope. No deployment/activation or disclosure
of existing private histories authorized by the implementation request.

Q26 pending: desired Historian provider/model/thinking, or permission to use current
main model for a synthetic pilot. Implement configuration with no default model or
silent fallback. Deterministic/scripted-provider checks are independent work.

## Implemented choices

- One restricted worker per enabled main session, publishing to a shared project
  journal. This avoids a cross-process observer daemon and preserves local OFF.
- Project identity: canonical Git common directory across linked worktrees, canonical
  cwd outside Git; independent clones stay separate (do not infer from remote URLs).
- Private storage under `<agentDir>/historian/projects/<project-id>/`; structured
  immutable commits, derived Markdown, per-session durable capture/cursor state.
- Serialize publication across processes; stale episode revisions must not overwrite
  concurrent changes. Keep per-source provenance and explicit episode links.
- No implicit raw-history access to other root sessions. Workers may consume the
  shared published journal, and their own authorized main/descendant evidence.

## Work allocation and verification

- Parent implements all changes in `.worktrees/wt-ponygirls-historian` on
  `feature/historian`. Prepared writer workspaces were denied by supervisor policy
  (no workspaceRoots); no policy bypass attempted. Unused clean worktrees removed.
- Read-only advisor `6f497777-0712-4465-9e2d-b8e04bf1d0f2` supplied feed anchors
  and reviewed core and bridge changes. No delegated edits or external queries.
- Packaging/Nix integration and mechanical checks are complete (receipts below).
  Live semantic acceptance is not authorized by the still-pending Q26.
  Final commit/merge/cleanup are recorded separately from test execution.

## Feed contract (v1)

Channel: `ponygirls-subagents:history-v1`.
Request: `{ rootSessionId: string, respond: (feed: HistoryFeed) => void }`.
Only governing-session extension code receives this capability; no model tool.

```typescript
interface HistorySource {
  sourceId: string;
  rootSessionId: string;
  agentId: string;
  agentPath: string;
  sessionId: string;
  parentAgentId: string | null;
  taskRunId: string | null;
  kind: "agent" | "review";
  copiedFrom: string | null;
  reconstructedPrefixBytes: number;
}
interface HistoryPage {
  entries: readonly unknown[]; // finalized Pi SessionEntry objects; consumer validates
  nextOffset: number; // byte offset into registered JSONL source
  eof: boolean;
  ready: boolean;
  gaps: readonly string[];
}
interface HistoryFeed {
  sources(): readonly HistorySource[];
  read(sourceId: string, offset: number, limit: number): Promise<HistoryPage>;
  subscribe(listener: () => void): () => void;
}
```

`read` is bounded in records and bytes; partial trailing JSONL line is not finalized.
No arbitrary paths. Source registration/identity must survive reload; identical copied
entries are not new execution. Native session identity + entry ID + integrity digest
bind evidence; contradictory bytes under the same identity are a visible fault.
Task-run metadata cannot be treated as immutable per-entry attribution if one native
session spans multiple tasks; preserve task assignments/messages and mark unavailable
exact mappings. Gaps report nested-tool metadata/results limits, not fabricated full
coverage. Notifications are hints, durable paged sources are authoritative.

## Progress

- Initial design inspected Pi 1.4.0 docs and concrete supervisor/worker limitations.
- Q25 confirmed; original design updated to shared project journals.
- New `ponygirls-historian/`: SQLite transactional shared store; private per-root
  SQLite exclusive lease; evidence extraction/redaction; tool-less Agent worker
  using the explicit ModelRegistry model; global/session settings and disclosure
  approval; controller, commands, badge/status/Markdown view.
- Scoped `ponygirls-subagents/src/history.ts` implemented; durable source records,
  checkpoint predecessor IDs, restore/reviewer registration, root-only event bus
  capability and per-attachment revocation wired. Production worker protocol did
  not need changes.
- No activation, deployment or live-provider inference. Q26 re-read during implementation:
  still pending revision 1. Only synthetic scripted-provider traffic.

## Iteration evidence (not final acceptance)

Pinned Pi SDK: `/nix/store/yba75cg526cdpyjlb095g0j8sfyk1qsh-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo`.
TypeScript: `/nix/store/mfrbqj78li0mmzi32xlbisgc6lr8qhnr-typescript-7.0.2/bin/tsc`.
Node: 24.21.0. Local ignored `node_modules` symlinks provide pinned SDK/settings/UI;
subagents/node_modules points to historian/node_modules. No unpinned install.

- Historian: `tsc -p tsconfig.json` and
  `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs`: 20 tests passed,
  0 failed/cancelled/skipped, ~0.71 s. Includes real Agent/ModelRuntime
  scripted-provider tests (not full Pi extension-loader or semantic-quality tests).
- Reproduced then corrected: quoted credential leakage after JSON encoding;
  OFF restart accidentally backfilling disabled intervals; late feed attachment
  backfilling old descendants; consent precedence coupled to enabled inheritance;
  quote-heavy serialized evidence exceeding the batch bound; cancellation allowing
  overlapping provider streams. A single worker now retains its drain state and
  controller ownership remains held if provider cancellation has not drained.
- Subagents full regression iteration:
  `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.ts`:
  769 tests, 726 passed, 43 failed, 0 cancelled/skipped, ~172.5 s.
  Log retained at `ponygirls-subagents/node_modules/.historian-validation/subagents-20261106-1353.log`.
  Most failures: real-process test factories place native sessions in `dir/sessions`
  while Supervisor root is `dir/root`; strict source registration rejects them.
  Align test storage with root ownership; do NOT loosen source confinement or
  shorten tests/deadlines. A few fake fixtures also need native header/event-bus
  shapes (model-reuse/governor-evidence now corrected; not yet rerun).
- Bridge regressions reproduced then corrected: partial initial header treated as
  corruption; false incomplete-tail gap at page boundaries; checkpoint ingestion
  following an escaping symlink and republishing those bytes as an authorized
  restored source. Reader/checkpoint ingestion now share an FD-based confined open.
- Focused subagent check after those corrections:
  `tsc -p tsconfig.json && node --test tests/history.test.ts tests/index.test.ts tests/transcript-source.test.ts`:
  25 passed, 0 failed/cancelled/skipped, ~1.91 s.
  These are not full-regression acceptance.

## Subsequent implementation / evidence

- Aligned process-test rootDir with their native session directory; preserved all
  assertions/deadlines/concurrency. Tagged roots retain separate session folders;
  OS-restart phases now retain the same root. Full subagents suite then passed:
  **770 tests, 0 failures/cancelled/skipped, 52.884 s**, with typecheck passing.
  Log: `ponygirls-subagents/node_modules/.historian-validation/subagents-20261106-roots-aligned.log`.
  Later bridge changes below invalidate this as final regression evidence.
- Added real Pi loader/runtime/command/reload tests with separate scripted main and
  Historian providers; no live network. Added OS-process SQLite exclusivity,
  SIGKILL lease release, concurrent publication and durable pending-before-crash tests.
- Further failing reproductions followed by fixes: every runtime attachment now
  baselines unknown offline history while retaining durable pending evidence;
  event hints now expedite an existing 10-second poll; streaming output is bounded
  before provider completion; unselected processed evidence bodies are pruned and
  receipts retain identities instead of duplicating transcript bodies. SQLite
  secure_delete is enabled, but no forensic erasure guarantee is claimed.
- Capture coverage accompanies worker payloads and derived Markdown (most recent
  100 distinct notices per root); activation/disable notices include observation
  timestamps. Only latest 12 episode revisions are supplied as context, explicitly
  declared incomplete; no arbitrary history/journal-read tool is provided.
- Bridge bus/current-root and same-policy-reload revocation tests pass. A simulated
  pre-bridge retained runtime reproduced a TypeError and cleared handoff timer;
  attach now rejects it with UPGRADE_RESTART_REQUIRED before touching retirement.
- Advisor core review `eb226531-5eab-489d-a81f-b3eff56fce96` (source-only, no execution)
  identified further defects and a copy-prefix migration caveat. Parent reproduced
  the failures: preactivation copied-prefix disclosure; unavailable activation source
  materializing later (including nonzero prior cursor); missed global OFF→ON;
  full-backlog processing deadlock; missing projection after committed crash window.
- Current corrections:
  - HistorySource includes reconstructedPrefixBytes. Final restored registration
    follows successful initialization, SDK migration and confirmed mailbox replay,
    before new task dispatch. Original sources remain independently reconciled;
    copies start at max(saved offset, reconstructed prefix). Earlier pre-replay
    measurement was insufficient and was superseded by the corrections below.
  - HistoryPage.ready is false for unavailable files, incomplete native headers,
    or incomplete sampled EOF tails. Durable `baseline:<sourceId>` markers discard
    initial history until a readable finalized EOF, even across positive cursors.
  - Defaults have enabledGeneration; writes serialize on a private SQLite lease.
    Global command mutations run under that lease against current defaults. Roots
    inheriting enablement include generation in their authorization key/baseline;
    session overrides ignore unrelated global toggles.
  - Main/native capture is bounded by remaining queue capacity, without advancing
    uncaptured cursors. Existing pending batches can drain a full queue.
  - SQLite tracks dirty Markdown projection; reconciliation repairs it independently
    of inference, including OFF attach. Projection errors are separately visible,
    retried without resending already committed evidence.
- Earlier iteration checks (superseded by final checks below):
  - Historian `tsc -p tsconfig.json` + full `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs`:
    **36 passed, 0 failed/cancelled/skipped, 1.452 s**.
  - Subagents `tsc -p tsconfig.json` + `node --test tests/history.test.ts tests/index.test.ts`:
    **22 passed, 0 failed/cancelled/skipped, 1.893 s**.
  - These remain iteration checks, not final acceptance or semantic-quality evidence.

## Final boundary corrections and review

- Persisted local enabledRevision complements global enabledGeneration. Fresh
  effective preferences serialize capture, worker admission and canonical commit
  with global updates through the same short SQLite lease. No lease spans async
  feed I/O or inference. Real child-process OFF race tests and lock-bypass negative
  controls establish the protected boundaries.
- **Admission is not network submission.** A deterministic real-Agent/scripted-
  provider test executes global OFF after admission and before first provider
  invocation: pre-admitted evidence reaches the provider, post-OFF evidence does
  not, publication is rejected and pending evidence survives. This is documented
  behavior, not a claimed atomic-submission fix or provider erasure guarantee.
- Checkpoint reload validates ACK path/session identity, finalized confined native
  bytes and post-replay size. Tests exercise actual SDK v2 migration, chained
  native restores and mailbox notes predating activation. Unconfirmed lookup or
  replay fails with RECOVERY_OWNER_UNCONFIRMED before publication/new dispatch;
  a timeout is not drain. Model-reuse fixtures now use real SessionManager.open.
- Two no-checkpoint controls first disclosed PRIVATE_NO_CHECKPOINT_REPLAY.
  Registration now follows confirmed mailbox reconstruction and a verified final
  materialized prefix. Materialized recovery excludes old notes and admits new
  work; actual SDK memory-only recovery explicitly refuses the reload and kills
  the uncertain replacement. No public setup-only flush was found in pinned Pi.
  Accepted notes remain retained. This external SDK constraint causes an explicit
  availability limitation; it is not hidden behind a guessed zero prefix.
- Restore checks use the accepted task's matching durable task.terminal, not the
  asynchronous command acceptance or latest executed task projection. Readiness
  checks synchronize on durable mailbox receipts rather than fixed sleeps.
- Projection-rename failure removes only the owned temporary file and repairs
  without repeating committed inference. Retry/backoff uses monotonic time.
- A real Agent/scripted-provider capacity control drains **10,000 retained events
  plus one overflow exactly once**, through 209 bounded batches. Final pending=0
  and main cursor=1; no reduced-capacity substitute. Focused run: 1/1, 4.365 s.
- Final read-only review task `f4d9ddeb-f4db-450f-9f84-b799cd386c80` found no material
  finding in the no-checkpoint correction or its materialized/memory-only controls.
  It accepted the expressly documented admission boundary as a limitation, not an
  unresolved defect. Reviewer inspected source; executions belong to the parent.

## Final mechanical validation (2026-11-06)

Pinned Pi SDK: `/nix/store/6ah99dii1kwj9bfi4cpx23rh2m698nzd-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo`.
Node 24.21.0 and TypeScript 7.0.2. No unpinned npm install.
Source: task changes atop `32034dab6687c349f9c1c24410611c9cead94e3a`; Nix output
identities below bind exact source/toolchain inputs, independently of this ledger.

```bash
nix build --keep-going --no-link --print-out-paths -L \
  .#checks.x86_64-linux.ponygirls-historian \
  .#checks.x86_64-linux.ponygirls-subagents \
  .#checks.x86_64-linux.ponygirls-decisions \
  .#checks.x86_64-linux.subagents-policy-shape \
  .#checks.x86_64-linux.dev-llm-module-boundary \
  .#checks.x86_64-linux.tui-hm-eval
```

Exit 0. Both affected extension typechecks passed. All application test files
were unfiltered. Policy evaluation also verifies subagents-before-Historian load
order and that Home Manager does not manage the user's historian.json consent.

| Check | Cases passed | Fail / cancel / skip | Evidence |
| --- | ---: | --- | --- |
| Subagents | 779 | 0 / 0 / 0 | Fresh final-source run 53.775 s; exact-input result reused in last invocation |
| Historian | 46 | 0 / 0 / 0 | Fresh 6.884 s, including actual capacity drain |
| Packaged combined extension host | 2 | 0 / 0 / 0 | Fresh 1.433 s; subagents loaded before Historian |
| Decisions | 120 | 0 / 0 / 0 | Existing exact-input Nix result reused; retained build log inspected |

Output identities:

- Historian: `/nix/store/951h32d9c6bb9h5rilbvhlfsxfqjyhll-ponygirls-historian-test`
- Subagents: `/nix/store/bakvpnl3nmk9qxhc1ghfhqz15fwf1yja-ponygirls-subagents-test`
- Decisions: `/nix/store/ggyr73qybhfzjmsa2hz4jl7ywdmr91j0-ponygirls-decisions-test`
- Policy shape: `/nix/store/x973xqwwx0prbzdl7slhban1nwmnkfka-subagents-policy-shape-test`
- Module boundary: `/nix/store/1n0a399hajmhj8nzckyxqg8whkk6kygv-dev-llm-module-boundary-test`
- TUI HM: `/nix/store/4qm393i6i3f6nganicyfwxcdkys12cz3-tui-tools-hm-test`
- Packaged extensions: `/nix/store/a9jsqrmm5j74zblgq1ik0fd9fbkc8jxf-ponygirls-pi-extensions`

Local untracked logs were preserved before worktree removal under the main Git
common directory: `.git/historian-evidence-20261106/validation/`, including
`nix-20261106-final.log`, `nix-20261106-no-checkpoint.log`,
`decisions-cached.log`, and `no-checkpoint-red.log`. Both synthetic PTY directories
are retained in `.git/historian-evidence-20261106/pty.tar` (sockets excluded).
These owner-private local artifacts are not runtime prerequisites.
`git diff HEAD --check` passed before final documentation bookkeeping.

## Interactive evidence

Real Pi 1.4.0/tmux 3.8 PTYs used disposable project/HOME/config/cache/session
storage, explicit environment allowlists, no real credentials/MCP/context/tools,
and the no-network fixture provider. Launch argv/environment, actions, raw ANSI
and rendered captures are retained in `/tmp/hist-tui.moN4SI`.

Observed: default OFF/unconfigured rejection; explicit model/ON; HIST badge;
synthetic evidence-linked episode; journal at 80×24 and 120×40; Escape close;
injected SGR badge open/close; local OFF despite global ON; inherit → global ON;
global OFF; reload retaining OFF; normal /quit with exit 0. Only the run-owned
private tmux server was killed, and its control endpoint no longer responded.
An initial startup wait expected the model display name instead of footer `main`;
this was a harness expectation mismatch, not an application failure.

The initial UI run predates the final no-checkpoint restore correction. Fresh
final-package confirmation in `/tmp/hist-tui-final.7xW4lZ` verified model/ON,
synthetic cited journal, narrow/wide rendering, Escape, OFF, reload retaining OFF,
and /quit exit 0; its private server was then stopped and its endpoint rejected
control. The first combined driver sequence expected the wrong journal title and
sent commands before Escape completion; those attempts did not change settings.
A corrected fail-fast sequence waited for the viewer to disappear before command
submission and verified each rendered outcome. Failed-attempt captures remain.
Injected mouse bytes establish application parser behavior, not physical terminal
input transport. No semantic-quality inference follows.

## Deliberate exclusions and follow-up authority

- Q26 was last checked pending revision 1, answer null; no live-dependent work was
  performed. No live model evaluation, private-history pilot, production provider
  selection, deployment or ordinary-session activation is claimed.
- No exhaustive combined-host multi-hop/reviewer/fork lifecycle journey or sustained
  main-session starvation/fairness benchmark was run. Existing full regression,
  focused bridge and combined-host tests are not a claim that every composition
  was exercised. No fixed freshness guarantee is offered under sustained backlog.
- Nested internals absent from native outer transcripts remain unavailable. Prefix
  exclusion may omit first recipient deliveries queued while unloaded. All shared
  published content remains interpretation; citations do not establish entailment.
- A delegated skill analysis was narrowed/reviewed and saved, not installed:
  `corporate-activity:skill-draft-transcript-replay-consent-boundaries`, revision 1,
  human attention required. Parent verified it with get. Initial put was rejected
  for malformed link tuples; corrected schema succeeded. Full adjacent draft
  reads and best-effort overlap limits are retained in its metadata.

## Integration receipt

- Implementation committed as `a7a4360289e38380ff4d274c5c8440e29716c562`.
- Main advanced concurrently to `36847d70780bdadd2ee7d9b05b6ba708bc702b1f`
  (unrelated Manure work); the initial fast-forward was safely refused without
  changing main. Merged that history into the clean task worktree without conflict
  as `4385ef2e17dfc0f971064e1ee5d32459dd8ee75c`, preserving both histories.
- All six checks passed again after that merge with the exact same Nix output
  identities above (cached execution evidence reused, assertions reevaluated).
  Receipt: `.git/historian-evidence-20261106/merged-checks.log`.
- Finalization procedure: fast-forward clean main to the descendant containing
  this receipt; rerun integrated checks; remove only the clean task worktree.
  Actual final branch/commit, check outputs and cleanup postconditions are recorded
  separately in `.git/historian-evidence-20261106/completion.json` and the closing
  session report. No push, deployment or installed-session activation is included.
