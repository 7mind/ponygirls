{ lib, pkgs, callPackage, squishLib }:
let
  tools = callPackage ./toolchain.nix { };
  dependencies = squishLib.mkCoursierCache { inherit pkgs; lockfilePath = ../../../chronicle/deps.lock.json; };
  repositories = pkgs.writeText "chronicle-sbt-offline-repositories" ''
    [repositories]
    maven-offline: file://${dependencies}/https/repo.maven.apache.org/maven2/
  '';
  setup = squishLib.mkSbtSetup { inherit pkgs; coursierCache = dependencies; jdk = tools.graal; };
  options = lib.concatStringsSep " " [
    "-Dsbt.supershell=false" "-Dsbt.ci=true" "-Dsbt.server.autostart=false"
    "-Dsbt.override.build.repos=true" "-Dsbt.repository.config=${repositories}"
    "-Dsbt.boot.directory=$SBT_CACHE/boot" "-Dsbt.global.base=$SBT_CACHE/global"
    "-Dsbt.ivy.home=$SBT_CACHE/ivy" "-Dcoursier.cache=$COURSIER_CACHE"
  ];
in {
  inherit tools dependencies;
  setup = ''
    ${setup.setupScript}
    export JAVA_HOME=${tools.graal}
    export SBT_CACHE="$HOME/.sbt"
    export SBT_JAVA_OPTS="$SBT_OPTS ${options}"
    export SBT_LAUNCH_JAR=${tools.launcher}
  '';
  assemble = ''
    read -r -a sbtJavaOpts <<< "$SBT_JAVA_OPTS"
    java "''${sbtJavaOpts[@]}" -jar ${tools.launcher} assembly
  '';
}
