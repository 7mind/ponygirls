{ lib, stdenvNoCC, callPackage, makeWrapper, squishLib }:
let
  environment = callPackage ../chronicle/sbt-environment.nix { inherit squishLib; };
  sources = callPackage ../chronicle/source.nix { };
  sharedJavaRuntime = environment.tools.graal;
in stdenvNoCC.mkDerivation {
  pname = "ontology-server";
  version = "0.1.0";
  src = sources.ontologyServer;
  nativeBuildInputs = [ sharedJavaRuntime makeWrapper ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    find . -type f -print0 | sort -z | xargs -0 sha256sum > ../compiled-inputs.sha256
    ${environment.setup}
    read -r -a sbtJavaOpts <<< "$SBT_JAVA_OPTS"
    java "''${sbtJavaOpts[@]}" -jar ${environment.tools.launcher} ontologyServer/assembly
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    install -Dm644 ontology/server/target/ontology-server.jar "$out/share/ontology/ontology-server.jar"
    install -Dm644 ../compiled-inputs.sha256 "$out/share/ontology/compiled-inputs.sha256"
    printf '%s\n' '${sources.ontologyServer}' > "$out/share/ontology/runtime-source"
    printf '%s\n' '${sharedJavaRuntime}' > "$out/share/ontology/toolchain"
    (cd "$out/share/ontology" && sha256sum ontology-server.jar > artifact.sha256)
    makeWrapper ${sharedJavaRuntime}/bin/java "$out/bin/ontology-server" \
      --add-flags "-jar $out/share/ontology/ontology-server.jar"
    runHook postInstall
  '';
  passthru = { runtimeSource = sources.ontologyServer; inherit sharedJavaRuntime; };
  meta = {
    description = "Ontology JVM service; deployment requires explicit runtime configuration";
    mainProgram = "ontology-server";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
