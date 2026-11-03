#!/usr/bin/env bash
# Foreground entrypoint. Parent supervision owns backgrounding, exit capture and
# polling. Invoke INSIDE the pinned `nix develop .#chronicle` environment.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# -ge 5 ]] || { echo 'usage: run-owned-target.sh /abs/pg-env.json /abs/with-owned-postgres.py /abs/provision-owned-database.py jvm|native ARGS...' >&2; exit 2; }
provider_env=$1; fixture_wrapper=$2; provision_source=$3; shift 3
for source in "$provider_env" "$fixture_wrapper" "$provision_source"; do
 [[ $source = /* && -f $source ]] || { echo 'explicit absolute owned-fixture source required' >&2; exit 2; }
done
base=$(mktemp -d "${TMPDIR:-/tmp}/manure-owned-launch.XXXXXXXX")
trap 'rm -rf "$base"' EXIT
# This is a public provider/toolchain descriptor, NEVER a service credential file.
# Validate before sourcing; no ignored process-substitution failure or shell eval.
python3 - "$provider_env" > "$base/provider.env" <<'PY'
import json,shlex,sys
with open(sys.argv[1]) as source: value=json.load(source)
allowed={'PG_BIN','PG_CONFIGURATION','PG_HBA','PG_POLICY','PG_PROVIDER'}
if not isinstance(value,dict) or set(value)!=allowed or any(not isinstance(v,str) or not v.startswith('/') or '\0' in v or '\n' in v for v in value.values()):
    raise SystemExit('invalid explicit owned provider descriptor')
for key in sorted(value):print('export '+key+'='+shlex.quote(value[key]))
PY
source "$base/provider.env"
# Optional EXPLICIT public tools descriptor; absence never guesses browser/SDK
# locations. Full test-target preflight requires all browser and SDK prerequisites.
if [[ -n ${MANURE_ACCEPTANCE_TOOLS_JSON:-} ]]; then
 [[ $MANURE_ACCEPTANCE_TOOLS_JSON = /* && -f $MANURE_ACCEPTANCE_TOOLS_JSON ]] || exit 2
 python3 - "$MANURE_ACCEPTANCE_TOOLS_JSON" > "$base/tools.env" <<'PY'
import json,shlex,sys
with open(sys.argv[1]) as source: value=json.load(source)
allowed={'MANURE_PLAYWRIGHT_CORE_PATH','MANURE_CHROMIUM_BIN','MANURE_MCP_SDK_PATH','MANURE_OPENSSL_BIN','FONTCONFIG_FILE'}
if not isinstance(value,dict) or set(value)!=allowed or any(not isinstance(v,str) or not v.startswith('/') or '\\0' in v or '\\n' in v for v in value.values()):
    raise SystemExit('invalid explicit public tools descriptor')
for key in sorted(value):print('export '+key+'='+shlex.quote(value[key]))
PY
 source "$base/tools.env"
 sha256sum "$MANURE_ACCEPTANCE_TOOLS_JSON"
fi
printf '#!/usr/bin/env bash\nexec python3 %q "$@"\n' "$provision_source" > "$base/provision"
chmod 700 "$base/provision"
export MANURE_TEST_PROVISION_COMMAND="$base/provision" PONYGIRLS_TEST_PROVISION_SERVICE=manure
# No ambient endpoint/token/client references may reach imports or child clients.
unset MANURE_URL MANURE_URL_FILE MANURE_TOKEN MANURE_TOKEN_FILE MANURE_CACHE_DIR MANURE_ALLOW_INSECURE_HTTP
printf 'Owned fixture launcher observed at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sha256sum "$provider_env" "$fixture_wrapper" "$provision_source"
python3 "$fixture_wrapper" bash manure/scripts/test-target.sh "$@"
