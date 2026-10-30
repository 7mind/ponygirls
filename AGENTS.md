# Agent instructions

## Chronicle validation

Routine Nix builds run a fast subset. A successful package build or fast test
run is **not** evidence that the full suites passed.

Use the pinned `chronicle` development shell for these commands. In batch mode,
use `nix develop .#chronicle --command bash -c '<commands>'` from the repository
root. On a fresh checkout, provision both locked npm dependency trees with
`(cd chronicle/web && npm ci)` and `(cd chronicle/collector && npm ci)` inside
that shell; `npm ci` replaces local node_modules, not the lockfiles. Use an
approved registry/cache and do not substitute unpinned installs. The protocol
compiler path, from `chronicle/`, is `$PWD/web/node_modules/.bin/tsc`.

Before declaring a Chronicle task complete, run the full, unfiltered suites
against the final changes:

- Backend: `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh`
  from the repository root. This starts an owned PostgreSQL cluster and runs
  every discovered suite. Keep shared-database tests serial; PostgreSQL cases
  must execute, not skip.
- Protocol: from `chronicle/`, run
  `TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh`. Check the sole current API and explicit removed/future-version
  rejection; preserve current-protocol framing and error branches.
- Dashboard: from `chronicle/web/`, run `npm run typecheck`, `npm test`, and the
  complete `npm run test:browser`, using the pinned Node/Chromium environment.
- Collector: from `chronicle/collector/`, run `npm run typecheck` and `npm test`.
- Relevance workflow: from the repository root, run
  `python3 -m unittest discover -s chronicle/eval/relevance/tests -v` and the
  controlled real-server acceptance leg when its runner/transport changes.
  Scripted acceptance is not a genuine agent or semantic-quality result.
  Prompt/index-eligibility changes also require controlled live-provider cases,
  held-out content and runtime Context negative controls; ordinary decoder
  tests do not establish model classification quality.
- When Nix packaging or validation policy changes, run its policy/module checks
  as well; do not substitute those for the application suites above.

Use the pinned tools/dependencies described in `chronicle/README.md`. Focused
reproductions and the fast subset are useful during iteration, but do not replace
these final runs. Preserve real deadline/concurrency assertions; do not shorten
deadlines, skip cases, filter counters, or relax browser interactions to obtain
a pass. Report failures or unavailable prerequisites explicitly.

Use a fresh reporting directory for inventory/XML verification. Preserve any
previous generated reports before a run; never filter stale or failing XML out
of a combined directory to manufacture a pass.

Record the commands, source identity, suite/case counts and failures/errors/skips.
Exact-input cached evidence may be reused when its source/artifact binding is
verified; identify reuse rather than claiming a fresh execution. New changes
invalidate evidence for their affected inputs. Source/JVM tests and an installed
ELF digest do not establish native-runtime behavioral acceptance or deployment.

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
