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
    find . -type f -print0 | sort -z | xargs -0 sha256sum > ../compiled-inputs.sha256
    ${environment.setup}
    ${environment.assemble}
    nativeImageThreads=$NIX_BUILD_CORES
    if (( nativeImageThreads > ${toString nativeImageMaximumThreads} )); then
      nativeImageThreads=${toString nativeImageMaximumThreads}
    fi
    native-image -J-Xmx${toString nativeImageHeapGiB}g --parallelism="$nativeImageThreads" --no-fallback -march=compatibility --enable-url-protocols=http,https '-H:IncludeResources=.*\.sql|org/postgresql/.*|META-INF/services/.*' ${lib.escapeShellArgs environment.tools.nativeImageFlags} \
      -jar chronicle/target/chronicle-server.jar chronicle-server
    runHook postBuild
  '';
  installPhase = ''
    install -Dm755 chronicle-server "$out/libexec/chronicle-server"
    install -Dm644 ../compiled-inputs.sha256 "$out/share/chronicle/compiled-inputs.sha256"
    printf '%s\n' '${sources.server}' > "$out/share/chronicle/runtime-source"
    printf '%s\n' '${environment.tools.graal}' > "$out/share/chronicle/toolchain"
  '';
  passthru = { runtimeSource = sources.server; };
  meta = {
    description = "Chronicle native development artifact; not a validated deployment package";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
