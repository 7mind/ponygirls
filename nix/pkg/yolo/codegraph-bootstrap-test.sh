#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: codegraph-bootstrap-test.sh <codegraph> <jq> <git>" >&2
  exit 2
fi

cg="$1"
jq="$2"
git="$3"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
bootstrap="$script_dir/codegraph-bootstrap.sh"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
parent="$workdir/parent"
child="$parent/child"
mkdir -p "$child"
parent="$(cd "$parent" && pwd -P)"
child="$(cd "$child" && pwd -P)"

"$git" -C "$parent" init -q
printf 'export const parent = 1;\n' > "$parent/parent.ts"
"$cg" init "$parent" >/dev/null 2>&1

"$git" -C "$child" init -q
printf 'export const child = 2;\n' > "$child/child.ts"
test ! -e "$child/.codegraph"

cold_output="$(cd "$child" && bash "$bootstrap" "$cg" "$jq" "$git" 2>&1)"
[[ "$cold_output" == *"building CodeGraph index for $child"* ]]
test -f "$child/.codegraph/codegraph.db"

status_json="$(cd "$child" && "$cg" status --json)"
[[ "$(printf '%s' "$status_json" | "$jq" -r .projectPath)" == "$child" ]]
[[ "$(printf '%s' "$status_json" | "$jq" -r .fileCount)" -eq 1 ]]

warm_output="$(cd "$child" && bash "$bootstrap" "$cg" "$jq" "$git" 2>&1)"
[[ "$warm_output" == *"syncing CodeGraph index for $child"* ]]

# A non-Git directory is not an index scope unless it opted in as a workspace
# (ponygirls-codegraph's `/cg init --workspace` marker): indexing a parent of
# many checkouts makes the MCP watcher walk every one of them.
plain="$workdir/plain"
mkdir -p "$plain/repo-a"
plain="$(cd "$plain" && pwd -P)"
printf 'export const a = 1;\n' > "$plain/repo-a/a.ts"
plain_output="$(cd "$plain" && bash "$bootstrap" "$cg" "$jq" "$git" 2>&1)"
[[ "$plain_output" == *"not a Git checkout or opted-in workspace"* ]]
test ! -e "$plain/.codegraph"
test ! -e "$plain/.gitignore"

opted="$workdir/opted"
mkdir -p "$opted/.pi"
opted="$(cd "$opted" && pwd -P)"
printf 'export const opted = 1;\n' > "$opted/opted.ts"
printf '{"version":1}\n' > "$opted/.pi/codegraph-workspace.json"
opted_output="$(cd "$opted" && bash "$bootstrap" "$cg" "$jq" "$git" 2>&1)"
[[ "$opted_output" == *"building CodeGraph index for $opted"* ]]
test -f "$opted/.codegraph/codegraph.db"

echo "CodeGraph bootstrap ancestor-index and workspace opt-in regressions passed"
