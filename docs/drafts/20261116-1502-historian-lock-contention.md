# Historian shared-settings contention

User explicitly requested fixing, pushing and redeploying after Q75 confirmed two independently created Pi session IDs. Same-directory capture should coexist; shared project/episode grouping is unchanged.

## Reproduction and scope

At baseline49b5d838, an isolated two-process probe confirms different session lease keys coexist. Both a duplicate session lease and ordinary shared PreferenceStore snapshot contention fail with `Historian session is already owned by another process` / SQLite database locked. Live journals/locks were untouched. All lock acquisitions currently use busy_timeout0, including short global/project-target/Chronicle settings mutexes.

## Plan and invariants

1. Add failing real-process regression tests through owning preference/project APIs; preserve same-ID exclusion, process-death release, and data/authorization invariants.
2. Put bounded contention handling and scoped diagnostics at the shared lock owner, not ad-hoc retries in callers. Keep session/uploader leases fail-fast, file/key identity unchanged, and no lock across async model/network work.
3. Run complete Historian typecheck/Node/packaged real-Pi tests, including two independent processes; retain exact-input evidence for unaffected Chronicle suites. Review the correction.
4. Commit/integrate/publish Ponygirls, update Paddock's provider pin, run policy/profile checks and guarded current-user setup. This is an extension-only correction, not a server restart. Preserve active capture/upload approvals, all credentials, concurrent changes and no-backfill behavior. Commit/integrate Paddock locally unless separately asked to push.

Task worktree: `.worktrees/wt-ponygirls-historian-lock-contention`, branch `fix/historian-lock-contention`. Test-only SDK dependencies link to the installed pinned1.5.2 package; local evidence is under `.local/historian-lock-contention/` and archived privately at `/home/pavel/.local/state/historian-lock-rollout/20261116-1502/validation/`.

## Verified correction

The three new true-process regression cases failed first with the exact ownership error (the initial missing-SDK-link attempt was an environment failure and is separately retained). `acquireSettingsLock` now uses a named5000ms SQLite bound for global/project/Chronicle settings. Existing file/key identity is unchanged, including coordination with the legacy fail-fast helper. Genuine session and uploader leases still use timeout0. Reads/revalidation remain inside the acquired lock; callbacks are not retried. Contention and corrupt-file/I/O failures have distinct messages and preserved causes. No journal/schema/grouping change was made.

A real-Pi-SDK child-process case creates two independent SessionManager IDs sharing cwd and agentDir, forces settings contention, then checks status/notify output, provider admissions and each owner's canonical publication. It fails against the unmodified installed package with the actual ownership notification and missing capture baseline; the candidate succeeds. An empty SDK onError array alone would have missed this failure. Existing synchronous reentry/spawnSync exclusion cases remain bounded failures with updated scoped diagnostics.

Final unfiltered Nix check passed typecheck plus176 Node cases and5 packaged real-Pi cases, zero failures/cancellations/skips. Seven focused SQLite contracts also pass: all3 shared settings scopes; fresh read-modify-write state retaining both writers' changes/generation; timeout/recovery while session exclusion remains fail-fast; and corrupt-file classification. Prior lease/death-release and journal/authorization tests remain intact. Result `/nix/store/n8isadfqf96i9nq1jjiv4q0pf9qydcym-ponygirls-historian-test`; raw builder log and acceptance.json are archived. Independent read-only review found no substantive findings.

Chronicle native derivation is unchanged at `/nix/store/kw9raj1xgp6qjrpa02rfy2h2hz9kc51p-chronicle-native-development-artifact-0.1.0.drv`; this is a client-extension correction, not a server refresh. Current17-path integrity baseline captures the already-enabled global capture/upload preferences and existing credentials before client activation. Paddock task branch `fix/historian-lock-rollout` starts at clean main `e32539b`.

Publication, consumer pin update and guarded profile activation follow this verification. Existing Pi processes must reload to replace already-loaded old code; mixed-version file coordination does not change old runtimes' fail-fast behavior.
