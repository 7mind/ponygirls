# Controlled relevance evaluation

Controlled versioned content with separate plumbing and real-provider workflows.
The Python standard-library CLI supplies ingestion, publication checks, explicitly
assigned lexical/semantic/hybrid baselines and scoring. Scripted providers establish plumbing only. Genuine agent trials
can use the existing server MCP tester; no provider SDK or second tool-loop
implementation is required. Never discover or mutate a production daemon.

See [read-only retrieval diagnostics](SEARCH-DIAGNOSTICS.md) for the exact-cosine,
candidate and fusion loss ladder, and [additive proposition support](PROPOSITION_SUPPORT.md)
for the explicitly versioned assessment alongside unchanged legacy strict scores.
[Batch assessment](BATCH_ASSESSMENT.md) applies that policy to captured runs without
new model calls and retains native failures and original controller exits.
[Measured first held-out results](RESULTS.md) separate retrieval gains from the
unmet frozen answer/execution targets and document the limits of this corpus.

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
python3 chronicle/eval/relevance/bridge.py ingest --mode lexical --related-policy deny --principal reader --manifest OWNED.json --fixture chronicle/eval/relevance/fixtures.json --out FRESH_INGEST
python3 chronicle/eval/relevance/bridge.py preflight --mode lexical --related-policy deny --principal reader --manifest OWNED.json --fixture chronicle/eval/relevance/fixtures.json --catalog FRESH_INGEST/receipts.json --out FRESH_PREFLIGHT
python3 chronicle/eval/relevance/bridge.py baseline --mode lexical --related-policy deny --principal reader --manifest OWNED.json --fixture chronicle/eval/relevance/fixtures.json --catalog FRESH_PREFLIGHT/catalog.json --task copper-port --out FRESH_ATTEMPT
python3 chronicle/eval/relevance/evaluate.py --principal reader --fact-format named-facts-v1 --fixture chronicle/eval/relevance/fixtures.json --catalog FRESH_PREFLIGHT/catalog.json --answer ANSWER.json --trace FRESH_ATTEMPT/trace.jsonl --k 5 --out FRESH_SCORE.json
```

The operator supplies and supervises a fresh isolated daemon with scripted local
annotation and nonzero constant embeddings. Manifest fields: `runId`, numeric
loopback `origin`, owned `pid`, exact `executable`, `elfSha256`, sanitized `profile`,
`profileSha256`, `modelCatalogSha256`, `tokenFiles` (Read-only), `ingestTokenFiles`
(Ingest-only), each token mapping `reader`/`restricted` to mode-0600 runtime files.
MCP whoami verifies exact Read scope. Native ELF/hash and listener ownership are
checked before every call. No DNS, proxies, redirects, credentials in traces, or
silent fallback. Each CLI phase has 64 calls, 64KiB/call, 1MiB aggregate request
and response bytes, 60 seconds; failures retain partial exclusive-create attempts.
Preflight fails unless every receipt has a published generation and exact paged
normalized messages. Its `indexCoverage` field measures that publication/source
check, not searchable Problem coverage: a complete Context-only publication can
still have no matching indexed text. Inspect actual Problem/Context source spans
separately. First-search Recall@k/MRR does not pool ranks across later searches;
absent/private tasks have undefined recall, not free recall credit. ACL leaks fail.

Answers are structured `{taskId,facts,abstain,citations}`. A citation contains
`sessionId`, exact `view:{revision,generationId}`, `messageId`, and verbatim quote
(exact stored text, no Unicode/whitespace rewriting). Quotes must match both the evaluator corpus and
messages actually observed in that task's trace. Exact fact slots plus all required
evidence determine answer success, never fluent prose or `Completed`. The lexical
baseline emits retrieval/reads only; it does not produce or claim correct answers.

## Genuine tools-only agent leg

Use a fresh isolated server and the browser MCP tester: negotiate `Hello`, read
`McpTestTools`, persist a fresh instance/run ID, send `StartMcpTest` exactly once,
then drain `ReadMcpTest` pages. Keep the originating socket alive and answer
Ping/Pong; disconnect erases its runs. Advance the cursor only to the last event
actually received, not the snapshot high-water mark. Validate contiguous event
sequences and complete multipart call/result/response items. Never replay an
uncertain Start; inspect the original IDs or record uncertainty.

The browser controller has normal browser authority; **the model** receives only
the server's read-only tool catalog and a fresh question, not the controller's
filesystem/browser capabilities. Verify the actual catalog. Send opaque task IDs
and identical output instructions for every case: fixture labels such as
`absent`/`unauthorized`, per-case fact keys and expected answers leak ground truth.
Retain original answers; require the exact opaque ID before evaluator-only
projection back to fixture IDs. Keep fixtures, oracle, catalog, private preflight
trace and ingest credentials outside model capabilities. A repository-reading
coding agent or the single-request `call` CLI is not this isolation boundary.

Score facts and verbatim citations independently of execution completion. Retain
failed runs and distinguish source classification, initial retrieval, tool use,
format/synthesis and orchestration failures. Owner job/session traversal may
recover facts missed by text search; that is not improved ranking. To compare
execution-policy changes, preserve the publication/generation IDs on an owned
offline database copy. To compare annotation changes, use identical controlled
source and paired request fields, held-out facts and runtime Context controls;
record the changed profile identity. Live provider realizations are not
bit-for-bit deterministic. Do not tune solely to development cases.

Tokenfactory trials have no spending approval gate or cumulative token budget.
Per-response provider policy, execution deadlines, trace/response bounds and runaway-loop protection remain
separate safety controls. Real annotation with constant embeddings is still a
lexical-only experiment, not semantic-search quality evidence.


## Portable real-provider workflow (Linux)

`run_real.py` uses the existing server `McpTestRuns`, generated Hello 1.7 codecs,
Node and Playwright. It is not another model SDK or tool loop. Linux `/proc`,
`pidfd`, `prctl` subreaping and a non-root PostgreSQL operator are required.
No service discovery, provider launch/stop, production connection, GPU launch,
or dependency installation occurs. The embedding and annotation services are
**external and nonowned**, including a loopback embedding service.

Copy `bindings.example.json` to a private operator directory and fill every
placeholder from the pinned artifacts. Paths are supplied by the operator; no
Nix-store, home-directory, model, endpoint or browser-layout defaults exist.
Bindings require actual native/PostgreSQL ELF hashes, every PostgreSQL tool,
Python/Node/Chromium/Playwright, the runtime dependency closure, generated codecs,
fixture, config template, profiles, real-embedding proof, output directory and
modes. For a PostgreSQL wrapper, bind `tools.postgres` to the launcher,
`postgres.executable` to the actual child ELF, and `postgres.launcher` to its
`{path,sha256}`; otherwise launcher is explicitly `null`.

Publication and execution artifacts are separate, required bindings:
`native` is always the actual executor ELF. `preparedNative` must be explicitly
`null` for prepare; for run it must be the exact `native` path/hash object stored
in the stopped seed's `bindings.json`. Clone verifies that publisher identity and
hash before comparing the remaining protected seed fields or copying PGDATA.
There is no fallback from a missing/null run binding to the executor. An explicitly
bound different executor is permitted without republishing: PostgreSQL, fixture
bytes, annotation/embedding profiles, fact format, model, generated codec files
and config template still must match the seed exactly. All metadata/data/source
fingerprint checks remain in force. `owned.json` and summary/prepared metadata
record both `publicationNative` and `executorNative`; the seed is never rewritten.
No alternate prepared-fixture or new-task projection is supported. Existing
frozen runs use their frozen workflow/schema; supply the new fields only in a
fresh bindings file, never by rewriting the historical seed.

`agentReasoningPolicy`, `agentMaximumOutputTokens` and `agentRevision` are required
for both phases, with no defaults. The controlled policies are exact `high` or
`max`; output tokens must be a positive integer and revision a nonempty exact
string. For the current controlled model the output allowance is 65536 tokens; copy
the exact revision from the actual catalog's `modelRevision` field. The controller
passes these expected values to the probe and checks the actual generated catalog's `reasoningPolicy`,
`maximumOutputTokens`, and **`modelRevision`** before any Start. `agentRevision`
is the input name; `revision` is not a public catalog field. Expected-input types,
missing catalog fields and any mismatch fail closed. Actual catalogs are retained;
these bindings do not change server model/limit configuration or infer a policy.
The 900-second deadline and all existing execution/protocol guards are unchanged.

Profile files contain the exact server `annotation`/`embedding` JSON objects,
**without** `credentialFile`. Credential paths live in the bindings only; each
file must have mode 0600. `authPolicy:bearer` requires a nonempty credential and
HTTPS. `authPolicy:token-free` requires a numeric HTTP loopback endpoint and an
exactly empty credential file. There is no credential fallback. Never include
credential bytes in bindings, frozen inputs, command arguments or logs.

`generatedFiles` lists every `generated/typescript/**/*.ts` source with its
relative path/hash; these are copied into the isolated codec project.
`runtimeFiles` binds the operator-selected dependency closure (including
Playwright package internals and browser/font/TLS inputs). `frozenInputs` must
include these seven workflow files, plus fixture, config template, both uniquely
named profiles and embedding proof:

```text
run_real.py runtime.py bridge.py evaluate.py
agent_probe.mjs live_protocol.mjs resolve-live-generated.mjs
```

Extra frozen evidence, such as full model-file verification, is permitted.
Frozen source/codecs are copied and rehashed before use. Credential bytes are
never archived; synthetic instance credentials remain private file-backed data.
Bindings, source paths and hashes are retained. The operator must validate the
real embedding proof against the supplied profile/service; merely naming an
endpoint does not establish semantic quality. The runner checks actual database
policy identity and embedding descriptor, including dimension and both prefixes.

```bash
python3 chronicle/eval/relevance/run_real.py --phase prepare \
  --bindings /private/prepare-bindings.json --bindings-sha256 "$PREPARE_SHA"
# After successful cleanup: inspect prepared.json, pg-controldata.txt,
# preflight/catalog.json, publication-before.json and source classification.
python3 chronicle/eval/relevance/run_real.py --phase run \
  --bindings /private/dev-bindings.json --bindings-sha256 "$DEV_SHA" \
  --prepared /private/prepared --prepared-sha256 "$PREPARED_JSON_SHA" --split dev
python3 chronicle/eval/relevance/run_real.py --phase run \
  --bindings /private/holdout-bindings.json --bindings-sha256 "$HOLDOUT_SHA" \
  --prepared /private/prepared --prepared-sha256 "$PREPARED_JSON_SHA" --split holdout
```

Prepare ingests **all** documents once, waits for real annotation/publication,
reads every original message page, captures source/publication/vector state,
then stops all owned children. A prepared artifact is published only after
successful cleanup, PostgreSQL exit 0 without forced kill, and `pg_controldata`
reports `shut down`. Context-only publications with zero searchable chunks are
valid source publications, not an orchestration failure or removed denominator.

Run requires an explicit split and a fresh output disjoint from the seed. It
verifies the stopped seed and metadata hashes, copies PGDATA ordinarily (never
hardlinks), preserves source bytes and modes, starts only the owned copy, and
verifies identical generations, archived revisions/messages, Problem/Context
spans/pieces, profiles, chunks/vectors and job identities/states. Browser auth,
telemetry, leases and access timestamps are not publication fingerprints. Each
trial gets a fresh browser/model conversation and an opaque UUID; the same
uniform ordered-value prompt is used everywhere. `modeOrderSeed` shuffles modes
per task, with full-fixture RNG advancement before split selection; the declared
schedule is retained. A matching fixed-mode baseline precedes each agent cell.
Related-session calls, wrong search modes and missing/wrong project filters are
reported as condition violations, never retried with a different mode.

The whole-matrix deadline derives from the selected task count × mode count ×
(900-second server run + drain/RPC allowance), plus explicit bootstrap and
publication budgets. There is no six-task cap or financial cap. Source, vector,
profile and jobs fingerprints are checked after every cell. Results are written
per cell; the overall summary is published only after successful owned cleanup.
Nonzero browser-controller exit prevents an overall `Completed` claim even if
some task answers succeeded. Cancellation retains the received prefix and
confirms a terminal read at the last **received** cursor; the server erases
cancelled traces, so this is not a complete-original-trace or provider-stop proof.
An unconfirmed cancellation aborts before another Start and closes the originating
socket. Cleanup attempts every owned stage independently and records exit/forced
termination statuses; it never closes either external provider.

### Ground truth and authorization boundary

The legacy `fixtures.json` and `score(...)` retain the original six named-fact,
reader-principal regressions. New fixtures explicitly declare
`factFormat:ordered-string-values-v1`,
`factNormalization:casefold-and-collapse-whitespace-only`, `modeOrderSeed`, and
every task's principal. Every new task has `facts:{values:[string,...]}` plus
frozen per-position `factAliases` arrays. Only case folding and whitespace
collapse apply to fact comparisons; citation quotations remain exact source
substrings. Neither aliases, evaluator task IDs, principal labels, relevance labels nor
expected values enter the model prompt. Every case uses the identical answer
schema; values follow question order.

`score_task(..., principal=..., fact_format=...)` requires explicit operator
arguments. The real CLI also checks a declared task principal against that
argument. The scorer's authorization oracle is owner-only for this controlled
corpus, not a general group-sharing ACL model. A restricted principal reading
its own source is authorized. Reader semantic searches may return unrelated
**authorized** nearest neighbors: negatives prohibit forbidden source IDs/content,
not all hits. Retrieval rank, source eligibility, tool use and answer/citation
success remain separate metrics. Synthetic controls and passing transport tests
alone do not establish real semantic relevance.

Controlled local checks (no live provider/model calls):

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
node --test chronicle/eval/relevance/tests/*.test.mjs
```

Run controlled real-server acceptance separately before claiming native behavior.


### Offline recovery of captured runs

A normalization defect does not require new model calls. Preserve the entire
original batch and run the model-free sidecar converter into a fresh, disjoint
output directory:

```bash
node chronicle/eval/relevance/reparse.mjs --source ORIGINAL_BATCH --out FRESH_SIDECARS
```

It validates every retained page against the exact persisted run identity,
limits and event sequence, then requires equality with the original `events.json`.
It joins results to validated ToolCall names by exact `callId`: generated
ToolResult records have no tool-name field. It hashes all original inputs again
at completion and snapshots the parser sources. Original answers are copied
byte-for-byte when present and checked against the final response. Native failed
states remain failed, including context-limit failures; an offline parser repair
never turns the original nonzero controller exit into a successful execution.
The sidecars contain normalized traces, original-answer copies, native outcomes
and retained controller-failure provenance for evaluator-only rescoring.

An unavailable or normalization-failed trace has **unavailable** ranking/ACL/
citation-evidence metrics, not observed zero recall or an observed absence of
leaks. A successfully repaired captured trace can supply those metrics without
rerunning a model or modifying the original attempt.
