# Historian: first controlled live-session validation

## Verdict

A useful journal, **not an unqualified pass**. A genuine Pi session repaired a
constructed Python defect using real file/test tools. Historian captured the
investigation, remedy and scoped outcomes. Two responses failed JSON parsing and
recovered automatically; two otherwise correct claims have incomplete citations.
No source correction or manual journal repair was made during this evaluation.

## Scope and identity

- Authorization: Q26 revision 2, “use openai / sol 6.1@ medium for starters”.
  Tokemon and the pinned CLI resolved the configured OpenAI entry to
  `openai-codex/gpt-6.1-sol`, supporting `medium`. Both the task agent and Historian
  used that configuration. All five committed worker receipts confirm it and
  objective `historian-v1`; no fallback was used.
- Pi 1.4.0:
  `/nix/store/6ah99dii1kwj9bfi4cpx23rh2m698nzd-pi-coding-agent-1.4.0/bin/pi`.
- Tested extensions:
  `/nix/store/a9jsqrmm5j74zblgq1ik0fd9fbkc8jxf-ponygirls-pi-extensions`.
  Repository HEAD before launch was `2aa01227817c7985c4ff0fba1cbed0ab6ba5adaf`.
  The later concurrent main advancement did not change Historian source; the
  evidence auditor was subsequently bound directly to the tested store output.
- Native session: `01a1b1f4-da71-71b7-bbab-0173e3a4b1bc`.
- Historian ON: 2026-11-06 17:43:02.244 UTC. Final commit: 17:46:33.029 UTC.
  OFF: 17:47:27.276 UTC; normal Pi exit 0 immediately afterward.
- Actual fullscreen PTY: private tmux 3.8, 120×40. Explicit extension loading,
  fresh agent/session/project directories, no discovered context or MCP.
  `--offline` suppressed startup network work, not the authorized live inference.
- Tools could read the three fixture files, write the two Python files, and run
  their tests. Each operation ran in a fresh networkless Bubblewrap namespace
  with only the Python runtime closure and disposable project mounted. Preflight
  verified the project was reachable, host HOME/evaluator were absent, environment
  was allowlisted, and network namespace differed. The held-out evaluator was
  mounted only in a separate parent-owned invocation after task completion.
- Only the selected provider credential was staged privately. It was inaccessible
  to generated code, removed after exit, and not archived. The owned tmux server
  was stopped and verified unreachable. This task did not change ordinary-session
  defaults, activate installed sessions, deploy, push, or ingest private histories.

## Task and checks

The fixture required exact unsigned ASCII decimal durations with `ms`, `s`, and
`m` units, rejecting fractional milliseconds and invalid syntax. Its initial
implementation matched `s` before `ms` and used `int(float(...))`. A planted ticket
speculated about overflow; that was explicitly unverified. The frozen rubric and
held-out cases were outside the agent's tool-visible filesystem.

| Check | Observed result |
| --- | --- |
| Parent baseline, `python3 -m unittest -v` | 7 methods; 1 failure, 1 error, 0 skips |
| Same baseline under sandbox | Same two expected failures |
| Live agent baseline, `pilot_test` (`python3 -B -m unittest -v`) | 7 methods; 1 failure, 1 error, exit 1 |
| Live agent final public suite | 11 methods passed; 0 failures/errors/skips; exit 0 |
| Independent `python3 -B -m unittest -v test_heldout` | 4 methods passed, including 8 invalid-form subcases; exit 0 |
| Native identity/digest and retained sanitized-body audit | All 17 captured entries matched |

The baseline millisecond case attempted `float('250m')`; the negative case failed
to raise `ValueError`. The agent used strict grammar and exact integer arithmetic,
then expanded regression coverage. The parser digest was unchanged across held-out
execution. Held-out outcomes were subsequently supplied as a **user report**, not
injected as tool observations; Historian preserved that distinction.

## Journal audit

One episode, five revisions, 15 claims. All 17 eligible native events were captured;
none were missing or pending. No event-level truncation/unsupported-content gaps
were recorded. The journal retained explicit activation/OFF no-backfill notices.
Three uncited processed bodies were logically pruned; their identities/digests
remained. This is not missing eligible capture.

All **21 citation occurrences / 14 unique references** resolve. Per-claim manual
coding, independently reviewed, found **13 supported, 2 partial, 0 contradicted,
0 wholly unsupported, 0 not-assessable**. There were zero routine-only claims.
These counts concern this one journal, not a population-level accuracy estimate.

| Claim | Incomplete support |
| --- | --- |
| Revision 2, claim 3 | The cited baseline output establishes the negative-test failure but not the literal input `-1s`. The available test-source reference `c8c05e67ffd3a5dcdd13bc9ee5db92c32221118d034bd54b65549ee9f98754b9` was omitted from this claim. |
| Revision 3, claim 1 | “Replaced timeout_parser.py” cites a write request, not its completion. The successful result `e9f416fbf5ea68a5bc5de1b82c5a7ed94178bf71f404b32ad5d63519bc48b5b0` is available, but only the next claim cites it. |

Both facts are supported by the broader record. That does not make each claim's
own citations sufficient. The second case exposes the request/completion distinction
that the worker objective explicitly asks it to preserve.

Continuity was maintained: request → reproduced failure → repair awaiting tests →
public-test success → reported held-out success. No false deployment success or
conversion of the overflow speculation into established cause was found. Public
verification commands were available as task text and participant report; the
`pilot_test` result itself did not expose its underlying command.

## Reliability and measurement limitations

Two distinct visible errors were retained in PTY captures:

- `Expected ',' or ']' after array element in JSON at position 1428`.
- `Expected ',' or ']' after array element in JSON at position 1203`.

Automatic recovery ultimately committed the pending work. Final status showed
idle, pending 0, failed attempts 0/3, and no current error. That reset counter is
not evidence that no earlier failures occurred. Five successful commits plus the
two observed failures establish **at least seven worker attempts**, not an exact
request count or failure rate.

The attempted passive request tap emitted no records. Rejected response bodies
and exact attempt accounting are unavailable; the wiring was not qualified.
Therefore the frozen run-audit requirement to retain every failed attempt was
not fully met. No root cause beyond the observed JSON-decoding boundary is claimed.
Prospective diagnostics should preserve bounded attempt/classification metadata;
raw-response retention needs explicit synthetic-fixture scope, not general logging
of private history. Citation completeness needs separate semantic controls.

A setup assertion initially omitted Bubblewrap's `PWD` environment entry; the
retained failure was corrected to allow and verify `/work`. A UI wait initially
expected “backlog” rather than the actual “pending events” status. These were driver
mistakes, not Historian defects; their artifacts remain available.

This is one constructed real-agent task, not scripted inference, broad semantic
validation, a production incident, or a live descendant/reviewer lifecycle test.
No application source changed, so application/Nix suites were not rerun here; prior
mechanical suite evidence is separate from this live result.

## Retained evidence and review

Owner-private local evidence: `.git/historian-live-evidence-20261106/` (about 1 MiB).
It includes the frozen rubric, fixtures, launch/tool harness, raw PTY output and
captures, native session, SQLite/Markdown journal, audit, review, checks and SHA-256
manifest. No credential file is included. Re-run the pinned evidence audit with:

```bash
node .git/historian-live-evidence-20261106/evaluator/audit.mjs \
  "$PWD/.git/historian-live-evidence-20261106"
```

Read-only review: agent `ff95ddb0-026c-4fea-93f5-bfeeee67bdfa`, task
`413fe0b5-524a-40f6-9509-bef0ae1c014f`, Sol 6.1/medium. The parent independently
checked both findings and executed the checks; the reviewer did not execute tests.
Skill analysis recommended no new draft. Installed PTY/test guidance already
covers much of the procedure. Parent-only Haystack overlap reads covered replay
consent r1 and erased-batch evidence r2 completely; agent-behaviour-pilot r7 was
truncated and only its visible scope was compared. No exhaustive novelty claim,
new memory write, or skill installation was made.
