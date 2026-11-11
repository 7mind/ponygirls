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
assert selected sources.ontologyServer "ontology/server/src/main/scala/ontology/Main.scala" "regular";
assert selected sources.ontologyServer "ontology/migrations/006_projection_sessions.sql" "regular";
assert selected sources.ontologyServer "ontology/generated/wire/ontology-wire-schemas.json" "regular";
assert !(selected sources.ontologyServer "ontology/server/src/test/resources/runtime-config.json" "regular");
assert !(selected sources.ontologyServer "ontology/web/package.json" "regular");
assert !(selected sources.ontologyServer "ontology/server/target/ontology-server.jar" "regular");
assert !(selected sources.ontologyServer ".local/secret" "regular");
assert selected sources.ontologyTests "ontology/server/src/test/resources/runtime-config.json" "regular";
assert selected sources.ontologyTests "ontology/generated/schema-input/ontology_api/v0_1_0/openapi.json" "regular";
assert selected sources.ontologyTests "shared/model-http/src/test/scala/ponygirls/retrieval/ResponseAcceptanceTest.scala" "regular";
assert selected sources.backendDevelopment "shared/service-runtime/src/test/scala/Example.scala" "regular";
assert selected sources.backendDevelopment "ontology/server/src/test/scala/ontology/MainSuite.scala" "regular";
assert selected sources.ontologyWeb "web/package-lock.json" "regular";
assert selected sources.ontologyWeb "generated/wire/ontology-wire-plan.json" "regular";
assert selected sources.ontologyWeb "scripts/schema-generate.ts" "regular";
assert !(selected sources.ontologyWeb "web/node_modules" "directory");
assert !(selected sources.ontologyWeb "web/dist" "directory");
assert !(selected sources.ontologyWeb "server/src/main/scala/ontology/Main.scala" "regular");
assert selected sources.ritesServer "rites/generated/scala/rites/api/RunInfo.scala" "regular";
assert selected sources.ritesServer "rites/server/src/main/scala/rites/Main.scala" "regular";
assert !(selected sources.ritesServer "rites/server/src/test/scala/rites/ExampleTest.scala" "regular");
assert !(selected sources.ritesServer "rites/web/app.ts" "regular");
assert !(selected sources.ritesServer "rites/worker/main.ts" "regular");
assert !(selected sources.ritesServer "rites/config.example.json" "regular");
assert !(selected sources.ritesServer "rites/server/target/rites-server.jar" "regular");
assert selected sources.ritesTests "rites/server/src/test/scala/rites/ExampleTest.scala" "regular";
assert !(selected server "rites/generated/scala/rites/api/RunInfo.scala" "regular");
assert selected sources.backendDevelopment "haystack/generated/scala/haystack/api/Item.scala" "regular";
assert selected sources.backendDevelopment "manure/generated/scala/manure/api/VersionInfo.scala" "regular";
assert selected sources.backendDevelopment "haystack/server/src/main/scala/haystack/Main.scala" "regular";
assert selected sources.backendDevelopment "manure/backend/src/main/scala/manure/Main.scala" "regular";
assert selected sources.backendDevelopment "rites/server/src/main/scala/rites/Main.scala" "regular";
assert selected sources.backendDevelopment "rites/server/src/test/scala/rites/ExampleTest.scala" "regular";
assert selected sources.backendDevelopment "ontology/generated/scala/ontology/api/Ref.scala" "regular";
assert !(selected server "ontology/generated/scala/ontology/api/Ref.scala" "regular");
assert !(selected sources.backendDevelopment "ontology/generated/.build/target/classes/ontology/api/Ref.class" "regular");
assert selected server "build.sbt" "regular";
assert selected server "project/plugins.sbt" "regular";
assert selected server "project/BuildChecks.scala" "regular";
assert !(selected server "project/project" "directory");
assert !(selected server "project/project/build-cache.json" "regular");
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
  developmentSource = sources.backendDevelopment;
  ontologySource = sources.ontologyServer;
  ontologyTestSource = sources.ontologyTests;
  ontologyWebSource = sources.ontologyWeb;
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  # Real source existence belongs to the builder. Pure no-build evaluation must
  # not dereference lazily realized filtered-store paths via builtins.pathExists.
  test -f "$ontologySource/ontology/server/src/main/scala/ontology/Main.scala"
  test -f "$ontologySource/ontology/generated/wire/ontology-wire-schemas.json"
  test -f "$ontologySource/ontology/migrations/006_projection_sessions.sql"
  test ! -e "$ontologySource/ontology/server/src/test"
  test ! -e "$ontologySource/ontology/web"
  test -f "$ontologyTestSource/ontology/server/src/test/resources/runtime-config.json"
  test -f "$ontologyTestSource/shared/model-http/src/test/scala/ponygirls/retrieval/ResponseAcceptanceTest.scala"
  test -f "$ontologyWebSource/web/package-lock.json"
  test -f "$ontologyWebSource/generated/wire/ontology-wire-plan.json"
  test -f "$ontologyWebSource/scripts/schema-generate.ts"
  test ! -e "$ontologyWebSource/web/node_modules"
  test ! -e "$ontologyWebSource/web/dist"
  test -f "$developmentSource/ontology/server/src/test/scala/ontology/MainSuite.scala"
  test -f "$serverSource/build.sbt"
  test -f "$serverSource/project/plugins.sbt"
  test ! -e "$serverSource/project/project"
  test -d "$serverSource/chronicle/server/src/main/resources/META-INF/native-image/chronicle"
  test -f "$testSource/chronicle/scripts/test-fast.sh"
  test -f "$testSource/chronicle/scripts/fast-suites.txt"
  test ! -e "$testSource/scripts/fast-suites.txt"
  test -f "$protocolSource/scripts/codec-fixtures.mjs"
  test -f "$developmentSource/haystack/generated/scala/haystack/api/Item.scala"
  test -f "$developmentSource/manure/generated/scala/manure/api/VersionInfo.scala"
  test -f "$developmentSource/rites/generated/scala/rites/api/RunInfo.scala"
  test -f "$developmentSource/ontology/generated/scala/ontology/api/Ref.scala"
  test ! -e "$developmentSource/ontology/generated/.build/target"
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
