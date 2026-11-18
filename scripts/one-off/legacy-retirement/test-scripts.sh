#!/usr/bin/env bash
# Fixture tests of the shell layer of the legacy-retirement scripts (argument validation, operator wrapper, export
# completeness, Haystack/Manure predicates, test isolation). Own throwaway PostgreSQL cluster; no other database,
# no kube context and no inherited connection settings are ever used.
# Usage, from the repository root:
#   nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test-scripts.sh [SCRIPTS_DIR]
# SCRIPTS_DIR defaults to scripts/one-off/legacy-retirement; pass an extracted older tree to show which checks it fails.
set -uo pipefail
cd "$(dirname "$0")/../../.."
here=scripts/one-off/legacy-retirement
. "$here/test-guard.sh" 2>/dev/null || {
  # Older trees have no guard; keep the refusal semantics here so this suite never inherits a production target.
  for v in PSQL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGOPTIONS KUBECONFIG LR_CONTEXT LR_NAMESPACE LR_POD; do
    [[ -z ${!v+x} ]] || { echo "test refused: $v is set in the environment; run from a clean shell" >&2; exit 4; }
  done
}
: "${POSTGRES_HOME:?run inside nix develop .#chronicle (PostgreSQL 18)}"
dir=${1:-$here}
base=$(mktemp -d /tmp/lr-sc-test.XXXXXX)
stop() { "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"; }
trap stop EXIT
pass=0; failed=0
ok() { pass=$((pass + 1)); echo "PASS $1"; }
ko() { failed=$((failed + 1)); echo "FAIL $1${2:+ ($2)}"; }
nl='
'
# A fake psql that only records that it was called: a refusal must happen before any session is sent.
cat >"$base/fake-psql" <<EOF
#!/bin/sh
echo called >>"$base/fake-psql.calls"; cat >/dev/null; exit 0
EOF
chmod +x "$base/fake-psql"
calls() { [[ -f $base/fake-psql.calls ]] && wc -l <"$base/fake-psql.calls" || echo 0; }
refused_without_session() { # name, command...
  local name=$1; shift; rm -f "$base/fake-psql.calls"
  PSQL=$base/fake-psql "$@" >"$base/out" 2>&1; local rc=$?
  if [[ $rc -ne 0 && $(calls) == 0 ]]; then ok "$name"; else ko "$name" "rc=$rc psql-calls=$(calls)"; fi
}

# --- F2: every validated argument rejects an embedded newline (first line valid) ----------------------------------
R="sh $dir/run.sh"
refused_without_session f2-run-batch-size $R chronicle dry-run --batch-size "10${nl}20"
refused_without_session f2-run-confirm-database $R chronicle apply --apply-irreversible --confirm-database "chronicle${nl}x" --expect-plan 1 --backup-reference r
refused_without_session f2-run-expect-plan $R chronicle apply --apply-irreversible --confirm-database chronicle --expect-plan "1${nl}2" --backup-reference r
refused_without_session f2-run-backup-reference $R chronicle apply --apply-irreversible --confirm-database chronicle --expect-plan 1 --backup-reference "r${nl}\\! touch $base/pwned"
refused_without_session f2-run-retire-history $R chronicle dry-run --retire-history --confirm-retire-history "1${nl}2"
refused_without_session f2-run-lock-timeout $R chronicle preflight --lock-timeout "5s${nl}6s"
refused_without_session f2-run-application-name $R chronicle terminate --application-name "lr:chronicle:apply:120000-1${nl}x"
D="sh $dir/drop-databases.sh"
refused_without_session f2-drop-name $D drop --drop "chronicle_nex249_bootstrap_20261106${nl}haystack" --confirm-database "chronicle_nex249_bootstrap_20261106${nl}haystack" --expect-oid 1
refused_without_session f2-drop-oid $D drop --drop chronicle_nex249_bootstrap_20261106 --confirm-database chronicle_nex249_bootstrap_20261106 --expect-oid "1${nl}2"
refused_without_session f2-drop-sample $D --sample-seconds "1${nl}2"
[[ ! -e $base/pwned ]] && ok f2-no-injected-command || ko f2-no-injected-command
# --- F4: an argument made of two adjacent allowed names is not an allowed name -------------------------------------
pair="chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106"
refused_without_session f4-adjacent-names $D drop --drop "$pair" --confirm-database "$pair" --expect-oid 1
# --- I1: the Chronicle apply cannot be told to ignore connected clients ----------------------------------------------
refused_without_session i1-chronicle-no-active-connection-bypass $R chronicle apply --apply-irreversible --confirm-database chronicle --expect-plan 1 --backup-reference r --allow-active-connections
PSQL=$base/fake-psql $R haystack dry-run --allow-active-connections --emit >"$base/out" 2>&1 && ok i1-haystack-keeps-online-mode || ko i1-haystack-keeps-online-mode
# --- Q102: "no backup" only as the one owner-decision literal, only for Chronicle, recorded in the output -------------
if PSQL=$base/fake-psql $R chronicle apply --apply-irreversible --confirm-database chronicle --expect-plan 1 --backup-reference none-owner-decision-Q102 --emit >"$base/out" 2>&1 \
   && grep -q 'LR.backup|none (owner decision Q102)' "$base/out"; then ok q102-chronicle-literal-recorded; else ko q102-chronicle-literal-recorded; fi
refused_without_session q102-haystack-requires-backup $R haystack apply --apply-irreversible --confirm-database haystack --expect-plan 1 --backup-reference none-owner-decision-Q102
for alias in none no-backup NONE skip n/a none-owner-decision none-owner-decision-q102; do
  refused_without_session "q102-no-other-shortcut-$alias" $R chronicle apply --apply-irreversible --confirm-database chronicle --expect-plan 1 --backup-reference "$alias"
done
# --- F9: worklist mode with identifiers; I2: fence modes only for the named service role -----------------------------
if PSQL=$base/fake-psql $R chronicle worklist --emit >"$base/out" 2>&1 && grep -q "LR.reindex_job" "$base/out"; then ok f9-worklist-mode; else ko f9-worklist-mode; fi
for m in fence unfence fence-status; do
  if PSQL=$base/fake-psql $R chronicle $m --role chronicle --emit >"$base/out" 2>&1; then ok "i2-$m-mode"; else ko "i2-$m-mode"; fi
done
refused_without_session i2-fence-refuses-other-role $R chronicle fence --role postgres
refused_without_session i2-fence-refuses-other-target $R haystack fence --role haystack

# --- cluster for the database cases ---------------------------------------------------------------------------------
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A trust --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-c listen_addresses='' -k $base" -w start >/dev/null
export PGHOST=$base PGUSER=postgres PATH=$POSTGRES_HOME/bin:$PATH
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
q -d postgres -c 'CREATE DATABASE haystack' -c 'CREATE DATABASE manure' >/dev/null
q -d haystack -c 'CREATE EXTENSION IF NOT EXISTS vector' -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' >/dev/null
for m in haystack/migrations/000[1-6]-*.sql; do q -d haystack -f "$m" >/dev/null || { echo "setup: $m failed" >&2; exit 5; }
  q -d haystack -c "INSERT INTO schema_migrations(version) VALUES ('$(basename "$m" .sql)') ON CONFLICT DO NOTHING" >/dev/null 2>&1 || true; done
q -d haystack -c "INSERT INTO haystack_contract_cutovers(contract, policy) SELECT 'haystack.api/1.0.0', 'test' WHERE NOT EXISTS (SELECT 1 FROM haystack_contract_cutovers)" >/dev/null 2>&1 || true
retrieval='CREATE TABLE pony_retrieval_profiles(namespace text NOT NULL, id text NOT NULL, space text NOT NULL, descriptor text NOT NULL, policy bytea NOT NULL, PRIMARY KEY(namespace, id))'
q -d haystack -c "$retrieval" >/dev/null; q -d manure -c "$retrieval" >/dev/null
v2='["embedding-space-v2","m","r",768,false,"q","d","cosine"]'
predicate_case() { # name, descriptor, expected verify outcome (zero|nonzero)
  local name=$1 desc=$2 want=$3 db
  for db in haystack manure; do
    q -d "$db" -c "TRUNCATE pony_retrieval_profiles" -c "INSERT INTO pony_retrieval_profiles VALUES ('ns', 'p1', 's', '$v2', ''), ('ns', 'p2', 's', \$d\$$desc\$d\$, '')" >/dev/null
    PGDATABASE=$db sh "$dir/run.sh" "$db" verify >"$base/out" 2>&1; local rc=$?
    local got=nonzero; [[ $rc -eq 0 ]] && grep -q 'LR.result|verify-zero' "$base/out" && got=zero
    PGDATABASE=$db sh "$dir/run.sh" "$db" preflight >"$base/pf" 2>&1
    [[ $got == "$want" ]] && ok "f6-$db-$name" || ko "f6-$db-$name" "verify=$got want=$want"
  done
}
predicate_case v2-only "$v2" zero
predicate_case v1-with-whitespace '[ "embedding-space-v1", "aa", "m", "r", 768, false, "q", "d", "cosine"]' nonzero
predicate_case unknown-version '["embedding-space-v3","m","r",768,false,"q","d","cosine"]' nonzero
predicate_case invalid-json '["embedding-space-v2",' nonzero
predicate_case v2-not-array '{"0":"embedding-space-v2"}' nonzero

# --- F3: an archive cut after its table of contents is not accepted as an export -----------------------------------
q -d manure -c "CREATE TABLE big AS SELECT g AS id, repeat(md5(g::text), 20) AS t FROM generate_series(1, 20000) g" >/dev/null
pg_dump --format=custom --compress=0 -d manure >"$base/full.dump"
head -c $(( $(stat -c %s "$base/full.dump") / 2 )) "$base/full.dump" >"$base/cut.dump"
pg_restore --list "$base/cut.dump" >/dev/null 2>&1 && echo "note: pg_restore --list accepts the cut archive (the old criterion)"
printf '#!/bin/sh\ncat %s/cut.dump\n' "$base" >"$base/fake-dump"; chmod +x "$base/fake-dump"
rm -rf "$base/exp"
SOURCE_PG_DUMP=$base/fake-dump CLONE_COMPRESS=0 bash "$dir/rehearsal/clone.sh" export --dir "$base/exp" manure >"$base/out" 2>&1
[[ $? -ne 0 && ! -e $base/exp/dumps/manure.dump ]] && ok f3-cut-archive-refused || ko f3-cut-archive-refused
printf '#!/bin/sh\ncat %s/full.dump\n' "$base" >"$base/fake-dump"; rm -rf "$base/exp"
SOURCE_PG_DUMP=$base/fake-dump CLONE_COMPRESS=0 bash "$dir/rehearsal/clone.sh" export --dir "$base/exp" manure >"$base/out" 2>&1 && [[ -s $base/exp/dumps/manure.dump ]] && ok f3-complete-archive-accepted || ko f3-complete-archive-accepted

# --- F10: the operator wrapper sends each target to its own database, drop/backup to the maintenance database ------
mkdir -p "$base/bin"
cat >"$base/bin/kubectl" <<EOF
#!/usr/bin/env bash
# fake kubectl: records arguments; 'exec … -- psql ARGS' runs the local psql with ARGS (minus -h/-U), 'get pod' prints
# restart counts, 'get configmap' prints a config with a JDBC URL naming the service's own database.
echo "\$*" >>"$base/kubectl.calls"
args=("\$@"); for i in "\${!args[@]}"; do [[ \${args[\$i]} == -- ]] && { cmd=("\${args[@]:\$((i+1))}"); break; }; done
case "\$*" in
  *" get pod "*) echo '{"status":{"containerStatuses":[{"name":"chronicle","restartCount":2},{"name":"postgres","restartCount":0}]}}' ;;
  *" get configmap "*) n=\${args[-3]}; printf '{"data":{"server.json":"{\\\\"jdbcUrl\\\\":\\\\"jdbc:postgresql://127.0.0.1:5432/%s\\\\",\\\\"database\\\\":{\\\\"jdbcUrl\\\\":\\\\"jdbc:postgresql://127.0.0.1:5432/%s\\\\"}}"}}' "\$n" "\$n" ;;
  *" exec "*) out=(); skip=0; for a in "\${cmd[@]:1}"; do if [[ \$skip == 1 ]]; then skip=0; continue; fi; case \$a in -h|-U) skip=1 ;; *) out+=("\$a") ;; esac; done
             exec psql -h "$base" -U postgres "\${out[@]}" ;;
esac
EOF
chmod +x "$base/bin/kubectl"
opv=(LR_CONTEXT=test-ctx LR_NAMESPACE=test-ns LR_POD=test-pod LR_CONTAINER=postgres LR_SOCKET=/run/x LR_ROLE=postgres)
if [[ -f $dir/op.sh ]]; then
  rm -f "$base/kubectl.calls"
  env -u PGHOST -u PGUSER "${opv[@]}" PATH="$base/bin:$PATH" bash "$dir/op.sh" manure preflight >"$base/out" 2>&1
  if grep -q 'LR.result|preflight-complete' "$base/out" && grep -q -- '-d manure' "$base/kubectl.calls" && grep -q 'LR.restarts' "$base/out"; then ok f10-op-target-database; else ko f10-op-target-database; fi
  rm -f "$base/kubectl.calls"
  env -u PGHOST -u PGUSER "${opv[@]}" PATH="$base/bin:$PATH" bash "$dir/op.sh" drop >"$base/out" 2>&1
  if grep -q 'DB.result|plan-complete-nothing-dropped' "$base/out" && grep -q -- '-d postgres' "$base/kubectl.calls"; then ok f10-op-drop-maintenance-database; else ko f10-op-drop-maintenance-database; fi
  env -u PGHOST -u PGUSER LR_CONTEXT="ctx${nl}x" LR_NAMESPACE=test-ns LR_POD=test-pod LR_CONTAINER=postgres LR_SOCKET=/run/x LR_ROLE=postgres PATH="$base/bin:$PATH" bash "$dir/op.sh" manure preflight >"$base/out" 2>&1 \
    && ko f10-op-rejects-multiline-setting || ok f10-op-rejects-multiline-setting
else
  ko f10-op-target-database "no op.sh"; ko f10-op-drop-maintenance-database "no op.sh"; ko f10-op-rejects-multiline-setting "no op.sh"
fi

# --- F8: the fixture tests refuse an inherited production-looking environment and never call it ---------------------
rm -f "$base/fake-psql.calls"
PSQL=$base/fake-psql timeout 120 bash "$dir/test-drop-databases.sh" >"$base/out" 2>&1; rc=$?
[[ $rc -ne 0 && $(calls) == 0 ]] && ok f8-drop-test-refuses-inherited-psql || ko f8-drop-test-refuses-inherited-psql "rc=$rc calls=$(calls)"
LR_CONTEXT=tavily-lne timeout 120 bash "$dir/test-drop-databases.sh" >"$base/out" 2>&1 && ko f8-drop-test-refuses-kube-context || ok f8-drop-test-refuses-kube-context
PGHOST=/run/pg-socket/private timeout 120 bash "$dir/test.sh" drop >"$base/out" 2>&1 && ko f8-test-sh-refuses-foreign-pghost || ok f8-test-sh-refuses-foreign-pghost

echo "legacy-retirement script tests ($dir): $pass passed, $failed failed"
[[ $failed -eq 0 ]]
