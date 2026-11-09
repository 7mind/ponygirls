{ lib, stdenv, callPackage, zlib, squishLib }:
let
  environment = callPackage ../chronicle/sbt-environment.nix { inherit squishLib; };
  sources = callPackage ../chronicle/source.nix { };
in stdenv.mkDerivation {
  pname = "rites-native-artifact";
  version = "0.1.0";
  src = sources.ritesServer;
  nativeBuildInputs = [ environment.tools.graal ];
  buildInputs = [ zlib ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    find . -type f -print0 | sort -z | xargs -0 sha256sum > ../compiled-inputs.sha256
    ${environment.setup}
    read -r -a sbtJavaOpts <<< "$SBT_JAVA_OPTS"
    java "''${sbtJavaOpts[@]}" -jar ${environment.tools.launcher} ritesServer/assembly
    threads=$NIX_BUILD_CORES
    if (( threads > 8 )); then threads=8; fi
    native-image -J-Xmx24g --parallelism="$threads" --no-fallback -march=compatibility \
      --enable-url-protocols=http,https --enable-all-security-services \
      '-H:IncludeResources=.*\.sql|org/postgresql/.*|META-INF/services/.*' \
      --initialize-at-run-time=org.postgresql.Driver,org.postgresql.util.SharedTimer,org.postgresql.core.v3.AuthenticationPluginManager,org.postgresql.ssl.LibPQFactory \
      ${lib.escapeShellArgs environment.tools.nativeImageFlags} \
      -cp rites/server/target/rites-server.jar rites.Main rites-server
    runHook postBuild
  '';
  installPhase = ''
    install -Dm755 rites-server "$out/libexec/rites-server"
    install -Dm644 ../compiled-inputs.sha256 "$out/share/rites/compiled-inputs.sha256"
    printf '%s\n' '${sources.ritesServer}' > "$out/share/rites/runtime-source"
    printf '%s\n' '${environment.tools.graal}' > "$out/share/rites/toolchain"
  '';
  passthru = { runtimeSource = sources.ritesServer; };
  meta = {
    description = "Rites native Scala coordinator; runtime acceptance is a separate check";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
