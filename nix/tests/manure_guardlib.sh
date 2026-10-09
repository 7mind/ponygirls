# Shared shell release-guard functions (owned helper, narrow).
#
# Sourced (not executed) by nix/tests/manure-unittests.nix and
# nix/tests/manure-browser.nix AND by the fixtures in
# nix/tests/test_manure_release_guards.py (`bash -c 'source ...; ...'`),
# so derivations and fixtures run the SAME code. A gate fixed here is
# fixed everywhere.
#
# Rules these encode (see manure_guardlib.py for the Python twins):
# - pipeline verdicts read PIPESTATUS as the FIRST command after the
#   pipeline (any intervening command, including `|| true`, clobbers it
#   and greens failures — the retired browser defect);
# - `set -euo pipefail` is assumed: intentionally-failing pipelines must
#   run where errexit cannot fire first (callers use the subshell shape
#   below or `if` conditions, never a bare failing pipeline);
# - FAILED/ERROR output text is NEVER a verdict signal (expected-negative
#   inner output must not false-fail); verdicts are exit codes + counts.
#
# Usage in derivations (bash, after `... | tee "$log"` with nothing between):
#   source "${./manure_guardlib.sh}"
#   require_pipeline_ok "suite-name"      # PIPESTATUS[0] must be 0
#   require_no_skips_file "$log" "label" # no `skipped=` summary marker
# Usage for intentional-failure probes (same guard, fatal-capable):
#   ( set +e; false | tee probe.log; require_pipeline_ok "probe" )
#   ... || { echo "guard misses failures"; exit 1; }
require_pipeline_ok() {
  # $1 = captured caller status: expand "${PIPESTATUS[0]}" as an argument
  # IN THE CALL ITSELF as the first command after the pipeline (argument
  # expansion reads PIPESTATUS before the call executes; reading it later
  # — even via `local` inside a callee — sees the clobbered value).
  # $2 = label. NEVER grep FAILED/ERROR output text for verdicts.
  local code="$1" label="$2"
  test "$code" -eq 0 \
    || { echo "manure-guard: FAIL — pipeline errored: $label" >&2; return 1; }
}

require_no_skips_file() {
  # $1 = log path, $2 = label. Redundant summary cross-check for skipped
  # COUNT (`OK (skipped=N)` marker); the definitive signal is always the
  # structured skipped list (see manure_guardlib.py), never FAILED text.
  local log="$1" label="$2"
  ! grep -q 'skipped=' "$log" \
    || { echo "manure-guard: FAIL — mandatory tests skipped: $label" >&2; return 1; }
}

require_group_files() {
  # $1 = dir, $2 = glob pattern, $3 = label. Every frozen owner group must
  # be present; a missing group fails naming it (no cross-group quorum, no
  # silent absence). Pure bash builtins (nullglob array, no subprocess) so
  # it is safe under `set -euo pipefail` anywhere in the caller.
  local dir="$1" pat="$2" label="$3"
  local -a hits=()
  local restore_nullglob
  # NOTE: `shopt -p <name>` prints the state but its EXIT STATUS is the
  # option state (1 when unset — the common case), so under `set -e` the
  # capture must not propagate that status; the printed line is what
  # matters and always succeeds.
  restore_nullglob=$(shopt -p nullglob || true)
  shopt -s nullglob
  hits=("$dir"/$pat)
  eval "$restore_nullglob"
  test "${#hits[@]}" -gt 0 \
    || { echo "manure-guard: FAIL — owner group absent: $label ($pat)" >&2; return 1; }
  echo "manure-guard: group $label ($pat): ${#hits[@]} files"
}

require_file_present() {
  # $1 = path, $2 = label. Required helper/data inputs fail naming the
  # missing file (release gates never go green on absence).
  local path="$1" label="$2"
  test -f "$path" \
    || { echo "manure-guard: FAIL — required helper absent: $label ($path)" >&2; return 1; }
}
