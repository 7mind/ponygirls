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
        metaBuildOutput = relative == "project/project" || lib.hasPrefix "project/project/" relative;
      in clean path type && !metaBuildOutput && (toString path == toString base || lib.any selected entries);
  };
  source = sourceAt chronicle;
  backendSource = sourceAt root;
  common = [ "build.sbt" "deps.lock.json" "project" "lockfile-config.json" "scripts/backend-sbt.sh" ];
  # Shared JVM inputs participate in consumer identities. Never include the full
  # repository: Manure/Haystack UIs, data and unrelated tooling are not inputs.
  shared = [ "shared/lossless-json/src/main" "shared/baboon-runtime/src/main"
    "shared/service-runtime/src/main" "shared/service-auth/src/main" "shared/model-http/src/main"
    "shared/retrieval-core/src/main" "shared/retrieval-postgres/src/main" ];
  manure = [ "manure/server/src" "manure/server/native-image" ];
  manureScripts = [ "scripts/manure-native-image.sh" "scripts/manure-probe-classpath.sh" ];
  # Web assets the JVM HTTP suites serve from MANURE_SOURCE_ROOT.
  # The shared in-memory imperative-account store, reused by Manure's test dummy (sbt test->test dependency).
  manureSharedTestFixtures = [ "shared/service-auth/src/test/scala/ponygirls/auth/MemoryImperativeUsers.scala" ];
  manureServedAssets = [ "manure/web/dashboard/index.html" "manure/web/dashboard/favicon.svg" "manure/web/dashboard/current"
    "manure/web/unlock" "manure/web/viewer/index.html" "manure/web/viewer/styles.css" ];
  runtime = common ++ shared ++ [ "chronicle/generated/scala" "chronicle/server/src/main" "chronicle/migrations" ];
  webEntries = [ "package.json" "web" "generated/typescript" "tests/archive-expression-cases.json" "tests/recorded-yolo-profile-cases.json" ];
  # The scripts the fast gate and chronicle-backend-full run; not the inner-loop dispatcher chronicle/scripts/test.sh.
  tests = [ "chronicle/server/src/test" "chronicle/tests" "chronicle/models" "chronicle/config.example.json"
    "chronicle/scripts/test-postgres.sh" "chronicle/scripts/test-fast.sh" "chronicle/scripts/fast-suites.txt" "chronicle/scripts/sbt.sh"
    # LegacyFreeCheckTest runs the retained post-deployment check, EpochDownScriptTest the S1 down-script, UploadBoundaryTest the S2 one,
    # StagedGenerationTest the streamed publication's.
    "chronicle/scripts/check-legacy-free.sql" "chronicle/scripts/down-024-epoch-layout.sql" "chronicle/scripts/down-025-uploads.sql"
    "chronicle/scripts/down-026-staged-generations.sql" ];
  sharedModuleTests = [ "shared/lossless-json/src/test"
    "shared/service-runtime/src/test" "shared/service-auth/src/test" "shared/model-http/src/test"
    "shared/retrieval-core/src/test" "shared/retrieval-postgres/src/test" ];
  sharedTests = [ "shared/baboon-runtime/src/test" ] ++ sharedModuleTests;
  ontologyRuntime = [ "ontology/generated/scala" "ontology/generated/wire"
    "ontology/server/src/main" "ontology/migrations" ];
  ontologyTests = [ "ontology/server/src/test" "ontology/models" "ontology/scripts"
    "ontology/generated/typescript" "ontology/generated/schema-input"
    "ontology/web/package.json" "ontology/web/package-lock.json" "ontology/web/tsconfig.json" "ontology/web/tsconfig.fixtures.json"
    "ontology/web/src" "ontology/web/tests" "ontology/web/tests-browser"
    "ontology/worker/src" "ontology/worker/scripts" "ontology/worker/tests"
    "ontology/worker/package.json" "ontology/worker/package-lock.json" "ontology/worker/tsconfig.json" ];
in {
  # JVM derivations consume the active repository-root build. Non-JVM sources
  # deliberately retain their existing Chronicle-relative layouts and identities.
  server = backendSource "chronicle-server-source" runtime;
  ontologyServer = backendSource "ontology-server-source" (common ++ shared ++ ontologyRuntime);
  ontologyTests = backendSource "ontology-tests-source" (common ++ shared ++ sharedTests ++ ontologyRuntime ++ ontologyTests);
  ontologyWorker = sourceAt (root + "/ontology") "ontology-worker-source" [
    "worker" "generated/typescript" "web/src/json.ts" "web/src/wire-validation.ts" "web/src/wire-plan.ts"
  ];
  ontologyWeb = sourceAt (root + "/ontology") "ontology-web-source" [
    "web" "generated/typescript" "generated/schema-input" "generated/wire" "models" "scripts"
  ];
  ritesServer = backendSource "rites-native-source" (common ++ shared ++ [ "rites/generated/scala" "rites/models" "rites/server/src/main" "rites/migrations" ]);
  ritesTests = backendSource "rites-tests-source" (common ++ shared ++ [ "rites/generated/scala" "rites/server/src" "rites/migrations" "rites/models" "rites/tests" "rites/scripts" "rites/config.example.json" ]);
  haystackServer = backendSource "haystack-native-source" (common ++ shared ++ [ "haystack/generated/scala" "haystack/models" "haystack/server/src/main" "haystack/migrations" ]);
  manureServer = backendSource "manure-native-source" (common ++ shared ++ [ "manure/generated/scala" "manure/models" "manure/migration/schema.sql" "manure/backend/src/main" "manure/migrations" "manure/server/src/main" "manure/server/native-image" ]);
  haystackTests = backendSource "haystack-native-tests-source" (common ++ shared ++ [ "haystack/generated/scala" "haystack/migrations" "haystack/tests" "haystack/server/tests-current"
    "haystack/scripts/test-current.sh" "haystack/scripts/register-generated.mjs" "scripts/junit-gate.py"
    "haystack/docs/scala-config.example.json" "haystack/generated/typescript" "haystack/package.json" "haystack/package-lock.json" "haystack/web/package.json" "haystack/server/package.json" ]);
  haystackJvmTests = backendSource "haystack-jvm-tests-source" (common ++ shared ++ [ "haystack/generated/scala"
    "haystack/models" "haystack/server/src" "haystack/migrations" "haystack/scripts/test-postgres-scala.sh" "scripts/junit-gate.py"
    # LegacyFreeCheckTest runs the retained post-deployment check.
    "haystack/scripts/check-legacy-free.sql" ]);
  haystackBrowserTests = backendSource "haystack-browser-tests-source" (common ++ shared ++ [ "haystack" "shared/account-web" "shared/ui-web" ]);
  manureTargetTests = backendSource "manure-target-tests-source" (common ++ shared ++ [
    "manure/tests" "manure/manure" "manure/web" "manure/models" "manure/generated/typescript"
    # The runner, and the launcher and tool pins that test_current_target_harness.py reads.
    "manure/scripts/target-suite.py" "manure/scripts/run-owned-target.sh" "manure/scripts/acceptance-tools-x86_64-linux.json"
    "manure/pyproject.toml" "shared/account-web" "shared/ui-web" ]);
  manureJvmTests = backendSource "manure-jvm-tests-source" (common ++ shared ++ manureSharedTestFixtures ++ manureServedAssets ++ [
    "manure/generated/scala" "manure/backend/src" "manure/server/src" "manure/migration/schema.sql" "manure/models/fixtures"
    # LegacyFreeCheckSuite runs the retained post-deployment check.
    "manure/scripts/check-legacy-free.sql" ]);
  manureTests = backendSource "manure-native-tests-source" (common ++ shared ++ manureSharedTestFixtures ++ [ "manure/generated/scala" "manure/backend/src" "manure/migrations" "manure/server/src" "manure/server/native-image" "manure/tests" ]);
  backendTests = backendSource "chronicle-backend-tests-source" (runtime ++ tests);
  sharedJvmTests = backendSource "shared-jvm-tests-source" (common ++ shared ++ sharedModuleTests ++ [ "scripts/junit-gate.py" ]);
  # The account browser test loads playwright-core from the Chronicle dashboard's locked dependencies.
  accountWebBrowserTests = backendSource "account-web-browser-tests-source" [ "shared/account-web" "shared/ui-web"
    "chronicle/web/package.json" "chronicle/web/package-lock.json" ];
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
  backendDevelopment = backendSource "backend-development-source" (runtime ++ tests ++ sharedTests ++ ontologyRuntime ++ ontologyTests ++ [
    "haystack/generated/scala" "haystack/server/src" "haystack/migrations"
    "manure/generated/scala" "manure/backend/src" "manure/server/src" "manure/migrations"
    "manure/migration/schema.sql" "manure/server/native-image"
    "rites/generated/scala" "rites/server/src" "rites/migrations" "rites/models" "rites/config.example.json"
  ]);
  protocol = source "chronicle-protocol-source" [ "package.json" "generated/typescript" "models" "server/src/test/fixtures" "scripts/codec-fixtures.mjs" "web/package.json" "web/package-lock.json" ];
  # The dashboard typecheck covers the browser harness components (tsconfig
  # includes tests-browser/*.tsx); the browser scenarios are not package inputs.
  web = lib.cleanSourceWith {
    name = "chronicle-web-source";
    src = source "chronicle-web-source-entries" webEntries;
    filter = path: type:
      let relative = lib.removePrefix "${toString chronicle}/" (toString path);
      in type == "directory" || !(lib.hasPrefix "web/tests-browser/" relative) || lib.hasSuffix ".tsx" relative;
  };
  # theme-retry.mjs compares the dashboard CSP with the server's Http.scala.
  webBrowserTests = source "chronicle-web-browser-tests-source" (webEntries ++ [ "server/src/main/scala/chronicle/Http.scala" ]);
  # test_source_observations_v3.py reads Core.scala.
  eval = source "chronicle-eval-source" [ "eval/relevance" "server/src/main/scala/chronicle/Core.scala" ];
  collector = source "chronicle-collector-source" [ "package.json" "collector" "generated/typescript" "tests/message-chain-v1.json" ];
  documentation = source "chronicle-documentation-source" [ "README.md" "models" "migrations" ];
  development = lib.cleanSourceWith { name = "chronicle-development-source"; src = chronicle; filter = clean; };
}
