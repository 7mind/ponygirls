#!/usr/bin/env bash
# Resource-limit regression tests exercise the public yolo CLI with a fake
# sandbox that reports the rlimits and CPU affinity it inherited (both are
# process attributes the launcher passes down to every child).
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SCRIPT="$SCRIPT_DIR/yolo.sh"

FAILURES=0
TESTS_RUN=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
PROJECT_DIR="$WORKDIR/project"
FAKE_HOME="$WORKDIR/home"
FAKE_BIN="$WORKDIR/bin"
_bash_path="$(command -v bash)"
mkdir -p "$PROJECT_DIR" "$FAKE_BIN" "$FAKE_HOME"

# The fake sandbox reports the limits it inherited from the yolo launcher.
# Both the soft and the hard data-segment limit: the launcher must set hard
# too, or the sandboxed tree could raise the limit back.
printf '%s\n' \
  "#!$_bash_path" \
  'echo "MEM_SOFT_KIB:$(ulimit -d)"' \
  'echo "MEM_HARD_KIB:$(ulimit -Hd)"' \
  'grep "^Cpus_allowed_list:" /proc/self/status' \
  > "$FAKE_BIN/limit-report"
chmod +x "$FAKE_BIN/limit-report"

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc -- expected [$expected], got [$actual]"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $desc -- expected output to contain [$needle]"
    FAILURES=$((FAILURES + 1))
  fi
}

run_limits_yolo() {
  {
    cd "$PROJECT_DIR" &&
      HOME="$FAKE_HOME" \
      YOLO_LLM_SANDBOX="$FAKE_BIN/limit-report" \
      YOLO_SANDBOX_ENTRYPOINT="$(command -v true)" \
      YOLO_NIX_LD="$(command -v true)" \
      YOLO_JQ="$(command -v jq)" \
      YOLO_TASKSET="$(command -v taskset)" \
      YOLO_CUSTOM_PROMPT="$SCRIPT_DIR/custom-prompt.sh" \
      bash "$SCRIPT" "$@" cmd true
  } 2>&1
}

mem_soft_of() { sed -n 's/^MEM_SOFT_KIB://p' <<< "$1" | head -1; }
mem_hard_of() { sed -n 's/^MEM_HARD_KIB://p' <<< "$1" | head -1; }
cpus_of() { sed -n 's/^Cpus_allowed_list:[[:space:]]*//p' <<< "$1" | head -1; }

# Expands a kernel CPU list ("0-3,8") to space-separated ids ("0 1 2 3 8").
expand_cpu_list() {
  local _spec="$1" _r _lo _hi _c
  local -a _out=() _ranges=()
  IFS=',' read -ra _ranges <<< "$_spec"
  for _r in "${_ranges[@]}"; do
    if [[ "$_r" == *-* ]]; then
      _lo="${_r%-*}"; _hi="${_r#*-}"
      for (( _c = _lo; _c <= _hi; _c++ )); do _out+=("$_c"); done
    else
      _out+=("$_r")
    fi
  done
  printf '%s' "${_out[*]}"
}

# The spec: 1/8 of host RAM (KiB) and 1/4 of the host's hardware threads,
# clamped to what the ambient affinity mask allows (a nested launch).
MEM_TOTAL_KIB="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
EXPECTED_MEM_KIB=$((MEM_TOTAL_KIB / 8))
TOTAL_CPUS="$(nproc --all)"
EXPECTED_QUOTA=$(( TOTAL_CPUS / 4 ))
(( EXPECTED_QUOTA < 1 )) && EXPECTED_QUOTA=1

# Ambient limits: the reference for "unchanged" and the selection pool.
BASELINE="$(run_limits_yolo --disable=mem-limit,cpu-limit)"
BASELINE_CPUS="$(expand_cpu_list "$(cpus_of "$BASELINE")")"
read -r -a _ambient_ids <<< "$BASELINE_CPUS"
AMBIENT_COUNT=${#_ambient_ids[@]}
EXPECTED_CPU_COUNT=$EXPECTED_QUOTA
(( AMBIENT_COUNT < EXPECTED_CPU_COUNT )) && EXPECTED_CPU_COUNT=$AMBIENT_COUNT
EXPECTED_CPUS="$(printf '%s\n' "$BASELINE_CPUS" | cut -d' ' -f"1-$EXPECTED_CPU_COUNT")"

OUT="$(run_limits_yolo)"
assert_eq "default caps the data segment at 1/8 of host RAM" \
  "$EXPECTED_MEM_KIB" "$(mem_soft_of "$OUT")"
assert_eq "default caps the hard data segment too (not escapable)" \
  "$EXPECTED_MEM_KIB" "$(mem_hard_of "$OUT")"
assert_eq "default pins 1/4 of the hardware threads" \
  "$EXPECTED_CPU_COUNT" "$(wc -w <<< "$(expand_cpu_list "$(cpus_of "$OUT")")")"
assert_eq "default pins the first quarter of the allowed CPUs" \
  "$EXPECTED_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"

OUT="$(run_limits_yolo --disable=mem-limit)"
assert_eq "--disable=mem-limit leaves the soft data segment untouched" \
  "$(mem_soft_of "$BASELINE")" "$(mem_soft_of "$OUT")"
assert_eq "--disable=mem-limit leaves the hard data segment untouched" \
  "$(mem_hard_of "$BASELINE")" "$(mem_hard_of "$OUT")"
assert_eq "--disable=mem-limit still pins the CPU quota" \
  "$EXPECTED_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"

OUT="$(run_limits_yolo --disable=cpu-limit)"
assert_eq "--disable=cpu-limit still caps the data segment" \
  "$EXPECTED_MEM_KIB" "$(mem_soft_of "$OUT")"
assert_eq "--disable=cpu-limit leaves the affinity untouched" \
  "$BASELINE_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"

OUT="$(run_limits_yolo --disable=mem-limit --disable=cpu-limit)"
assert_eq "both limits disabled leaves the data segment untouched" \
  "$(mem_soft_of "$BASELINE")" "$(mem_soft_of "$OUT")"
assert_eq "both limits disabled leaves the affinity untouched" \
  "$BASELINE_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"

# Explicit values: SIZE is KiB or a K/M/G/T (1024-based) suffix.
OUT="$(run_limits_yolo --mem-limit=100M)"
assert_eq "--mem-limit=100M sets the data-segment limit" \
  "102400" "$(mem_soft_of "$OUT")"
assert_eq "--mem-limit=100M sets the hard limit too" \
  "102400" "$(mem_hard_of "$OUT")"
assert_eq "--mem-limit=100M keeps the default CPU pin" \
  "$EXPECTED_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"

OUT="$(run_limits_yolo --mem-limit=51200)"
assert_eq "--mem-limit takes a bare KiB value" "51200" "$(mem_soft_of "$OUT")"

OUT="$(run_limits_yolo --mem-limit=1G --disable=cpu-limit)"
assert_eq "--mem-limit=1G is 1048576 KiB" "1048576" "$(mem_soft_of "$OUT")"

OUT="$(run_limits_yolo --mem-limit=none)"
assert_eq "--mem-limit=none leaves the data segment untouched" \
  "$(mem_soft_of "$BASELINE")" "$(mem_soft_of "$OUT")"

OUT="$(run_limits_yolo --cpu-limit=2 --disable=mem-limit)"
assert_eq "--cpu-limit pins exactly N threads" \
  "2" "$(wc -w <<< "$(expand_cpu_list "$(cpus_of "$OUT")")")"
assert_eq "--cpu-limit pins the first N allowed CPUs" \
  "$(printf '%s\n' "$BASELINE_CPUS" | cut -d' ' -f1-2)" "$(expand_cpu_list "$(cpus_of "$OUT")")"

OUT="$(run_limits_yolo --cpu-limit=none)"
assert_eq "--cpu-limit=none leaves the affinity untouched" \
  "$BASELINE_CPUS" "$(expand_cpu_list "$(cpus_of "$OUT")")"
assert_eq "--cpu-limit=none keeps the default memory cap" \
  "$EXPECTED_MEM_KIB" "$(mem_soft_of "$OUT")"

# --disable wins over a value flag for the same limit.
OUT="$(run_limits_yolo --disable=mem-limit --mem-limit=100M)"
assert_eq "--disable=mem-limit beats --mem-limit" \
  "$(mem_soft_of "$BASELINE")" "$(mem_soft_of "$OUT")"

# Invalid specs fail fast at argument parsing.
OUT="$(run_limits_yolo --mem-limit=0)"
STATUS=$?
assert_eq "--mem-limit=0 is rejected" "1" "$STATUS"
assert_contains "--mem-limit=0 points at 'none'" "$OUT" "use 'none'"

OUT="$(run_limits_yolo --mem-limit=12X)"
STATUS=$?
assert_eq "--mem-limit rejects unknown units" "1" "$STATUS"
assert_contains "--mem-limit=12X shows the expected form" "$OUT" "--mem-limit expects SIZE"

OUT="$(run_limits_yolo --cpu-limit=zero)"
STATUS=$?
assert_eq "--cpu-limit rejects non-numbers" "1" "$STATUS"
assert_contains "--cpu-limit=zero shows the expected form" "$OUT" "--cpu-limit expects a positive"

OUT="$(run_limits_yolo --cpu-limit=0)"
STATUS=$?
assert_eq "--cpu-limit=0 is rejected" "1" "$STATUS"

echo "resource-limits-test: $TESTS_RUN tests, $FAILURES failures"
[[ $FAILURES -eq 0 ]] || exit 1
