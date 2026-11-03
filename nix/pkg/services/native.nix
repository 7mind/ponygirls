{ lib, stdenv, callPackage, zlib, squishLib, service }:
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
  nativeBuildInputs = [ environment.tools.graal ];
  buildInputs = [ zlib ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
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
      --enable-url-protocols=http,https ${lib.escapeShellArgs environment.tools.nativeImageFlags} \
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
  '';
  passthru = { runtimeSource = sources."${service}Server"; inherit project jar; };
  meta = { description = "${service} static-musl Scala server (native-runtime acceptance is a separate required check)"; platforms = [ "x86_64-linux" ]; license = lib.licenses.mit; };
}
