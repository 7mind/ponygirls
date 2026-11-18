#!/usr/bin/env bash
# Fixture test of drop-databases.sh on an owned, throwaway PostgreSQL cluster (no other database is touched).
# Usage, from the repository root:  nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test-drop-databases.sh [SCRIPT]
# SCRIPT defaults to the current drop-databases.sh. Passing an older version (e.g. extracted with `git show`) runs
# the same cases through that version's interface (`drop NAME --confirm-database NAME --expect-oid OID`, which drops
# without a separate flag) to show which refusals it lacked. Every case asserts the database state afterwards.
set -uo pipefail
cd "$(dirname "$0")/../../.."
. scripts/one-off/legacy-retirement/test-guard.sh
: "${POSTGRES_HOME:?run inside nix develop .#chronicle (PostgreSQL 18)}"
script=${1:-scripts/one-off/legacy-retirement/drop-databases.sh}
legacy_cli=f; grep -q -- '--drop NAME' "$script" || legacy_cli=t
bindings=(); grep -q -- '--configured-databases' "$script" && bindings=(--configured-databases chronicle,haystack,manure)
base=$(mktemp -d /tmp/lr-dd-test.XXXXXX)
stop() { "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"; }
trap stop EXIT
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A trust --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-c listen_addresses='' -k $base" -w start >/dev/null
export PGHOST=$base PGUSER=postgres PGDATABASE=postgres PATH=$POSTGRES_HOME/bin:$PATH
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
oid() { q -c "SELECT oid FROM pg_database WHERE datname = '$1'"; }
exists() { [[ $(q -c "SELECT count(*) FROM pg_database WHERE datname = '$1'") == 1 ]]; }
for d in chronicle haystack manure other_db chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106 haystack_nex249_before_20261105a manure_nex249_before_20261105a; do
  q -c "CREATE DATABASE $d" >/dev/null
done
q -d chronicle_nex249_import_20261105a -c 'CREATE TABLE t(x int)' >/dev/null
pass=0; failed=0
check() { # name, expectation (kept|dropped), database
  if { [[ $2 == kept ]] && exists "$3"; } || { [[ $2 == dropped ]] && ! exists "$3"; }; then pass=$((pass + 1)); echo "PASS $1"
  else failed=$((failed + 1)); echo "FAIL $1 (expected $3 $2)"; fi
  grep -h -o -E 'refused: [^;]*|DB\.(would_drop|refuse)\|[^|]*\|.*' "$base/out" 2>/dev/null | sed 's/^/     /' | head -6
}
# drop attempt through the interface of the script under test; extra=1 adds the explicit flag (new interface only)
attempt() { local name=$1 confirm=$2 expect_oid=$3
  if [[ $legacy_cli == t ]]; then sh "$script" drop "$name" --confirm-database "$confirm" --expect-oid "$expect_oid"
  else PSQL=${attempt_psql:-psql} sh "$script" drop --drop "$name" --confirm-database "$confirm" --expect-oid "$expect_oid" --sample-seconds 2 "${bindings[@]}"; fi
} >"$base/out" 2>&1

# 1. a live service database typed with its correct OID (the rehearsal incident)
attempt haystack haystack "$(oid haystack)"; check live-service-database-refused kept haystack
# 2. a database that is neither a service database nor one of the four copies
attempt other_db other_db "$(oid other_db)"; check free-form-name-refused kept other_db
# 3. default mode prints a plan and drops nothing (old interface: a bare `drop` invocation)
if [[ $legacy_cli == t ]]; then sh "$script" drop haystack_nex249_before_20261105a --confirm-database haystack_nex249_before_20261105a --expect-oid "$(oid haystack_nex249_before_20261105a)" >"$base/out" 2>&1
else sh "$script" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1; grep -q '^DB.would_drop|haystack_nex249_before_20261105a|' "$base/out" || { failed=$((failed + 1)); echo "FAIL plan-lists-would-drop"; cat "$base/out"; }; fi
check default-mode-drops-nothing kept haystack_nex249_before_20261105a
# 4. connected
psql -X -q -d manure_nex249_before_20261105a -c 'SELECT pg_sleep(30)' >/dev/null 2>&1 & held=$!; sleep 1
attempt manure_nex249_before_20261105a manure_nex249_before_20261105a "$(oid manure_nex249_before_20261105a)"; check connected-copy-refused kept manure_nex249_before_20261105a
kill "$held" 2>/dev/null; wait "$held" 2>/dev/null
# a killed client leaves its backend running pg_sleep: end it so the copy is free for the later cases
q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'manure_nex249_before_20261105a'" >/dev/null; sleep 1
# 5. written to during the sample window (writer connects and disconnects, so the connection check alone misses it)
( for i in $(seq 12); do psql -X -q -d chronicle_nex249_import_20261105a -c "INSERT INTO t VALUES ($i)" >/dev/null 2>&1; sleep 0.5; done ) & writer=$!
sleep 0.3; attempt chronicle_nex249_import_20261105a chronicle_nex249_import_20261105a "$(oid chronicle_nex249_import_20261105a)"; check recently-written-copy-refused kept chronicle_nex249_import_20261105a
wait "$writer"
# 6. name not typed back exactly; 7. wrong OID
attempt chronicle_nex249_bootstrap_20261106 chronicle_nex249_bootstrap_2026110 "$(oid chronicle_nex249_bootstrap_20261106)"; check confirm-mismatch-refused kept chronicle_nex249_bootstrap_20261106
attempt chronicle_nex249_bootstrap_20261106 chronicle_nex249_bootstrap_20261106 1; check wrong-oid-refused kept chronicle_nex249_bootstrap_20261106
# 9. F1: the object dropped is the object checked. A psql wrapper runs a "swap" between the check and the DROP of
#    the script under test (new script: between the rename transaction and the drop; old script: before its DROP):
#    the checked database is renamed aside and the live `haystack` takes the name the DROP will use.
hay_oid=$(oid haystack)
cat >"$base/swap-psql" <<'SWAP'
#!/usr/bin/env bash
# inserts "\! sh $LR_TEST_BASE/swap.sh" before the line after which the script under test issues its DROP
awk -v base="$LR_TEST_BASE" '/^[\\]echo DB[.]phase[|]between-rename-and-drop/ || /^[\\]echo DB[.]dropping[|]:name/ { printf "%c! sh %s/swap.sh\n", 92, base } { print }' | psql "$@"
SWAP
export LR_TEST_BASE=$base
chmod +x "$base/swap-psql"
copy=chronicle_nex249_import_20261105a; copy_oid=$(oid $copy)
if ! grep -q lr_drop_ "$script"; then printf 'psql -X -q -c "ALTER DATABASE %s RENAME TO held_aside" -c "ALTER DATABASE haystack RENAME TO %s" 2>>%s/swap.err; echo ran >%s/swap.ran\n' "$copy" "$copy" "$base" "$base" >"$base/swap.sh"
else printf 'psql -X -q -c "ALTER DATABASE lr_drop_%s RENAME TO held_aside" -c "ALTER DATABASE haystack RENAME TO lr_drop_%s" 2>>%s/swap.err; echo ran >%s/swap.ran\n' "$copy_oid" "$copy_oid" "$base" "$base" >"$base/swap.sh"; fi
sleep 3   # let the writer of case 5 age out of the sample window
if [[ $legacy_cli == t ]]; then PSQL=$base/swap-psql sh "$script" drop "$copy" --confirm-database "$copy" --expect-oid "$copy_oid" >"$base/out" 2>&1
else PSQL=$base/swap-psql sh "$script" drop --drop "$copy" --confirm-database "$copy" --expect-oid "$copy_oid" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1; fi
if [[ ! -f $base/swap.ran ]]; then failed=$((failed + 1)); echo "FAIL swapped-name-does-not-drop-live-database (the swap did not run: no evidence)"
elif [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $hay_oid") == 1 ]]; then pass=$((pass + 1)); echo "PASS swapped-name-does-not-drop-live-database"
else failed=$((failed + 1)); echo "FAIL swapped-name-does-not-drop-live-database (the live database's OID is gone)"; fi
grep -h -o -E "refused: [^;]*|DB.dropping.*|DB.result.*" "$base/out" | head -3 | sed "s/^/     /"; [[ -s $base/swap.err ]] && sed 's/^/     swap: /' "$base/swap.err"
# restore the names for the remaining cases
for d in $(q -c "SELECT datname FROM pg_database WHERE oid = $hay_oid"); do [[ $d == haystack ]] || q -c "ALTER DATABASE $d RENAME TO haystack" >/dev/null; done
held=$(q -c "SELECT datname FROM pg_database WHERE datname = 'held_aside'"); [[ -z $held ]] || q -c "ALTER DATABASE held_aside RENAME TO $copy" -c "ALTER DATABASE $copy ALLOW_CONNECTIONS true CONNECTION LIMIT -1" >/dev/null
if [[ $legacy_cli == f ]] && grep -q -- '--configured-databases' "$script"; then
  # 10. a copy that a service is configured to use is refused
  sh "$script" drop --drop chronicle_nex249_bootstrap_20261106 --confirm-database chronicle_nex249_bootstrap_20261106 --expect-oid "$(oid chronicle_nex249_bootstrap_20261106)" --sample-seconds 2 --configured-databases chronicle,chronicle_nex249_bootstrap_20261106 >"$base/out" 2>&1
  check configured-binding-refused kept chronicle_nex249_bootstrap_20261106
  # 11. without the configured bindings the script refuses (it cannot learn them itself)
  sh "$script" drop --drop chronicle_nex249_bootstrap_20261106 --confirm-database chronicle_nex249_bootstrap_20261106 --expect-oid "$(oid chronicle_nex249_bootstrap_20261106)" --sample-seconds 2 >"$base/out" 2>&1
  check bindings-required kept chronicle_nex249_bootstrap_20261106
  # 12. an interrupted drop (session ended after the rename) resumes from the tombstone
  o=$(oid manure_nex249_before_20261105a)
  q -c "ALTER DATABASE manure_nex249_before_20261105a RENAME TO lr_drop_$o" -c "ALTER DATABASE lr_drop_$o ALLOW_CONNECTIONS false CONNECTION LIMIT 0" >/dev/null
  sh "$script" drop --drop manure_nex249_before_20261105a --confirm-database manure_nex249_before_20261105a --expect-oid "$o" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  if [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $o") == 0 ]] && grep -q 'DB.result|dropped' "$base/out"; then pass=$((pass + 1)); echo "PASS interrupted-drop-resumes"; else failed=$((failed + 1)); echo "FAIL interrupted-drop-resumes"; fi
fi

# 8. the intended drop succeeds
attempt chronicle_nex249_bootstrap_20261106 chronicle_nex249_bootstrap_20261106 "$(oid chronicle_nex249_bootstrap_20261106)"; check copy-dropped dropped chronicle_nex249_bootstrap_20261106
for d in chronicle haystack manure postgres; do check "live-$d-still-present" kept "$d"; done
# 13. F5: with statistics collection off the write sample is no evidence: refuse (fail closed)
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m fast -w stop >/dev/null; "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-c listen_addresses='' -k $base -c track_counts=off" -w start >/dev/null
attempt haystack_nex249_before_20261105a haystack_nex249_before_20261105a "$(oid haystack_nex249_before_20261105a)"; check track-counts-off-refused kept haystack_nex249_before_20261105a
echo "drop-databases test ($script, legacy_cli=$legacy_cli): $pass passed, $failed failed"
[[ $failed -eq 0 ]]
