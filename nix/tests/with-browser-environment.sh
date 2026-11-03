#!/usr/bin/env bash
# HOME lifetime is exactly the enclosing owned fixture, including host runs.
# Never use the builder's /homeless-shelter or the operator's real browser state.
set -euo pipefail
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?browser environment requires the owned provider wrapper}"
[[ -d $PONYGIRLS_OWNED_FIXTURE_ROOT && ! -L $PONYGIRLS_OWNED_FIXTURE_ROOT && $(<"$PONYGIRLS_OWNED_FIXTURE_ROOT/.owned-test-only") == ponygirls-owned-test-v1 ]]
umask 077
export HOME="$PONYGIRLS_OWNED_FIXTURE_ROOT/browser-home"
export XDG_CONFIG_HOME="$HOME/config" XDG_CACHE_HOME="$HOME/cache" XDG_RUNTIME_DIR="$HOME/runtime" XDG_DATA_HOME="$HOME/data"
for directory in "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME"; do
  [[ ! -L $directory ]]
  install -d -m 0700 "$directory"
done
exec "$@"
