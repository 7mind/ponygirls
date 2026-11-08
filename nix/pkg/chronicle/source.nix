{ lib }:
let
  root = ../../..;
  chronicle = ../../../chronicle;
  excluded = [ "target" "node_modules" "dist" ".cache" ".local" ".bsp" ".metals" "test-results" "playwright-report" "artifacts" "__pycache__" ".worktrees" ];
  clean = path: type: lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) excluded);
  sourceAt = base: name: entries: lib.cleanSourceWith {
    inherit name;
    src = base;
    filter = path: type:
      let
        relative = lib.removePrefix "${toString base}/" (toString path);
        selected = entry: relative == entry || lib.hasPrefix "${entry}/" relative
          || (type == "directory" && lib.hasPrefix "${relative}/" entry);
      in clean path type && (toString path == toString base || lib.any selected entries);
  };
  source = sourceAt chronicle;
  backendSource = sourceAt root;
  common = [ "build.sbt" "deps.lock.json" "project" "lockfile-config.json" "scripts/backend-sbt.sh" "rites/generated/scala" ];
  # Shared JVM inputs participate in consumer identities. Never include the full
  # repository: Manure/Haystack UIs, data and unrelated tooling are not inputs.
  shared = [ "shared/lossless-json/src/main" "shared/baboon-runtime/src/main"
    "shared/service-runtime/src/main" "shared/model-http/src/main"
    "shared/retrieval-core/src/main" "shared/retrieval-postgres/src/main" ];
  manure = [ "manure/server/src" "manure/server/native-image" ];
  manureScripts = [ "scripts/manure-native-image.sh" "scripts/manure-probe-classpath.sh" ];
  manureInventory = builtins.fromJSON (builtins.readFile (root + "/manure/tests/current-test-inventory.json"));
  manureWitnesses = lib.unique (lib.concatMap (group: map (ref: ref.path) (group.sourceRefs ++ group.targetRefs)) manureInventory.invariantGroups);
  runtime = common ++ shared ++ [ "chronicle/generated/scala" "chronicle/server/src/main" "chronicle/migrations" ];
  tests = [ "chronicle/server/src/test" "chronicle/tests" "chronicle/models" "chronicle/config.example.json" "chronicle/scripts" ];
in {
  # JVM derivations consume the active repository-root build. Non-JVM sources
  # deliberately retain their existing Chronicle-relative layouts and identities.
  server = backendSource "chronicle-server-source" runtime;
  ritesServer = backendSource "rites-native-source" (common ++ shared ++ [ "rites/models" "rites/server/src/main" "rites/migrations" ]);
  ritesTests = backendSource "rites-tests-source" (common ++ shared ++ [ "rites/server/src" "rites/migrations" "rites/models" "rites/tests" "rites/scripts" "rites/config.example.json" ]);
  haystackServer = backendSource "haystack-native-source" (common ++ shared ++ [ "haystack/generated/scala" "haystack/models" "haystack/server/src/main" "haystack/migrations" ]);
  manureServer = backendSource "manure-native-source" (common ++ shared ++ [ "manure/generated/scala" "manure/models" "manure/migration/schema.sql" "manure/scripts/artifact-source.py" "manure/backend/src/main" "manure/migrations" "manure/server/src/main" "manure/server/native-image" ]);
  haystackTests = backendSource "haystack-native-tests-source" (common ++ shared ++ [ "haystack/generated/scala" "haystack/server/src" "haystack/migrations" "haystack/tests" "haystack/server/tests-current" "haystack/scripts" "haystack/docs/scala-config.example.json" "haystack/generated/typescript" "haystack/package.json" "haystack/package-lock.json" "haystack/web/package.json" "haystack/server/package.json" ]);
  haystackBrowserTests = backendSource "haystack-browser-tests-source" (common ++ shared ++ [ "haystack" ]);
  manureTargetTests = backendSource "manure-target-tests-source" (common ++ shared ++ [ "manure" ] ++ manureWitnesses);
  manureTests = backendSource "manure-native-tests-source" (common ++ shared ++ [ "manure/generated/scala" "manure/backend/src" "manure/migrations" "manure/server/src" "manure/server/native-image" "manure/tests" ]);
  backendTests = backendSource "chronicle-backend-tests-source" (runtime ++ tests);
  manurePosix = backendSource "manure-posix-source" [ "manure/server/src/main/c"
    "manure/server/src/main/java/manure/storage/PosixNative.java"
    "manure/server/src/main/java/manure/storage/NativeFailure.java" ];
  manureDirectJni = backendSource "manure-direct-jni-source" [
    "manure/server/src/main/c/posix_native.c"
    "manure/server/src/main/c/manure_storage_PosixNative.h"
    "manure/server/src/main/java/manure/storage/PosixNative.java"
    "manure/server/src/main/java/manure/storage/NativeFailure.java"
    "manure/server/native-tests/NativeSelfTest.java"
  ];
  manureAcceptance = backendSource "manure-posix-acceptance-source" (common ++ manure ++ manureScripts);
  foundation = backendSource "backend-foundation-source" (common ++ shared ++ [ "shared/lossless-json/src/test" "manure/server/src" "scripts/backend-foundation-report.py" ]);
  backendDevelopment = backendSource "backend-development-source" (runtime ++ tests ++ [ "shared/lossless-json/src/test" "manure/server/src" "rites/server/src" "rites/migrations" "rites/models" "rites/config.example.json" ]);
  protocol = source "chronicle-protocol-source" [ "package.json" "generated/typescript" "models" "server/src/test/fixtures" "scripts/codec-fixtures.mjs" "web/package.json" "web/package-lock.json" ];
  web = source "chronicle-web-source" [ "package.json" "web" "generated/typescript" "tests/archive-expression-cases.json" "tests/recorded-yolo-profile-cases.json" "server/src/main/scala/chronicle/Http.scala" ];
  collector = source "chronicle-collector-source" [ "package.json" "collector" "generated/typescript" ];
  documentation = source "chronicle-documentation-source" [ "README.md" "models" "migrations" ];
  development = lib.cleanSourceWith { name = "chronicle-development-source"; src = chronicle; filter = clean; };
}
