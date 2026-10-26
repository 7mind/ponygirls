# Opt-in real CUDA validation

This is a synthetic, local, on-demand acceptance suite, not a benchmark and not part of the normal test command. It does not provision models, download weights, inspect harness histories, or start GPU services. It fails rather than substituting simulated models when explicitly enabled.

## Run

Provision the dependencies in `chronicle/tests/package-lock.json`, PostgreSQL with pgvector, an actual Chronicle native executable, and authenticated loopback model endpoints. Use the generated **1.1.0** codecs matching the server.

```bash
export CHRONICLE_CUDA=1
export CHRONICLE_CUDA_MODELS=/absolute/path/models.json
export PG_BIN=/absolute/path/postgresql-and-plugins/bin
export CHRONICLE_SERVER_COMMAND='["/absolute/path/bin/chronicle-server"]'
./chronicle/scripts/test-cuda.sh
```

The model configuration is not a credential store; it references separate mode-0600 credential files:

```json
{
  "annotation": {
    "requestPolicy": "strict-json-schema",
    "endpoint": "http://127.0.0.1:18501/v1/chat/completions",
    "model": "Qwen/Qwen3-4B-Instruct-2507",
    "revision": "cdbee75f17c01a7cc42f958dc650907174af0554",
    "credentialFile": "/absolute/private/path/synthetic-api-key"
  },
  "embedding": {
    "endpoint": "http://127.0.0.1:18500/v1/embeddings",
    "model": "nvidia/llama-nemotron-embed-1b-v2",
    "revision": "113abe4acafa848e77ead9c0623205e511932348",
    "credentialFile": "/absolute/private/path/synthetic-api-key",
    "dimensions": 2048,
    "sendDimensions": false,
    "queryPrefix": "query: ",
    "documentPrefix": "passage: "
  }
}
```

Without `CHRONICLE_CUDA=1`, the script prints an explicit skip. With it, required environment variables, authentication, immutable revision shape, loopback URLs, expected dimensions and all assertions are mandatory. The temporary database and native server are stopped after the test; failed synthetic fixtures/logs are retained under the printed temporary path. The caller owns model-service supervision and shutdown.

### Assertions

- `tests/cuda/endpoints.test.ts`: missing/wrong API credentials are rejected; native 2048-dimensional vectors are finite and nonzero; response indices correspond to input order even after reordering and changing batch size; repeat cosine exceeds 0.9999. Six labeled paraphrases retrieve their own topic at rank 1. Cyclically mismatched vectors lose by at least 0.1 cosine, and an unrelated-query control scores below every labeled positive.
- `tests/cuda/native.test.ts`: the real native process ingests synthetic Pi transcripts encoded through the collector and Baboon codecs into real PostgreSQL. A transparent local audit relay forwards **unaltered requests and real model responses**, checking actual credential-file authentication, `query: `/`passage: ` prefixes, omission of the optional dimensions request, batch bounds, and JSON-object annotation mode. It never synthesizes annotations or vectors.
- Every job must publish successfully. Model-generated summaries/tags must be nonempty and bounded; source spans must cover every original UTF-8 byte exactly once, in source order, reconstructing the chunk text exactly. Session source identity, indexed revision and immutable generation must agree. No simulator-specific tag names, chunk counts or exact LLM wording are assumed.
- WebSocket negotiation requires 1.1.0. Official MCP semantic and hybrid searches must retrieve each expected topic first and return `CandidateWindow` with an explicit integral `rankingLimit`; legacy 1.0 exact compatibility is not acceptance. This identifies the bounded API semantics, not the physical PostgreSQL query plan: HNSW plan use and recall require the separate larger-corpus database validation.

These are specified-origin Behavioral-Active Good-Communication tests: the endpoint suite is Blackbox; the native suite is Effectual because it audits outgoing model-protocol requests. Printed latency/resource observations are diagnostic measurements, not correctness thresholds or throughput claims. Existing deterministic model-adapter tests remain the fast tier; this small real-model tier establishes behavior that an HTTP simulator cannot establish.

## Actual local experiment: 2026-10-25

Host `computeinstance-e00cd1eayd00hs9qas`; driver `580.173.02`; H100 80GB HBM3. GPUs 0 and 1 reported 0 MiB before allocation. Only GPU 0 was allocated for embedding and GPU 1 for annotation; GPUs 2–7 were not used. No Docker access, daemon change, host activation, permanent deployment, global pip installation, borrowed HF credential, or gated model was used.

| Role | GPU UUID | Public model revision | Weight SHA-256 |
|---|---|---|---|
| Embedding / GPU 0 | `GPU-342b9337-a406-198c-2f96-97dc2daff70e` | `nvidia/llama-nemotron-embed-1b-v2@113abe4acafa848e77ead9c0623205e511932348` | `45f8440682a89ac577cc8d53b1bb345804772adb7b34e0573562e2fca4e62b0d` |
| Initial annotation smoke / GPU 1 | `GPU-eb2725a6-749a-3e55-bc24-8fcc30303796` | `Qwen/Qwen3-0.6B@c1899de289a04d12100db370d81485cdf75e47ca` | `f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b` |
| Accepted annotation / GPU 1 | same GPU, after stopping the small model | `Qwen/Qwen3-4B-Instruct-2507@cdbee75f17c01a7cc42f958dc650907174af0554` | three shards: `75311d91bb08cf0b882913da464a1e722a31fb44db35208663487efb7a3d8ed6`, `0b48adbb1f60e901153d91907ba11ce63bd4b8b584482e730f48808d055dfba1`, `7dd39ccca5e4de123c74c14af44c9bf2eb75df33b4614382af0134528e060d5d` |

Complete portable SHA-256 manifests are provided in [`../model-manifests/nemotron-embed-1b-v2.json`](../model-manifests/nemotron-embed-1b-v2.json) and [`../model-manifests/qwen3-4b-instruct-2507.json`](../model-manifests/qwen3-4b-instruct-2507.json).

HF API manifests were resolved to exact commits before downloading. All selected LFS files were checked by size and SHA-256, other files by Git blob SHA-1, with a completeness manifest written last. Redundant `pytorch_model.bin` was not downloaded. Model directories are commit-addressed; reuse requires verification, not mere path existence. Only safetensors weights were loaded.

Before enabling remote code, the pinned `llama_bidirectional_model.py` and `pooling.py` were read completely: tensor operations, Transformers classes, and compatibility introspection; no filesystem/process/network side effects were present. Their SHA-256 values are respectively `fd26e459b1277bee61b3d501cddd61291714e48a93a9a1c0ab81b1342c59fcc2` and `117422c718eac86f834c1cacf39c1eca13f80a254e03bacdf3a4f4e4e98da4bb`.

### Runtime and serving

Observed wheel runtime: Nix Python **3.12.15**, uv **0.13.1**, vLLM **0.29.0**, torch **2.13.0+cu130**, Transformers **5.20.2**, FlashInfer **0.6.18**. The wheel runtime is application-version parity with the optional deployment's vLLM 0.29.0, **not** bit-equivalence with a Nix Python 3.13 closure or the separately pinned official OCI image. No OCI execution is claimed here.

Both roles use `host=127.0.0.1`, `dtype=bfloat16`, `max-model-len=8192`, `gpu-memory-utilization=0.2`, `enforce-eager=true`, `max-num-seqs=16`; distinct role ports 18500/18501 and `CUDA_VISIBLE_DEVICES=0`/`1`. Embedding uses `runner=pooling`, `trust-remote-code=true`, and the exact repository name as `served-model-name`. Annotation uses `runner=generate`, `served-model-name=Qwen/Qwen3-4B-Instruct-2507`, and `default-chat-template-kwargs={"enable_thinking":false}`. The latter key was checked against actual 0.29.0 CLI help and config parsing.

Run the local model directory **positionally**:

```bash
vllm serve /absolute/path/models/EXACT_HF_COMMIT --config /absolute/path/role.yaml
```

The `.yaml` file may contain JSON (YAML subset), but the extension must be `.yaml`/`.yml`. Do not put a `model` key in it: actual 0.29.0 `serve --config` converted that key into removed `--model` and exited 2 with an ambiguous-option error. Positional model plus both corrected role configs parsed successfully.

API authentication was supplied by a Python exec helper reading the separate synthetic credential file into `VLLM_API_KEY`, never putting the key in argv. The helper sets private `HF_HOME`, `HF_HUB_CACHE`, `XDG_CACHE_HOME`, `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`, `HF_HUB_OFFLINE=1`, removes `HF_TOKEN`, and disables usage telemetry. vLLM, Triton, CUDA and TorchInductor caches are explicitly private. FlashInfer requires **`FLASHINFER_WORKSPACE_BASE`** as well: its inspected implementation does not use XDG for that cache. The venv `bin` directory must be on PATH for installed `ninja`. These explicit JIT-cache/telemetry settings were added after inspecting initial failed annotation attempts; the original embedding process was not restarted merely to change its environment. Do not infer that it inherited later helper edits. The first annotation attempt selected FlashInfer's default home-cache location before that behavior was discovered; subsequent attempts use owned paths. No claim of zero initial writes outside the experiment cache is made.

On this Nix Python/host-driver combination, precise `LD_LIBRARY_PATH` entries were needed for Nix `libstdc++` and an owned directory containing symlinks to the host's CUDA/NVML libraries. Adding the entire host `/usr/lib/x86_64-linux-gnu` was rejected after reproducing a glibc-private-symbol failure; no host loader/library files were changed.

### Compiler/header correction, verified before model restart

The initial resolver chose nvcc/CRT/NVVM **13.4.92** beside torch's **13.0** headers/runtime. Annotation warmup failed first because `ninja` was not on PATH; after that correction, the actual error was CCCL's compiler/toolkit compatibility assertion (`CUDART_VERSION=13000`, compiler 13.4). No compatibility guard or sampling backend was disabled.

A separate project-local toolchain, leaving the running embedding venv unchanged, pins:

```text
nvidia-cuda-nvcc==13.0.88
nvidia-cuda-crt==13.0.88
nvidia-nvvm==13.0.88
nvidia-cuda-cccl==13.0.85
nvidia-cuda-runtime==13.0.96
nvidia-nvjitlink==13.0.88
nvidia-curand==10.4.0.35
```

`CUDA_HOME` selects that toolchain. Its wheel layout required owned `lib64 -> lib` and `lib/libcudart.so -> libcudart.so.13` symlinks after a captured linker failure; nothing outside the experiment directory was modified. A standalone kernel compiled with FlashInfer's vendored CCCL headers and compile-time major/minor assertions returned **`compiler=13.0 runtime=13000 kernel_result=1`**. Then FlashInfer's actual top-k/top-p JIT and CUDA sampling returned **`[3,3,3,3]`**, before requesting an annotation-service restart. This is kernel execution evidence, not an inference claim for the language model.

### Observed embedding results

Authenticated real `/v1/embeddings` inference produced distinct indexed 2048D vectors. The labeled endpoint test passed:

- Rank-1 retrieval: **6/6**, for database/astronomy/baking/network/gardening/music paraphrases.
- Positive cosine range **0.24795–0.50473**; cyclic mismatched range **−0.01703–0.03176**; every positive exceeded its mismatch by more than 0.1.
- Unrelated-query maximum cosine **0.03498**, below every positive.
- Repeated-query cosine **0.9999167**; reordered batch/single comparisons passed.
- Observed requests: batches **6/6/1/2/1**, approximately **47.2/31.7/15.6/17.3/22.5 ms** including HTTP. One warm synthetic run, not a sustained-load measurement.
- Post-probe GPU 0 snapshot: **3183 MiB**; GPUs 1–7 at **0 MiB** at that observation. This snapshot is not a peak-memory measurement.

A real interoperability defect was reproduced before changing the client: the same natural-2048D model returned **400** when sent `dimensions:2048`, versus **200 / shape [1,2048]** when that optional truncation parameter was absent. Its pinned HF config does not advertise Matryoshka dimensions, despite the model card discussing truncation. The acceptance configuration therefore explicitly uses `sendDimensions:false` while **still requiring exactly 2048 output values**. No HF metadata override, silent retry, vector truncation, or weaker shape check was used.

### Annotation model selection

After the compiler correction, Qwen3-0.6B completed real authenticated CUDA chat inference with `response_format=json_object`, but failed the unchanged semantic contract. For two fragments indexed 0 and 1, it returned `first:0,last:117`, copying the source byte end instead of the fragment index. A deterministic repeat produced the same invalid partition. The pinned public Qwen3-4B-Instruct-2507 was then tested on the same GPU after stopping 0.6B. It also completed real CUDA chat inference but returned byte endpoints 117 and 87 instead of fragment indices. **Model size was not an established correction.** No partition/source oracle was relaxed.

A controlled 4B experiment with all six two-message topic fixtures yielded **0/6 valid partitions** with the original production prompt and envelope. Keeping the system prompt, model, temperature 0, JSON-object constraint, source text and strict oracle unchanged, removing only the unnecessary `start`/`end` byte offsets from the model-facing source yielded **6/6 valid partitions**. The server retains byte spans internally and reconstructs source text itself; the model selects only fragment indices.

The same minimal correction, with the actual production key order `index,role,text,messageId`, passed **5/5 additional cases**: one fragment, three messages, four messages, four full-window fragments of one message, and a fragmented Chinese/Russian/emoji message. The repeated astronomy message has UTF-8 fragment lengths **2048/2048/2048/926 bytes**. The native fixture now includes that complete window, rather than checking only short transcripts.

An initially reported long-window failure was subsequently isolated to a different JSON key order (`messageId` before `text`), not to the exact production envelope. A controlled key-order/message-ID comparison and repeat of all five production-order cases corrected that interpretation. An additional bounds sentence also passed, but was not needed for the validated production envelope and was not selected as the minimal correction. This sensitivity is a limitation of empirical model compliance, not permission to repair model output or weaken the server's partition guard. Results are finite synthetic observations, not a guarantee for all transcripts.

After these probes, GPU memory snapshots were **3183 MiB embedding / 16323 MiB annotation**, with GPUs 2–7 still at 0 MiB. These are resident snapshots, not peak memory or throughput measurements.

### JVM full-pipeline smoke result — not native acceptance

The root-supervised run `bgt-0fb56009bcccb567` was inspected in its terminal log and passed **2/2 tests**, including the complete four-fragment astronomy window. Its recorded server command was GraalVM Java **`java -jar chronicle/target/chronicle-server.jar`**, not an ELF native executable. This is actual application/database/model pipeline evidence, but **not native-image evidence**, and it predates the final single-traversal search integration.

Observed: **6 sessions / 12 chunks**, all original UTF-8 source bytes covered exactly once; real upstream calls **7 annotation / 7 document embedding / 12 query embedding**; all **12 semantic/hybrid topic searches ranked the expected session first**, with 1.1 candidate-window assertions passing. Indexing took **13.764 s**; the pipeline test took **24.390 s**. Search observations were approximately **46.2–74.6 ms** including MCP/HTTP/model/DB work; these are one-run diagnostics, not benchmark claims. The endpoint test independently repeated 6/6 rank-1 retrieval and the negative controls.

The JVM result is kept separate from the final native-image result below. The harness prints its actual `serverCommand` and job-attempt counts to disclose command provenance and retries.

### Final integrated native-image result

Root-supervised run **`bgt-b72cbc060f65e0f0`**, inspected in its specific terminal log on 2026-10-25, passed **2/2 tests, zero failures/skips**. No concurrent duplicate GPU run was made. The test source matched the integrated copy byte-for-byte (`native.test.ts` SHA-256 `c646fc5aaba4bfab5ca24c34dc411ece58f17c28903e9649adc171c4e01a2013`, harness commits `a476830`, `66b2527`, `85de184`).

Actual command:

```text
/nix/store/rsx2kfpbivrcc9nik6dfkdrkj8y73zsa-chronicle-0.1.0/bin/chronicle-server
```

The wrapper was inspected: it directly `exec`s the package's `libexec/chronicle-server`, with no Java launcher. That **60,294,288-byte ELF 64-bit x86-64, statically linked, stripped** executable was independently identified with `file`; its SHA-256 is **`455ed07e84c75b8c3406afbc631efa3675178a78b1b575e1c2f986b45a94a35a`**. This immutable package, not the earlier JVM jar, is the native acceptance artifact.

Observed native result:

| Check | Actual result |
|---|---|
| Published sessions / chunks | **6 / 12**; no exact chunk-count oracle |
| Job attempts | **[1,1,1,1,1,1]** — no indexing retries |
| Real model calls | **7 annotation / 7 document embedding / 12 query embedding** |
| Source provenance | Every original UTF-8 byte covered exactly once; source text reconstructed exactly; matching source identity, revision and generation |
| Long-window coverage | Full **2048/2048/2048/926-byte** same-message astronomy window, including multibyte text |
| Generated annotations | Nonempty bounded summaries/tags; unchanged strict partition guard |
| Semantic / hybrid retrieval | **12/12 expected topics at rank 1**, all with 1.1 `CandidateWindow` and explicit `rankingLimit` assertions |
| Native indexing observation | **14.156 s** |
| Pipeline / complete suite observation | **23.247 s / 23.955 s** |
| Search observations | **36.9–45.5 ms**, including MCP/HTTP/model/DB work |

The final endpoint leg independently passed auth rejection, finite/nonzero **2048D** shape, batch indices/order, query/passage prefixes and negative controls: **6/6 rank-1** labels; positive cosine **0.248418–0.504891**, cyclic mismatch **−0.017205–0.031307**, unrelated maximum **0.034981**, repeat cosine **0.9999999999999998**. Batches 6/6/1/2/1 took approximately **37.3/38.1/15.5/15.4/15.5 ms**, including HTTP. These are finite synthetic-run observations, **not throughput, peak-memory, production-recall, general LLM-compliance, or physical HNSW-plan claims**.

Model services remain root-supervised for final integration review; the root owns their eventual shutdown. The test cleaned up its own native process and temporary database. No permanent service deployment or host configuration activation was performed.

### Evidence retention and limits

Raw synthetic evidence is retained under the experiment worktree's ignored `.local/cuda/`: `embedding-results.log`, `embedding-dimensions-repro.json`, `embedding-first-inference.json`, `toolchain-probe.log`, `sampling-probe.log`, `annotation-first-inference.json`, `annotation4b-inference.json`, the controlled `prompt-experiment` / `source-envelope-experiment` / `production-envelope-experiment` / `field-order-id-experiment` JSON/logs, model manifests and role configs. Model-service task IDs and terminal logs are supervised by the root agent, not detached shell processes. Caches and weights are not committed.

Dependency evidence:

- `runtime.lock` SHA-256: `5faaafedbeabd2342fe9d9fdba95d65e432056b0ca5faf6d163ed018956b9164`.
- `runtime-installed.json` SHA-256: `7c42613001504b45b33dd04164fbb04af96ef8e28cb60898760149ce7040d280`.
- `runtime-wheels.json` SHA-256: `fc310bb9317f65dcd9b21cfa22d644df9c7ff80ad7684afc148a76055058ef76` (198 installed wheels, filename/URL/download SHA-256 extracted from uv's actual wheel cache and crosschecked against installed distributions).
- `toolchain.lock` SHA-256: `25876ce40f8990997965cc6b2d5cb582e6e7f650fee4f34661e3cfc160b23f4c`.
- `toolchain-wheels.json` SHA-256: `a5961ec88e91d0434aa8e0ee46dcf0c6a3f4bc70e160a18981ebe6d73896b6e0` (seven separately selected compiler/toolkit wheels).

The full wheel identities below distinguish installed runtime wheels from the separately selected 13.0 compiler/toolkit. The original venv still contains unused 13.4 compiler wheels; the effective compiler is the explicit 13.0 `CUDA_HOME`, not whichever compiler happens to be installed in that venv.

<details>
<summary>Installed runtime wheels (198)</summary>

```text
22c6a1c9c23894a12f55aea625f060b8d3330fba774de72d02d5442bb580417f  agent_detector-2.0.0-py3-none-any.whl
9243213661e29250eb41368e5daa826fc017156c3b8a11440826b2e3ed376472  aiohappyeyeballs-2.7.1-py3-none-any.whl
20f085697d7e911f1f73c43ed03fafbed1e7121797e2eb5428efa80398060584  aiohttp-3.14.5-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
053243f8b92b990551949e63930a839ff0cf0b0ebbe0597b0f3fb19e1a0fe82e  aiosignal-1.4.0-py3-none-any.whl
117bac03a25ede5df5440e855b32d556049ca169ead221505badf432fed4b101  annotated_doc-0.0.5-py3-none-any.whl
f072f4d804ea359e4eaf198b1af7a8b0943881a87f31bb764f8bf219bb9419e0  annotated_types-0.8.0-py3-none-any.whl
aa6a3984f9276f307933d42dc6f58b6efc821a5ecafbc8d1bb5993a066767622  anthropic-2.3.0-py3-none-any.whl
6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101  anyio-4.15.1-py3-none-any.whl
2843f084cdc94dedacd8b257a395a2b71b8a3dc7fc99711b148bf1d161983128  apache_tvm_ffi-0.1.11-cp312-abi3-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl
070a54e890cefb5b3739d19f30f5a5ec840ffc9c50ffa7d23cc9fc1a38ebbfc5  astor-0.8.1-py2.py3-none-any.whl
c647aa4a12dfbad9333ca4e71fe62ddc36f4e63b2d260a37a8b83d2f043ac309  attrs-26.1.0-py3-none-any.whl
33424c686b291c7682b5816fe9320466dbc0a457ef7e15c273c804a2d70fea70  blake3-1.0.11-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
9033308cc26b678784a27b096aab1541b9e698d785c3e9918b691ccd458d88df  cachetools-7.2.5-py3-none-any.whl
b70d7c47ea84d456034d2be02e89d92eef7044cfcedf6f05058e21d4452f0fef  cbor2-6.1.5-cp312-cp312-manylinux_2_28_x86_64.whl
e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1  certifi-2026.10.23-py3-none-any.whl
c1453022f490d2459a11819d83ad1d586e9ff65a12ac3e705ffebd46d3685dcf  cffi-2.1.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
3d31298449090ab8d47b7b1b2a555ff73cac7ed438a08b7ac160980c7ebed649  charset_normalizer-3.5.2-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360  click-8.5.0-py3-none-any.whl
9acb47f6afd73f60dc1df93bb801b472f05ff42fa6c84167d25cb206be1fbf4a  cloudpickle-3.1.2-py3-none-any.whl
4a1b89b508f7efb8ffb4eee8a6e69e0452d9b080cae130146025c64fbe9fa9aa  compressed_tensors-0.17.0-py3-none-any.whl
9dab55f57c74c3cad24c323bacbbd04be4705ba6eb0d92e920b1fc4837ed5079  cryptography-50.0.2-cp311-abi3-manylinux_2_34_x86_64.whl
433efa31e33c2868621b5f6036bd3bf5de9c45c5546cb1361a5f6ff3415b8bb5  cuda_bindings-13.4.4-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl
0b299eee52edece08b77428cfc22b33b29be1bc69c42878d2e6114031eac17e6  cuda_core-1.2.2-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl
85a4e708c725d603f576042ef32781a3d1737c51e84c35fe361d2680191af65a  cuda_pathfinder-1.8.4-py3-none-any.whl
2a4a35c7f102e3c51b9e18e65b34a24b82d7363893b6e2f228978c18bafa1957  cuda_python-13.4.4-py3-none-any.whl
f886e84a7b54de5e26598eb9a828387a4c87e6ab5b986838cd8a5277a9ffab40  cuda_tile-1.7.0-cp312-cp312-manylinux2014_x86_64.whl
d693caaa261214ddd7dbb60d68e71cbed884e68c2be7509778f3051da0b91c3f  cuda_toolkit-13.0.3.0-py2.py3-none-any.whl
d31effad4261cebecb58955d832e448ace88f432328f95f82fd99c30fd9308d4  depyf-0.20.0-py3-none-any.whl
87e2ce7d05cb108b178f8e45bb80d3d88c0cb4b397983345c18ad6562e02e620  detect_installer-0.2.1-py3-none-any.whl
1e1ce33e978ae97fcfcff5638477032b801c46c7c65cf717f95fbc2248f79a9d  dill-0.4.1-py3-none-any.whl
9a4aedb833c3c1b49214d04d44d3032ab7a9135f7c1d29a549b4ff78fd82fda9  dnspython-2.9.0-py3-none-any.whl
b3fcbed555c47d8479be0796ef7e19c2670d428d72e96da63f3a40122860374b  docstring_parser-0.18.0-py3-none-any.whl
54058201ac7087911181bfec4af6091bb59380360f069276601256a76af08193  einops-0.8.2-py3-none-any.whl
80f13f623413e6b197ae73bb10bf4eb0908faf509ad8362c5edeb0be7fd450b4  email_validator-2.3.0-py3-none-any.whl
3d2a69bdf04b7e9f3afa292c3bc7a98816bbfafa10bc9b45f3f3700d2f761620  fastapi-0.136.3-py3-none-any.whl
8dcc286fa32f01bbd3f65dd09cfd5a2540ed5f2230b77db7fd30978d6165f3c4  fastapi_cli-0.0.32-py3-none-any.whl
94029f92f3dc4289b376e1213f0d6cc7c30d4f32de7e47b5effc6dc754ab9ce9  fastapi_cloud_cli-0.26.0-py3-none-any.whl
deb0b3882626832361dd0fcee1f4ef1c6e2a7aaa4165e51c86ae0bab95caccd6  fastar-0.12.0-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
cf8085203d83abbf2ea37edfb4b007cf1de521ab1cd29b46935f611d68c80d7d  fastsafetensors-0.5.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
301241438c57936ef93f4243a94f2559022268bfcf9b375a9a72eb0f8db8358e  filelock-4.2.4-py3-none-any.whl
d5d26edb48f8def0bf28b2c94415aef7f0754e2cd9e3cb3d6e7081262d068aad  flashinfer_python-0.6.18-py3-none-any.whl
494a5952b1c597ba44e0e78113a7266e656b9794eec897b19ead706bd7074383  frozenlist-1.8.0-cp312-cp312-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl
8dd6e646e99ea382bd85f97a45e6b526a442d79423a7dc673f1e2756d05fcb5f  fsspec-2026.9.0-py3-none-any.whl
59e13344a9f3651aa201a03e2bee815a3bf43a4baf1f9ff8a9b62a840ce25fac  googleapis_common_protos-1.76.0-py3-none-any.whl
474408c92b27c823ea6aab2315e2ea52d5a4e0040b37ce1e65e89d9149c48205  grpcio-1.84.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86  h11-0.16.0-py3-none-any.whl
2814a6e999d13464c4d679b788cc5d784eb5a4edfc638a31f10e9a11ab531ef8  hf_xet-1.7.0-cp38-abi3-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55  httpcore-1.0.9-py3-none-any.whl
5c4358319f2602d984ad93182c9fee5160f22e9da7babdda870a5e7c4e2dc34f  httpcore2-2.16.0-py3-none-any.whl
3e3201fe4d46e0d15d7ff9fafc94a605da9eb82d2c5b9837f0368acb325481f1  httptools-0.9.0-cp312-cp312-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl
d909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad  httpx-0.28.1-py3-none-any.whl
fd2c5d7909e8d86fe92d53020c310ca0e4e431b838c207c5754b9bbf0308d49a  httpx2-2.16.0-py3-none-any.whl
5da369600233568a126eb5578754935b2add9446b42d9e2fc0927d56840ac1a5  huggingface_hub-2.3.0-py3-none-any.whl
cd3ef712a93f3a9075ea99de2c72bcd3ec89dab3759b3a248d869f5507b60331  humming_kernels-0.1.12-py3-none-manylinux_2_28_x86_64.whl
ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c  idna-3.20-py3-none-any.whl
c14d568d31a322e8ed7e9735f6e355608a23cc6ff4b5da843515089dae4cbf5f  ijson-3.6.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
382954f2329fc085ff298ce0205a06ce0fc8c67a704fc032613931a5ae9018d5  instanttensor-0.2.2-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
b0c07007d48c89d6d19f7204972d369b2a77222722e126b6aa63aa721dc3b19c  interegular-0.3.3-py37-none-any.whl
85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67  jinja2-3.1.6-py3-none-any.whl
b3c741e6b778c951a6861964ee475118812a33208426c54fb92bf4e318bda834  jiter-0.18.0-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
a5663118de4908c91729bea0acadca56526eb2698e83de10cd116ae0f4e97c64  jmespath-1.1.0-py3-none-any.whl
d489f15263b8d200f8387e64b4c3a75f06629559fb73deb8fdfb525f2dab50ce  jsonschema-4.26.0-py3-none-any.whl
98802fee3a11ee76ecaca44429fda8a41bff98b00a0f2838151b113f210cc6fe  jsonschema_specifications-2025.9.1-py3-none-any.whl
c2276486b02f0f1b90be155f2c8ba4a8e194d42775786db622faccd652d8e80c  lark-1.2.2-py3-none-any.whl
ceec951d29a74309984e3be0fe7f5f56c1362434cd937abd517b259a60908b1e  llguidance-1.7.6-cp39-abi3-manylinux_2_31_x86_64.whl
5853bf26160857c0c2573415ff4efe01c4c651e59e2c55c2a088740acfee51cd  llvmlite-0.47.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
cf586350875def1ae7a8fba84fcbbfc8371424b6c9d05c1fcba70aa233fbf06f  lm_format_enforcer-0.11.3-py3-none-any.whl
31a33c10c8e1e10422bfd431aeb5d351c7cf7fa671e3c4df004162264b28220c  loguru-0.7.3-py3-none-any.whl
9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a  markdown_it_py-4.2.0-py3-none-any.whl
8e124f974786f831d6043728e38296969d3579db8896fe004682f5758e613581  markupsafe-3.0.4-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
dd0c44c089d16453e8ae31a3877a0054d7a2314caaa81f5e0541b9b1734b2377  mcp-2.3.0-py3-none-any.whl
968efdbdaedfab06adae40d378a34395f1090c5921d4be3c9cde283aaf76d91d  mcp_types-2.3.0-py3-none-any.whl
84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8  mdurl-0.1.2-py3-none-any.whl
fa4504b66c30c0201ae4578c0340c5ee2abd22151c271532f62e373b985a53cf  mistral_common-1.12.0-py3-none-any.whl
3b4a480aa8fd54a1805b8ac10f3f91763926a74f73c0c364c10f9231854f4170  ml_dtypes-0.6.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
47f4f65713120bc3a69feb022981a38db9e557aedf88dbd72077f20588caa12b  model_hosting_container_standards-0.1.16-py3-none-any.whl
a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c  mpmath-1.3.0-py3-none-any.whl
99c401861c5bb3a57f7d6423ea7ed4352cd57aa3f04f4fbe9f3e3e4564a10f08  msgspec-0.22.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
1fb8c1a3480c130c3a6422d5f16f3cad6552bf08c2089dd288ba7134649183b5  multidict-7.2.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
f4006cf8c12c26ed29811b80858a58f8f31e4b42ea85b6c1d23401981449ab9d  nccl4py-0.6.0-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl
e3fd2c13a7814cee3746340d8d7f8598a67f16a58bf47fb7f8793fab6efca1b0  networkx-3.7-py3-none-any.whl
65a24341b5ac09fcadcc37082660be40a94174e51a937fabf6e2cae26225fa2c  ninja-1.13.2-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
a52d92ffd297c10364bce60cd1fcb88f99284ab5df085f2c6bcd1cb33b529a6f  numba-0.65.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
0d8163f43acde9a73c2a33605353a4f1bc4798745a8b1d73183b28e5b435ae28  numpy-2.3.5-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
37936a16db8fe4ac1f065c2139360608a543a09275cb1a1af612e08cfa065436  nvidia_cublas-13.1.1.3-py3-none-manylinux_2_27_x86_64.whl
48ba8e44a1162face51306d5bfd67604d9949be5acb9105dbb93734d2df8b3a4  nvidia_cuda_cccl-13.3.4.3.1-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
731ce3de11df8add8306404417a1edaede225dbe27eb233aed37c8de9d4fe720  nvidia_cuda_crt-13.4.92-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
4eb01c08e859bf924d222250d2e8f8b8ff6d3db4721288cf35d14252a4d933c8  nvidia_cuda_cupti-13.0.85-py3-none-manylinux_2_25_x86_64.whl
a1f3bfb27299e060b444d5df1f4bcd762501326cf0fd3141ed61756816ab9a0e  nvidia_cuda_nvcc-13.4.92-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
f35a5b6ddb64b6758c22c0b078c5b6ff6d54f7c240cd74bf131ab5bf13b6c3fe  nvidia_cuda_nvdisasm-13.4.92-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
ad9b6d2ead2435f11cbb6868809d2adeeee302e9bb94bcf0539c7a40d80e8575  nvidia_cuda_nvrtc-13.0.88-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl
7f82250d7782aa23b6cfe765ecc7db554bd3c2870c43f3d1821f1d18aebf0548  nvidia_cuda_runtime-13.0.96-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
0c45dd8eeb50b603f07995b1b300c62ffe6a1980482b82b3bcf94a4ca9d49304  nvidia_cudnn_cu13-9.20.0.48-py3-none-manylinux_2_27_x86_64.whl
3171f102254136418f24b4470dfa5419f34b03d9d792a4b773cf65c7a37e6bf8  nvidia_cudnn_frontend-1.31.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
6c44f692dce8fd5ffd3e3df134b6cdb9c2f72d99cf40b62c32dde45eea9ddad3  nvidia_cufft-12.0.0.61-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
08a3ecefae5a01c7f5117351c64f17c7c62efa5fffdbe24fc7d298da19cd0b44  nvidia_cufile-1.15.1.6-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
1aee33a5da6e1db083fe2b90082def8915f30f3248d5896bcec36a579d941bfc  nvidia_curand-10.4.0.35-py3-none-manylinux_2_27_x86_64.whl
0a759da5dea5c0ea10fd307de75cdeb59e7ea4fcb8add0924859b944babf1112  nvidia_cusolver-12.0.4.66-py3-none-manylinux_2_27_x86_64.whl
2b3c89c88d01ee0e477cb7f82ef60a11a4bcd57b6b87c33f789350b59759360b  nvidia_cusparse-12.6.3.3-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
786ce87568c303fadb5afcc7102d454cd3040d75f6f8626f5db460d1871f4dd0  nvidia_cusparselt_cu13-0.8.1-py3-none-manylinux2014_x86_64.whl
06ac62deb182a852dfb053032cf945bf02b9aa1bf502a18b129d280d7babb26c  nvidia_cutlass_dsl-4.6.2-py3-none-any.whl
24dfaddad6077fd0de14eecaf66a72762f2f5f30ae1872231f5bf8b243ac2eac  nvidia_cutlass_dsl_libs_base-4.6.2-cp312-cp312-manylinux_2_28_x86_64.whl
571d4b46fca1bfbb123d0dc348eaa7fd80af0014ddffc07b849e8195b2364333  nvidia_cutlass_dsl_libs_core-4.6.2-py3-none-any.whl
7f510307369d522da8e7d666557b9b9e7df06b94748bd5dc0198d59dfd0d918a  nvidia_cutlass_dsl_libs_cu12-4.6.2-cp312-cp312-manylinux_2_28_x86_64.whl
a299a623fad75eb752c1a4e447b924e9049ed396b037509c41a48da82d1f340a  nvidia_cutlass_dsl_libs_cu13-4.6.2-cp312-cp312-manylinux_2_28_x86_64.whl
959bf4adf6fe1308e4bd739e722236b0d1ec8392e2cefad33ff70c311380b9b6  nvidia_ml_py-13.615.71-py3-none-any.whl
edd81538446786ec3b73972543e53bb43bcaf0bfc8ef76cb679fcc390ffe136d  nvidia_nccl_cu13-2.29.7-py3-none-manylinux_2_18_x86_64.whl
e0391f24ed94ec879b84e3da4d4ec320c879aff681f2c7a638462f7199284323  nvidia_nvjitlink-13.4.92-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl
290f0a2ee94c9f3687a02502f3b9299a9f9fe826e6d0287ee18482e78d495b80  nvidia_nvshmem_cu13-3.4.5-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
4936d1d6780fbe68db454f5e72a42ff64d1fd6397df9f363ae786930fd5c1cd4  nvidia_nvtx-13.0.85-py3-none-manylinux1_x86_64.manylinux_2_5_x86_64.whl
e4c81cb321dd9743bcf871c5e7e8fecd7f05dea607944426e102bdda8d49e137  nvidia_nvvm-13.4.92-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl
3ca8030a6d197952318013dd1c12c22da1d4b9feb76ba72e0fcd449961183c2c  nvtx-0.2.15-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
d9f5b000f52397a7f9f946012744c5bc4c962eed3c100385252464c273a63e57  openai-3.37.0-py3-none-any.whl
c007d277218a50db8839e599ed78e0fffe5130f614c3f6d93ae257f282071a29  openai_harmony-0.0.8-cp38-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
ed709fdf9aa0bd1f2ed8549e71d19449b03a675bb581eb292285f6861953be37  opencv_python_headless-5.0.0.93-cp37-abi3-manylinux_2_28_x86_64.whl
b31553efa588ae44bc306f863c785c5333a9ecc091248c6ee68b4b6c87fdedfb  opentelemetry_api-1.45.1-py3-none-any.whl
2f95404bdee7f9d2d529c7de56c7bd86d014d774d8fbf137810e0167f8a492bf  opentelemetry_exporter_http_transport-0.66b1-py3-none-any.whl
ef3910d32b36ccbaf62390189759bd43a8109885e2d50b738ed9c9b255bf5cb5  opentelemetry_exporter_otlp-1.45.1-py3-none-any.whl
00ff8592c3a7cb729ff3fdc7ffa12372c243bdf2163e80c180994d0c7bd83ee9  opentelemetry_exporter_otlp_common-0.66b1-py3-none-any.whl
2f446183ae7047b036226f1d846c41a834b0e8755ad13b51a51dd38952eb466c  opentelemetry_exporter_otlp_proto_common-1.45.1-py3-none-any.whl
e42ecb789d2fc5d8145e3dadc3e2991c9f18cd166d7c7514e234702540274b76  opentelemetry_exporter_otlp_proto_grpc-1.45.1-py3-none-any.whl
24a97cf3753c7fb52fad44a696e452ff371686339e2acf3309e2eda3d0230700  opentelemetry_exporter_otlp_proto_http-1.45.1-py3-none-any.whl
f38e2a8413053c180cd3d2637fbb279673ec2f6a6e09c995aafa2f452c52b46e  opentelemetry_proto-1.45.1-py3-none-any.whl
c604c11dc429810812348989115fa44bd558772a3d7442afc43d024f2c250ca4  opentelemetry_sdk-1.45.1-py3-none-any.whl
d4cddeb4315490b35213f55e2bdc9ac54bb1e4d318927475bed62b35545e581b  opentelemetry_semantic_conventions-0.66b1-py3-none-any.whl
25aeb22bd261543b4898a73824026d96770e5351209c7d07a0b1314762b1f6e4  opentelemetry_semantic_conventions_ai-0.5.1-py3-none-any.whl
3bb2060c240c4507f334965a8948dbeeb22007560d797f6debd92346c0b620cb  outlines_core-0.2.14-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c  packaging-26.3-py3-none-any.whl
145119e5eabcf80cbb13844a6b50a85c68bf99d376f8ed771e2a3c3b03e653ae  partial_json_parser-0.2.1.1.post7-py3-none-any.whl
42d63be3af4f9b951b199b0a9d23365d37ab14687e6d77b74940432c8515c4ca  pillow-13.0.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
fa93d06737aa02bacd05794768508bb97d2fbee28cb3bca04eaae92f0ca953d6  prometheus_client-0.26.0-py3-none-any.whl
b9f40b2cff3f7891ca0610b3ae4fc6ec723fd326b04bb659819aaeb821a0fc7d  prometheus_fastapi_instrumentator-8.1.0-py3-none-any.whl
2814ecd8e818f487bee4b0f921bc4d1c176cc5fc71ac0f072d0fa67eda4ac14b  propcache-0.5.4-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
e9db7e292e0ab79dd108d7f1a94fe31601ce1ee3f7b79e0692043423020b0593  protobuf-6.33.6-cp39-abi3-manylinux2014_x86_64.whl
076a2d2f923fd4821644f5ba89f059523da90dc9014e85f8e45a5774ca5bc6f9  psutil-7.2.2-cp36-abi3-manylinux2010_x86_64.manylinux_2_12_x86_64.manylinux_2_28_x86_64.whl
859625bc251f64e21f077d099d4162689c762b5d6a4c3c97553d56241c9674d5  py_cpuinfo-9.0.0-py3-none-any.whl
c212d02fd072c5845d39b4699eb65efa827b79a5cf7fecc9f468f8cad2b8540f  pybase64-1.5.1-cp312-cp312-manylinux1_x86_64.manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_5_x86_64.whl
115c4baf7cceaa30f59a4694d79483c9167dbce7a9de4d3d571c5f3ea77c305a  pycountry-26.2.16-py3-none-any.whl
a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e  pycparser-3.12-py3-none-any.whl
9195d967ec791692a04438115466764fb8b9a27b31f14a760437694f40d6b454  pydantic-2.14.1-py3-none-any.whl
93ba4e9d8210d941c200431a56b2c0400b131865947903937ed3ec5404307d2e  pydantic_core-2.50.1-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
1722ea2bddae5628ace25f2aa685b69978ef533123e5638cfbddb999e0100ec1  pydantic_extra_types-2.11.1-py3-none-any.whl
30f5313340da4e8f1b440d1910b92a5bc3ccbb6b4ba70ec2b8395bc921f418f5  pydantic_settings-2.16.1-py3-none-any.whl
2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9  pygments-2.21.0-py3-none-any.whl
42d59d631f7768a1028a64c7ff581a9bf7519804daf91fc5b6c56e30eec5e193  pyjwt-2.15.1-py3-none-any.whl
b59cec7a1a3f78fad13fead78cad8b6d9686827f9ff4477080245457675a01d0  pynvvideocodec-2.0.4-cp312-cp312-manylinux_2_28_x86_64.whl
42269a8a5b3fd54ffa6f3d84b18abed50064717576b4ecf03dc4a55d8aa04fdc  python_dotenv-1.2.4-py3-none-any.whl
158a52126fcd6869e09574d2b66272666f3dc8f468c62637ef9a1fa883719cb9  python_json_logger-4.2.0-py3-none-any.whl
ff6d3f776f16878c894e52e107296ffc890e913c611b1a4ec6c44e2821fe2e23  python_multipart-0.0.32-py3-none-any.whl
ba1cc08a7ccde2d2ec775841541641e4548226580ab850948cbfda66a1befcdc  pyyaml-6.0.3-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
dea74fd65f1fc5f7fe167916a473ebe6ed6174e5e5d9de11ea6583661be6cf43  pyzmq-27.2.0-cp312-abi3-manylinux_2_26_x86_64.manylinux_2_28_x86_64.whl
e77c5d1f1299b0b38487fe8737df6c6975daa16bca7f7eb883bd1a74d09e7e78  quack_kernels-0.6.4-py3-none-any.whl
381329a9f99628c9069361716891d34ad94af76e461dcb0335825aecc7692231  referencing-0.37.0-py3-none-any.whl
39ab5894d971f9ac68baa6eca5c50387db579cfcacf36ae8df3feceb1815e6d0  regex-2026.9.29-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0  requests-2.34.2-py3-none-any.whl
33bd4ef74232fb73fe9279a257718407f169c09b78a87ad3d296f548e27de0bb  rich-15.0.0-py3-none-any.whl
465453ba6f94f99401f59f79fb562827ba5f6b4d4759015d40019f5c67750262  rich_toolkit-0.20.6-py3-none-any.whl
2e68cfc4ee0a2909952af2aebd608d1cd22f7d1cdce332cb0b5ea3762939865d  rignore-0.8.1-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
addeda51556dac7c1a2f14cda62db8b621cd12afba3091d03a96c72932387eab  rpds_py-2026.9.1-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
fd6f3f93c9a0a7cc2788ee63fb763353d4bd2e89b0751bc78fcf7dda00bea774  safetensors-0.8.0-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
c8a168b040bc61681293f79a949b5d911c8e25086f4260285b8d97ab5f1195da  sentencepiece-0.2.2-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
0bcfa6928ea5adbb89591858b514d27adac27c7a3cccc31b20ed10e0b09eda9e  sentry_sdk-2.73.0-py3-none-any.whl
4a765e0c80a2453480be27c4fc22ba1c0771867040c5f91e4221940d78a4abfb  setproctitle-1.3.8-cp312-cp312-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl
95b30ddfb717250edb492926c92b5221f7ef3fbcc2b07579bcd4a27da21d0173  setuptools-80.10.2-py3-none-any.whl
7ecfff8f2fd72616f7481040475a65b2bf8af90a56c89140852d1120324e8686  shellingham-1.5.4-py2.py3-none-any.whl
4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274  six-1.17.0-py2.py3-none-any.whl
2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2  sniffio-1.3.1-py3-none-any.whl
e4dfa4d237d2712cb2b4d4918eda9b457cd6b44bbecdc838af75de836565bafd  sse_starlette-3.6.0-py3-none-any.whl
478c0ab3b4ced6e82719849c118fa406f0278a3499c1a898cd15cd31bdc38ce4  starlette-1.10.0-py3-none-any.whl
0bcb763fddafba410f35cbde226aa7f8514b9fb82eb05a0c85f6588d1c13f8db  supervisor-4.3.0-py2.py3-none-any.whl
e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5  sympy-1.14.0-py3-none-any.whl
f0b0622e567335c8fabaaa659f1b33bcb6ddfe2e496071b743aa113f8774f2d3  tabulate-0.10.0-py3-none-any.whl
7896eea257fe497a2b7134474d909156c6744ce8da35bce88011a960e008aa0d  tiktoken-0.14.0-cp312-cp312-manylinux_2_28_x86_64.whl
bbeb5573cbe2544a51a5c9a6cc737c5e3b5c2d95411caa3687fd9b08eb9d5f97  tilelang-0.1.12-cp38-abi3-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
376851d22bcf9d650a5c3090bb83e6cf9e895fbf0595369fa4cd43c1f69b5f87  tokenizers-0.23.3-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
6a7526d7327746893f8c20d24aa63ba5b8a123d0dfd6e66388e13b768b6452c6  tokenspeed_mla-0.1.8-py3-none-manylinux_2_28_x86_64.whl
5cb864b8a55f3b0b6d95dca81af85abd702496265971d8c44366eb68c8851154  tokenspeed_triton-3.9.10.post20261008-cp312-abi3-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
796633c4cdf0fe2cdced72d8f88f22e73dbcfce83132763162f6d4bff13b820b  torch-2.13.0-cp312-cp312-manylinux_2_28_x86_64.whl
e6f9da4bb9af70e27facc777458be62e10dbbbddda7672d16138db0553c5a524  torch_c_dlpack_ext-0.1.5-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl
6503c0bdb29daf2e6281bb70ea2dfe2c3553b782b619eb5d73bdadd8a3f7cecf  torchaudio-2.11.0-cp312-cp312-manylinux_2_28_x86_64.whl
defd5f0901999c9e981f6465a0f4aac8b5a5147e38e539b77c0711c015cf5349  torchcodec-0.17.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
028a3d481b37d785605620d7cdad897064c5a55bae2aa1f2658766333e291940  torchvision-0.28.0-cp312-cp312-manylinux_2_28_x86_64.whl
c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73  tqdm-4.70.1-py3-none-any.whl
7ae75dbc1fb3922aff1b6c97b9e5479d6cf26fd86a8866bfb71324190479f807  transformers-5.20.2-py3-none-any.whl
7e40869937a68206ec70d7f25bb7ec6433cb083f9135e1f36dbd318dc449a728  triton-3.7.1-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
9aaaedaefaf06d8b206278cf8b5012bc897f485a874503501e12d776df78951c  truststore-0.10.5-py3-none-any.whl
e50022f28b82a86313e54501317a1db64bf8f8d036ff8cfe5ca7e47675454aff  typer-0.27.3-py3-none-any.whl
481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8  typing_extensions-4.16.0-py3-none-any.whl
65b8397ba37ccbce054456aaccddfc91e6e3083c92824df348d96ca832f3f147  typing_inspection-0.4.4-py3-none-any.whl
0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3  urllib3-2.8.0-py3-none-any.whl
505bdb0f318731d45f1f712071fc781a8981f6847a31c902c9f5e652d4f67faf  uvicorn-0.54.0-py3-none-any.whl
090865d8ce7a03986755a3ce711b7dd0d4b44eb14ab74368b717f3fad1180208  uvloop-0.23.0-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
09d48617fc2be9c6cdcd5db480651ab0d84817b257204f2cc2e3ecbb70bbb635  vllm-0.29.0-cp38-abi3-manylinux_2_28_x86_64.whl
b5768b49e426fd5b550b012c866db347cdf15c398ef98dc557b6e6b72fa74cd1  watchfiles-1.3.0-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
a7f391838e8adcf1f2fe71561d9e5a9f74ea7ffa5052eb2db329aac677383136  websockets-17.3-cp312-cp312-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl
4045b096735bb2523e0d874039a55994c1b390620d547c4a0d4f43b9a106177b  xgrammar-0.2.8-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
c6f117789d22dce188e5754e8bc65b7e6ebf8cb73963b9fa761f672a5883769d  yarl-1.25.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl
7e103a6f203f505b8b8b8e5c931cc407c95b61556512d4921c1ddc0b3f41b08e  z3_solver-4.15.4.0-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
```

</details>

<details>
<summary>Selected CUDA 13.0 toolchain wheels (7)</summary>

```text
e0da7ad981f3a8aff08241b5bfc1af868742a63e2762f53a5171c492ef242649  nvidia_cuda_cccl-13.0.85-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
2c8043c7c9e02492716426e9919fc78d2c5b3b2a7a768a88e952676b08aa55a4  nvidia_cuda_crt-13.0.88-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
56fe502eb77625a12f25172caa3cdddb4e4c8ba2c8c17dba44b164761b380f03  nvidia_cuda_nvcc-13.0.88-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
7f82250d7782aa23b6cfe765ecc7db554bd3c2870c43f3d1821f1d18aebf0548  nvidia_cuda_runtime-13.0.96-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
1aee33a5da6e1db083fe2b90082def8915f30f3248d5896bcec36a579d941bfc  nvidia_curand-10.4.0.35-py3-none-manylinux_2_27_x86_64.whl
13a74f429e23b921c1109976abefacc69835f2f433ebd323d3946e11d804e47b  nvidia_nvjitlink-13.0.88-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl
c5f41ffeb6466944a026dfa5317d7d85355c119bbec279205d22f1869d1054e0  nvidia_nvvm-13.0.88-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl
```

</details>
