#!/usr/bin/env bash
# Haystack browser legs against the native ELF, packaged assets and the evaluated
# NixOS proxy. It NEVER starts/adopts a cluster itself: invoke via
# service-test-fixture-tools/bin/with-service-postgres. No admin fallback.
# Fails on any failing leg, a skip, or a run without a passing check.
set -euo pipefail
artifact=${1:?actual native ELF}; report=${2:?fresh absolute report}; proxy=${3:?actual evaluated proxy JSON}
[[ $artifact = /* && -x $artifact && $report = /* && $proxy = /* && -f $proxy ]]
[[ $artifact != *[!a-zA-Z0-9_./+-]* ]]
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?use the owned fixture wrapper}"
: "${HAYSTACK_TEST_PROVISION_COMMAND:?strict paired helper required}"
[[ -x $HAYSTACK_TEST_PROVISION_COMMAND && $(<"$PONYGIRLS_OWNED_FIXTURE_ROOT/.owned-test-only") == ponygirls-owned-test-v1 ]]
if [[ -e $report && -n $(ls -A "$report") ]]; then echo 'refusing nonempty report' >&2; exit 2; fi
umask 077
mkdir -p "$report/artifacts"
export HAYSTACK_SERVER_COMMAND="$artifact" HAYSTACK_UI_ARTIFACTS="$report/artifacts" HAYSTACK_PROXY_CONFIG_FILE="$proxy"
unset HAYSTACK_FIXTURE_ADMIN_AUTHORIZED
status=0
(cd haystack/web && npm run test:browser) > "$report/browser.log" 2>&1 || status=$?
if grep -q '# SKIP' "$report/browser.log" || ! grep -q '^ok - ' "$report/browser.log"; then
  echo 'browser legs skipped a check or passed none' >&2; status=1
fi
exit "$status"
