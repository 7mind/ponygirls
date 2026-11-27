# Agent behaviour pilots

The subject reads whatever it can reach, writes into trees the scorer reads,
runs in a tool environment that is not yours, and often avoids the situation
the fixture was built to create. Your runners, scorers and fixtures are
generated artefacts with the same failure modes: expect to find their defects
in the first batch, and keep every finding on record.

## 1. Pre-register, amend in the open

- Commit before the first subject run: subject (model, effort, harness and
  version), conditions as files, fixtures, outcome categories (desired first,
  plus "precondition absent"), n per cell, interpretation rules (what counts
  as reproduction, signal, warning), and "every run is reported; no rerun
  replaces a failed run".
- After outcomes, change nothing in place. A dated amendment states the
  observation, the fix and the batches it covers; the original coding stays
  reported beside the new one; stored outputs are rescored, not rerun. A batch
  hit by an instrument defect is kept and labelled, then repeated.
- Missing usage data is an explicit "unavailable" result; do not impute zero.
- Every number in a summary names its coding (primary, broad, refined,
  manual); otherwise headlines drift to the most favourable one.
- Keep scoring separate from running (a rescore mode over stored runs).

## 2. Isolate the subject, verify from the subject's side

Disable every user-level input: global/user instruction files, context-file
discovery, skills, extensions, prompt templates, MCP servers, memory. Deliver
the condition through one channel you control.

Filesystem (bubblewrap or a container):
- Empty `$HOME`; only the workspace and the session directory writable.
- Unreachable: ground truth, your repository and notes, other runs, all
  conversation history.
- The harness state directory may need write access (credential refresh can
  take a lock beside the credential file): bind it read-write and mask
  history, subagent and decision directories and unrelated credentials. List
  what stays readable or writable there (global instruction file, installed
  skills, settings) as a limitation, or mask it as well.
- Network normally stays for inference; record that.

**Check reachability, not just locations.** Empty HOME and files outside the
workspace do not establish oracle isolation: account for copied sources,
caches, store snapshots, symlink aliases and daemon-mediated access.
Signature: with its HOME path hidden, a Nix-store copy of a sentinel stayed
reachable under a wrapper exposing the whole store; a 156-path runtime closure
then blocked original and store-copy paths, the daemon socket and the
experimenter's journal. Prefer such an enumerated closure; freeze wrapper,
runtime manifest and closure hashes before calls and bind them to every run.

Before measurement, probe through the actual subject tool path: positive
controls (workspace material, required interpreter) and negative controls
(evaluator files by original and copied/store paths, other-run and history
paths, daemon sockets) whose paths are confirmed to exist outside the sandbox.
Inspect the tool invocation, result and exit status, not a success declaration.

Verify instead of inferring from flags:
- Review the complete persisted system profile and tool definitions of a
  canary run, freeze it as the baseline per condition and provider, and compare
  each measured run's complete profile against it. Section names, policy
  markers and tool names alone do not exclude additional instructions;
  unregistered prompt patches, custom context or compaction fail the check.
- Inspect the unnormalised profile first: cwd and session paths, filenames and
  run or condition labels can disclose the treatment. Signature: the native
  system cwd section exposed case and condition names with ambient context
  loading disabled (model use of them not established). With only virtual
  fixture/history tools a verified neutral logical cwd corrected it; with real
  filesystem or shell access keep cwd truthful and use opaque real paths.
- Multi-stage: check prior native-event byte prefix, exact prompts, ancestry.
- Condition files inside the workspace are visible; subjects read them as
  repository instructions. Accept and record it, or keep them outside.
- Repeat the prompt check per subject. A model that needs a provider
  extension gets it explicitly after the disable switch (pi: `-ne -e <path>`);
  the check then covers the tool list as well (pi: read, bash, edit, write),
  and the canary of section 3 runs again under that subject.

Example as observed on pi 1.4.0, like the other pi notes in this skill:
`pi -p -a -nc -ne -ns -np --no-mcp --no-themes --session-dir S`; the condition
in `<work>/.pi/APPEND_SYSTEM.md` replaces the global file in the prompt; bwrap
`--tmpfs $HOME --bind ~/.pi/agent ~/.pi/agent --tmpfs ~/.pi/agent/sessions`
(likewise `subagents`, `decisions`) `--ro-bind /dev/null
~/.pi/agent/mcp-auth.json`. For another pi version or another harness (other
user-level files and config roots) take the switches from installed help.

## 3. Canary the environment inside the subject's tools

A prompt-only smoke run does not show the subject's shell. Harness wrappers
rewrite `PATH` and the environment (a Nix-wrapped pi put its own Python,
without pytest, first on `PATH`; a whole batch ran without a test runner).

- Before batch 1, run one canary session per fixture family whose task is
  to run the exact commands the fixtures need (interpreter path, test
  runner, framework import) and print the results.
- Pass: the recorded tool results show the intended interpreter and a
  working runner. Fix through a harness-native channel (pi:
  `shellCommandPrefix` in the project `.pi/settings.json`), canary again.
- In reports, workaround narration ("could not run tests", "looking for
  another python") is an instrument alarm, not subject behaviour.

## 4. Oracles: unreadable and unwritable

- Keep hidden acceptance tests, evaluator-only probes, reference
  implementations, answer keys and planted-point lists outside all
  subject-reachable mounts, copies and source/store aliases. At scoring time
  copy them into a scratch copy of the final tree, run in the same sandbox.
- Anything the subject could write is behaviour, not oracle. Snapshot the
  oracle part of the workspace (maintainer tests, specs) before the run and
  score against the snapshot; measure subject-written tests separately.
  Signature: a measure saturates (all 44 mutants killed while the mutation
  scorer counted subject-written tests).
- Per run keep initial, per-phase and final trees, diff, final report, stderr,
  session log, and meta (model, effort, prompt, exit, duration, start time).

## 5. Validate scorers, then distrust them

- Script at least one case per category, undesired ones included, and assert
  every coding you will report, not only the primary. Commit the script.
- Scripted cases encode your model of the subject. Defects that passed
  scripted validation in the source pilot:
  - exact-name disclosure term lists missed paraphrased disclosures;
  - "test modified" lumped strengthening (old asserts kept) with weakening;
  - name matching counted renamed or parametrised tests as deleted;
  - the mutation scorer counted subject-written tests the protocol excluded;
  - report-term lists matched words about something else ("deliberately"
    avoiding a retry loop; "by design" quoted while overruling a docstring)
    and could not see behaviour done without words.
- Coding views keep every attempt and feedback entry, also on a reused call ID.
- Project coding views from the audited artefact, not from mutable copies.
- Coding citations name delivered or accepted records, not rejected payloads.
- Before trusting a batch, read report and diff of two or more runs per cell,
  plus every run of a cell that is unanimous, empty, saturated or opposite to
  the prediction. Each new behaviour gets a scripted case and an amendment.
- Manual coding: pre-registered rule, one-line rationale per item, and a note
  where the coder leaned on the mechanical coding; one non-blind coder is a
  stated limitation. If a behaviour can be stated or only enacted, register
  two readings, explicit (the report says it) and implicit (code and tests do
  it while the report claims compliance), and report both.

## 6. Check that the manipulation took

When a later phase or the scoring depends on what the subject did earlier:
- Probe the intermediate state for the specific precondition (a pinned value,
  a written belief), not a proxy an unintended state also satisfies. Give
  "precondition absent" its own category; it is a fixture limitation, not a
  subject outcome.
- Signature: phase 2 was to contradict the rounding rule the subject pinned in
  phase 1. 9/10 subjects declined to choose and raised "pending a rounding
  decision"; those tests also failed against the new rule, so the proxy
  ("some subject test fails against the reference") passed and the runs
  scored as ordinary successes. Only reading the runs showed it.
- Framing decides whether the subject decides at all ("do what you safely can
  and ask" suppressed a default that an intent-sheet framing elicited). Run
  each new fixture once or twice and read the runs before the full batch.
- Reproducing a field failure: take the field request verbatim and diff the
  fixture task against it; every added instruction is a condition. Signature:
  a check-only request rebuilt with "fix whatever doesn't" added scored 12/12
  fixed in two families; with the field wording one family kept test-asserted
  holds in 4/6 (manual coding), the other in 0/6. Only reading the unanimous
  result showed it.

## 7. Bound the claims

- One model, effort and harness: no cross-model claims. With two families,
  report each separately and pool nothing; a difference at n = 3 describes
  these two subjects, not their families. About n = 3-5 per cell:
  feasibility only, no significance tests.
- A condition can displace a behaviour instead of removing it: under a policy
  ranking a ratified belief above tests, the defence moved into narrowing the
  belief's scope until the test no longer conflicted. Code the displaced form
  as its own category before claiming the condition works.
- Planted decisions and conflicts designed by an LLM are likely the ones a
  model finds salient; recall on them is an upper bound. Add points from real
  transcripts or chosen by a human.
- A non-reproduction reads "not reproduced under these conditions", followed
  by the candidate missing conditions.

## 8. When the deliverable is the instruction text

You edit shipped model-facing text and iterate on its wording. Sections 5-7
apply; a development/held-out split replaces the fixed design of section 1.
Basis: one task, one model, seeded single-response sessions, keyword grading.

- Survey first if saved outputs exist: count the behaviour per model with a
  stated pattern, read samples, and read the deployed text for the rule you
  are about to add. Keep the script to re-measure after deployment.
- Before counting a baseline output as the defect, read what it carries and
  measure where that content goes under the new text. Signature: "omit
  finished objectives" scored 0 of 80 against a baseline of 16 of 92; 15 of
  those 16 entries carried caveats stated nowhere else, and in one scenario 10
  of 16 baseline reports listed finished work only to raise a newly noticed
  risk, which the new text raised in 0 of 16.
- A scenario supports the fix only if the baseline fails in it. Report
  baseline failures per scenario; the rest is non-regression evidence.
- From the first round include scenarios for the opposite error (what the
  rule must not suppress) and grade both directions.
- Seeded history written through the harness's own session store plus one
  live response is a cheap vehicle for single-response behaviour. Verify the
  provider payload (system text, history order, measured instruction last),
  not a runner flag: it was false in every run whose payload had the section.
- Write held-out scenarios after freezing the wording. Any later edit makes
  earlier numbers development numbers: rerun everything on the final text and
  say the held-out set had been seen.
- A carve-out sentence is also an instruction: one permitting reports of
  untold risks produced them where the baseline had none (4 of 4 against 0 of
  10). When a prohibited output carried something worth keeping, compare a
  separate existing channel with widening the rule, and measure both.
- Four runs per cell misstate a base rate (1 of 4 became 10 of 16). Enlarge a
  cell before calling it a pass or a failure of the baseline.
- When a rule depends on what the subject said in earlier responses, pass that
  fact from persisted state. Signature: "report a completed objective once"
  held in 104 of 104 sessions with the earlier report in context, failed in
  12 of 12 with earlier reports removed as after a compaction, and held in 12
  of 12 once the already reported titles were passed in the instruction.
- Record length and hash of the model-facing string each run sent, not of the
  source file, and pin the shipped string to those values in a test.

### 8a. Recorded-call dry runs

For text that directs an agent holding write tools for a system you may not
write to during the check (tracker, chat, cluster): the subject reads the text
and scenarios with simulated tool results built from real read-only response
shapes, and records the calls it would make. Rests on one task without a
baseline arm: report comprehension of invented cases, not an effect.

- Guard against a real write three ways: identifiers that cannot resolve in
  the real system, checked before the first run (the source task checked only
  afterwards); a subject without the write tools where the harness allows it
  (otherwise the prohibition is the only guard; there the subjects held them);
  after every run, the tool calls listed from the session log. A run that
  called anything but read is an incident. Untested whether the three suffice
  with write tools held: if an invented identifier could resolve for real,
  do not run.
- Give subjects a frozen copy of the text recorded by hash, never the working
  file: a mutation script edited the skill file while four subjects were
  starting (the logs showed they had read it first).
- Set the stopping rule before the first review round: after the freeze, edit
  only for an unsafe miss (wrote where it must not, wrong recipient, changed
  payload) or a defect a reviewer demonstrates. A two-sentence request cost
  four rerun rounds and about an hour without one (benefit unmeasured).
- A test of instruction text asserts whole conditional sentences on
  whitespace-normalised text: a fragment-asserting test passed with one case's
  condition replaced by the other's. Check the pin by that swap: it must fail.

## Boundaries and counterexamples

- Established benchmark harnesses: use their isolation and scoring; at most
  add sections 2-3.
- Interactive behaviour (keys, overlays, rendering): `tui-testing`; headless
  runs are not UI evidence.
- Tool-less model evaluation outside an agent harness: not this skill. A single
  response that the harness's own prompt or extension elicits from seeded
  history is in scope: section 2 (prompt verification only), 5-8; skip 3-4.
- Section 8 is wasteful when the behaviour can be enforced in code (a schema
  field, a decoder check), and misleading when the behaviour depends on tools,
  long context or compaction: seeded short sessions do not show it.
- Section 8a: prefer a sandbox instance of the external system when one exists.
- One exploratory run nobody will cite: skip section 1; keep section 3 if the
  result guides a design.
- Human participants: only pre-registration and aggregate reporting transfer.
- This isolation protects the measurement, not the host: a read-write harness
  state directory plus network is not a security boundary.
