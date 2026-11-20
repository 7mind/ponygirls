#!/usr/bin/env bash
# S2 acceptance runs A, B, D and E of docs/drafts/20261120-1201-append-only-ingest-spec.md §11.1 (on demand, not part of
# verify): the native server built from this tree in `serve` (normal indexing workers) with a bounded heap, -XX:+PrintGC
# and GET /api/versions probed every 100 ms from readiness to stop (asserted: every answer 200 within 1 s of monotonic
# time, never more than 200 ms without a probe, the probe alive at the stop); the collector built from this tree with
# --max-old-space-size=256 and --trace-gc, through a logging proxy (status and time of every request, the answers of all
# but parts); a loopback stub model server; synthetic Pi sessions generated in a private
# temporary directory; the owned database only. Every assertion prints `ok - …`; the last line is a JSON summary with
# wall time, WAL, disk and the peak live heap of both sides. The wall-time and disk budgets below are assertions (disk:
# the cluster and the run's directory with the fixtures, sampled every 10 s). The script fails on any failed assertion.
#   A  1,000,000,000 raw bytes uploaded as a replacement, +5 % as an append, the 1 GiB declaration boundary (413 above
#      it), the job ending index-budget-exceeded, reads (pages, locate, context, Find, Archive search, GetRaw too-large),
#      a 16 MiB session indexing on the same server; then the S2 -> S1 rollback (down-025-uploads.sql, the S1 server
#      CHRONICLE_S1_SERVER with workers): the same verdicts. Server heap 768 MiB, indexing budget scaled to it. ≤ 30 min, ≤ 25 GB.
#   B  4,400,000,000 raw bytes with records of 9-20 MiB (large parts), appended to; raw_bytes > 2^32 exact; reads (pages
#      holding a record above the CLI's 8 MiB frame bound over the browser protocol); the job ends index-budget-exceeded
#      while four other sessions index. Server heap 1 GiB. ≤ 90 min, ≤ 60 GB; about 55 minutes on this host (2026-11).
#   D  a 2 MB session grows by six appends while its jobs run (stub annotation delay 1 s per window) and ends indexed at
#      its head; jobs and windows spent. ≤ 30 min.
#   E  gate O (scripts/test-main-collector.sh) against this tree's server, heaps bounded and the server probed.
# One run per invocation; the owned-database wrapper stops a run after an hour, which B can reach on a loaded host. From
# the repository root (S1 tip 4f4c941e: the rollback binary of A):
#
#   nix develop .#chronicle --command bash -c '
#     export TMPDIR=$(mktemp -d /tmp/upload-bounds.XXXXXX)    # short: PostgreSQL socket paths; ≥ 60 GB free for B
#     CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#     CHRONICLE_S1_SERVER="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=4f4c941e166a9b27120e3853b635cfac39d0a35c#chronicle.nativeArtifact")/libexec/chronicle-server" \
#     CHRONICLE_COLLECTOR="$(nix build --no-link --print-out-paths .#chronicle-collector)" \
#     CHRONICLE_CLI="$(nix build --no-link --print-out-paths .#chronicle-cli)/bin/chronicle" \
#     MAIN_COLLECTOR="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=0aedcfa8bcdbfd93610ba63b3836384240538b83#chronicle-collector")/bin/chronicle-collector" \
#     "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#       nice -n 10 bash chronicle/scripts/test-upload-bounds.sh A|B|D|E'
#
# CHRONICLE_S1_SERVER is needed by A only, MAIN_COLLECTOR by E only, CHRONICLE_COLLECTOR by A, B and D.
# UPLOAD_BOUNDS_EVIDENCE=DIR keeps the server logs, probe samples and collector stderr. To try the harness (not an
# acceptance run): UPLOAD_BOUNDS_SCALE=0.01 shrinks the fixtures, UPLOAD_BOUNDS_D_DELAY=0.3 shortens D's annotation delay.
set -euo pipefail
usage='Usage: chronicle/scripts/test-upload-bounds.sh A|B|D|E'
[[ $# == 1 && $1 =~ ^[ABDE]$ ]] || { echo "$usage" >&2; exit 2; }
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the native server executable built from this tree}"
: "${CHRONICLE_CLI:?set CHRONICLE_CLI to the chronicle CLI built from this tree}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
case $1 in
  A) : "${CHRONICLE_S1_SERVER:?set CHRONICLE_S1_SERVER to the native server of the S1 tip (the rollback binary)}" ;;
  E) : "${MAIN_COLLECTOR:?set MAIN_COLLECTOR to the chronicle-collector executable built from main 0aedcfa8}" ;;
esac
[[ $1 == E ]] || : "${CHRONICLE_COLLECTOR:?set CHRONICLE_COLLECTOR to the chronicle-collector package built from this tree}"
cd "$(dirname "$0")/../.."
exec python3 chronicle/scripts/upload-bounds.py "$1"
