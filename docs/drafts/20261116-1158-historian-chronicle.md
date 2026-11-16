# Historian → Chronicle implementation ledger

## Scope and observed baseline

User: extend Chronicle to ingest Historian summaries as distinct indexable/stored inputs; add Historian upload settings. No deployment, real journal disclosure, push or external publication of source is authorized.

- Main observed clean at `b0efce458e2cad7fc9ead8f65273421013477a0f`.
- Parent edits `.worktrees/wt-ponygirls-historian-ingest`, branch `feature/historian-ingest`.
- Backend worker edits independent `.worktrees/wt-ponygirls-historian-backend`, branch `feature/historian-backend`; supervisor disallows prepared `workspace_path`, so worker is explicitly constrained to that absolute worktree.
- Codegraph index inventory says ready but explore refused foreign/unknown PID namespace. No daemon action taken; direct inspection instead.
- Chronicle already uses Baboon, a sole current schema edited in place, generic source format identity, immutable raw snapshots and durable indexing jobs. Historian SQLite revisions are canonical; Markdown is a recoverable projection.
- Q70 revision 2 answered: only summaries created/updated after enabling upload; no automatic historical backfill (verified with decisions get). Queue only new canonical revisions at commit while explicitly enabled; do not scan historical revisions.

## Design and ownership

Use `SourceFormat.Historian` and existing authenticated ingest/CAS/receipt/index/read/ACL path, not a parallel storage stack. One episode is a source. Claim/basis labels and evidence references stay in summary text/structured raw JSONL; evidence/session bodies are not exported. Summary upload responsibility belongs to canonical committed revisions and a durable uploader, not Markdown rendering or the model worker.

Uploader settings are explicit opt-in, private global configuration with a bearer token FILE (no inline credential), validated destination, bounded nonredirecting HTTP. Managed Home Manager defaults never enable or approve upload. Queued payload/request identities survive lost acknowledgements; upload failures are observable and do not prevent canonical local publication. Destination/credential changes never reroute old authorized payloads: an opaque binding-derived wire namespace starts a distinct stream because Ingest-only credentials cannot establish owner continuity. Earlier streams remain separate archives, including after same-owner token rotation.

The canonical commit, eligibility and outbox insertion share a transaction; replay of an old commit cannot mint eligibility. Settings changes serialize with both commit authorization and synchronous network-attempt admission, not network waits. Bad upload settings explicitly deny enqueue while preserving independently authorized local publication. OFF pauses delivery, not deletion/retraction; already admitted requests can still complete.

## Plan and verification

1. Trace responsibilities and settle upload scope → verify current decisions/code.
2. Add specified tests first, then backend format and canonical upload/settings → verify fail-first output and focused tests.
3. Integrate worker changes → run complete pinned Chronicle backend/PostgreSQL, protocol, dashboard typecheck/Node/Chromium, collector typecheck/tests, relevance tests; Historian full typecheck/tests/packaged host and affected Nix policy checks. Use fresh report directories and retain complete logs/counts.
4. Review, fix reproduced defects, commit task-only changes, merge safely to original main, verify integrated inputs/result and remove owned clean worktrees. Preserve any Codegraph cleanup constraints.

## Verification receipts

All application data and credentials used for development were synthetic. No real journals were uploaded; no push, deployment or live-provider semantic-quality claim is made.

Source identity: base `b0efce458e2cad7fc9ead8f65273421013477a0f` plus the commit containing this note. Detailed file digests, complete logs, XML inventories, helper originals and expected-failure logs are retained under the main checkout's ignored `.local/historian-validation-20261116-chronicle/`. Application-input manifests are checked again after local integration; evidence reuse is exact-input reuse, not a new execution.

| Check | Command / result |
| --- | --- |
| Locked npm trees | Pinned `nix develop .#chronicle`, `npm ci` in both `chronicle/web` and `chronicle/collector`; lockfiles unchanged |
| Full backend | `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh`: 116 discovered suites, 1009 cases, 0 failures/errors/skips; owned PostgreSQL cases executed serially |
| Full inventory/XML | Fresh reports preserved before protocol run; `validation-report.py` accepted all 116 suites/1009 cases, without filtering XML |
| Protocol | Pinned shell, `TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh` in `chronicle`: 17 TS fixture groups, sole API 1.9.0, removed/future rejection retained; 3 JVM suites/18 cases, 0 failures/errors/skips |
| Dashboard | Pinned shell, `npm run typecheck`, `npm test`, complete `npm run test:browser`: 147 Node cases, 0 failures/skips, all 20 Chromium entrypoints passed. Browser scripts report scenario/group results, not one aggregate case count |
| Collector | Pinned shell, `npm run typecheck && npm test`: 125 cases, 0 failures/skips |
| Relevance workflow | `python3 -m unittest discover -s chronicle/eval/relevance/tests -v`: 172 cases passed. Runner/transport, annotation prompts, ranking and eligibility were unchanged; no controlled live-provider leg was required or claimed |
| Historian | Pinned Node/compiler, complete typecheck plus unfiltered `node --test tests/*.test.mjs`: 168 cases, 0 failures/skips/cancellations |
| Packaged Historian | `nix build .#checks.x86_64-linux.ponygirls-historian`: full 168 cases plus 4 real-SDK packaged-host cases, including new-summary-only upload and reload, 0 failures/skips |
| Nix policy/module checks | `subagents-policy-shape`, `chronicle-validation-policy`, `chronicle-evidence-layout`, `chronicle-protocol`, `dev-llm-module-boundary` all passed. Some unchanged-input policy derivations were reused; builder outputs are retained |
| TUI | Isolated Pi 1.5.2 + tmux 3.8 + scripted provider, private disposable config, 120×40 and 80×24: configure saves OFF, Cancel preserves bytes/OFF, explicit approval enables, OFF persists, normal exit 0 and private-server cleanup verified. Some main-editor submissions required explicit CR/CSI-u parser probes; do not claim physical-terminal key-transport coverage |

The first Nix protocol build correctly rejected its stale expected count of 16 after 17 fixture groups passed. `protocol-validation.nix` was corrected to require 17; the complete Nix check command then passed. This was not an application/protocol failure and was not filtered away.

## Reproduction and review

Backend expected failures were captured before adding/regenerating the Historian enum and vocabulary. Root outbox tests failed before implementation. Independent read-only review found six concrete boundaries; expected failing tests preceded their corrections:

1. Stale dialog approval could enable a replacement destination.
2. OFF between initial reconciliation and admission still allowed a new HTTP request.
3. Credential rotation reset local remote-CAS state but reused the old wire source.
4. Oversized preparation escaped durable stop bookkeeping and starved unrelated episodes.
5. Invalid upload preferences prevented canonical local publication.
6. A failed settings read leaked an approval-operation marker.

Additional reproduced diagnostic defects were an empty result claiming a saved revision and OFF hiding acknowledged counts. Corrected full suites passed afterward. Final independent review reported no residual substantive findings; the later count-only correction was independently reproduced and covered by the final full extension/package rerun.

The backend worker's code/tests and settings worker's code/tests/HM module were byte-compared with the integrated tree. Only their documentation was intentionally superseded; complete originals and comparison receipts were retained.

## Integration and cleanup

The tested task tree is ready for commit and local integration; no push or deployment is authorized or performed. Completion requires committing the verified changes, safely integrating into the original main branch, and checking the exact application-input manifests there. Post-integration receipts are retained with the validation artifacts. The unindexed task worktree is removed only after those checks. Two helper checkouts acquired Codegraph indexes automatically; online removal is unsafe under its documented reader protocol. Q71 records the retention/barrier decision for those exact paths. No foreign daemon, reader lock or index file is removed without the required barrier.

## Reusable procedure accounting

Delegated skill analysis proposed a narrow optional-export settings composition. Root reviewed it against the actual corrections and installed skills, searched Haystack overlap, and read related approval/admission/configuration drafts. An inert, single-feature-qualified `consent-bound-export-settings` draft was saved and reread at `corporate-activity:skill-draft-consent-bound-export-settings` revision 1. It was not installed or activated.
