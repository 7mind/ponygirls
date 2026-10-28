{ lib, runCommand, makeWrapper, python3, nativeArtifact, web, validationEvidence, validationInputs, documentation, dependencies, toolchain, offlineAssemblyCheck, backendValidation, protocolValidation }:
runCommand "chronicle-0.1.0" {
  pname = "chronicle";
  version = "0.1.0";
  nativeBuildInputs = [ makeWrapper python3 ];
  passthru = { inherit nativeArtifact web validationEvidence backendValidation protocolValidation dependencies toolchain offlineAssemblyCheck; };
  meta = {
    description = "Validated Chronicle archive server and WebSocket dashboard";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "chronicle-server";
  };
} ''
  python3 ${./validation-evidence.py} verify --inputs ${validationInputs} --receipt ${validationEvidence}/validation.json
  mkdir -p "$out/bin" "$out/libexec" "$out/share/chronicle" "$out/share/doc/chronicle"
  ln -s ${nativeArtifact}/libexec/chronicle-server "$out/libexec/chronicle-server"
  makeWrapper ${nativeArtifact}/libexec/chronicle-server "$out/bin/chronicle-server" \
    --set CHRONICLE_WEB_ROOT ${web}/share/chronicle/web
  cp ${validationEvidence}/validation.json "$out/share/chronicle/validation.json"
  cp ${documentation}/README.md "$out/share/doc/chronicle/README.md"
  cp -r ${documentation}/models ${documentation}/migrations "$out/share/doc/chronicle/"
''
