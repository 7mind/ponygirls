# Subagent storage-failure investigation

Base: `a8a530ba13a6837d16783a116b98bdf05b7bf459`.
Branch: `fix/subagents-storage-fault`.

## Scope

User reported ENOSPC during a journal durability barrier, with the store still
failed after space recovered. The incident host, timestamps and disk consumer
have not been independently verified. No incident files were pruned and no
session was restarted. Tests never fill a filesystem.

The FileRunStore failure latch is intentional: partial appends and uncertain
manifest publication require validated reopen, not automatic retry. `/reload`
retains the same supervisor/store. Keep that fence and do not replay uncertain
effects.

## Reproductions and corrections

- Real-store poisoning previously still admitted provider requests. Admission
  now consults latched health, including external effect-time authorization after
  an awaited preparation. The latter test failed with one executed effect where
  zero was expected before its correction.
- Failed settlement previously did not notify observers. Store health now has a
  volatile, persistence-independent notification path, explicit failed waits and
  last-known-state diagnostics. No uncommitted terminal outcome is invented.
- Failed `recordCommand` publication populated the deduplication cache. Publish
  before caching; reject side-file mutations while the journal is fenced.
- The first ENOSPC during read-triggered question expiry threw out of inspection.
  Reproduced through `listWithCapacity`; expiry now persists before mutating its
  state and inspection returns health rather than throwing a latched failure.
- Separate cleanup work (`da0e665f722ba2a18d382084c48eb31101cc11fd`) reproduced
  early loop termination after cancellation receipt failure, swallowed backend
  cancellation errors, and skipped worker-stop retries. Its implementation
  attempts all owned cleanup before reporting errors, suppresses late success,
  retains failed receipts and preserves the lock when store close fails.
- Final review exposed cancellation confirmation from the wrong backend. Six
  fail-first cases (host/sandbox × bulk/signal/controller check) reported
  `cancelled` instead of `uncertain`. Each job now records its owning backend;
  unrelated cancellation support cannot establish that its effect stopped.

## Validation

Focused commands from `nix/pkg/pi-extensions/ponygirls-subagents`:

```bash
node --test tests/storage-failure.test.ts tests/notice-delivery.test.ts \
  tests/notice-delivery-extension-sdk.test.ts tests/delegated-call.test.ts \
  tests/external-supervisor.test.ts
```

46 tests passed; zero failures/cancellations/skips. Includes real SDK workers and
an idle file-backed governor autonomously receiving a volatile failure notice
from a journal redirected to `/dev/full`. Only the fixture journal fails; this
is not evidence that a governor on the same full filesystem can save a notice.

Storage tests cover partial/short writes, journal sync, manifest write/sync/rename,
directory sync, and reopening only the manifest-selected prefix. An operation
with a failed directory sync may nevertheless be adopted on reopen; it is never
blindly replayed. Kernel ENOSPC is exercised without consuming free space.

Cleanup writer reported 10/10 new regressions and 100/100 related tests passed;
these were reviewed and integrated. Final combined validation was freshly run
against package tree `13f00dfaa1daa9e07112e398d8fa11c9e5987e73`
(`nix/pkg/pi-extensions/ponygirls-subagents`, final staged source):

```bash
nix build .#checks.x86_64-linux.ponygirls-subagents \
  --no-link --print-out-paths -L
```

Exit 0. The check runs `tsc -p tsconfig.json`, then the unfiltered
`node --test tests/*.test.ts`: **760 tests passed**, 0 failures, 0 cancellations,
0 skips, 0 TODO, about 53 seconds. Derivation:
`lyz84mhr7b0shgzazmxphl80idksdh9c-ponygirls-subagents-test.drv`;
output: `/nix/store/j7lpbcb9lq7hawkx1hsl5b1q1g8xavbx-ponygirls-subagents-test`.
The previous combined check passed 754 cases at `249d2316`; final backend-owner
coverage adds six. Two intervening typechecks rejected incomplete test-adapter
shapes (missing operation ID, then backend/probe); their logs remain preserved.
The final typed adapter and entire suite passed together.
Local raw logs are preserved at `.worktrees/subagents-storage-evidence/`, outside
the disposable task worktrees. Earlier truncated full-check output is not
counted as verified evidence. This is code/test validation, not deployment or
repair of the affected session.

Codegraph was unavailable (foreign/unknown PID namespace); source was inspected
directly. Read-only agent review identified the expiry and effect-time admission
gaps. Skill review found no distinct reusable candidate beyond existing
`dual-tests`, `tass`, and the existing Haystack draft
`corporate-activity:skill-draft-caller-completion-resource-ownership` (revision 3,
read by the parent after a bounded overlap search). No new skill was written or
installed.
