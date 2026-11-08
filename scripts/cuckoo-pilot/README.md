# Cuckoo usefulness pilot (synthetic, live provider)

This is a small, controlled workflow/constraint-retention experiment, not a
benchmark of real-world task success. It does not alter Cuckoo or deploy it.

## Predeclared design

- Model: configured default `openai-codex/gpt-6.1-sol`, medium reasoning;
  actual runtime capacity must remain **500,000 tokens**. No capacity overrides.
- Treatment: real Cuckoo ON with default `window 15` (75k additional tokens per
  checkpoint). Control: same loaded extension, OFF. Compaction/retries disabled;
  no tools, MCP, skills, host context files or private indexed material.
- Three synthetic tasks: incident triage, protected-component migration planning,
  and a held-out constrained release-selection case. The latter is not used for
  feasibility, prompt development or grader tuning after observing model output.
- Each task has short/long archives, in fresh paired on/off sessions: 12 scored
  sessions total, one repetition. Arm order is deterministic hash-randomized
  within each pair. Identical source/user prompts go to both arms; assistant
  histories naturally differ. No adaptive coaching or shared generated answers.
- Two intermediate archive-inspection steps are genuine row-count/endpoint
  extraction work. Archives are explicitly historical source data, not malicious
  instructions. Long archives have 2,000 rows per batch; short ones have 20.
- Original constraints appear only in the initial task. Fresh task facts appear
  in the final input, separating instruction retention from buried-fact retrieval.
- Primary: final deliverable correctness, six explicit component checks per task,
  plus perfect-deliverable rate. JSON schema, coverage/nonempty work, scope,
  permissions/protected entities, ordering/dependencies and correct data values
  are checked as applicable. Checkpoint accuracy is not the primary outcome.
- Secondary: original-objective recall is probed only **after** the deliverable
  has been committed to the transcript, without a revision opportunity. Lexical
  recall coverage is reported as such, never semantic correctness.
- Costs/exposure: record actual context usage, checkpoints/validation failures,
  model turns, input/output/cached tokens, elapsed time and execution failures.
  Short controls must not trigger; long/on runs require a validated checkpoint
  before the graded deliverable. Off runs must never produce checkpoints. Keep
  all planned runs in accounting. A completed primary deliverable remains scored
  if a later recall probe fails; execution/exposure validity is reported separately.
  Failed-response usage is retained, with unavailable usage explicitly unknown.
- One repetition and synthetic constraints cannot establish reliability or
  real-world drift reduction. A ceiling result means no demonstrated benefit,
  not proof of no benefit. Two arms measure the overall intervention, not whether
  structured reflection is superior to equally expensive generic reminders.

## Safeguards and provenance

Run separate unscored feasibility material first, using the exact model and long
corpus generator. It must complete with at least one validated actual checkpoint.
No manually forced checkpoint or substituted context capacity is permitted.
Freeze config, source hashes, source commit, task order and input hashes before
scored inference. The scored gate requires exact feasibility config, source hashes
and actual model identity/capacity, not merely a successful earlier attempt. Do not change prompts, corpus, grading or exclusions after
viewing scored outcomes. If execution code must change, retain the old attempt
and identify the new attempt/protocol rather than silently replacing results.

Each model response has a cooperative 180s cancellation deadline and a
24k-character streaming bound (including exposed reasoning text). Sessions check
limits of 12 model requests, 15 minutes and 80% of context capacity; the pilot
checks a 1h wallclock deadline. The launcher independently enforces a 3650s OS
process deadline, escalating TERM to KILL after 10s if cooperative cancellation
or cleanup stalls. Request payloads are capped at 4M characters. These are runaway-execution
controls, not spending caps. Failed/aborted/non-triggering runs remain visible.
The runtime uses an explicitly selected existing refreshable credential file;
credentials are never copied to the fixture or printed. Auth failures are
execution failures, not an invitation to automate login. Observation/progress
reads use local result files and no credentials. JSON heartbeat lines identify
phase starts, actual requests, completed context observations and terminal status.

Output lives outside the worktree at a task-specific path under the main
checkout's ignored `.local/cuckoo-pilot/`, preserving it across worktree cleanup.
Transcripts contain only the synthetic tasks and responses. Source fixtures and
graders are committed; large generated archives/transcripts are not.

## Run

```bash
node --test scripts/cuckoo-pilot/*.test.mjs
export PI_SDK_ROOT=/absolute/pinned/pi-monorepo
export PI_PILOT_AUTH_PATH=/absolute/existing/agent/auth.json
export PI_OFFLINE=1 PI_TELEMETRY=0
bash scripts/cuckoo-pilot/run.sh feasibility /absolute/results
bash scripts/cuckoo-pilot/run.sh scored /absolute/results
node scripts/cuckoo-pilot/analyze.mjs /absolute/results
```

The source extension must resolve its shared `@ponygirls/pi-ui` and
`@ponygirls/pi-settings` dependencies, as in its Nix package. Offline suppresses
startup refresh/discovery, not the deliberately authorized live inference.
`protocol.json` is create-only; repeated scored execution into the same output
directory is rejected. Result files are atomically replaced as each run advances.
Analysis reloads planned per-run files, tolerates an absent aggregate summary
with an explicit fault, checks source/input hashes, and regrades available primary
responses independently of overall run success. It reports primary-workload token
usage separately from usage including the retrospective recall probe.
The process exits nonzero for feasibility/execution failures; semantic constraint
failures are scored results, not harness crashes.
