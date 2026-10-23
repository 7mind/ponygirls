#!/usr/bin/env bash
# Behavioral-Active Blackbox-Atomic; specified runtime credential modes.
set -euo pipefail
helper="${1:-$(dirname "$0")/runtime-token.sh}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unset HAYSTACK_TOKEN HAYSTACK_TOKEN_FILE MANURE_TOKEN MANURE_TOKEN_FILE
token="$(printf '%043d' 0 | tr 0 A)"
printf '%s' "$token" > "$work/raw"
printf '%s\n' "$token" > "$work/lf"
reject() {
  if "$@" > "$work/out" 2> "$work/err"; then echo 'expected rejection' >&2; exit 1; fi
  [[ ! -s "$work/out" ]]
  ! grep -q "$token" "$work/err"
}
for name in HAYSTACK_TOKEN MANURE_TOKEN; do
  [[ "$(bash "$helper" "$name" "$work/raw")" == "$token" ]]
  [[ "$(env "$name=$token" bash "$helper" "$name" /missing)" == "$token" ]]
  [[ "$(env "${name}_FILE=$work/lf" bash "$helper" "$name" /missing)" == "$token" ]]
  [[ "$(env "$name=" "${name}_FILE=" bash "$helper" "$name" "$work/raw")" == "$token" ]]
  reject env "$name=$token" "${name}_FILE=/missing" bash "$helper" "$name" "$work/raw"
  reject bash "$helper" "$name" ''
  reject env "$name=${token%?}B" bash "$helper" "$name" "$work/raw"
  reject env "$name=$token " bash "$helper" "$name" "$work/raw"
  reject env "$name=$token"$'\n' bash "$helper" "$name" "$work/raw"
  env "${name}_FILE=$work/raw" bash "$helper" "$name" '' bash -c '[[ ${!1} == "$2" && ! -v "$1_FILE" ]]' bash "$name" "$token"
  for suffix in crlf double-lf nul embedded; do
    case "$suffix" in
      crlf) printf '%s\r\n' "$token" ;;
      double-lf) printf '%s\n\n' "$token" ;;
      nul) printf '%s\0' "$token" ;;
      embedded) printf '%s\nA' "${token:0:41}" ;;
    esac > "$work/bad"
    reject bash "$helper" "$name" "$work/bad"
  done
  reject env "$name=" "${name}_FILE=$work/bad" bash "$helper" "$name" "$work/raw"
done
echo 'runtime-token tests passed'
