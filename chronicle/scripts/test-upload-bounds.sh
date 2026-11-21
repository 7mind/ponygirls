#!/usr/bin/env bash
# Acceptance runs of the ingest limits (docs/drafts/20261121-0055-ingest-limits-spec.md §9; U8's runs A, B, D, E of the
# append-only ingest extended), on demand, not part of verify. The native server built from this tree in `serve` (normal
# indexing workers) at the default bounds: -XX:MaxHeapSize=6871947673 (the 8 GiB container's native default), the default
# indexing budget, the deployment limits (maxFileBytes 8 GiB, maxMessages 2,000,000, maxRecordBytes 32 MiB, maxBodyBytes
# 256 MiB, maxRawReadBytes default), -XX:+PrintGC, GET /api/versions probed every 100 ms from before the start to the stop
# (asserted: every answer 200 within 1 s of monotonic time, never more than 200 ms without a probe, the probe alive at the
# stop); PostgreSQL with production's current settings applied and checked (service role: statement_timeout 30 s,
# lock_timeout 35 s, idle_in_transaction_session_timeout 60 s, work_mem 4 MB; max_wal_size 1 GB); the collector built from
# this tree with --max-old-space-size=256 and --trace-gc straight to the server (asserted: --once exits 0 and leaves no
# report-failed diagnostic); the CLI built from this tree, every call's peak RSS recorded; a loopback stub model server
# (768 dimensions); synthetic Pi sessions generated in a private temporary directory; the owned database only. Every
# assertion prints `ok - …`; the last line is a JSON summary with wall time, WAL, disk and the peak heaps and RSS. The
# wall-time and disk budgets below are assertions (disk: the cluster and the run's directory with the fixtures, sampled
# every 10 s and once at the end). Exit 1 on any failed assertion; exit 3 (`incomplete`) when a leg of the stage could
# not run with these binaries (`not run - …` lines: e.g. a CLI without `raw --output`, a collector without the incremental
# append); legs of a later stage are listed as outside the stage.
#   A  A′ 1,000,000,000 raw bytes uploaded as a replacement (WAL per raw byte reported), +5 % as an append (incremental,
#      parsing the delta, collector CPU ≤ 10 s), the maxFileBytes boundary (413 above it), a 16 MiB session indexing, the
#      head's indexing verdict, reads (pages, locate, context, Find, Archive search ≤ 1.0 s, GetRaw too-large), the raw
#      downloads (a streaming cookie client, `chronicle raw --output FILE` and `--output -` with peak RSS ≤ 128 MB, the
#      dashboard's link in Chromium with the page's JS heap ≤ 64 MB; each byte-exact); then the S2 -> S1 rollback
#      (down-025-uploads.sql, the S1 server CHRONICLE_S1_SERVER with workers): the same verdicts. ≤ 4 h, ≤ 50 GB.
#   B  B′ 4,400,000,000 raw bytes with records of 9-20 MiB (large parts), appended to; raw_bytes > 2^32 exact; pages
#      holding the large records through the CLI and the browser protocol; Archive search ≤ 1.0 s and within 0.2 s of an
#      A run's (UPLOAD_BOUNDS_COMPARE_A=its output); the downloads as in A (≥ 4 GiB); the head's indexing verdict while
#      four other sessions index. ≤ 14 h, ≤ 110 GB: run it with TMPDIR on /mnt/dev-data and a long wrapper timeout.
#   D  a 2 MB session grows by six appends while its jobs run (stub annotation delay 1 s per window) and ends indexed at
#      its head; jobs and windows spent. ≤ 30 min.
#   E  gate O (scripts/test-main-collector.sh) against this tree's server, heaps bounded and the server probed. ≤ 15 min.
#   G  the 1 GiB session grows by 20 appends of +0.5 % (each incremental; collector CPU per append), then a same-length
#      in-place edit of a line in the middle plus an append: a replacement (source-prefix-changed) whose archive equals the
#      file. The growth ≤ 30 min, the run ≤ 1 h, ≤ 25 GB.
# One run per invocation. The owned-database wrapper stops its command after an hour unless given
# --child-timeout-seconds=N (at most 86400); A and B need more. From the repository root (S1 tip 7bc75834 =
# agent/ingest-b-s1: the rollback binary of A):
#
#   nix develop .#chronicle --command bash -c '
#     export TMPDIR=$(mktemp -d /tmp/upload-bounds.XXXXXX)    # short: PostgreSQL socket paths; B: a directory on /mnt/dev-data
#     CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#     CHRONICLE_S1_SERVER="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=7bc75834ffc86edd2480372e4e693cafeb91fa41#chronicle.nativeArtifact")/libexec/chronicle-server" \
#     CHRONICLE_COLLECTOR="$(nix build --no-link --print-out-paths .#chronicle-collector)" \
#     CHRONICLE_CLI="$(nix build --no-link --print-out-paths .#chronicle-cli)/bin/chronicle" \
#     CHRONICLE_WEB_ROOT="$(nix build --no-link --print-out-paths .#chronicle.web)/share/chronicle/web" \
#     CHRONICLE_CHROMIUM="$(nix build --no-link --print-out-paths --inputs-from . nixpkgs#chromium)/bin/chromium" \
#     MAIN_COLLECTOR="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=0aedcfa8bcdbfd93610ba63b3836384240538b83#chronicle-collector")/bin/chronicle-collector" \
#     "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" --child-timeout-seconds=21600 \
#       nice -n 10 bash chronicle/scripts/test-upload-bounds.sh A|B|D|E|G'
#
# CHRONICLE_S1_SERVER is needed by A only, MAIN_COLLECTOR by E only, CHRONICLE_COLLECTOR by A, B, D and G; without
# CHRONICLE_WEB_ROOT and CHRONICLE_CHROMIUM the dashboard download of A and B is `not run`. UPLOAD_BOUNDS_STAGE=prefix
# (default; L4, L1, L3, L6, L2) or l5 (streamed indexing as well) selects the stage the run accepts.
# UPLOAD_BOUNDS_EVIDENCE=DIR keeps the server logs, probe samples, collector output and Chromium's log;
# UPLOAD_BOUNDS_PROXY=1 puts U8's logging proxy between collector and server (diagnostic: status and time of every
# request). To try the harness (not an acceptance run): UPLOAD_BOUNDS_SCALE=0.01 shrinks the fixtures, the raw read
# bound and the indexing budget; UPLOAD_BOUNDS_D_DELAY=0.3 shortens D's annotation delay.
set -euo pipefail
usage='Usage: chronicle/scripts/test-upload-bounds.sh A|B|D|E|G'
[[ $# == 1 && $1 =~ ^[ABDEG]$ ]] || { echo "$usage" >&2; exit 2; }
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the native server executable built from this tree}"
: "${CHRONICLE_CLI:?set CHRONICLE_CLI to the chronicle CLI built from this tree}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
case $1 in
  A) : "${CHRONICLE_S1_SERVER:?set CHRONICLE_S1_SERVER to the native server of the S1 tip 7bc75834 (the rollback binary)}" ;;
  E) : "${MAIN_COLLECTOR:?set MAIN_COLLECTOR to the chronicle-collector executable built from main 0aedcfa8}" ;;
esac
[[ $1 == E ]] || : "${CHRONICLE_COLLECTOR:?set CHRONICLE_COLLECTOR to the chronicle-collector package built from this tree}"
cd "$(dirname "$0")/../.."
exec python3 chronicle/scripts/upload-bounds.py "$1"
