{ lib, runCommand, makeWrapper, nativeArtifact, web, documentation, dependencies, toolchain, offlineAssemblyCheck, backendValidation, protocolValidation }:
runCommand "chronicle-0.1.0" {
  pname = "chronicle";
  version = "0.1.0";
  nativeBuildInputs = [ makeWrapper ];
  passthru = { inherit nativeArtifact web backendValidation protocolValidation dependencies toolchain offlineAssemblyCheck; };
  meta = {
    description = "Chronicle archive server and WebSocket dashboard with fast validation";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "chronicle-server";
  };
} ''
  # Build-time gate: the package exists only once the fast backend suites and the protocol fixtures have passed.
  test -f ${backendValidation}/counts.json
  test -f ${protocolValidation}/protocol.log
  mkdir -p "$out/bin" "$out/libexec" "$out/share/doc/chronicle"
  ln -s ${nativeArtifact}/libexec/chronicle-server "$out/libexec/chronicle-server"
  makeWrapper ${nativeArtifact}/libexec/chronicle-server "$out/bin/chronicle-server" \
    --set CHRONICLE_WEB_ROOT ${web}/share/chronicle/web
  cp ${documentation}/README.md "$out/share/doc/chronicle/README.md"
  cp -r ${documentation}/models ${documentation}/migrations "$out/share/doc/chronicle/"
''
