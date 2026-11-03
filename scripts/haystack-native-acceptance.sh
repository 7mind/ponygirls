#!/usr/bin/env bash
# Shared Nix-owned harness. It NEVER starts/adopts a cluster itself: invoke via
# service-test-fixture-tools/bin/with-service-postgres. No admin fallback.
set -euo pipefail
mode=${1:?core or browser}; artifact=${2:?actual native ELF}; manifest=${3:?actual compiled input manifest}; report=${4:?fresh absolute report}; proxy=${5:-}
[[ $mode == core || $mode == browser ]]
[[ $artifact = /* && -x $artifact && $manifest = /* && -f $manifest && $report = /* ]]
[[ $artifact != *[!a-zA-Z0-9_./+-]* ]]
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?use the owned fixture wrapper}"
: "${HAYSTACK_TEST_PROVISION_COMMAND:?strict paired helper required}"
[[ -x $HAYSTACK_TEST_PROVISION_COMMAND && $(<"$PONYGIRLS_OWNED_FIXTURE_ROOT/.owned-test-only") == ponygirls-owned-test-v1 ]]
if [[ -e $report && -n $(ls -A "$report") ]]; then echo 'refusing nonempty report' >&2; exit 2; fi
umask 077
mkdir -p "$report/artifacts"
revision=${HAYSTACK_SOURCE_REVISION:-}
if [[ -e .git ]]; then
  observed=$(git rev-parse HEAD)
  [[ -z $revision || $revision == "$observed" ]]
  revision=$observed
fi
[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo 'frozen source commit identity required' >&2; exit 2; }
python3 - "$artifact" <<'PY'
import sys
with open(sys.argv[1],'rb') as f: assert f.read(4)==b'\x7fELF'
PY
sha256sum -c "$manifest" > "$report/compiled-input-verification.log"
cp "$manifest" "$report/compiled-inputs.sha256"
printf '%s\n' "$revision" > "$report/source-revision"
sha256sum "$artifact" > "$report/artifact-before.sha256"
export HAYSTACK_ARTIFACT_KIND=native HAYSTACK_SERVER_ARTIFACT_FILE="$artifact" HAYSTACK_SERVER_COMMAND="$artifact" HAYSTACK_SOURCE_REVISION="$revision" HAYSTACK_UI_ARTIFACTS="$report/artifacts"
unset HAYSTACK_FIXTURE_ADMIN_AUTHORIZED
record_source() {
  find haystack/server/src/main haystack/server/tests-current haystack/web/src haystack/web/tests haystack/web/tests-browser haystack/generated/scala haystack/generated/typescript haystack/models haystack/migrations shared -type f ! -path '*/target/*' ! -path '*/__pycache__/*' ! -path '*/.build/*' -print0 | sort -z | xargs -0 sha256sum
  sha256sum build.sbt deps.lock.json lockfile-config.json haystack/quick-ui.sh haystack/package-lock.json haystack/web/package.json haystack/scripts/register-generated.mjs "$0" "$HAYSTACK_TEST_PROVISION_COMMAND" "$PG_PROVIDER"
}
record_source > "$report/source-before.sha256"
set +e
if [[ $mode == core ]]; then
  cp haystack/server/tests-current/inventory.json "$report/inventory.json"
  (cd haystack && timeout --signal=TERM --kill-after=10s 240s node --import ./scripts/register-generated.mjs --test --test-timeout=60000 --test-concurrency=1 --test-reporter=tap --test-reporter-destination="$report/transport.tap" --test-reporter=junit --test-reporter-destination="$report/transport.xml" server/tests-current/*.test.mjs) > "$report/run.log" 2>&1
  status=$?
  statuses=$status
else
  [[ $proxy = /* && -f $proxy ]] || { echo 'actual evaluated proxy JSON required' >&2; exit 2; }
  export HAYSTACK_PROXY_CONFIG_FILE="$proxy"
  sha256sum "$proxy" > "$report/proxy-before.sha256"
  cp haystack/web/tests-browser/inventory.json "$report/inventory.json"
  (
    cd haystack/web
    node --import ../scripts/register-generated.mjs --test --test-concurrency=1 --test-reporter=tap --test-reporter-destination="$report/atomic.tap" --test-reporter=junit --test-reporter-destination="$report/atomic.xml" tests/*.test.ts tests/*.test.mjs
  ) > "$report/atomic-runner.log" 2>&1
  atomic=$?
  (cd haystack/web && node tests-browser/browse-markup.mjs) > "$report/markup.log" 2>&1
  markup=$?
  (cd haystack/web && npm run test:browser) > "$report/browser.log" 2>&1
  browser=$?
  statuses="$atomic $markup $browser"
  status=0
  if (( atomic || markup || browser )); then status=1; fi
  sha256sum "$proxy" > "$report/proxy-after.sha256"
  cmp "$report/proxy-before.sha256" "$report/proxy-after.sha256" || status=1
fi
set -e
printf '%s\n' "$statuses" > "$report/exit-statuses"
record_source > "$report/source-after.sha256"
cmp "$report/source-before.sha256" "$report/source-after.sha256"
sha256sum "$artifact" > "$report/artifact-after.sha256"
cmp "$report/artifact-before.sha256" "$report/artifact-after.sha256"
python3 - "$mode" "$report" "$status" <<'PY'
import hashlib,json,pathlib,sys,xml.etree.ElementTree as ET
mode,where,status=sys.argv[1:];root=pathlib.Path(where);inventory=json.loads((root/'inventory.json').read_text())
cases=list(ET.parse(root/('transport.xml' if mode=='core' else 'atomic.xml')).iter('testcase'))
names=[c.attrib['name'] for c in cases]
expected=inventory if mode=='core' else inventory['atomicLeafCases']
assert expected and sorted(names)==sorted(expected), 'case inventory mismatch'
failures=sum(len(c.findall('failure'))+len(c.findall('error')) for c in cases)
skips=sum(len(c.findall('skipped')) for c in cases)
receipt={'artifactKind':'native','mode':mode,'cases':len(cases),'failuresAndErrors':failures,'skips':skips,'inventoryExact':True,'sourceAndArtifactUnchanged':True,'exitStatuses':list(map(int,(root/'exit-statuses').read_text().split()))}
receipt.update(artifactSha256=(root/'artifact-before.sha256').read_text().split()[0],compiledInputManifestSha256=hashlib.sha256((root/'compiled-inputs.sha256').read_bytes()).hexdigest(),sourceManifestSha256=hashlib.sha256((root/'source-before.sha256').read_bytes()).hexdigest(),sourceRevision=(root/'source-revision').read_text().strip(),inventorySha256=hashlib.sha256((root/'inventory.json').read_bytes()).hexdigest())
if mode=='browser':
    import os
    declaration=json.loads(pathlib.Path(os.environ['HAYSTACK_PROXY_CONFIG_FILE']).read_text())
    assets=pathlib.Path(declaration['root']);receipt['installedAssets']={str(p.relative_to(assets)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(assets.rglob('*')) if p.is_file()}
    assert 'index.html' in receipt['installedAssets'] and len(receipt['installedAssets'])>=3
    receipt['proxyJsonSha256']=(root/'proxy-before.sha256').read_text().split()[0]
    browser=(root/'browser.log').read_text();actual=[l.removeprefix('ok - ') for l in browser.splitlines() if l.startswith('ok - ')]
    markup=[l.removeprefix('ok - ') for l in (root/'markup.log').read_text().splitlines() if l.startswith('ok - ')]
    assert actual and sorted(actual)==sorted(inventory['browserCases'])
    assert markup==inventory['markupCases'] and '# SKIP' not in browser and '# 34 checks; 0 failures; 0 skipped' in browser
    receipt.update(browserCases=len(actual),markupCases=len(markup))
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert cases and failures==skips==0 and all(s==0 for s in receipt['exitStatuses']) and status=='0',receipt
print(json.dumps(receipt,sort_keys=True))
PY
exit "$status"
