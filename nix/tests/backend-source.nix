# Behavioral-Active / Blackbox-Atomic; source-set invariants that keep check and
# package identities from including outputs, secrets or unrelated sources.
{ pkgs }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  selected = source: path: type: source.filter "${toString source.origSrc}/${path}" type;
  server = sources.server;
  tests = sources.backendTests;
  protocol = sources.protocol;
in
# Runtime sources exclude tests, build outputs, sbt meta-build output and local state.
assert selected server "project/BuildChecks.scala" "regular";
assert !(selected server "project/project" "directory");
assert !(selected server "chronicle/server/src/test/scala/example.scala" "regular");
assert !(selected server "shared/lossless-json/src/test/scala/example.scala" "regular");
assert !(selected server "chronicle/target/chronicle-server.jar" "regular");
assert !(selected server "chronicle/web/package.json" "regular");
assert !(selected server ".worktrees" "directory");
assert !(selected sources.ontologyServer ".local/secret" "regular");
assert !(selected sources.manureServer "shared/retrieval-postgres/src/test/scala/ponygirls/retrieval/postgres/AuthorizedCandidateTest.scala" "regular");
assert !(selected sources.backendDevelopment "ontology/generated/.build/target/classes/ontology/api/Ref.class" "regular");
# The fast-suite list stays Chronicle-relative inside the repository-root test source.
assert selected tests "chronicle/scripts/fast-suites.txt" "regular";
# Protocol remains rooted at Chronicle: TypeScript and fixture-script relative
# paths must not silently move with the JVM build.
assert selected protocol "generated/typescript/chronicle/api/index.ts" "regular";
assert !(selected protocol "build.sbt" "regular");
# Check sources exclude inputs their check does not read.
assert !(selected sources.web "web/tests-browser/ux.mjs" "regular");
assert !(selected sources.web "server/src/main/scala/chronicle/Http.scala" "regular");
assert !(selected sources.haystackTests "haystack/server/src/test/scala/haystack/Example.scala" "regular");
assert !(selected sources.manureJvmTests "manure/web/dashboard/app.js" "regular");
assert !(selected sources.manureTargetTests "manure/docs/query.md" "regular");
pkgs.runCommand "backend-source-layout-test" {
  serverSource = server;
  testSource = tests;
  webSource = sources.web;
  webBrowserTestSource = sources.webBrowserTests;
  haystackTestSource = sources.haystackTests;
  manureJvmTestSource = sources.manureJvmTests;
  manureTargetTestSource = sources.manureTargetTests;
} ''
  # Real source existence belongs to the builder. Pure no-build evaluation must
  # not dereference lazily realized filtered-store paths via builtins.pathExists.
  test -f "$serverSource/project/plugins.sbt"
  test ! -e "$serverSource/project/project"
  test -d "$serverSource/chronicle/server/src/main/resources/META-INF/native-image/chronicle"
  test -f "$testSource/chronicle/scripts/fast-suites.txt"
  test -f "$webSource/web/tests-browser/harness.tsx"
  test ! -e "$webSource/web/tests-browser/run.mjs"
  test -f "$webBrowserTestSource/web/tests-browser/run.mjs"
  test -f "$webBrowserTestSource/server/src/main/scala/chronicle/Http.scala"
  test -d "$haystackTestSource/haystack/server/tests-current"
  test ! -e "$haystackTestSource/haystack/server/src"
  test -f "$manureJvmTestSource/manure/web/dashboard/favicon.svg"
  test -f "$manureJvmTestSource/manure/web/dashboard/current/manure/api/index.js"
  test -f "$manureJvmTestSource/manure/web/viewer/index.html"
  test -f "$manureJvmTestSource/manure/models/fixtures/results.json"
  test ! -e "$manureJvmTestSource/manure/tests"
  test -f "$manureTargetTestSource/manure/tests/target_server.py"
  test ! -e "$manureTargetTestSource/manure/docs/current-api.md"
  test ! -e "$manureTargetTestSource/manure/README.md"
  touch "$out"
''
