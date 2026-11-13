# Shared scoped extension configuration

## Scope

Migrate the ordinary extension preferences for Cuckoo, Decisions, Context Archive,
Fast mode and Historian. Add the same staged configuration interaction:
session/project/global tabs, checkbox/value rows, effective origins, explicit
inherit/reset, Apply for the selected scope and cancellation of unsaved drafts.
Project configuration is ignored without Pi project trust and rechecked before
writes. New project settings do not become provider/tool/host authorization.

Preserve built-in behavior: Cuckoo OFF, Archive OFF with 70/50 watermarks,
Decisions ON, Fast ON, Historian OFF. Preserve legacy `/fast on|off` as global.
Other existing commands retain their session/global meaning. Archive threshold
pairs and Cuckoo growth policies are indivisible settings. Existing file reads
must not rewrite legacy data.

## Ownership

- `@ponygirls/pi-settings`: generic typed value/origin resolution, per-scope
  drafts, explicit tagged set/inherit changes, controller and async operation
  lifecycle. No terminal dependency or permission implementation.
- `@ponygirls/pi-ui`: one scoped panel/dialog using shared chrome, allocated
  scrolling and real mouse gesture handling. It consumes presentation DTOs and a
  typed controller port, with a type-only dependency on pi-settings.
- Extensions: codecs, migrations, persistence/session records, defaults, runtime
  activation and domain-specific editors/approval.

This avoids putting a terminal UI in the headless persistence library or copying
Cuckoo's implementation into each extension. It does not create a schema system
for unrelated host configuration.

## Boundaries

Historian retains its model-specific consent, lock ordering and activation
revisions. Project files may request enabled/model/focus but cannot carry or reuse
provider approval. Project ON needs explicit root-local approval bound to project,
activation generation and full resolved model. A setting, project trust or native
user-role message is not approval. Managed model/journalRoot remain read-only.
Observed trust/read-fault/source/generation changes must fence old work and prevent
backfill through disabled or uncertain intervals.

Subagent policy/grants, executable paths, credentials/provider profiles, Codegraph
workspace admission, model-picker data and goal/budget/runtime records are not
ordinary configuration-dialog candidates. Leave their ownership unchanged.

## Verification

Baseline checks: shared pi-ui/settings, Cuckoo, Decisions, Archive and Historian;
Fast's existing suite is also required. Run complete affected source/package
suites after migration, preserving native SDK and filesystem legs. Add contracts
for nullable values vs inheritance, managed origins, trust/fork boundaries,
source-target changes, failed writes, async editing/apply disposal and ownership.
Exercise actual PTYs in regular/fullscreen and narrow/wide geometry. Use synthetic
controlled providers only; no private data transmission or live-provider claims.

No push, deployment or unrelated worktree cleanup is part of this change.
