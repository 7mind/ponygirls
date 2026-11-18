#!/bin/sh
# Decides with the real Haystack codec whether any stored document still needs the wide stored-read tolerance.
# Unlike run.sh this needs a JVM: run it from the repository root inside `nix develop .#chronicle` (sbt launcher).
# The database is reached only through psql, exactly as run.sh reaches it (PG* variables or PSQL), so the pod still
# needs nothing but psql; the documents are exported as hex into a private temporary file and judged locally.
#
#   sh scripts/one-off/legacy-retirement/check-stored-documents.sh
#
# Exit status 0 only when every stored text of items and item_revisions decodes on the strict path.
# The temporary file holds document content: it is created mode 0600 in a 0700 directory and removed on exit.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../../.." && pwd)
: "${SBT_LAUNCH_JAR:?run inside nix develop .#chronicle (sbt launcher required)}"
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/lr-documents.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM
sh "$here/run.sh" haystack export-stored-documents "$@" >"$work/export"
status=0
(cd "$root" && bash scripts/backend-sbt.sh "haystackServer/Test/runMain haystack.storage.LegacyStoredDocumentCheck $work/export") >"$work/check.log" 2>&1 || status=$?
grep '^LR\.' "$work/check.log" || { tail -n 40 "$work/check.log" >&2; exit 3; }
grep -q '^LR.result|stored-documents-strict-ok$' "$work/check.log" && [ "$status" -eq 0 ] || exit 3
