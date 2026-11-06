# Behavioral-Active / Blackbox-Atomic; specified source-layout/cache contract.
{ pkgs }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  selected = source: path: type: source.filter "${toString source.origSrc}/${path}" type;
  server = sources.server;
  tests = sources.backendTests;
  protocol = sources.protocol;
  manureInventory = builtins.fromJSON (builtins.readFile ../../manure/tests/current-test-inventory.json);
  manureWitnesses = pkgs.lib.concatMap (group: group.sourceRefs ++ group.targetRefs) manureInventory.invariantGroups;
in
assert selected server "build.sbt" "regular";
assert selected server "project/plugins.sbt" "regular";
assert selected server "deps.lock.json" "regular";
assert selected server "chronicle/generated/scala/chronicle/api" "directory";
assert selected server "chronicle/server/src/main/resources/META-INF/native-image/chronicle" "directory";
assert selected server "shared/lossless-json/src/main/scala/example.scala" "regular";
assert !(selected server "shared/lossless-json/src/test/scala/example.scala" "regular");
assert !(selected server "manure/server/src/main/scala/example.scala" "regular");
assert !(selected server "manure/web/example.ts" "regular");
assert !(selected server "chronicle/web/package.json" "regular");
assert !(selected server "chronicle/server/src/test/scala/example.scala" "regular");
assert !(selected server "chronicle/target/chronicle-server.jar" "regular");
assert !(selected server ".worktrees" "directory");
assert selected tests "chronicle/scripts/validation-report.py" "regular";
assert selected tests "chronicle/scripts/fast-suites.txt" "regular";
assert !(selected tests "scripts/fast-suites.txt" "regular");
assert selected tests "scripts/backend-sbt.sh" "regular";
assert selected tests "chronicle/server/src/test/fixtures/client.json" "regular";
assert selected sources.foundation "manure/server/src/test/scala/example.scala" "regular";
assert !(selected sources.foundation "chronicle/server/src/main/scala/example.scala" "regular");
assert !(selected sources.foundation "manure/web/example.ts" "regular");
assert selected sources.backendDevelopment "manure/server/src/test/scala/example.scala" "regular";
assert selected sources.manurePosix "manure/server/src/main/c/posix_native.c" "regular";
assert selected sources.manurePosix "manure/server/src/main/java/manure/storage/PosixNative.java" "regular";
assert selected sources.manurePosix "manure/server/src/main/java/manure/storage/NativeFailure.java" "regular";
assert !(selected server "manure/server/src/main/c/posix_native.c" "regular");
assert !(selected server "manure/server/src/main/java/manure/storage/PosixNative.java" "regular");
assert !(selected tests "manure/server/src/main/c/posix_native.c" "regular");
assert selected sources.manureAcceptance "manure/server/native-image/PosixLinkFeature.java" "regular";
assert selected sources.manureAcceptance "scripts/manure-native-image.sh" "regular";
assert pkgs.lib.all (ref: selected sources.manureTargetTests ref.path "regular") manureWitnesses;
assert selected sources.manureTargetTests "manure/tests/portable_root_probe.py" "regular";
assert !(selected sources.manureTargetTests "shared/retrieval-postgres/src/test/scala/unrelated.scala" "regular");
assert !(selected sources.manureServer "shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/AuthorizedCandidateTest.scala" "regular");
assert !(selected sources.manurePosix "manure/server/src/main/scala/example.scala" "regular");
assert selected sources.manureDirectJni "manure/server/native-tests/NativeSelfTest.java" "regular";
assert selected sources.manureDirectJni "manure/server/src/main/c/posix_native.c" "regular";
assert selected sources.manureDirectJni "manure/server/src/main/java/manure/storage/PosixNative.java" "regular";
assert !(selected sources.manureDirectJni "manure/server/native-tests/verification/jvm-strict.log" "regular");
assert !(selected sources.manureDirectJni "manure/server/native-tests/run.sh" "regular");
assert !(selected sources.manureAcceptance "manure/server/native-tests/NativeSelfTest.java" "regular");
assert !(selected sources.manureAcceptance "scripts/manure-acceptance-report.py" "regular");
# Protocol remains rooted at Chronicle: TypeScript and fixture-script relative
# paths must not silently move with the JVM build.
assert selected protocol "generated/typescript/chronicle/api/index.ts" "regular";
assert selected protocol "web/package-lock.json" "regular";
assert selected protocol "server/src/test/fixtures/client.json" "regular";
assert !(selected protocol "build.sbt" "regular");
pkgs.runCommand "backend-source-layout-test" {
  serverSource = server;
  testSource = tests;
  protocolSource = protocol;
  haystackSource = sources.haystackServer;
  manureSource = sources.manureServer;
  manureTargetSource = sources.manureTargetTests;
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  # Real source existence belongs to the builder. Pure no-build evaluation must
  # not dereference lazily realized filtered-store paths via builtins.pathExists.
  test -f "$serverSource/build.sbt"
  test -d "$serverSource/chronicle/server/src/main/resources/META-INF/native-image/chronicle"
  test -f "$testSource/chronicle/scripts/test-fast.sh"
  test -f "$testSource/chronicle/scripts/fast-suites.txt"
  test ! -e "$testSource/scripts/fast-suites.txt"
  test -f "$protocolSource/scripts/codec-fixtures.mjs"
  for source in "$serverSource" "$haystackSource" "$manureSource"; do
    for shared in baboon-runtime service-runtime model-http retrieval-core retrieval-postgres; do
      test -d "$source/shared/$shared/src/main"
    done
    test ! -e "$source/haystack/web"
    test ! -e "$source/manure/web"
    test ! -e "$source/chronicle/web"
  done
  test -d "$haystackSource/haystack/migrations"
  test -f "$manureSource/manure/migration/schema.sql"
  test -f "$manureSource/manure/server/native-image/PosixLinkFeature.java"
  test -f "$manureTargetSource/manure/tests/portable_root_probe.py"
  python3 - "$manureTargetSource" <<'PY'
  import json,pathlib,sys
  root=pathlib.Path(sys.argv[1])
  registry=json.loads((root/'manure/tests/current-test-inventory.json').read_text())
  for group in registry['invariantGroups']:
      for kind in ('sourceRefs','targetRefs'):
          for reference in group[kind]:
              assert (root/reference['path']).is_file(), reference['path']
  PY
  touch "$out"
''
