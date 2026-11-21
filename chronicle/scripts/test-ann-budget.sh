#!/usr/bin/env bash
# On demand (not part of verify): semantic legs crowded by ≥ 200,000 invisible index entries, at production scale and
# settings, through the native server built from this tree. An owned PostgreSQL cluster (the role settings of
# production: statement_timeout 30 s, work_mem 4 MB) holds a 300,000-row background archive (one server-indexed template
# session cloned in SQL; synthetic topic vectors from a loopback stub model) and the HNSW index; then
#   uncommitted  N search rows nearer the query than every visible row, inserted by open transactions (a publication in
#                flight), and
#   dead         the same rows rolled back (dead until VACUUM, as retired rows),
# and in each state semantic, hybrid and project-filtered searches through MCP and Archive search through the browser
# protocol must answer the complete window (compared with the exact nearest visible chunks) or fail `unavailable`,
# never a short one; the leg's first pass alone (production budget, by SQL) shows the shortfall it repairs. Every
# assertion prints `ok - …`; the last line is a JSON summary. About 5 minutes and 12 GB (N = 220,000; 2026-11). From the
# repository root:
#
#   nix develop .#chronicle --command bash -c '
#     export TMPDIR=$(mktemp -d /tmp/ann-budget.XXXXXX)        # short: the PostgreSQL socket lives here
#     ANN_DATA_DIR=/large/disk/ann-budget \                      # new or empty directory for the cluster
#     CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#       bash chronicle/scripts/test-ann-budget.sh'
#
# ANN_INVISIBLE_ROWS (default 220000) sets N. The cluster and the server are stopped at the end; ANN_DATA_DIR is left
# for the caller to remove.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the native server executable built from this tree}"
: "${POSTGRES_HOME:?run inside nix develop .#chronicle (PostgreSQL 18 with pgvector)}"
: "${ANN_DATA_DIR:?set ANN_DATA_DIR to a new or empty directory on a disk with ≥ 30 GB free}"
cd "$(dirname "$0")/../.."
exec python3 chronicle/scripts/ann-budget.py
