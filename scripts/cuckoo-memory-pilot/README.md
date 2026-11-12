# Cuckoo reflective-memory mechanism pilot

Synthetic, live-provider comparison of **current Cuckoo versus candidate writing and retrieval strategies**. This does not modify or deploy production Cuckoo. The earlier ON/OFF pilot was a ceiling; correct checkpoints did not establish improved task outcomes.

## Frozen comparison

A 2×2 design:

| Writing | Retrieval |
|---|---|
| Current Cuckoo v4 inquiry | Existing `cuckoo_recall` list/read |
| Generic delta/correction focus appended to the same v4 inquiry | Existing list/read plus `cuckoo_search` |

The delta instruction contains no case-specific facts, changed values or expected answers. It retains full current objectives/rules, emphasizes changed evidence and superseded conclusions, and uses the same schema, number of checkpoint opportunities and output bound. It is a prompt pilot, not a new production report format.

Search is a deliberately simple candidate: number of distinct literal query words present in each saved report, newest-first tie breaking, at most five metadata/400-character preview results. It indexes only the saved current-branch report set; it cannot inspect source documents or evaluator answers. Baseline list/read stays available. Search changes navigation/presentation, not access to exclusive evidence.

Three preselected non-Anthropic models:

- `openai-codex/gpt-6.1-sol`, high reasoning.
- `compatible/deepseek-ai/DeepSeek-V4-Pro-0813`, high reasoning.
- `compatible/Qwen/Qwen3-30B-A3B-Instruct-2507`, reasoning off (non-reasoning model).

The compatible API is explicitly registered only inside the pilot from a private configuration file, using an existing environment credential. Its `/models` response confirms model identity but does not advertise capacity. Endpoint and authentication-variable names stay outside Git under the repository's local-reference policy; the protocol binds the private file by SHA-256 without publishing its contents. The 65536-context/8192-output SDK settings are conservative **client execution bounds**, not verified physical limits. OpenAI uses pinned SDK metadata. No context-window reduction is used to trigger automatic Cuckoo scheduling.

## Task and memory trajectory

Two development cases (upgrade planning and stock reservations) and four held-out cases (meeting scheduling, consent/aliases, payment reconciliation and row-scoped sensor corrections). Cases use small, evolving source collections, not repetitive filler. Task-visible contracts specify all output fields, scope, ordering and citation rules. Hidden expected outputs and scoring live separately in `grade.mjs`; subjects have no filesystem/shell access to them.

For each model/case/repetition/writing strategy:

1. Read original sources and produce a provisional artifact; collect a genuine main-model Cuckoo checkpoint.
2. Make revised source records available, request a revised provisional artifact, and collect another checkpoint. Corrections arrive identically in all arms; no oracle-derived diff is supplied.
3. Park the target and perform two unrelated synthetic audits, each followed by a checkpoint.
4. Preserve the native JSONL prefix. Fork independent ordinary/selective recall continuations from it. Assert byte-equivalent report inventories before either continuation.
5. Apply deterministic native compaction retaining only a neutral anchor, then resume the named target. Every original/amended source record and every saved Cuckoo report remains tool-accessible. The model may use memory or re-read sources; memory use is not forced.

Automatic scheduling is OFF; four manual inquiries create matched checkpoint opportunities. This tests externalized reflection/retrieval **under controlled context reduction**, not natural cadence or in-model memory decay. Development adds an ordinary/full-context continuation as a diagnostic, not a scored treatment.

Development: 2 cases × 3 models × 2 writing strategies = 12 prefixes, each with three continuations (36 artifacts). Scored: 4 held-out cases × 3 models × 2 repetitions × 2 writing strategies = 48 prefixes, each with two reduced-context continuations (96 artifacts; 24 per treatment combination). Repetitions are fresh sampling runs, **not provider RNG seeds**. Fixed hash ordering interleaves jobs and reverses sibling recall order. No model/seed selection is based on task outcomes.

## Outcomes and limitations

Primary: strict final JSON artifact correctness and perfect-artifact rate. Deterministic task checks evaluate effective values, scope, dependencies/arithmetic, and source citations—not reflection fluency or self-rated confidence. Revised provisional artifacts provide a pre-reduction observation. Stale-value reuse is explicit; repeated failed check names are not automatically the same mistaken reasoning.

Secondary: actual memory/source tool use, report validity, model requests, returned tool characters, token usage and elapsed time. Prefix usage is counted once and separately from final-continuation usage. Latency is descriptive shared-service observation, not a controlled performance benchmark. Usage is not billing; the user authorized non-Anthropic inference without financial caps.

Every planned continuation stays in accounting. Transport/timeout/isolation failures, invalid checkpoints, incomplete artifacts and semantic failures remain distinct. An execution failure is not evidence of poor reflective judgment. No report-format failures are silently corrected or retried. A ceiling/null result is retained. The unit is the artifact/session; task checks are not independent samples. Retrieval siblings share a prefix, and cases/repetitions/models have clustered dependencies. Report per-model results; do not make statistical reliability or broad coding-efficacy claims.

There is no OFF/no-memory or generic-reminder arm. Consequently this supports only relative comparisons against current Cuckoo, not absolute memory benefit or a claim that structure beats equally expensive generic thought. Compact source fixtures may still yield a ceiling. Selective recall is lexical, not a semantic retrieval system. No live model outcome is established by instrument tests.

## Isolation, integrity and bounds

Use pinned Node 24.22.2 and Pi 1.5.2. No ambient extensions, MCP, skills, prompt templates or context files; only packaged Cuckoo and task tools. No host read/write/bash tools are exposed. Credentials remain in the approved existing auth store or provider environment and are never copied into subjects. No interactive login or model fallback. An explicit allowlist rejects Anthropic and unregistered models. Native provider continuations are disabled and OpenAI uses SSE; each fork has its own session identity.

`protocol.json` is create-only and records source hashes, commit, runtime/extension identity, case-input hashes, model selection and complete job plan. Source/runtime/plan bindings are checked before jobs. Freeze all cases and graders before held-out inference. If code must change after results exist, preserve the attempt and use a new protocol; do not overwrite or silently reclassify scored runs. Native session digests, report inventories, source IDs, tool traces and public response entry IDs support auditing. Primary answers, report inventories, token usage and final tool-use metrics are reconstructed from native entries. The supervisor records each completed worker's result-file digest; execution/request/timing metadata is checked against that receipt and is reported unavailable without it.

Execution safeguards: 4 concurrent worker processes; 180s per phase; 900s cooperative job bound; 1000s supervisor job timeout with TERM/KILL escalation; 1h batch bound. At most 48 prefix requests or 20 continuation requests, 500k payload characters, 60k public response characters/150k including exposed thinking, and 50k observed context tokens. These are runaway-execution controls, not spending caps. Local monitoring uses no credentials. Preserve exit status, authoritative result state and all partial outputs.

Native JSONL can contain provider thinking and normal runtime pathname metadata. Keep raw transcripts local; publish only sanitized public-output summaries. Provider error bodies are redacted from ordinary evidence logs. No private user sessions, indexed data or production resources are used.

## Run

Set explicit existing `PI_PILOT_AUTH_PATH`, `PI_SDK_ROOT`, `PI_CUCKOO_EXTENSION`, and `PI_PILOT_PROVIDER_CONFIG`; set `PI_OFFLINE=1 PI_TELEMETRY=0`. The private provider file has exactly `baseUrl` (credential-free HTTPS URL) and `apiKeyEnv` (the existing environment variable's name). The credential value stays in the environment, never a command argument or saved config. Keep this provider file local; do not add it to Git or presentation artifacts.

```bash
node --test scripts/cuckoo-memory-pilot/*.test.mjs
node scripts/cuckoo-memory-pilot/pilot.mjs freeze /absolute/results-v1
bash scripts/cuckoo-memory-pilot/run.sh /absolute/results-v1 development
node scripts/cuckoo-memory-pilot/analyze.mjs /absolute/results-v1 development
bash scripts/cuckoo-memory-pilot/run.sh /absolute/results-v1 scored
node scripts/cuckoo-memory-pilot/analyze.mjs /absolute/results-v1 scored
```

Scored inference requires completed same-protocol development execution, but not a favorable semantic outcome or a reproduced baseline task error. Each phase refuses rerunning into the same directory. Output belongs under the main checkout's ignored `.local/cuckoo-memory-pilot/`, outside removable worktrees. No deployment or push is performed.
