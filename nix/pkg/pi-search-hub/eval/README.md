# Reproduce the fusion investigation

Findings and limitations: [REPORT.md](REPORT.md). Frozen protocol: [PLAN.md](PLAN.md).
The application remains RRF(k=60); alternative methods here are experimental.

## Pinned offline check

From the repository root:

```bash
nix build .#checks.x86_64-linux.pi-search-hub-eval --no-link -L
```

This downloads only hash-pinned public ranked document IDs/scores and judgments
(no corpus/query text, model weights, private data or credentials), then runs:

- 37 Python tests;
- original producer-metric calibration;
- development/held-out replay and exact report hashes;
- the frozen live URL-pool replay;
- installed TypeScript/Python RRF60 ordering parity for all 10 live pools.

The application check is separate and is also a dependency of installed parity:

```bash
nix build .#pi-search-hub --no-link -L
```

## Manual offline runs

Use fresh output names; differing artifacts are never silently overwritten.
Python's standard library is sufficient. Run from this directory:

```bash
python3 -m unittest discover -s . -p 'test_*.py' -v
python3 download.py --output .cache
mkdir -p results
python3 evaluate.py development --data-dir .cache --output results/development.json
python3 evaluate.py heldout --data-dir .cache \
  --selection results/development.json --output results/heldout.json
python3 replay_live.py --input fixtures/live-public-20261107.json \
  --output results/live-replay.json
```

The held-out command requires a development report with matching source hashes,
protocol and candidate grid. It uses that fixed winner; it does not retune on
held-out data. Reports preserve every query and expose incomplete judgments,
retrieval-pool recall and returned-window size separately.

## Optional new live collection

This is **not** part of offline checks. It uses configured search-service keys
and Pi's stored inference credentials through its registry. Only the frozen
public queries are sent, never repository/session content. Provider search/tool
usage may apply; runtime deadlines and response bounds remain enforced.

From the repository root, choose a fresh local reporting directory:

```bash
sdk=$(nix build .#pi-coding-agent --no-link --print-out-paths)/lib/node_modules/pi-monorepo
PI_SDK_ROOT="$sdk" node nix/pkg/pi-search-hub/eval/capture-live.mjs \
  --configRoot "$PWD" --output debug/fusion-live-FRESH --from 0 --count 10
PI_SDK_ROOT="$sdk" node nix/pkg/pi-search-hub/eval/normalize-live.mjs \
  --input debug/fusion-live-FRESH --output debug/fusion-live-FRESH-normalized.json
python3 nix/pkg/pi-search-hub/eval/replay_live.py \
  --input debug/fusion-live-FRESH-normalized.json \
  --output debug/fusion-live-FRESH-report.json
```

Capture can be divided into nonoverlapping `--from`/`--count` batches. Existing
query records are not overwritten. The source, query-file and capture-harness
hashes must match across every normalized case. Raw local records include public
snippets and request statistics; the committed fixture contains URL/rank metadata
only. Do not commit credentials, arbitrary private queries or protected content.

The sampler does not load arbitrary Pi extension packages. Plugin-only provider
registrations may therefore be absent; absence is not evidence that an account
lacks credentials. The recorded live cohort actually exercised built-in Codex
and Anthropic OAuth registrations, alongside five search engines.

## Interpretation

Target matching is not complete relevance labeling. Native source-encounter order
is not guaranteed relevance order. Prefix-depth and shuffled/clone experiments
are explicit counterfactuals on frozen pools, not fresh retrieval or observed
production configurations. Transport success, authentication, target coverage,
relevance, answer support and latency are separate claims.
