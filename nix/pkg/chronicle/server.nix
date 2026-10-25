{ lib, stdenv, callPackage, cacert, makeWrapper, zlib, findutils, gnused, python3 }:
let
  tools = callPackage ./toolchain.nix { };
  src = callPackage ./source.nix { };
  hashes = import ./hashes.nix;
  web = callPackage ./web.nix { };
  sbtOptions = lib.concatStringsSep " " [
    "-Dsbt.supershell=false" "-Dsbt.ci=true" "-Dsbt.server.autostart=false"
    "-Dsbt.override.build.repos=true" "-Dsbt.repository.config=${tools.repositories}"
    "-Dsbt.boot.directory=$SBT_CACHE/boot" "-Dsbt.global.base=$SBT_CACHE/global"
    "-Dsbt.ivy.home=$SBT_CACHE/ivy" "-Dcoursier.cache=$SBT_CACHE/coursier"
  ];
  dependencies = stdenv.mkDerivation {
    pname = "chronicle-sbt-dependencies";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ tools.graal cacert findutils ];
    LANG = "C.UTF-8";
    LC_ALL = "C.UTF-8";
    dontConfigure = true;
    buildPhase = ''
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME" "$out"
      export SBT_CACHE="$out"
      export COURSIER_CACHE="$SBT_CACHE/coursier"
      java ${sbtOptions} -jar ${tools.launcher} update 'contracts/compile' 'show scalaInstance' 'show scalaCompilerBridgeBinaryJar'
    '';
    installPhase = ''
      find "$out" -type f \( -name '*.lock' -o -name '*.log' -o -name '*.checked' -o -name '*.error' \) -delete
      find "$out" -type d -empty -delete
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = hashes.sbt;
  };
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
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    cp -r ${dependencies} "$TMPDIR/sbt-cache"
    chmod -R u+w "$TMPDIR/sbt-cache"
    export SBT_CACHE="$TMPDIR/sbt-cache"
    export COURSIER_CACHE="$SBT_CACHE/coursier"
    java ${sbtOptions} -Dsbt.offline=true -jar ${tools.launcher} assembly
    native-image -J-Xmx8g --parallelism="$NIX_BUILD_CORES" --no-fallback -march=compatibility --enable-url-protocols=http,https ${lib.escapeShellArgs tools.nativeImageFlags} \
      -jar target/chronicle-server.jar chronicle-server
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    export POSTGRES_HOME=${tools.postgres}
    export SBT_LAUNCH_JAR=${tools.launcher}
    export SBT_JAVA_OPTS="${sbtOptions} -Dsbt.offline=true"
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
  passthru = { inherit dependencies web; toolchain = tools; };
  meta = {
    description = "Semi-structured agent session archive, hybrid search, MCP and WebSocket dashboard";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "chronicle-server";
  };
}
