#!/bin/sh
# One-off legacy-data retirement driver. POSIX shell + psql only.
#
#   run.sh <chronicle|haystack> <preflight|dry-run|apply|verify> [options]
#
# The script composes ONE psql session (a script on standard input) and runs it with `${PSQL:-psql}`.
# Connection parameters are the operator's: the standard PG* environment variables, or a complete command in PSQL
# (for instance a `kubectl exec -i … -- psql …` command line). `--emit` prints the composed session instead of
# running it, so it can be piped into a psql that runs somewhere this file is not present.
#
# Modes
#   preflight  read-only; prints the legacy counters, the re-index worklist and the plan token
#   dry-run    performs the whole migration in one transaction and rolls it back; prints what would change
#   apply      requires --apply-irreversible, --confirm-database NAME and --expect-plan TOKEN (from preflight)
#   verify     read-only; exits non-zero unless every legacy counter is zero
#
# Options
#   --confirm-database NAME      must equal current_database() of the session (apply)
#   --expect-plan TOKEN          the LR.plan value printed by preflight (apply)
#   --apply-irreversible         acknowledges that apply deletes rows (apply)
#   --allow-active-connections   do not refuse when other clients are connected to the database
#   --batch-size N               rows per batch transaction (default 50)
#   --max-batches N              batches per kind in one run (default 200); a longer backlog needs another run
#   --lock-timeout D             default 5s
#   --statement-timeout D        default 120s (preflight, verify) or 900s (dry-run, apply)
#   --emit                       print the psql session instead of running it
#
# Output: lines `LR.<key>|<value>` (counts and state only, never row contents); refusals are psql errors.
# Exit status: 0 success; 2 usage; 3 a refusal, a failed precondition or a non-zero verify (psql ON_ERROR_STOP).
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
usage() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'legacy-retirement: %s\n' "$1" >&2; exit 2; }

[ $# -ge 2 ] || usage
target=$1; mode=$2; shift 2
case $target in chronicle|haystack) ;; *) usage ;; esac
case $mode in preflight|dry-run|apply|verify) ;; *) usage ;; esac

confirm_database=''; expect_plan=''; acknowledged=f; allow_connections=f; emit=f
batch_size=50; max_batches=200; lock_timeout=5s; statement_timeout=''
while [ $# -gt 0 ]; do
  case $1 in
    --confirm-database) [ $# -ge 2 ] || usage; confirm_database=$2; shift 2 ;;
    --expect-plan) [ $# -ge 2 ] || usage; expect_plan=$2; shift 2 ;;
    --apply-irreversible) acknowledged=t; shift ;;
    --allow-active-connections) allow_connections=t; shift ;;
    --batch-size) [ $# -ge 2 ] || usage; batch_size=$2; shift 2 ;;
    --max-batches) [ $# -ge 2 ] || usage; max_batches=$2; shift 2 ;;
    --lock-timeout) [ $# -ge 2 ] || usage; lock_timeout=$2; shift 2 ;;
    --statement-timeout) [ $# -ge 2 ] || usage; statement_timeout=$2; shift 2 ;;
    --emit) emit=t; shift ;;
    *) usage ;;
  esac
done

# Every value below is interpolated into the psql session: accept only closed alphabets.
matches() { printf '%s' "$1" | grep -Eq "^$2\$"; }
matches "$batch_size" '[1-9][0-9]{0,5}' || fail '--batch-size must be a positive integer'
matches "$max_batches" '[1-9][0-9]{0,3}' || fail '--max-batches must be a positive integer below 10000'
matches "$lock_timeout" '[0-9]+(ms|s|min)' || fail '--lock-timeout must look like 5s'
if [ -z "$statement_timeout" ]; then
  case $mode in preflight|verify) statement_timeout=120s ;; *) statement_timeout=900s ;; esac
fi
matches "$statement_timeout" '[0-9]+(ms|s|min)' || fail '--statement-timeout must look like 900s'
if [ "$mode" = apply ]; then
  [ "$acknowledged" = t ] || fail 'apply requires --apply-irreversible'
  [ -n "$confirm_database" ] || fail 'apply requires --confirm-database NAME (type the name of the target database)'
  [ -n "$expect_plan" ] || fail 'apply requires --expect-plan TOKEN (the LR.plan line of a preflight taken just before)'
fi
[ -z "$confirm_database" ] || matches "$confirm_database" '[A-Za-z0-9_.-]{1,63}' || fail '--confirm-database has unexpected characters'
[ -z "$expect_plan" ] || matches "$expect_plan" '[0-9]+(\.[0-9]+)*' || fail '--expect-plan is not a plan token'

sql=$here/sql/$target
# A line consisting of \ir_counts is replaced by the counters fragment (psql cannot include files on a remote stdin).
fragment() {
  awk -v counts="$sql/counts-cte.sql" '$0 == "\\ir_counts" { while ((getline line < counts) > 0) print line; close(counts); next } { print }' "$sql/$1"
}
repeat() { i=0; while [ "$i" -lt "$max_batches" ]; do fragment "$1"; i=$((i + 1)); done; }

compose() {
  printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'"
  printf "\\\\set mode '%s'\n\\\\set confirm_database '%s'\n\\\\set expect_plan '%s'\n\\\\set allow_connections '%s'\n" "$mode" "$confirm_database" "$expect_plan" "$allow_connections"
  printf "\\\\set batch_size %s\n\\\\set lock_timeout '%s'\n\\\\set statement_timeout '%s'\n" "$batch_size" "$lock_timeout" "$statement_timeout"
  if [ "$mode" = apply ]; then printf '%s\n' '\set lr_apply t' '\set lr_dry_run f'; else printf '%s\n' '\set lr_apply f' '\set lr_dry_run t'; fi
  printf '\\echo LR.tool|legacy-retirement %s %s\n' "$target" "$mode"
  case $mode in
    preflight) fragment preflight.sql ;;
    verify) fragment verify.sql ;;
    dry-run|apply)
      fragment 10-guards.sql
      case $target in
        chronicle) repeat 20-batch-generations.sql; repeat 21-batch-jobs.sql; repeat 22-batch-namespaces.sql; fragment 30-identity.sql ;;
        haystack) repeat 20-batch-replay.sql; fragment 30-finish.sql ;;
      esac ;;
  esac
}

# Compose completely before anything is sent: a failure here must not reach psql as a truncated session.
session=$(compose)
if [ "$emit" = t ]; then printf '%s\n' "$session"; exit 0; fi
# PSQL may be a whole command line supplied by the operator; word splitting is intended.
# shellcheck disable=SC2086
printf '%s\n' "$session" | ${PSQL:-psql} -X -q -v ON_ERROR_STOP=1 -f -
