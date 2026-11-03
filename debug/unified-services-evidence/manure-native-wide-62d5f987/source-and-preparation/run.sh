#!/usr/bin/env bash
# Preparation-only until explicitly BG-launched by parent. No full335 substitute.
set -euo pipefail
readonly work=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62
readonly frozen=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-full-validation/debug/manure-full-frozen-fixture
readonly probe=/nix/store/rpgyw9j2diprbjbchpsp1qs2zwqdba6d-probe.py
readonly report=/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-port/debug/manure-native-wide-probe/result
cd "$work"
test "$(git rev-parse HEAD)" = 62d5f9877d9df9ae2d059c5cec5facff09b182b5
test -z "$(git status --porcelain)"
test ! -e "$report"
mkdir "$report"
finish() { rc=$?;trap - EXIT;printf '%s\n' "$rc" > "$report/runner-exit-status";date -u +%FT%TZ > "$report/runner-ended-at";exit "$rc"; }
trap finish EXIT
date -u +%FT%TZ > "$report/started-at"
git ls-files -z | xargs -0 sha256sum > "$report/source-before.sha256"
sha256sum /nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/libexec/manure-server /nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/share/manure/compiled-inputs.sha256 "$probe" "$frozen/provider-env.json" "$frozen/with-owned-postgres.py" "$frozen/provision-owned-database.py" "$frozen/provider.py" > "$report/inputs.sha256"
printf '#!/usr/bin/env bash\nexec python3 -B %q "$@"\n' "$frozen/provision-owned-database.py" > "$report/provision"
chmod 700 "$report/provision"
set +e
# Probe body has its own180s signal deadline, HTTP/ready/SQL/helper bounds and
# unconditional owned child/DB/temp cleanup. Provider wrapper has its own finite
# lifecycle; parent outer BG deadline should allow init+cleanup (>=1000 seconds).
nix develop .#chronicle --command python3 -B - "$report" "$probe" "$frozen" <<'PY' > "$report/run.log" 2>&1
import json,os,pathlib,subprocess,sys
report,probe,frozen=map(pathlib.Path,sys.argv[1:])
value=json.loads((frozen/'provider-env.json').read_text())
assert set(value)=={'PG_BIN','PG_CONFIGURATION','PG_HBA','PG_POLICY','PG_PROVIDER'}
assert all(isinstance(v,str) and v.startswith('/') and '\0' not in v and '\n' not in v for v in value.values())
assert value['PG_PROVIDER']==str(frozen/'provider.py')
# Retain only pinned tooling and explicit owned-provider inputs, never ambient
# endpoints, credentials, PG defaults, Python hooks or proxy/Node injection.
env={k:os.environ[k] for k in ('PATH','JAVA_HOME','POSTGRES_HOME') if k in os.environ}
env.update(value)
source=pathlib.Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62')
home=report/'runtime-home';home.mkdir(mode=0o700)
env.update(HOME=str(home),TMPDIR=str(home),LANG='C.UTF-8',LC_ALL='C.UTF-8',TZ='UTC',PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',PYTHONPATH=str(source/'manure')+os.pathsep+str(source/'manure/tests'),MANURE_TEST_PG_BIN=value['PG_BIN'],PONYGIRLS_TEST_PROVISION_SERVICE='manure',MANURE_TEST_PROVISION_COMMAND=str(report/'provision'),MANURE_TEST_SERVER_COMMAND_JSON=json.dumps(['/nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/libexec/manure-server']))
# No credentials are logged; wrapper creates ONLY its own marked local cluster.
result=subprocess.run([sys.executable,'-B',str(frozen/'with-owned-postgres.py'),sys.executable,'-B',str(probe),str(report)],env=env)
raise SystemExit(result.returncode)
PY
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
assert s['source']=='62d5f9877d9df9ae2d059c5cec5facff09b182b5' and s['compiledInputManifestSha256']=='1ed47d780d8a78f14eaad4e75c3e57c841604bb04180a8aaecdaec4c58feb3a1',s
print('Focused ACTUAL native accepted4096-manager domain checks12PASS; not full335/global acceptance.')
PY
fi
exit "$status"
