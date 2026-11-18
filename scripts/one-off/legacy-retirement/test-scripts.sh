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
. "$here/test-guard.sh"
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
predicate_case v2-outer-whitespace "  $v2${nl}" zero
predicate_case v1-with-whitespace '[ "embedding-space-v1", "aa", "m", "r", 768, false, "q", "d", "cosine"]' nonzero
predicate_case unknown-version '["embedding-space-v3","m","r",768,false,"q","d","cosine"]' nonzero
predicate_case invalid-json '["embedding-space-v2",' nonzero
predicate_case v2-not-array '{"0":"embedding-space-v2"}' nonzero
# S3: three-valued logic — every shape whose version test is NULL must count as "not proven v2"
predicate_case empty-array '[]' nonzero
predicate_case null-element '[null]' nonzero
predicate_case json-null 'null' nonzero
predicate_case empty-object '{}' nonzero
predicate_case scalar-string '"embedding-space-v2"' nonzero
predicate_case scalar-number '42' nonzero
predicate_case wrong-case '["Embedding-Space-V2","m","r",768,false,"q","d","cosine"]' nonzero
predicate_case inner-leading-space '[" embedding-space-v2","m","r",768,false,"q","d","cosine"]' nonzero
predicate_case inner-trailing-space '["embedding-space-v2 ","m","r",768,false,"q","d","cosine"]' nonzero
predicate_case number-tag '[2,"m"]' nonzero

# --- S3 (Chronicle): the same shapes in ch_embedding_spaces / ch_index_profiles (jsonb) on the real schema --------
q -d postgres -c 'CREATE DATABASE chronicle_t' >/dev/null
q -d chronicle_t -c 'CREATE EXTENSION vector' -c 'CREATE EXTENSION pg_trgm' >/dev/null
for m in 001.sql 002.sql 003_index_progress.sql 004_collector_progress.sql 005_static_tokens.sql 006_archive_projection.sql 007_owner_profiles.sql 008_problem_passages.sql 009_transient_security_epoch.sql 010_index_checkpoints.sql 011_context_coverage.sql 012_reindex_cohorts.sql 013_revision_bindings.sql 014_renewable_sessions.sql 015_annotation_attempts.sql 018_model_identity.sql 019_retained_profile_reads.sql 020_persistent_sessions.sql 017_head_literal_candidates.sql; do
  q -d chronicle_t -f "chronicle/migrations/$m" >/dev/null 2>&1 || { echo "setup: chronicle migration $m failed" >&2; exit 5; }
done
cv2='["embedding-space-v2","m","r",768,false,"q","d","cosine"]'
chronicle_case() { # name, space descriptor, profile descriptor, expected verify outcome
  q -d chronicle_t -c "DELETE FROM ch_index_profiles" -c "DELETE FROM ch_embedding_spaces" \
    -c "INSERT INTO ch_embedding_spaces(id, descriptor) VALUES ('s2', \$d\$$cv2\$d\$), ('sx', \$d\$$2\$d\$)" \
    -c "INSERT INTO ch_index_profiles(profile, embedding_space, policy, descriptor) VALUES ('p2', 's2', 'ContextAwareProblemsV1', \$d\$$3\$d\$)" >/dev/null 2>"$base/err" \
    || { ko "s3-chronicle-$1" "setup: $(head -1 "$base/err")"; return; }
  PGDATABASE=chronicle_t sh "$dir/run.sh" chronicle verify >"$base/out" 2>&1; local rc=$? got=nonzero
  [[ $rc -eq 0 ]] && grep -q 'LR.result|verify-zero' "$base/out" && got=zero
  [[ $got == "$4" ]] && ok "s3-chronicle-$1" || ko "s3-chronicle-$1" "verify=$got want=$4"
}
okprof='["index-profile-descriptor-v2",["m","r","p","1"],"c"]'
chronicle_case all-v2 "$cv2" "$okprof" zero
for shape in '[]' '[null]' 'null' '{}' '"embedding-space-v2"' '42' '["Embedding-Space-V2"]' '[" embedding-space-v2"]' '["embedding-space-v1"]'; do
  chronicle_case "space-$(printf '%s' "$shape" | tr -c 'A-Za-z0-9' '_')" "$shape" "$okprof" nonzero
done
for shape in '[]' '[null]' 'null' '{}' '"index-profile-descriptor-v2"' '["Index-Profile-Descriptor-V2"]' '["index-profile-descriptor-v1"]'; do
  chronicle_case "profile-$(printf '%s' "$shape" | tr -c 'A-Za-z0-9' '_')" "$cv2" "$shape" nonzero
done

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

# --- S4/F10: the REAL op.sh (by path and mode) against a fake kubectl with realistic JSON --------------------------
mkdir -p "$base/bin"; echo normal >"$base/fake-mode"; echo 0 >"$base/fake-pod-calls"
cat >"$base/bin/kubectl" <<'FAKE'
#!/usr/bin/env bash
# Fake kubectl for the op.sh tests. Modes ($LR_FAKE_DIR/fake-mode): normal, cut-no-marker (exec psql output loses its
# last line, exit 0), failure-marker (psql error lines dropped, exit 0, so the last line is a failure marker),
# probe-before-fail (first 'get pod' fails), probe-after-fail (second 'get pod' fails), restart-during (second
# 'get pod' reports one more chronicle restart), bad-url (the haystack ConfigMap holds an unparseable PG URL).
d=$LR_FAKE_DIR; mode=$(cat "$d/fake-mode"); echo "$*" >>"$d/kubectl.calls"
args=("$@"); cmd=(); for i in "${!args[@]}"; do [[ ${args[$i]} == -- ]] && { cmd=("${args[@]:$((i+1))}"); break; }; done
case " $* " in
  *" get pod "*)
    n=$(( $(cat "$d/fake-pod-calls") + 1 )); echo $n >"$d/fake-pod-calls"
    [[ $mode == probe-before-fail && $n -eq 1 ]] && { echo 'error: You must be logged in to the server (Unauthorized)' >&2; exit 1; }
    [[ $mode == probe-after-fail && $n -ge 2 ]] && { echo 'Unable to connect to the server: EOF' >&2; exit 1; }
    r=2; [[ $mode == restart-during && $n -ge 2 ]] && r=3
    cat <<JSON
{"apiVersion":"v1","kind":"Pod","metadata":{"name":"test-pod","namespace":"test-ns","uid":"0b6f0c8e-0000-4000-8000-000000000001"},
 "status":{"phase":"Running","conditions":[{"type":"Initialized","status":"True"},{"type":"Ready","status":"True"},{"type":"ContainersReady","status":"True"}],
  "containerStatuses":[{"name":"chronicle","ready":true,"restartCount":$r,"started":true},{"name":"haystack","ready":true,"restartCount":0},
   {"name":"manure","ready":true,"restartCount":0},{"name":"postgres","ready":true,"restartCount":0}]}}
JSON
    ;;
  *" get configmap "*)
    svc=${args[-3]}; extra=''
    [[ $mode == bad-url && $svc == haystack ]] && extra=',"replica":"jdbc:postgresql://db.example:5432/haystack_ro?sslmode=require"'
    python3 -c 'import json,sys; svc,extra=sys.argv[1],sys.argv[2]; cfg="{\"database\":{\"jdbcUrl\":\"jdbc:postgresql://127.0.0.1:5432/%s\",\"user\":\"%s\"}%s}" % (svc,svc,extra); print(json.dumps({"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":svc},"data":{"server.json":cfg}}))' "$svc" "$extra" ;;
  *" exec "*)
    case ${cmd[0]} in
      psql) out=(); skip=0; for a in "${cmd[@]:1}"; do if [[ $skip == 1 ]]; then skip=0; continue; fi; case $a in -h|-U) skip=1 ;; *) out+=("$a") ;; esac; done
            in=$(mktemp "$d/stdin.XXXXXX"); cat >"$in"
            grep -q "lr:op:probe" "$in" && mode=normal   # the modes break the command under test, not op.sh's own probes
            exec <"$in"; rm -f "$in"
            if [[ $mode == cut-no-marker ]]; then psql -h "$d" -U postgres "${out[@]}" 2>&1 | head -n -1; exit 0
            elif [[ $mode == failure-marker ]]; then psql -h "$d" -U postgres "${out[@]}" 2>&1 | grep -vE '^(psql:|ERROR|CONTEXT|DETAIL)'; exit 0
            else exec psql -h "$d" -U postgres "${out[@]}"; fi ;;
      env) exec pg_dump -h "$d" -U postgres --format=custom -d haystack ;;
    esac ;;
  *) echo "fake kubectl: unexpected $*" >&2; exit 9 ;;
esac
FAKE
chmod +x "$base/bin/kubectl"
sysid=$(q -d postgres -c 'SELECT system_identifier FROM pg_control_system()')
q -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chronicle') THEN CREATE ROLE chronicle LOGIN; END IF; END \$\$" >/dev/null
q -d postgres -c 'CREATE DATABASE chronicle' >/dev/null
OP="$dir/op.sh"
op() { # mode, op args… : the real file, executed by its path (so a missing exec bit fails), in a clean environment
  echo "$1" >"$base/fake-mode"; echo 0 >"$base/fake-pod-calls"; rm -f "$base/kubectl.calls"; shift
  env -i PATH="$base/bin:$PATH" HOME="$HOME" LR_FAKE_DIR="$base" LR_CONTEXT=test-ctx LR_NAMESPACE=test-ns LR_POD=test-pod \
    LR_CONTAINER=postgres LR_SOCKET=/run/x LR_ROLE=postgres LR_SYSTEM_IDENTIFIER="${op_sysid:-$sysid}" "$OP" "$@" >"$base/op.out" 2>&1
}
expect_op() { # name, want-rc, grep-pattern-or-empty, mode, op args…
  local name=$1 want=$2 pat=$3; shift 3; op "$@"; local rc=$?
  if [[ $rc == "$want" ]] && { [[ -z $pat ]] || grep -qE "$pat" "$base/op.out"; }; then ok "$name"; else ko "$name" "rc=$rc want=$want"; sed 's/^/     | /' "$base/op.out" | tail -n 4; fi
}
if [[ -f $OP ]]; then
  [[ -x $OP ]] && ok s4-op-executable || ko s4-op-executable "mode $(stat -c %a "$OP")"
  [[ $(grep -vE '^[[:space:]]*#' "$OP" | grep -c 'kubectl') == 3 ]] && ok s2-kubectl-named-only-in-the-three-helpers || ko s2-kubectl-named-only-in-the-three-helpers
  q -d manure -c "TRUNCATE pony_retrieval_profiles" >/dev/null
  expect_op s4-op-preflight-target-database 0 'LR\.result\|preflight-complete' normal manure preflight
  grep -q -- '-d manure' "$base/kubectl.calls" && ok s4-op-routes-to-target-database || ko s4-op-routes-to-target-database
  expect_op s4-op-restart-lines 0 '^LR\.restarts\|after\|chronicle=2' normal manure preflight
  expect_op s4-cut-stream-exit0-without-marker-fails 3 'OP\.fail\|manure-preflight' cut-no-marker manure preflight
  q -d manure -c "INSERT INTO pony_retrieval_profiles VALUES ('ns', 'x', 's', '[]', '')" >/dev/null
  expect_op s4-failure-marker-with-exit0-fails 3 'LR\.result\|verify-nonzero' failure-marker manure verify
  q -d manure -c "TRUNCATE pony_retrieval_profiles" >/dev/null
  expect_op s4-before-probe-failure-sends-nothing 5 'OP\.before-probe\|failed' probe-before-fail manure preflight
  if grep -q 'LR.tool' "$base/op.out" || grep -q ' exec ' "$base/kubectl.calls"; then ko s4-before-probe-failure-ran-nothing; else ok s4-before-probe-failure-ran-nothing; fi
  expect_op s4-after-probe-failure-reported 6 'OP\.after-probe\|failed' probe-after-fail manure preflight
  expect_op s4-restart-during-command-reported 7 'LR\.restarts\.changed' restart-during manure preflight
  op_sysid=1 expect_op s4-identity-mismatch-refused 5 'identity mismatch' normal manure preflight
  expect_op s4-identify 0 "OP\.confirm\|.*system_identifier=$sysid" normal identify
  expect_op s4-ready 0 '^OP\.ready\|pod\|True' normal ready
  expect_op r7-unparseable-jdbc-url-refused 3 'cannot parse \(refusing\)' bad-url drop
  grep -q '^DB\.' "$base/op.out" && ko r7-no-drop-session-after-refusal || ok r7-no-drop-session-after-refusal
  expect_op s4-drop-plan-maintenance-database 0 'DB\.result\|plan-complete-nothing-dropped' normal drop
  expect_op s5-fence-prints-recovery-before 0 'OP\.fence\.lift\|.*unfence --role chronicle' normal chronicle fence --role chronicle
  op normal manure preflight; [[ $(head -n 1 "$base/op.out") == "FENCED since "* ]] && ok s5-fenced-banner-first-line || ko s5-fenced-banner-first-line "first: $(head -n 1 "$base/op.out")"
  expect_op s5-unfence 0 'LR\.result\|unfenced' normal chronicle unfence --role chronicle
  op normal manure preflight; [[ $(head -n 1 "$base/op.out") != "FENCED since "* ]] && ok s5-banner-gone-after-unfence || ko s5-banner-gone-after-unfence
  expect_op s4-backup-haystack-decoded 0 'LR\.result\|backup-decoded-completely' normal backup-haystack "$base/hs-backup.dump"
  expect_op s6-check-legacy-free-remote 3 'LF\.result\|legacy-present' normal check-legacy-free haystack
else
  ko s4-op-executable "no op.sh"
fi

# --- F8: the fixture tests refuse an inherited production-looking environment and never call it ---------------------
rm -f "$base/fake-psql.calls"
PSQL=$base/fake-psql timeout 120 bash "$dir/test-drop-databases.sh" >"$base/out" 2>&1; rc=$?
[[ $rc -ne 0 && $(calls) == 0 ]] && ok f8-drop-test-refuses-inherited-psql || ko f8-drop-test-refuses-inherited-psql "rc=$rc calls=$(calls)"
LR_CONTEXT=tavily-lne timeout 120 bash "$dir/test-drop-databases.sh" >"$base/out" 2>&1 && ko f8-drop-test-refuses-kube-context || ok f8-drop-test-refuses-kube-context
PGHOST=/run/pg-socket/private timeout 120 bash "$dir/test.sh" drop >"$base/out" 2>&1 && ko f8-test-sh-refuses-foreign-pghost || ok f8-test-sh-refuses-foreign-pghost

# --- S4/R2: test isolation is derived from the scripts, in one place, and complete -----------------------------------
guard=$dir/test-guard.sh
clean_env=(env -i PATH="$PATH" HOME="$HOME" POSTGRES_HOME="$POSTGRES_HOME")
inputs=$("${clean_env[@]}" bash -c '. "$1" && declare -F lr_guard_inputs >/dev/null && lr_guard_inputs' _ "$guard" 2>/dev/null)
if [[ -n $inputs ]] && grep -qx attempt_psql <<<"$inputs"; then ok r2-guard-derives-attempt_psql; else ko r2-guard-derives-attempt_psql; fi
exempt=$("${clean_env[@]}" bash -c '. "$1" && printf "%s" "${LR_GUARD_EXEMPT:-}"' _ "$guard" 2>/dev/null)
if [[ -n $exempt ]] && ! grep -qE '(^| )(PG[A-Z]|LR_|KUBE|CLONE_|PSQL)' <<<"$exempt"; then ok s4-exempt-list-holds-no-target; else ko s4-exempt-list-holds-no-target "exempt='$exempt'"; fi
missing=''
for name in $inputs PGHOST PGSERVICEFILE PGSOMETHINGNEW KUBECONFIG KUBECTL_EXTERNAL_DIFF LR_NEW_SETTING CLONE_NEW PSQL; do
  case " $exempt " in *" $name "*) continue ;; esac
  "${clean_env[@]}" "$name=x" bash -c '. "$1"' _ "$guard" >/dev/null 2>&1; [[ $? -eq 4 ]] || missing="$missing $name"
done
[[ -z $missing && -n $inputs ]] && ok s4-every-derived-input-refused || ko s4-every-derived-input-refused "not refused:${missing:- (no inputs derived)}"

echo "legacy-retirement script tests ($dir): $pass passed, $failed failed"
[[ $failed -eq 0 ]]
