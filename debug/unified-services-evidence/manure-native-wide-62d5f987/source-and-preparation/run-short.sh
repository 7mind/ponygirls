#!/usr/bin/env bash
# Preparation-only until explicitly BG-launched by parent. No full335 substitute.
set -euo pipefail
readonly work=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62
readonly frozen=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-full-validation/debug/manure-full-frozen-fixture
readonly probe=/nix/store/rpgyw9j2diprbjbchpsp1qs2zwqdba6d-probe.py
readonly report=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-port/debug/manure-native-wide-probe/result-short
readonly bootstrap=/nix/store/ifwl7l3gmgz1h235jspmh9hahq5aa6s4-launch-short.py
cd "$work"
test "$(git rev-parse HEAD)" = 62d5f9877d9df9ae2d059c5cec5facff09b182b5
test -z "$(git status --porcelain)"
test ! -e "$report"
mkdir "$report"
finish() { rc=$?;trap - EXIT;printf '%s\n' "$rc" > "$report/runner-exit-status";date -u +%FT%TZ > "$report/runner-ended-at";exit "$rc"; }
trap finish EXIT
date -u +%FT%TZ > "$report/started-at"
git ls-files -z | xargs -0 sha256sum > "$report/source-before.sha256"
sha256sum /nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/libexec/manure-server /nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/share/manure/compiled-inputs.sha256 "$probe" "$bootstrap" "$frozen/provider-env.json" "$frozen/with-owned-postgres.py" "$frozen/provision-owned-database.py" "$frozen/provider.py" > "$report/inputs.sha256"
printf '#!/usr/bin/env bash\nexec python3 -B %q "$@"\n' "$frozen/provision-owned-database.py" > "$report/provision"
chmod 700 "$report/provision"
set +e
# Probe body has its own180s signal deadline, HTTP/ready/SQL/helper bounds and
# unconditional owned child/DB/temp cleanup. Provider wrapper has its own finite
# lifecycle; parent outer BG deadline should allow init+cleanup (>=1000 seconds).
nix develop .#chronicle --command python3 -B "$bootstrap" "$report" "$probe" "$frozen" > "$report/run.log" 2>&1
status=$?
set -e
printf '%s\n' "$status" > "$report/command-exit-status"
git ls-files -z | xargs -0 sha256sum > "$report/source-after.sha256"
cmp "$report/source-before.sha256" "$report/source-after.sha256"
sha256sum -c "$report/inputs.sha256" > "$report/input-after-check.log"
test -z "$(git status --porcelain)"
if [ "$status" -eq 0 ]; then
 python3 - "$report/summary.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));assert s['success'] and s['failure'] is None and s['expectedChecks']==s['passedChecks']==12,s
assert len(s['checks'])==12 and all(c['status']=='passed' for c in s['checks']),s
c=json.load(open(sys.argv[1].replace('summary.json','short-root-cleanup.json')));assert c['success'] and c['sameUidProcessInspectionComplete'] and c['anchoredLiveProcessCount']==0 and c['signalsSent']==0,c
assert s['source']=='62d5f9877d9df9ae2d059c5cec5facff09b182b5' and s['compiledInputManifestSha256']=='1ed47d780d8a78f14eaad4e75c3e57c841604bb04180a8aaecdaec4c58feb3a1',s
print('Focused ACTUAL native accepted4096-manager domain checks12PASS; not full335/global acceptance.')
PY
fi
exit "$status"
