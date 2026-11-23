# Chronicle operations

## Deployment

Chronicle is separate from Haystack and Manure. The server is Linux-native; the collector CLI supports Linux/macOS discovery, but the managed collector daemon is currently Linux/systemd-user only. Nothing collects sessions until explicitly enabled.

```bash
nix develop .#chronicle
nix build .#chronicle .#chronicle-collector
```

The Linux build uses GraalVM's supported fully-static musl target. This avoids the pinned glibc 2.44 mixed static-libm/dynamic-libc linker defect (`_dl_x86_cpu_features`), independently reproduced with a C `log2` program. It is still a native image, not a JVM fallback. The server uses Scala 3.9.0 with `-Yretain-trees`; Baboon 0.0.200 codecs compile in an isolated Scala 2.13.18 library because that generator's runtime is not Scala-3-source-compatible. See the server README for build probes.

Create password hashes with stdin, not password arguments or Nix literals:

```bash
read -rs -p 'Password: ' password; printf '\n'
printf '%s\n' "$password" | chronicle-server password-hash > /secure/runtime/password-hash
unset password
chmod 600 /secure/runtime/password-hash
```

Provision the referenced credentials with your normal secret manager. Model key files may be explicitly empty for an unauthenticated local vLLM endpoint. They must still exist. The managed database password must be nonempty.

```nix
{ config, inputs, ... }:
let database = config.ponygirls.servicePostgres.connections.chronicle;
in {
imports = [ inputs.ponygirls.nixosModules.chronicle ];
ponygirls.servicePostgres = {
  enable = true;
  stateDirectory = "/var/lib/ponygirls-postgres-18";
  databases.chronicle = {
    name = "chronicle";
    user = "chronicle";
    passwordFile = "/run/secrets/chronicle-db-password";
    lockTimeoutMs = 35000;
    idleTransactionTimeoutMs = 60000;
  };
};
smind.services.chronicle = {
  enable = true;
  publicUrl = "https://chronicle.example.net";
  users.alice = {
    login = "alice";
    passwordHashFile = "/run/secrets/chronicle-alice-password-hash";
  };
  database = {
    inherit (database) jdbcUrl readinessUnit;
    user = database.databaseUser;
    passwordFile = database.databasePasswordFile;
    limits.maxConnections = database.maxConnections;
  };
  annotation = {
    requestPolicy = "strict-json-schema";
    endpoint = "http://127.0.0.1:8000/v1/chat/completions";
    model = "archive-annotator";
    revision = "your-immutable-deployment-revision";
    credentialFile = "/run/secrets/chronicle-annotation-key";
  };
  embedding = {
    endpoint = "http://127.0.0.1:8001/v1/embeddings";
    model = "nvidia/llama-nemotron-embed-1b-v2";
    revision = "your-immutable-checkpoint-revision";
    dimensions = 2048;
    sendDimensions = false;
    queryPrefix = "query: ";
    documentPrefix = "passage: ";
    credentialFile = "/run/secrets/chronicle-embedding-key";
  };
  proxy.acmeHost = "chronicle.example.net"; # or terminate TLS at your existing edge
};
}
```

The provider owns the single PostgreSQL service; Chronicle consumes its isolated
database/role with finite JDBC limits and an independent readiness dependency.
The new marked provider directory does not adopt an old cluster. Migrate existing
data explicitly before activation; retain existing credentials and do not point
the provider at an unmarked production directory.

The backend remains loopback-only. The module does not open firewall ports. Without `proxy.acmeHost`, arrange TLS at the existing edge; the configured `publicUrl` must remain the exact browser Origin. Deliberately trusted private-network HTTP requires `allowInsecureHttp = true` and an `http://` `publicUrl`; it exposes credentials/data on the wire, keeps the backend loopback-only, and does not open firewall ports (see the server README). Standalone server JSON configuration is in `config.example.json`. All model endpoints are **full operation URLs**, not just `/v1` base URLs.

## Upgrading to the epoch layout

From the release with the epoch layout (migration 024) on, every revision switch of a source finds the source's previous
search candidates through the index `ch_archive_fragments_session_candidates`. Its start builds that index itself only while `ch_archive_fragments` is at
most 1 GiB (`pg_relation_size`); on a larger archive it refuses with `migration-required` until the index exists, and it
refuses an invalid one (left by an interrupted concurrent build) at any size. Build it before the upgrade while the
running release keeps serving (a concurrent build blocks neither reads nor writes; it waits for transactions already
writing the table), in psql as the owner of the table, without the service's timeouts:

```sql
SET statement_timeout = 0;
SET lock_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ch_archive_fragments_session_candidates ON ch_archive_fragments(session_id) WHERE head_candidate;
```

If the build is interrupted, run `DROP INDEX CONCURRENTLY ch_archive_fragments_session_candidates;` and build it again.
The down-script of 024 (`chronicle/scripts/down-024-epoch-layout.sql`) drops the index.

## Upgrading to streamed indexing (migration 026)

From this release on an indexing job holds one window of its revision at a time, whatever the revision's size
([Oversize guards](../CONTRACT.md#oversize-guards)): it reads its messages by position, keeps each window's accepted
annotation and embedding parts as its durable checkpoints, then publishes from them in batches of at most 500 rows and
8 MiB into a *staged* generation (`ch_staged_generations`) that no read reaches, and switches the source to it in one
short transaction. Search rows are written last, by at most four writers in the whole process (they share the
connection pool), each statement of 500 rows committed.

- **Nothing is indexed again.** The index profile, the checkpoint keys and the published rows are those of the previous
  release; a job running at the deploy is claimed again after its lease and continues from its accepted windows.
- **Configuration.** `maxIndexingBudgetBytes` keeps its default (2,147,483,647) and now bounds one window and one
  message, not a job. `maxSmallJobBudgetBytes` is retired: a configuration that sets it still starts, the value has no
  effect, and the server logs `retired configuration key ignored key=maxSmallJobBudgetBytes` once at start; remove it.
- **Jobs ended `index-budget-exceeded`** by an earlier release stay so; `RetryJob` indexes them, and so does the
  source's next upload. Each costs its annotation calls (about one per 128 KiB of source).
- **Migration 026** (applied by the start) creates two empty tables and sets `ch_search_chunks`'
  `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 100000`: catalog changes only, whatever the
  archive's size (the `ALTER TABLE` takes the table's SHARE UPDATE EXCLUSIVE lock once, which waits for a running
  vacuum of that table; reads and writes go on).
- **Semantic search while a large session publishes.** Committed staged search rows and the replaced generation's rows
  until they are vacuumed are index entries a query may not see; each one the HNSW scan meets costs it time, and a scan
  that meets more of them than its budget before its first 1,000 visible rows returns fewer rows. The staged rows exist
  only while the search rows are written (the last step of a publication); the replaced ones are deleted right after the
  switch, 10,000 per statement, and the threshold above makes 100,000 deleted rows enough for an autovacuum within a
  minute. The vacuum walks the whole HNSW index (minutes at a million rows). Index cleanup is not forced: when the dead
  rows sit in less than 2 % of the table's pages, PostgreSQL skips the index and their entries stay until a later vacuum
  crosses that line — at the production table's ≈ 11 rows per page that is fewer than ≈ 20,000 entries, below the scan
  budget, while `vacuum_index_cleanup = on` would make every vacuum of the table (also those its inserts trigger) walk
  the whole index.
- **Disk.** A re-published session's staged rows exist beside its published ones until the switch (twice its index rows
  during its publication). Earlier generations' chunk and passage rows stay, as before; those an explicit rebuild
  retires are deleted after its switch in bounded statements (`ch_generation_retirements`), no longer inside it.
- **Rollback.** Stop the server and run `chronicle/scripts/down-026-staged-generations.sql` (read-only preflight, then
  `mode=apply` with the confirmation it names) **before** starting the previous release: it deletes every staged
  generation, completes the retirements still running (search rows; a rebuild's retired rows), resets the two autovacuum
  settings and drops the tables. Without
  it the previous release fails the publication of a job whose run staged a generation (its chunk ids are the staged
  ones) until the source's next revision. Generations published by this release are ordinary rows to the previous one;
  jobs too large for its estimate end `index-budget-exceeded` again there. Before an older rollback (part uploads,
  epoch layout) run this script first, then `down-025`, then `down-024`.

## Window reuse (migration 027)

A job annotates and embeds only the windows no earlier run of the same source and index profile accepted for the same
input: after an append, the windows from the previous revision's last one on (a window's input is its source fragments
with their message positions and the passage carried into it). Each reused decision or embedding part is recorded as a
reference to the exact checkpoint it took (`ch_index_checkpoint_refs`); the publication and a resumed job read those
references, never a new lookup. A `RetryJob` of a Complete job is a cached republication: its new run reuses every
window of its revision (no model call). A confirmed owner rebuild ("Rebuild archive index") reuses no earlier run's
work, also into an unchanged profile: it annotates and embeds every window again — use it to replace accepted
annotations. A replacement reuses a decision only where the source and its positions are unchanged. Purge removes jobs,
checkpoints and references together.

- **Nothing is indexed again.** Profiles, checkpoint keys and published rows are unchanged; checkpoints written before
  027 have no content hash and are never reused.
- **Migration 027** (applied by the start) adds a nullable column and a partial index to `ch_index_checkpoints` (the
  index build reads the table's main heap, about 40 MB for 380,000 checkpoints; the values are out of line) and creates
  the empty reference table.
- **Rollback.** Stop the server and run `chronicle/scripts/down-027-window-reuse.sql` (read-only preflight, then
  `mode=apply` with the confirmation it names) **before** starting the previous release: it copies the references of
  jobs that are not Complete into their own checkpoints (the preflight prints how many and their bytes), so such a job
  resumes from exactly the work it accepted, then drops the reference table, the index and the column. Before an older
  rollback run it first, then `down-026`.

## Incremental publication (migration 028)

An append to an indexed session publishes only its tail: the next *version* of the published generation's *lineage*
(`ch_lineage_segments`). The job annotates, embeds and writes the windows from the published generation's last one on
(its *cut*), plus the pieces of the passage open at that window whose metadata the new windows change (below); every
other row stays the published generation's, shared by the next version and never rewritten. The switch changes a number
of segment rows proportional to the windows of that rewrite region (at most 2 · 16 + 10 under a horizon of 16); the
replaced rows' search rows are deleted after it (`ch_search_retirements`), 10,000 per statement. Rows written, embedding
calls, HNSW insertions and later vacuum are proportional to the addition plus the rewritten pieces, not to the session.
A *root* (a full publication) starts a lineage: the first index of a session, a replacement (a new epoch), a legacy
revision, an explicit rebuild, `incrementalPublication` false, the first publication of a session published by an
earlier release or under another `metadataHorizonWindows`. A root's switch changes at most 6 rows; its tag counts are
written with its rows before it.

- **Metadata: final by default.** With the default `metadataHorizonWindows` (2147483647) every piece carries its
  passage's final summary and tags, as before incremental publication: search answers are those of a full
  re-publication. An append whose new windows change the summary or tags of the passage open at the cut writes all that
  passage's earlier pieces again (texts, spans and vectors copied, not re-embedded; a probe of one piece per window
  decides), and nothing else before the cut: **append publication work = the addition plus the passage still open at the
  cut (clone: p99 20 windows / 1,210 pieces, max 64 windows / 3,858 pieces)**; such an append costs that passage's
  pieces (about 64 a window) in rows, HNSW insertions, retired search rows and their vacuum. Passages end where the
  annotator closes them; nothing bounds their length.
- **Finite metadata horizon (behaviour change for newly published content):** opt-in; its effect on real-model relevance
  is not measured (scripted mechanism result only: reports/ingest-c/REL/RESULTS.md); on the clone it would save ≈ 2 % of
  append work. With `metadataHorizonWindows` H (for example 16) a piece carries its passage's summary and tags as they
  stood H windows after its own window (or at the passage's last window): an append writes again at most the open
  passage's pieces of the H windows before the cut. The older pieces of a passage longer than H + 1 windows show what
  the annotator held H windows later, not the final summary and tags: lexical and hybrid search, Related, tag filters,
  facets and the tag catalog match those pieces by that intermediate vocabulary (a query phrased with the passage's
  final wording can miss its early pieces; one phrased with the earlier wording can find them). Vectors and passage rows
  (`GetPassages`) are unchanged. Both kinds of publication follow the rule, so an incremental publication reads exactly
  as a full one of the same content.
- **Configuration** (server JSON `indexing`, both optional, part of no profile): `incrementalPublication` (default
  true; false publishes every revision whole — the off switch, and the comparison oracle); `metadataHorizonWindows`
  (1..2147483647, default 2147483647: final metadata). A lineage continues only under the horizon it was published with:
  after a change each session's next publication is a root (staged publications restart), and generations published
  earlier keep their rows; nothing else is indexed again. The server logs both once at start. The NixOS module does not
  set them.
- **Migration 028** (applied by the start) is DDL only: lineage columns, segment, lineage, tag and retirement tables,
  `ch_search_chunks.ordinal`, the format check admitting `ContextAwareProblemsLineage` (the stored label of a version
  of 1 or more; readers answer it as `ContextAwareProblems`). Ties in ranking are ordered by session, the chunk's place
  in its session and chunk ID.
- **Rollback.** Stop the server and run `chronicle/scripts/down-028-generation-lineage.sql` (read-only preflight, then
  `mode=apply` with the confirmation it names) **before** starting the previous release, which otherwise refuses to
  start while a lineage version exists: per source it flattens the published version into rows of its own generation
  (and retires the source's other lineage versions: their pins answer `indexed-view-retired`), restartable after an
  interruption. Before an older rollback run it first, then `down-027`, then `down-026`.

## Publication after a database restart (migration 029)

A transient database failure of an indexing job — a statement cut by its timeout (57014), a connection the server lost or
refused while it starts, stops or is full (class 08, 57P01-03, 53300), a full or timed-out admission — is not charged to
the job's five attempts, and neither is a lock timeout at the start of a publication while a statement of an earlier
attempt of the same job still runs in PostgreSQL. The job is **held**: `Queued` with error `database-transient`, its
failure stage, and `lease_until` = its next attempt, 1, 2, 4, 8, then 15 minutes after its 1st, 2nd, … consecutive such
failure (no claim takes it before); the 10th in a row fails it `database-transient` (at least 90 minutes after the
first). An attempt that commits progress — a model answer's checkpoint, a staged publication step, or the search-row
range the previous attempt stopped in (written alone, first) — starts the count again; any other failure, a retry and a
rebuild reset it. Every other failure is charged as before.

- **Restarts.** The hold is written by the job's fenced failure record; while the database refuses it, the worker tries
  again every 2 s until the attempt's lease ends (300 s after its claim or last renewal, less a 5 s margin), each try
  checking that the claim still holds the job and each of its waits (connection, lock, statement, network) bounded by
  5 s and by the lease left. So a PostgreSQL restart that ends at least 10 s before the in-flight job's lease ends charges no attempt, provided the hold's write obtains a connection and the row lock within that margin; longer outages charge one attempt through reclaim and can lose one paid model answer; crashed jobs resume as today. As before, a model answer whose uncommitted checkpoint write a restart cuts
  is lost (its reservation stays charged, at most one per lane). Stopping the server stops scheduling at once; an in-flight recording try ends within about 10 s (each of
  its waits is bounded separately; one deadline per try is an R-a2 item); the job keeps its lease, as before.
- **Logs** (warn, ids and codes only): `job held jobId=… code=database-transient sqlState=<s|none> class=<class>
  stage=<stage|none> consecutive=<k> nextAttemptAt=<ISO>`; at the limit `job failed … consecutive=10 nextAttemptAt=none`.
- **Visible state.** Activity and the dashboard show a held job as `Queued`, Lease **Waiting** (title "Next attempt
  <time>"), reason `Prior: database-transient`; the lease filter value of a held job is `inactive`. `chronicle jobs`
  shows it Queued with its error. Retry starts it at once.
- **Publication timeout.** The publication's batches and search-row statements (P1-P3) run under
  `indexing.publicationStatementTimeoutMs` (server JSON, optional; default 300000, or `databaseLimits.statementTimeoutMs`
  when that is larger; valid `databaseLimits.statementTimeoutMs`..3600000), set per transaction above the role's
  setting, with the network timeout following it. Every other transaction keeps `databaseLimits`; lock and
  idle-in-transaction timeouts are unchanged.
- **Connections.** With `databaseLimits.maxConnections` of 2 or more one connection is kept for lease renewals, so they
  never wait behind publication statements or other transactions; a publication's search-row writers use at most the
  other connections. With 1 everything shares that connection, as before (a long publication statement then delays
  renewals: not a production budget).
- **Known limit.** A purge of a source whose publication statement is running waits for it and fails `unavailable`
  at its own statement timeout (30 s); it succeeds once that statement ends (at most the publication timeout).
- **Migration 029** (applied by the start) adds `ch_jobs.transient_failures` and `ch_jobs.transient_range`
  (metadata-only, no rewrite).
- **Rollback.** The previous release starts on a database migrated to 029: it ignores both columns and claims a held
  job at once. To drop them, stop the server and run `chronicle/scripts/down-029-transient-failures.sql` (read-only
  preflight, then `mode=apply` with the confirmation it names): it clears the holds and drops the columns. Before an
  older rollback run it first, then `down-028`.
- **Migration 030** (applied by the start) adds `ch_tokens.operate_jobs` and `ch_mutations.token` (metadata-only, no
  rewrite): the OperateJobs grant of a token and the token that executed a mutation first (job operations for tokens,
  CONTRACT.md).
- **Rollback past OPS.** Remove `"OperateJobs"` from configured tokens' `scopes` (the earlier release refuses a configuration
  that names it), then deploy the earlier release. No data step and no down script: the earlier release ignores both
  columns. Issued tokens with OperateJobs act with their typed scopes and regain OperateJobs if OPS returns; revoke them
  first if that is unwanted. For an older rollback, 030 needs nothing: run `down-029`, then `down-028`.

## Models

An annotation model must honor the structured JSON contract in the server README. Source text is untrusted input, never instructions to execute tools. The model chooses semantic chunk boundaries over bounded, numbered source fragments; the server verifies complete, non-overlapping coverage and constructs the original spans itself.

Use a compatible embedding endpoint with explicit model/revision/dimensions and query/document prefixes. `dimensions` is the expected response/storage shape and is always validated. `sendDimensions=false` is the default: the optional OpenAI `dimensions` request parameter is sent only when explicitly enabled for a model supporting output truncation. A native-dimensional Nemotron endpoint can reject even `dimensions=2048`; do not invent Matryoshka metadata or silently retry a failed request without the parameter. External endpoints remain supported; optional managed vLLM is described below and is not part of the archive executable's runtime closure. The [Nemotron model card](https://huggingface.co/nvidia/llama-nemotron-embed-1b-v2) documents 2048-dimensional output and `query: `/`passage: ` prefixes; its vLLM example requires a compatible vLLM version and reviewed, pinned remote model code. For [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2), full output is 768 dimensions, with `task: search result | query: ` and `title: none | text: ` prefixes for general retrieval. Do not apply both server-side and Chronicle-side prefixes. Truncated output requires a matching dimension/profile and appropriate normalization at the embedding service.

For external endpoints, a revision string is an operator assertion about the served weights/tokenizer/pooling. Chronicle cannot detect a server silently replacing weights behind the same model name. Pin that deployment. Managed roles derive their revision from the checked file manifest, pinned runtime and result-affecting settings; credentials, GPU placement and ports are excluded. Deterministic HTTP fixtures do not establish GPU behavior or real-model quality; the separate opt-in CUDA evidence uses synthetic inputs, not production histories.

### Optional managed GPU model serving

`smind.services.chronicle.models.annotation` and `.embedding` are disabled by default. Enabling a role provisions checksummed weights outside the Nix store and a loopback endpoint; the module supplies its full URL, served name, semantic revision and credential path to Chronicle. Remove explicit external endpoint/model/revision/credential settings for that role if using this autowiring. Embedding dimensions and prefixes remain explicit.

The default runtime is the official vLLM 0.29.0 Linux/amd64 image pinned by registry digest, launched with daemonless Podman and NVIDIA CDI. The engine runs as root but the model process uses a dedicated nonroot UID/GID, read-only weights/configuration and a writable private cache. API keys are staged as model-owned runtime-only credentials, never command arguments or Nix-store values. Configure the host's NVIDIA driver separately. No model port is opened in the firewall. The pinned nixpkgs native CUDA vLLM is marked broken; the module does not clear that marker. The alternative `backend="native"` requires an explicitly supplied compatible package.

For the public checkpoints used by the CUDA experiments, the repository includes complete pinned manifests. Merge this example with the user/database/TLS settings above, removing that example's external model overrides:

```nix
let
  manifest = name: builtins.fromJSON (builtins.readFile
    (inputs.ponygirls + "/chronicle/model-manifests/${name}.json"));
in {
  smind.services.chronicle = {
    models.embedding = (manifest "nemotron-embed-1b-v2") // {
      enable = true;
      apiKeyFile = "/run/secrets/chronicle-embedding-key";
      maxModelLength = 8192;
      cudaVisibleDevices = [ "0" ];
      enforceEager = true;
      trustRemoteCode = true; # Review the pinned custom Python before enabling.
    };
    models.annotation = (manifest "qwen3-4b-instruct-2507") // {
      enable = true;
      apiKeyFile = "/run/secrets/chronicle-annotation-key";
      maxModelLength = 8192;
      cudaVisibleDevices = [ "1" ];
      enforceEager = true;
    };
    embedding = {
      dimensions = 2048;
      sendDimensions = false;
      queryPrefix = "query: ";
      documentPrefix = "passage: ";
    };
  };
}
```

This example needs two suitable GPUs; adjust placement/memory utilization for the machine. See [CUDA validation](cuda-validation.md) for exact experimental runtime identity and limitations: native wheel inference does **not** prove OCI/CDI execution.

A role requires an immutable 40-character repository revision, a complete relative-path→SHA256 `files` manifest, `apiKeyFile` and `maxModelLength`. Include model/tokenizer configuration, tokenizer data, every weight shard/index and any reviewed custom Python files. Set `trustRemoteCode=true` only after reviewing that pinned code. Set GPU IDs and memory limits for the actual machine; defaults use separate GPUs for the two roles. Downloads resume verified partial files and publish the identity-stamped artifact only after every checksum succeeds. Corrupt published artifacts fail closed rather than being silently repaired. Restart the affected role and Chronicle after rotating API credentials. The model-user weights unit owns cache creation; the rootful engine unit must not claim that cache through `CacheDirectory`, which would reset its descendants' ownership on restart. If an earlier experimental configuration already produced root-owned cache descendants, stop the affected service and explicitly rebuild only its known generated cache. This preventive policy does not silently repair existing corrupted caches or recursively chown an untrusted tree.

## Indexed retrieval and SSD tuning

API 1.1 retrieves only currently published chunks through a dedicated projection, replaced atomically with publication. Lexical search uses GIN with `@@`; vector candidates use normalized half-precision HNSW and are reranked by full-precision cosine distance. Indexed dimensions are explicitly bounded to 4000, including Nemotron's 2048 dimensions. Stored original vectors and historical source generations remain intact. Filtered ANN uses iterative scanning and live ACLs, but approximation/scan budgets can omit candidates: semantic/hybrid counts describe the returned ranking window, not a global archive total. API 1.0 is an explicit legacy exact-search compatibility path, not a fallback from failed ANN.

Set host-wide tuning on the shared provider, not an application's retired local-cluster options: `ponygirls.servicePostgres.randomPageCost = 1.1`, `effectiveIoConcurrency = 200` and `maintenanceIoConcurrency = 100` are SSD-oriented starting values. Provider options also expose explicit buffer/cache/maintenance memory budgets. These settings affect every database in that cluster; external databases are not modified. No RAM size is guessed, and fsync/synchronous-commit durability must remain enabled. This is not a storage benchmark: measure query plans/recall and the actual workload.

## Users and agents

Sign in, open **Access**, and mint tokens. A single Home Manager credential used for both collection and search needs `Ingest` + `Read`; `Raw` is separate. Tokens cannot manage groups or mint more tokens. The secret is shown once; after an uncertain mint, resolve the receipt, revoke that token and mint another.

```nix
# Alongside homeManagerModules.dev-llm, or its Chronicle client module.
smind.hm.dev.llm.chronicle = {
  enable = true; # MCP only; does NOT start collection
  url = "https://chronicle.example.net";
  tokenFile = "/run/secrets/chronicle-agent-token";
  collector = {
    enable = true; # explicit upload/privacy opt-in
    exclusions.profiles = [ "personal" ];
  };
};
```

For direct harness launches use `chronicle-run pi` (or `claude`/`codex`); yolo receives the validated runtime token through the existing sandbox credential mechanism. Do not put secrets in URLs, argv or the Nix store. Review the [collector README](../collector/README.md) before enabling native/yolo-profile discovery. Group acceptance shares all archived sessions with current and future members; sharing is direct, not transitive.

## Failure recovery

- `archived` is not `indexed`: raw/status views survive model failure; explicit lexical search remains available when semantic search is unavailable. There is no hidden hybrid→lexical fallback. An open source view pins its revision and annotation generation while head/index counters may advance. **Reload source snapshot** selects the current published source; **View latest archived revision** reads a newer, possibly unindexed archive without attaching older annotations. MCP readers should carry the returned `view.revision` and `view.generationId` into subsequent source/chunk requests.
- Graceful shutdown uses the pinned HTTP server's 30-second active-connection drain; the NixOS service allows 60 seconds. Closing clients first exits much faster. Do not diagnose an open-WebSocket drain with a 5-second kill deadline.
- Review **Activity** and retry failed jobs after correcting the model/configuration. Durable leases and fencing recover interrupted workers; newer archive revisions cannot be replaced by stale workers.
- Collector `--status` shows coverage, pending requests, quarantines and conflicts. Lost acknowledgements retry the same bytes/request ID. Resolve CAS conflicts explicitly; do not silently rewrite expected revisions.
- Exclusions/redaction act before spool/upload. Purge an accidentally uploaded source, then drop/tombstone or exclude it locally; see the collector's `--drop` procedure. Redaction cannot guarantee recognition of arbitrary secrets in prose.
- Changing the annotation model, revision or request policy changes the index profile. `strict-json-schema-32k` sends the same schema as `strict-json-schema`, with `max_tokens=32768` and no model-template override. Startup does not retarget existing owners. If the embedding space is unchanged, use **Maintenance → Review profile switch → Switch without backfill** to use the deployed profile for new sessions and new revisions only. This queues zero replacement jobs, stops unfinished work on obsolete profiles, and leaves existing publications and historical views intact. Use **Rebuild archive index** instead only when you want to replace the existing archive index. Verify any rebuild cohort to completion rather than treating queued work as success.
- Back up the **whole** database, including archive, memberships, receipts, jobs and index profiles. Use `pg_dump`/`pg_restore` or a tested PostgreSQL backup system; periodically restore into a separate database and verify raw retrieval and search. An index-only backup is insufficient.

## Verification

Before release, run `scripts/verify chronicle` from the repository root: it builds the package and the complete backend, dashboard, browser, collector, CLI, protocol and evaluation suites as cacheable Nix checks (see `README.md`, "Verification"). None of them executes the native server. `tests/workflow.test.ts` is an on-demand real-process acceptance test with an actual PostgreSQL/pgvector instance, HTTPS model simulator, generated TypeScript↔Scala codecs, collector CLI and official MCP client. It requires `PG_BIN`, `JAVA_HOME`, `PLAYWRIGHT_BROWSERS_PATH` and `CHRONICLE_SERVER_COMMAND` (a JSON command array). It uses the built dashboard and collector (`npm run build` in each), exercises all eight tools through the official MCP client, pins source views across a model outage and new publication, drives the actual dashboard, and writes ignored desktop/mobile screenshots under `tests/artifacts/`. Run it once for the JVM jar and once for the native executable. See the delivery progress/evidence notes for observed results, not this runbook's intended checks.
