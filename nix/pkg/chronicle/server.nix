{ lib, pkgs, stdenv, callPackage, makeWrapper, zlib, findutils, gnused, python3, squishLib }:
let
  tools = callPackage ./toolchain.nix { };
  src = callPackage ./source.nix { };
  web = callPackage ./web.nix { };
  sbtOptions = lib.concatStringsSep " " [
    "-Dsbt.supershell=false" "-Dsbt.ci=true" "-Dsbt.server.autostart=false"
    "-Dsbt.override.build.repos=true" "-Dsbt.repository.config=${offlineRepositories}"
    "-Dsbt.boot.directory=$SBT_CACHE/boot" "-Dsbt.global.base=$SBT_CACHE/global"
    "-Dsbt.ivy.home=$SBT_CACHE/ivy" "-Dcoursier.cache=$COURSIER_CACHE"
  ];
  dependencies = squishLib.mkCoursierCache { inherit pkgs; lockfilePath = ../../../chronicle/deps.lock.json; };
  offlineRepositories = pkgs.writeText "chronicle-sbt-offline-repositories" ''
    [repositories]
    maven-offline: file://${dependencies}/https/repo.maven.apache.org/maven2/
  '';
  sbtSetup = squishLib.mkSbtSetup { inherit pkgs; coursierCache = dependencies; jdk = tools.graal; };
  setupSbt = ''
    ${sbtSetup.setupScript}
    export JAVA_HOME=${tools.graal}
    export SBT_CACHE="$HOME/.sbt"
    export SBT_JAVA_OPTS="$SBT_OPTS ${sbtOptions}"
  '';
  assemble = ''
    read -r -a sbtJavaOpts <<< "$SBT_JAVA_OPTS"
    java "''${sbtJavaOpts[@]}" -jar ${tools.launcher} assembly
  '';
  offlineAssemblyCheck = pkgs.runCommand "chronicle-offline-assembly" {
    nativeBuildInputs = [ tools.graal ];
    LANG = "C.UTF-8";
    LC_ALL = "C.UTF-8";
  } ''
    cp -r ${src} project
    chmod -R u+w project
    cd project
    ${setupSbt}
    ${assemble}
    install -Dm644 target/chronicle-server.jar "$out/chronicle-server.jar"
  '';
in
stdenv.mkDerivation {
  pname = "chronicle";
  version = "0.1.0";
  inherit src;
  nativeBuildInputs = [ tools.graal makeWrapper findutils gnused python3 ];
  buildInputs = [ zlib ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  postPatch = ''
    patchShebangs scripts
  '';
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    ${setupSbt}
    ${assemble}
    native-image -J-Xmx8g --parallelism="$NIX_BUILD_CORES" --no-fallback -march=compatibility --enable-url-protocols=http,https ${lib.escapeShellArgs tools.nativeImageFlags} \
      -jar target/chronicle-server.jar chronicle-server
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    export POSTGRES_HOME=${tools.postgres}
    export SBT_LAUNCH_JAR=${tools.launcher}
    bash scripts/test-postgres.sh
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 chronicle-server "$out/libexec/chronicle-server"
    makeWrapper "$out/libexec/chronicle-server" "$out/bin/chronicle-server" \
      --set CHRONICLE_WEB_ROOT ${web}/share/chronicle/web
    install -Dm644 README.md "$out/share/doc/chronicle/README.md"
    cp -r models migrations "$out/share/doc/chronicle/"
    runHook postInstall
  '';
  passthru = { inherit dependencies web offlineAssemblyCheck; toolchain = tools; };
  meta = {
    description = "Semi-structured agent session archive, hybrid search, MCP and WebSocket dashboard";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "chronicle-server";
  };
}
