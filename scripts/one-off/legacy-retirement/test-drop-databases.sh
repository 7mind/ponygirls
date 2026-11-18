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
  else PSQL=psql sh "$script" drop --drop "$name" --confirm-database "$confirm" --expect-oid "$expect_oid" --sample-seconds 2 "${bindings[@]}"; fi
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
  # 12. a session cut right after the rename transaction (the script's own tombstone) resumes under the full guard
  o=$(oid manure_nex249_before_20261105a)
  cat >"$base/cut-psql" <<'CUT'
#!/usr/bin/env bash
# ends the session (\q) where the script under test passes from the rename to the drop
awk '/^[\\]echo DB[.]phase[|]between-rename-and-drop/ { printf "%cq\n", 92 } { print }' | psql "$@"
CUT
  chmod +x "$base/cut-psql"
  PSQL=$base/cut-psql sh "$script" drop --drop manure_nex249_before_20261105a --confirm-database manure_nex249_before_20261105a --expect-oid "$o" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  # precondition: the cut left this script's tombstone (otherwise the next command is a plain fresh drop)
  tomb=$(q -c "SELECT datname || ',' || datallowconn || ',' || coalesce(shobj_description(oid, 'pg_database'), '-') FROM pg_database WHERE oid = $o")
  sh "$script" drop --drop manure_nex249_before_20261105a --confirm-database manure_nex249_before_20261105a --expect-oid "$o" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  if [[ $tomb == "lr_drop_$o,false,legacy-retirement drop: original=manure_nex249_before_20261105a oid=$o at="* ]] && [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $o") == 0 ]] && [[ $(tail -1 "$base/out") == "DB.result|dropped|oid=$o" ]]; then pass=$((pass + 1)); echo "PASS interrupted-drop-resumes"; else failed=$((failed + 1)); echo "FAIL interrupted-drop-resumes (state after the cut: $tomb)"; fi
  # 13. "dropped but not confirmed": the same command again reports the OID as already gone (distinct result, exit 0)
  sh "$script" drop --drop manure_nex249_before_20261105a --confirm-database manure_nex249_before_20261105a --expect-oid "$o" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1; rc=$?
  if [[ $rc -eq 0 && $(tail -1 "$base/out") == "DB.result|already-gone|oid=$o" ]]; then pass=$((pass + 1)); echo "PASS already-gone-reported"; else failed=$((failed + 1)); echo "FAIL already-gone-reported (rc=$rc last=$(tail -1 "$base/out"))"; fi
  # R1 a. an unrelated database under a tombstone name (no provenance) is not resumed
  q -c "CREATE DATABASE r1_unrelated" >/dev/null; ro=$(oid r1_unrelated)
  q -c "ALTER DATABASE r1_unrelated RENAME TO lr_drop_$ro" -c "ALTER DATABASE lr_drop_$ro ALLOW_CONNECTIONS false CONNECTION LIMIT 0" >/dev/null
  sh "$script" drop --drop haystack_nex249_before_20261105a --confirm-database haystack_nex249_before_20261105a --expect-oid "$ro" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  if [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $ro") == 1 ]] && grep -q 'does not carry the provenance' "$base/out" && [[ $(tail -1 "$base/out") == 'DB.result|refused' ]]; then pass=$((pass + 1)); echo "PASS r1-unrelated-tombstone-refused"; else failed=$((failed + 1)); echo "FAIL r1-unrelated-tombstone-refused"; fi
  # T3: no executable SQL is ever printed (refusals and plan print command lines of this script only)
  sh "$script" plan --sample-seconds 2 "${bindings[@]}" >"$base/plan" 2>&1
  if grep -qiE 'ALTER DATABASE|DROP DATABASE|COMMENT ON' "$base/out" "$base/plan"; then failed=$((failed + 1)); echo "FAIL t3-no-sql-printed"; else pass=$((pass + 1)); echo "PASS t3-no-sql-printed"; fi
  grep -q "^DB.tombstone_unowned|lr_drop_$ro|" "$base/plan" && { pass=$((pass + 1)); echo "PASS t3-plan-unrelated-tombstone-unowned"; } || { failed=$((failed + 1)); echo "FAIL t3-plan-unrelated-tombstone-unowned"; }
  # T3: restore is a mode of the script under the same guard: it refuses the unrelated tombstone ...
  sh "$script" restore --oid "$ro" --confirm-database haystack_nex249_before_20261105a --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  [[ $(q -c "SELECT datname FROM pg_database WHERE oid = $ro") == lr_drop_$ro && $(tail -1 "$base/out") == 'DB.result|refused' ]] && { pass=$((pass + 1)); echo "PASS t3-restore-refuses-unrelated-tombstone"; } || { failed=$((failed + 1)); echo "FAIL t3-restore-refuses-unrelated-tombstone"; }
  # ... and a provenance whose name differs only where LIKE would see a wildcard ('_' -> 'X') is not this copy's
  q -c "COMMENT ON DATABASE lr_drop_$ro IS 'legacy-retirement drop: original=haystackXnex249_before_20261105a oid=$ro at=2026-11-18T00:00:00Z'" >/dev/null
  sh "$script" restore --oid "$ro" --confirm-database haystack_nex249_before_20261105a --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  sh "$script" plan --sample-seconds 2 "${bindings[@]}" >"$base/plan" 2>&1
  [[ $(q -c "SELECT datname FROM pg_database WHERE oid = $ro") == lr_drop_$ro ]] && grep -q "^DB.tombstone_unowned|lr_drop_$ro|" "$base/plan" && { pass=$((pass + 1)); echo "PASS t3-wildcard-lookalike-provenance-refused"; } || { failed=$((failed + 1)); echo "FAIL t3-wildcard-lookalike-provenance-refused"; }
  q -c "COMMENT ON DATABASE lr_drop_$ro IS NULL" >/dev/null
  # ... and restores this script's own tombstone (cut after the rename; plan names the owner and the command)
  co=$(oid chronicle_nex249_bootstrap_20261106)
  PSQL=$base/cut-psql sh "$script" drop --drop chronicle_nex249_bootstrap_20261106 --confirm-database chronicle_nex249_bootstrap_20261106 --expect-oid "$co" --sample-seconds 2 "${bindings[@]}" >/dev/null 2>&1
  sh "$script" plan --sample-seconds 2 "${bindings[@]}" >"$base/plan" 2>&1
  grep -q "^DB.tombstone_of|chronicle_nex249_bootstrap_20261106|$co" "$base/plan" && grep -q "^DB.tombstone_command|restore|drop-databases.sh restore --oid $co --confirm-database chronicle_nex249_bootstrap_20261106" "$base/plan" \
    && { pass=$((pass + 1)); echo "PASS t3-plan-names-owner-and-command"; } || { failed=$((failed + 1)); echo "FAIL t3-plan-names-owner-and-command"; }
  sh "$script" restore --oid "$co" --confirm-database chronicle_nex249_bootstrap_20261106 --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  if [[ $(tail -1 "$base/out") == "DB.result|restored|oid=$co" && $(q -c "SELECT datname || ',' || datallowconn || ',' || datconnlimit || ',' || coalesce(shobj_description(oid, 'pg_database'), '-') FROM pg_database WHERE oid = $co") == 'chronicle_nex249_bootstrap_20261106,true,-1,-' ]]; then pass=$((pass + 1)); echo "PASS t3-restore-mode-restores-own-tombstone"; else failed=$((failed + 1)); echo "FAIL t3-restore-mode-restores-own-tombstone"; fi
  # R1 b. another copy's interrupted drop (provenance names another copy) is not resumed under this name
  q -c "COMMENT ON DATABASE lr_drop_$ro IS 'legacy-retirement drop: original=chronicle_nex249_import_20261105a oid=$ro at=2026-11-18T00:00:00Z'" >/dev/null
  sh "$script" drop --drop haystack_nex249_before_20261105a --confirm-database haystack_nex249_before_20261105a --expect-oid "$ro" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $ro") == 1 ]] && { pass=$((pass + 1)); echo "PASS r1-other-copys-tombstone-refused"; } || { failed=$((failed + 1)); echo "FAIL r1-other-copys-tombstone-refused"; }
  # R1 c. a configured service database renamed to a tombstone name is refused (configured list includes the tombstone name)
  q -c "COMMENT ON DATABASE lr_drop_$ro IS 'legacy-retirement drop: original=haystack_nex249_before_20261105a oid=$ro at=2026-11-18T00:00:00Z'" >/dev/null
  sh "$script" drop --drop haystack_nex249_before_20261105a --confirm-database haystack_nex249_before_20261105a --expect-oid "$ro" --sample-seconds 2 --configured-databases "chronicle,haystack,manure,lr_drop_$ro" >"$base/out" 2>&1
  [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $ro") == 1 ]] && grep -q 'service or configured database' "$base/out" && { pass=$((pass + 1)); echo "PASS r1-configured-tombstone-name-refused"; } || { failed=$((failed + 1)); echo "FAIL r1-configured-tombstone-name-refused"; }
  # R1 d. an idle service database renamed into a tombstone name (no provenance) is refused; the plan lists it as not ours
  mo=$(oid manure); q -c "ALTER DATABASE manure RENAME TO lr_drop_$mo" -c "ALTER DATABASE lr_drop_$mo ALLOW_CONNECTIONS false CONNECTION LIMIT 0" >/dev/null
  :
  sh "$script" drop --drop manure_nex249_before_20261105a --confirm-database manure_nex249_before_20261105a --expect-oid "$mo" --sample-seconds 2 "${bindings[@]}" >"$base/out" 2>&1
  sh "$script" plan --sample-seconds 2 "${bindings[@]}" >"$base/plan" 2>&1
  if [[ $(q -c "SELECT count(*) FROM pg_database WHERE oid = $mo") == 1 ]] && grep -q "^DB.tombstone_unowned|lr_drop_$mo|" "$base/plan"; then pass=$((pass + 1)); echo "PASS r1-idle-service-database-under-tombstone-name-refused"; else failed=$((failed + 1)); echo "FAIL r1-idle-service-database-under-tombstone-name-refused"; fi
  q -c "ALTER DATABASE lr_drop_$mo RENAME TO manure" -c "ALTER DATABASE manure ALLOW_CONNECTIONS true CONNECTION LIMIT -1" >/dev/null
  q -c "ALTER DATABASE lr_drop_$ro ALLOW_CONNECTIONS true" -c "DROP DATABASE lr_drop_$ro" >/dev/null
fi

# 8. the intended drop succeeds
attempt chronicle_nex249_bootstrap_20261106 chronicle_nex249_bootstrap_20261106 "$(oid chronicle_nex249_bootstrap_20261106)"; check copy-dropped dropped chronicle_nex249_bootstrap_20261106
for d in chronicle haystack manure postgres; do check "live-$d-still-present" kept "$d"; done
# 13. F5: with statistics collection off the write sample is no evidence: refuse (fail closed)
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m fast -w stop >/dev/null; "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-c listen_addresses='' -k $base -c track_counts=off" -w start >/dev/null
attempt haystack_nex249_before_20261105a haystack_nex249_before_20261105a "$(oid haystack_nex249_before_20261105a)"; check track-counts-off-refused kept haystack_nex249_before_20261105a
echo "drop-databases test ($script, legacy_cli=$legacy_cli): $pass passed, $failed failed"
[[ $failed -eq 0 ]]
