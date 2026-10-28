{ lib, stdenv, callPackage, zlib, squishLib }:
let
  environment = callPackage ./sbt-environment.nix { inherit squishLib; };
  sources = callPackage ./source.nix { };
  nativeImageHeapGiB = 24;
  nativeImageMaximumThreads = 8;
in stdenv.mkDerivation {
  pname = "chronicle-native-development-artifact";
  version = "0.1.0";
  src = sources.server;
  nativeBuildInputs = [ environment.tools.graal ];
  buildInputs = [ zlib ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    ${environment.setup}
    ${environment.assemble}
    nativeImageThreads=$NIX_BUILD_CORES
    if (( nativeImageThreads > ${toString nativeImageMaximumThreads} )); then
      nativeImageThreads=${toString nativeImageMaximumThreads}
    fi
    native-image -J-Xmx${toString nativeImageHeapGiB}g --parallelism="$nativeImageThreads" --no-fallback -march=compatibility --enable-url-protocols=http,https ${lib.escapeShellArgs environment.tools.nativeImageFlags} \
      -jar target/chronicle-server.jar chronicle-server
    runHook postBuild
  '';
  installPhase = ''
    install -Dm755 chronicle-server "$out/libexec/chronicle-server"
  '';
  passthru = { runtimeSource = sources.server; };
  meta = {
    description = "Chronicle native development artifact; not a validated deployment package";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
