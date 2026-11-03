{ lib, stdenv, callPackage, zlib, python3, squishLib, service }:
assert builtins.elem service [ "haystack" "manure" ];
let
  environment = callPackage ../chronicle/sbt-environment.nix { inherit squishLib; };
  sources = callPackage ../chronicle/source.nix { };
  project = "${service}Server";
  jar = if service == "manure" then "manure/backend/target/manure-server.jar" else "haystack/server/target/haystack-server.jar";
  bridge = callPackage ../manure/posix.nix { };
in stdenv.mkDerivation {
  pname = "${service}-native-artifact";
  version = "0.1.0";
  src = sources."${service}Server";
  nativeBuildInputs = [ environment.tools.graal python3 ];
  buildInputs = [ zlib ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    # Exact filtered input bytes BEFORE compilation creates target/hosted files.
    find . -type f -print0 | sort -z | xargs -0 sha256sum > ../compiled-inputs.sha256
    ${lib.optionalString (service == "manure") "python3 manure/scripts/artifact-source.py > ../compiled-runtime-inputs.sha256"}
    ${environment.setup}
    read -r -a sbtJavaOpts <<< "$SBT_JAVA_OPTS"
    java "''${sbtJavaOpts[@]}" -jar ${environment.tools.launcher} ${project}/assembly
    threads=$NIX_BUILD_CORES
    if (( threads > 8 )); then threads=8; fi
    ${lib.optionalString (service == "manure") ''
      # The hosted feature is build-only. Production classes use only the JDK;
      # this is the proven POSIX seam, not a JVM/legacy Python fallback.
      grep -q 'GRAALVM_VERSION="25.4.4.1.1"' "$JAVA_HOME/release"
      mkdir hosted-feature
      javac --add-modules org.graalvm.nativeimage -cp "$JAVA_HOME/lib/svm/builder/*" \
        -d hosted-feature manure/server/native-image/PosixLinkFeature.java
    ''}
    native-image -J-Xmx24g --parallelism="$threads" --no-fallback -march=compatibility \
      --enable-url-protocols=http,https --enable-all-security-services \
      '-H:IncludeResources=.*\.sql|org/postgresql/.*|META-INF/services/.*' \
      --initialize-at-run-time=org.postgresql.Driver,org.postgresql.util.SharedTimer,org.postgresql.core.v3.AuthenticationPluginManager,org.postgresql.ssl.LibPQFactory \
      ${lib.escapeShellArgs environment.tools.nativeImageFlags} \
      ${lib.optionalString (service == "manure") ''
        --enable-native-access=ALL-UNNAMED \
        -J--add-exports=org.graalvm.nativeimage.builder/com.oracle.svm.core.jdk=ALL-UNNAMED \
        -J--add-exports=org.graalvm.nativeimage.builder/com.oracle.svm.hosted.c=ALL-UNNAMED \
        --features=manure.build.PosixLinkFeature -H:CLibraryPath=${bridge.static}/lib \
      ''} \
      -cp ${jar}${lib.optionalString (service == "manure") ":hosted-feature"} ${service}.Main ${service}-server
    runHook postBuild
  '';
  installPhase = ''
    install -Dm755 ${service}-server "$out/libexec/${service}-server"
    install -Dm644 ../compiled-inputs.sha256 "$out/share/${service}/compiled-inputs-full.sha256"
    install -Dm644 ../compiled-${if service == "manure" then "runtime-" else ""}inputs.sha256 "$out/share/${service}/compiled-inputs.sha256"
    printf '%s\n' '${sources."${service}Server"}' > "$out/share/${service}/runtime-source"
    printf '%s\n' '${environment.tools.graal}' > "$out/share/${service}/toolchain"
  '';
  passthru = { runtimeSource = sources."${service}Server"; inherit project jar; };
  meta = { description = "${service} static-musl Scala server (native-runtime acceptance is a separate required check)"; platforms = [ "x86_64-linux" ]; license = lib.licenses.mit; };
}
