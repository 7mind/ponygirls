#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NATIVE_TEST="$ROOT/tests/native/native_acceptance.py"

if [ "${1:-}" = "--selftest" ] && [ "$#" -eq 1 ]; then
  PYTHONDONTWRITEBYTECODE=1 exec python3 -m unittest discover -s "$ROOT/tests/native" -p 'test_*.py' -v
fi

if [ "$#" -ne 3 ]; then
  echo "usage: $0 NATIVE_LAUNCHER WORKER_EXECUTABLE NATIVE_ELF" >&2
  echo "       $0 --selftest   # loopback fixtures only; not native acceptance" >&2
  exit 2
fi

[ -f "$1" ] && [ -x "$1" ] || { echo "invalid NATIVE_LAUNCHER" >&2; exit 2; }
[ -f "$2" ] && [ -x "$2" ] || { echo "invalid WORKER_EXECUTABLE" >&2; exit 2; }
[ -f "$3" ] && [ -x "$3" ] || { echo "invalid NATIVE_ELF" >&2; exit 2; }
[ "$(dd if="$3" bs=4 count=1 2>/dev/null)" = "$(printf '\177ELF')" ] || { echo "NATIVE_ELF is not ELF" >&2; exit 2; }

export PYTHONDONTWRITEBYTECODE=1
exec python3 "$NATIVE_TEST" "$1" "$2" "$3"
