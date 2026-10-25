# Chronicle operations

## Deployment

Chronicle is separate from Haystack and Manure. The server is Linux-native; the collector CLI supports Linux/macOS discovery, but the managed collector daemon is currently Linux/systemd-user only. Nothing collects sessions until explicitly enabled.

```bash
nix develop .#chronicle
nix build .#chronicle .#chronicle-collector
```

The Linux build uses GraalVM's supported fully-static musl target. This avoids the pinned glibc 2.44 mixed static-libm/dynamic-libc linker defect (`_dl_x86_cpu_features`), independently reproduced with a C `log2` program. It is still a native image, not a JVM fallback. The server uses Scala 3.9.0 with `-Yretain-trees`; Baboon 0.0.198 codecs compile in an isolated Scala 2.13.18 library because that generator's runtime is not Scala-3-source-compatible. See the server README for build probes.

Create password hashes with stdin, not password arguments or Nix literals:

```bash
read -rs -p 'Password: ' password; printf '\n'
printf '%s\n' "$password" | chronicle-server password-hash > /secure/runtime/password-hash
unset password
chmod 600 /secure/runtime/password-hash
```

Provision the referenced credentials with your normal secret manager. Model key files may be explicitly empty for an unauthenticated local vLLM endpoint. They must still exist. The managed database password must be nonempty.

```nix
imports = [ inputs.ponygirls.nixosModules.chronicle ];
smind.services.chronicle = {
  enable = true;
  publicUrl = "https://chronicle.example.net";
  users.alice = {
    login = "alice";
    passwordHashFile = "/run/secrets/chronicle-alice-password-hash";
  };
  database.passwordFile = "/run/secrets/chronicle-db-password";
  annotation = {
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
```

The backend remains loopback-only. The module does not open firewall ports. Without `proxy.acmeHost`, arrange TLS at the existing edge; the configured `publicUrl` must remain the exact browser Origin. Deliberately trusted private-network HTTP requires `allowInsecureHttp = true` and an `http://` `publicUrl`; it exposes credentials/data on the wire, keeps the backend loopback-only, and does not open firewall ports (see the server README). Standalone server JSON configuration is in `config.example.json`. All model endpoints are **full operation URLs**, not just `/v1` base URLs.

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

For a managed local PostgreSQL cluster, `database.ssdTuning=true` supplies overridable `mkDefault` settings: `random_page_cost=1.1`, `effective_io_concurrency=200`, `maintenance_io_concurrency=100`. These settings are cluster-wide, including other databases sharing it. Set `database.ssdTuning=false` to opt out or override `services.postgresql.settings` normally. External databases are not modified. No RAM size is guessed, and fsync/synchronous-commit durability is not weakened. Treat these as SSD-oriented starting values, not a storage benchmark; measure query plans/recall and the actual workload.

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
- Model/prefix/profile changes require `chronicle-server maintenance-reindex CONFIG.json`; restart/resume with the same target configuration after interruption. Do not claim success until jobs are complete and semantic queries are enabled again.
- Back up the **whole** database, including archive, memberships, receipts, jobs and index profiles. Use `pg_dump`/`pg_restore` or a tested PostgreSQL backup system; periodically restore into a separate database and verify raw retrieval and search. An index-only backup is insufficient.

## Verification

Run the collector/web tests and server `scripts/test-postgres.sh` before release. `tests/workflow.test.ts` is a real-process acceptance test with an actual PostgreSQL/pgvector instance, HTTPS model simulator, generated TypeScript↔Scala codecs, collector CLI and official MCP client. It requires `PG_BIN`, `JAVA_HOME`, `PLAYWRIGHT_BROWSERS_PATH` and `CHRONICLE_SERVER_COMMAND` (a JSON command array). It uses the built dashboard and collector (`npm run build` in each), exercises all eight tools through the official MCP client, pins source views across a model outage and new publication, drives the actual dashboard, and writes ignored desktop/mobile screenshots under `tests/artifacts/`. Run it once for the JVM jar and once for the native executable. See the delivery progress/evidence notes for observed results, not this runbook's intended checks.
