{ runCommand, callPackage, python3, coreutils }:
let
  source = (callPackage ../chronicle/source.nix { }).manureDirectJni;
  tools = callPackage ../chronicle/toolchain.nix { };
  bridge = (callPackage ./posix.nix { }).shared;
in runCommand "manure-production-shared-direct-jni-validation" {
  nativeBuildInputs = [ tools.graal python3 coreutils ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  passthru = { directJniSource = source; posixLibrary = bridge; };
} ''
  cp -r ${source} source
  chmod -R u+w source
  cd source
  mkdir -p classes generated "$out"
  ${tools.graal}/bin/javac -Xlint:all -Werror -h generated -d classes \
    manure/server/src/main/java/manure/storage/NativeFailure.java \
    manure/server/src/main/java/manure/storage/PosixNative.java \
    manure/server/native-tests/NativeSelfTest.java
  cmp generated/manure_storage_PosixNative.h manure/server/src/main/c/manure_storage_PosixNative.h
  # Run against the actual GCC16 Nix production .so, not a test recompilation.
  timeout 90 ${tools.graal}/bin/java --enable-native-access=ALL-UNNAMED -Xcheck:jni \
    -cp classes manure.storage.NativeSelfTest --shared ${bridge}/lib/libmanure_posix.so \
    > "$out/jni.log" 2> "$out/jni.stderr" || { cat "$out/jni.log" "$out/jni.stderr"; exit 1; }
  cat "$out/jni.log" "$out/jni.stderr"
  python3 - "$out" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys
out = Path(sys.argv[1])
lines = out.joinpath('jni.log').read_text().splitlines()
optional = re.compile(r'SKIP optional owned device fixture unavailable: mknod exit status ([1-9][0-9]*)')
passes = [re.fullmatch(r'PASS NativeSelfTest assertions=([0-9]+)', line) for line in lines]
passes = [match for match in passes if match]
skips = [optional.fullmatch(line) for line in lines if optional.fullmatch(line)]
if len(passes) != 1 or len(skips) > 1 or any(not optional.fullmatch(line) and
        not re.fullmatch(r'PASS NativeSelfTest assertions=([0-9]+)', line) for line in lines):
    raise SystemExit('unexpected, failed or ambiguous direct JNI output')
assertions = int(passes[0][1])
# The optional owned mknod case adds two errno/label/message checks (six assertions).
if assertions != (1257 if skips else 1263):
    raise SystemExit('direct JNI assertion inventory changed; review the required boundary contract')
stderr = out.joinpath('jni.stderr').read_text().splitlines()
if stderr and (not skips or any(not line.startswith('mknod: ') for line in stderr)):
    raise SystemExit('unexpected direct JNI stderr; only supplemental mknod diagnostics are allowed')
library = Path('${bridge}/lib/libmanure_posix.so')
receipt = {'schemaVersion': 1, 'status': 'passed', 'scope': 'production-shared-direct-jni-boundary',
           'directJniSource': '${source}', 'toolchain': '${tools.graal}', 'assertions': assertions,
           'requiredAssertions': 1257, 'requiredSkipped': 0, 'failed': 0,
           'supplementalOwnedDeviceNode': {
               'status': 'skipped-fixture-command-nonzero' if skips else 'passed',
               'mknodExitStatus': int(skips[0][1]) if skips else 0,
               'stderr': stderr},
           'library': {'path': str(library), 'sha256': hashlib.sha256(library.read_bytes()).hexdigest()},
           'runtimeStderrSha256': hashlib.sha256(out.joinpath('jni.stderr').read_bytes()).hexdigest(),
           'runtimeLogSha256': hashlib.sha256(out.joinpath('jni.log').read_bytes()).hexdigest(),
           'claimsStaticNativeAcceptance': False, 'claimsCompleteServer': False}
out.joinpath('direct-jni.json').write_text(json.dumps(receipt, indent=2) + '\n')
PY
''
