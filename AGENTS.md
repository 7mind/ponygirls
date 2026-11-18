# Agent instructions

## Validation

A task that changes Chronicle, Haystack, Manure or `shared/` is complete when the verify target of every
service it touches builds on the final tree; changes to `shared/`, the shared Nix modules or the root sbt
build use `all`:

    scripts/verify chronicle | haystack | manure | all      # nix build .#verify-<service>

Each target is a set of exact-input Nix checks: the package with its fast gate, the complete backend suites on
owned PostgreSQL clusters, protocol checks, dashboard Node tests and the complete Chromium suites, collector and
CLI tests, the Haystack transport and Manure target suites against the native executables, and the module
checks; `all` adds the cross-service module checks. A cache hit is valid evidence: those exact inputs passed
before. Report the command, the source identity (commit and whether the tree was dirty), which checks were built
and which were reused, and the case counts of the built ones; `scripts/verify` prints all three (the counts come
from `counts.json` in the outputs of the checks that gate JUnit XML). A check that fails or cannot run is
reported with its failing script and log (`nix log`), not retried until green or worked around. Known
limitation: the Chromium suites fail intermittently under heavy host load; report such a failure the same way.

- Stage new files before verifying (`git add -N`): untracked files are invisible to flake builds, and
  `scripts/verify` refuses to run while any exist under the source roots.
- `nix build .#chronicle` (or `.#haystack`, `.#manure`) runs only the fast package gate. It is not evidence
  that the full suites passed. Source or JVM tests do not establish native-runtime behaviour or deployment.
- Inner loop: `nix develop .#chronicle --command <dir>/scripts/test.sh [part...]` for `chronicle`, `haystack`,
  `manure` and `shared` runs the same runners outside the sandbox, parts concurrently, after `npm ci` in the
  directories its header names. Use it, or one runner, to iterate; it does not replace `scripts/verify`.
- On-demand checks are not part of verify. Run them when you change what they guard and report the result:
  `nix build .#onDemand.manure-vm` (Manure NixOS/HM modules, nginx/TLS edge, HM client wiring),
  `.#onDemand.manure-portable-root` (root authority and root binding), `.#onDemand.backend-coassembly`
  (Baboon runtime, contract build settings); Chronicle indexing-recovery, CLI real-server and CUDA tests as
  described in `chronicle/README.md`; the Haystack CLI real-server leg (`npm run test:real` in `haystack/cli`,
  with the server ELF and an owned database as `haystack/cli/tests/run-real.sh` requires).
- Relevance evaluation: its unit tests are part of `verify chronicle`. A runner or transport change also needs
  the controlled real-server acceptance leg; a prompt or index-eligibility change needs controlled live-provider
  cases with held-out content and runtime Context negative controls. Scripted runs establish workflow
  behaviour, not semantic or classification quality.
- Runners fail on any failure, error or skip and on an empty run; PostgreSQL-backed cases execute, never skip.
  Do not add lists of expected test names, receipts, evidence files, or tests whose subject is test tooling.
  Cheap tests of fixture safety interlocks (a fixture refusing a database or process it does not own) are the
  exception.
- PostgreSQL tests run one suite at a time per database. Parallel groups use separate databases or clusters;
  never point two concurrent suites at the same database.
- Timing rule. A test may exercise a timeout, heartbeat, back-off or expiry mechanism with a controlled clock,
  or with a short interval supplied through a constructor parameter or fixture configuration, when all three
  hold: the production code path is the one executed; a separate test asserts the production default; the
  assertion keeps its kind (the event happens after the configured time and not before). It is forbidden to
  lengthen a test timeout, shorten a production deadline, add retries, filter cases or relax an assertion in
  order to obtain a pass. A test whose subject is real elapsed time against a value we do not control (for
  example a third-party default timeout, or a database-clock lease) keeps real time and runs in parallel.

## Search-quality experiments

Use isolated real server instances and controlled, versioned content for
reproducible experiments. Do not mutate production or send private indexed
content to external models without explicit authorization. Tokenfactory usage
has no token/cost budget caps for this work. Do not invent spending-approval gates. Keep explicit runtime deadlines,
response-size bounds and runaway-loop safeguards; these are execution controls,
not financial limits.

Reproduce a retrieval failure before changing ranking. Keep the evaluator's
ground truth separate from the search agent's task, preserve tool traces and
exact source citations, and compare baseline/candidate runs on the same corpus,
configuration and declared metrics. Distinguish indexing coverage, retrieval
ranking, tool use and answer synthesis failures. Scripted providers establish
workflow behavior, not real semantic relevance. Do not tune solely to the cases
used to develop the correction; retain held-out cases and report regressions.
