{ lib }:
let
  root = ../../../chronicle;
  excluded = [ "target" "node_modules" "dist" ".cache" ".local" ".bsp" ".metals" "test-results" "playwright-report" "artifacts" "__pycache__" ];
  clean = path: type: lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) excluded);
  source = name: entries: lib.cleanSourceWith {
    inherit name;
    src = root;
    filter = path: type:
      let
        relative = lib.removePrefix "${toString root}/" (toString path);
        selected = entry: relative == entry || lib.hasPrefix "${entry}/" relative
          || (type == "directory" && lib.hasPrefix "${relative}/" entry);
      in clean path type && (toString path == toString root || lib.any selected entries);
  };
  runtime = [ "build.sbt" "deps.lock.json" "project" "generated/scala" "server/src/main" "migrations" ];
in {
  server = source "chronicle-server-source" runtime;
  backendTests = source "chronicle-backend-tests-source" (runtime ++ [ "server/src/test" "tests" "models" "config.example.json" "scripts" ]);
  protocol = source "chronicle-protocol-source" [ "package.json" "generated/typescript" "protocol/typescript" "models" "server/src/test/fixtures" "scripts/codec-fixtures.mjs" "web/package.json" "web/package-lock.json" ];
  web = source "chronicle-web-source" [ "package.json" "web" "generated/typescript" "protocol/typescript" "tests/archive-expression-cases.json" "tests/recorded-yolo-profile-cases.json" "server/src/main/scala/chronicle/Http.scala" ];
  collector = source "chronicle-collector-source" [ "package.json" "collector" "generated/typescript" "protocol/typescript" ];
  documentation = source "chronicle-documentation-source" [ "README.md" "models" "migrations" ];
  development = lib.cleanSourceWith { name = "chronicle-development-source"; src = root; filter = clean; };
}
