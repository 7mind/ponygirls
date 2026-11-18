# Full JVM suites as exact-input checks (Tier F): each runs its suite runner on an owned PostgreSQL cluster in the sandbox.
{ pkgs, squishLib }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  suite = pkgs.callPackage ./sbt-suite.nix { inherit squishLib; };
in {
  # Grouped runner: one forked JVM and one cluster per group, group count from NIX_BUILD_CORES.
  chronicle-backend-full = suite {
    name = "chronicle-backend-full";
    source = sources.backendTests;
    nativeBuildInputs = [ ];
    runner = "bash chronicle/scripts/test-postgres.sh";
    reports = [ "chronicle/target/test-reports" ];
  };
  haystack-jvm = suite {
    name = "haystack-jvm";
    source = sources.haystackJvmTests;
    nativeBuildInputs = [ ];
    runner = "bash haystack/scripts/test-postgres-scala.sh";
    reports = [ "haystack/server/target/test-reports" ];
  };
  shared-jvm = suite {
    name = "shared-jvm";
    source = sources.sharedJvmTests;
    nativeBuildInputs = [ ];
    runner = "bash ${./shared-jvm.sh}";
    reports = map (module: "shared/${module}/target/test-reports")
      [ "lossless-json" "service-runtime" "service-auth" "model-http" "retrieval-core" "retrieval-postgres" ];
  };
}
