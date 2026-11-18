#!/bin/sh
# One-off legacy-data retirement driver. POSIX shell + psql only.
#
#   run.sh chronicle <preflight|dry-run|apply|verify> [options]
#   run.sh haystack  <preflight|dry-run|apply|verify|export-stored-documents> [options]
#   run.sh manure    <preflight|verify>                    (shared retrieval model identity only)
#
# The script composes ONE psql session (a script on standard input) and runs it with `${PSQL:-psql}`.
# Connection parameters are the operator's: the standard PG* environment variables, or a complete command in PSQL
# (for instance a `kubectl exec -i … -- psql …` command line). `--emit` prints the composed session instead of
# running it, so it can be piped into a psql that runs somewhere this file is not present.
#
# Modes
#   preflight  read-only; legacy counters, worklists, backup sizes and the plan token
#   dry-run    performs the whole migration in one transaction and rolls it back; prints what would change
#   apply      requires --apply-irreversible, --confirm-database NAME, --expect-plan TOKEN, --backup-reference REF
#   verify     read-only; exits non-zero unless every legacy counter of the selected items is zero
#   export-stored-documents  (haystack) read-only; every stored document as hex, for check-stored-documents.sh
#
# Options
#   --confirm-database NAME      must equal current_database() of the session (apply)
#   --expect-plan TOKEN          the LR.plan value printed by preflight (apply)
#   --apply-irreversible         acknowledges that apply cannot be undone without the backup (apply)
#   --backup-reference REF       identifier of the restorable backup taken for this run; recorded in the output (apply)
#   --skip-formats               chronicle: leave the publication-formats item alone (dry-run, apply, verify)
#   --retire-history             chronicle: retire non-retired historical generations of the old formats, the way a
#                                rebuild retires them (tombstone stays, derived rows go). Never the default.
#   --confirm-retire-history N   the number of generations --retire-history will retire (from preflight)
#   --allow-active-connections   do not refuse when other clients are connected to the database
#   --batch-size N               rows per batch transaction (default 50)
#   --max-batches N              batches per kind in one run (default 200); a longer backlog needs another run
#   --lock-timeout D             default 5s
#   --statement-timeout D        default 120s (read-only modes) or 900s (dry-run, apply)
#   --emit                       print the psql session instead of running it
#
# Output: lines `LR.<key>|<value>` (counts and state only, never row contents; export-stored-documents is the one
# exception and prints document bytes as hex). Refusals are psql errors.
# Exit status: 0 success; 2 usage; 3 a refusal, a failed precondition or a non-zero verify (psql ON_ERROR_STOP).
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
usage() { sed -n '2,39p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'legacy-retirement: %s\n' "$1" >&2; exit 2; }

[ $# -ge 2 ] || usage
target=$1; mode=$2; shift 2
case $target:$mode in
  chronicle:preflight|chronicle:dry-run|chronicle:apply|chronicle:verify) ;;
  haystack:preflight|haystack:dry-run|haystack:apply|haystack:verify|haystack:export-stored-documents) ;;
  manure:preflight|manure:verify) ;;
  *) usage ;;
esac

confirm_database=''; expect_plan=''; acknowledged=f; allow_connections=f; emit=f; backup_reference=''
skip_formats=f; retire_history=f; confirm_retire_history=''
batch_size=50; max_batches=200; lock_timeout=5s; statement_timeout=''
while [ $# -gt 0 ]; do
  case $1 in
    --confirm-database) [ $# -ge 2 ] || usage; confirm_database=$2; shift 2 ;;
    --expect-plan) [ $# -ge 2 ] || usage; expect_plan=$2; shift 2 ;;
    --backup-reference) [ $# -ge 2 ] || usage; backup_reference=$2; shift 2 ;;
    --apply-irreversible) acknowledged=t; shift ;;
    --skip-formats) skip_formats=t; shift ;;
    --retire-history) retire_history=t; shift ;;
    --confirm-retire-history) [ $# -ge 2 ] || usage; confirm_retire_history=$2; shift 2 ;;
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
  case $mode in dry-run|apply) statement_timeout=900s ;; *) statement_timeout=120s ;; esac
fi
matches "$statement_timeout" '[0-9]+(ms|s|min)' || fail '--statement-timeout must look like 900s'
if [ "$mode" = apply ]; then
  [ "$acknowledged" = t ] || fail 'apply requires --apply-irreversible'
  [ -n "$confirm_database" ] || fail 'apply requires --confirm-database NAME (type the name of the target database)'
  [ -n "$expect_plan" ] || fail 'apply requires --expect-plan TOKEN (the LR.plan line of a preflight taken just before)'
  [ -n "$backup_reference" ] || fail 'apply requires --backup-reference REF (the restorable backup taken for this run)'
fi
[ -z "$confirm_database" ] || matches "$confirm_database" '[A-Za-z0-9_.-]{1,63}' || fail '--confirm-database has unexpected characters'
[ -z "$expect_plan" ] || matches "$expect_plan" '[0-9]+(\.[0-9]+)*' || fail '--expect-plan is not a plan token'
[ -z "$backup_reference" ] || matches "$backup_reference" '[A-Za-z0-9_.:/@+=-]{1,200}' || fail '--backup-reference has unexpected characters'
[ -z "$confirm_retire_history" ] || matches "$confirm_retire_history" '[0-9]{1,9}' || fail '--confirm-retire-history must be a number'
if [ "$target" != chronicle ]; then
  [ "$skip_formats$retire_history" = ff ] && [ -z "$confirm_retire_history" ] || fail '--skip-formats and --retire-history apply to chronicle only'
fi
[ "$skip_formats$retire_history" != tt ] || fail '--skip-formats and --retire-history exclude each other'
if [ "$retire_history" = t ]; then
  [ -n "$confirm_retire_history" ] || fail '--retire-history requires --confirm-retire-history N (the count preflight reports as generations.old_format.history)'
else
  [ -z "$confirm_retire_history" ] || fail '--confirm-retire-history requires --retire-history'
fi

sql=$here/sql/$target
# A line consisting of \ir_counts is replaced by the counters fragment (psql cannot include files on a remote stdin).
fragment() {
  awk -v counts="$sql/counts-cte.sql" '$0 == "\\ir_counts" { while ((getline line < counts) > 0) print line; close(counts); next } { print }' "$sql/$1"
}
repeat() { i=0; while [ "$i" -lt "$max_batches" ]; do fragment "$1"; i=$((i + 1)); done; }
flag() { printf '\\set %s %s\n' "$1" "$2"; }

compose() {
  printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'"
  printf "\\\\set mode '%s'\n\\\\set confirm_database '%s'\n\\\\set expect_plan '%s'\n\\\\set allow_connections '%s'\n" "$mode" "$confirm_database" "$expect_plan" "$allow_connections"
  printf "\\\\set backup_reference '%s'\n\\\\set skip_formats '%s'\n\\\\set retire_history '%s'\n\\\\set confirm_retire_history '%s'\n" "${backup_reference:--}" "$skip_formats" "$retire_history" "$confirm_retire_history"
  printf "\\\\set batch_size %s\n\\\\set lock_timeout '%s'\n\\\\set statement_timeout '%s'\n" "$batch_size" "$lock_timeout" "$statement_timeout"
  if [ "$mode" = apply ]; then flag lr_apply t; flag lr_dry_run f; else flag lr_apply f; flag lr_dry_run t; fi
  flag lr_skip_formats "$skip_formats"; flag lr_retire_history "$retire_history"
  printf '\\echo LR.tool|legacy-retirement %s %s\n' "$target" "$mode"
  case $mode in
    preflight) fragment preflight.sql ;;
    verify) fragment verify.sql ;;
    export-stored-documents) fragment export-stored-documents.sql ;;
    dry-run|apply)
      fragment 10-guards.sql
      case $target in
        chronicle) repeat 20-batch-retire-history.sql; repeat 21-batch-unfinished-runs.sql; fragment 30-identity.sql ;;
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
