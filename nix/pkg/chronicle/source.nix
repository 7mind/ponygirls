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
  common = [ "build.sbt" "deps.lock.json" "project" "lockfile-config.json" "scripts/backend-sbt.sh" ];
  # Shared JVM inputs participate in consumer identities. Never include the full
  # repository: Manure/Haystack UIs, data and unrelated tooling are not inputs.
  shared = [ "shared/lossless-json/src/main" ];
  runtime = common ++ shared ++ [ "chronicle/generated/scala" "chronicle/server/src/main" "chronicle/migrations" ];
  tests = [ "chronicle/server/src/test" "chronicle/tests" "chronicle/models" "chronicle/config.example.json" "chronicle/scripts" ];
in {
  # JVM derivations consume the active repository-root build. Non-JVM sources
  # deliberately retain their existing Chronicle-relative layouts and identities.
  server = backendSource "chronicle-server-source" runtime;
  backendTests = backendSource "chronicle-backend-tests-source" (runtime ++ tests);
  foundation = backendSource "backend-foundation-source" (common ++ shared ++ [ "shared/lossless-json/src/test" "manure/server/src" "scripts/backend-foundation-report.py" ]);
  backendDevelopment = backendSource "backend-development-source" (runtime ++ tests ++ [ "shared/lossless-json/src/test" "manure/server/src" ]);
  protocol = source "chronicle-protocol-source" [ "package.json" "generated/typescript" "models" "server/src/test/fixtures" "scripts/codec-fixtures.mjs" "web/package.json" "web/package-lock.json" ];
  web = source "chronicle-web-source" [ "package.json" "web" "generated/typescript" "tests/archive-expression-cases.json" "tests/recorded-yolo-profile-cases.json" "server/src/main/scala/chronicle/Http.scala" ];
  collector = source "chronicle-collector-source" [ "package.json" "collector" "generated/typescript" ];
  documentation = source "chronicle-documentation-source" [ "README.md" "models" "migrations" ];
  development = lib.cleanSourceWith { name = "chronicle-development-source"; src = chronicle; filter = clean; };
}
