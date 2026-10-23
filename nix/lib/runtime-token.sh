#!/usr/bin/env bash
# Runtime-only credential resolution. Arguments contain names/paths, never secrets.
set -euo pipefail
export LC_ALL=C
name="$1"
default_file="$2"
shift 2
if [[ ! "$name" =~ ^[A-Z_][A-Z0-9_]*_TOKEN$ ]]; then
  echo 'runtime-token: invalid token variable name' >&2
  exit 3
fi
file_name="${name}_FILE"
token="${!name:-}"
file="${!file_name:-}"
reject() { echo "runtime-token: $name: $1" >&2; exit 3; }
if [[ -n "$token" && -n "$file" ]]; then
  echo "runtime-token: $name: ambiguous-credentials: both $name and $file_name are nonempty" >&2
  exit 2
fi
if [[ -z "$token" ]]; then
  file="${file:-$default_file}"
  [[ -n "$file" ]] || reject 'missing credential'
  [[ -f "$file" && -r "$file" ]] || reject 'token file not readable'
  size="$(wc -c < "$file" | tr -d '[:space:]')"
  [[ "$size" == 43 || "$size" == 44 ]] || reject 'token file must contain 43 bytes with at most one final LF'
  content="$(cat -- "$file"; printf x)"
  content="${content%x}"
  [[ "${#content}" == "$size" ]] || reject 'invalid token file bytes'
  if [[ "$size" == 44 ]]; then
    [[ "${content: -1}" == $'\n' ]] || reject 'token file must end with LF'
    content="${content%$'\n'}"
  fi
  token="$content"
fi
# A 32-byte base64url token has two zero padding bits in its last sextet.
[[ "$token" =~ ^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$ ]] || reject 'token must be canonical unpadded base64url for 32 bytes'
if [[ $# == 0 ]]; then
  printf '%s\n' "$token"
else
  export "$name=$token"
  unset "$file_name"
  exec "$@"
fi
