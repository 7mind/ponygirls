# Scala production backend; retain the owned Python CLI/MCP ONLY as clients.
{ lib, callPackage, runCommand, makeWrapper, python3, squishLib }:
let
  nativeArtifact = callPackage ../services/native.nix { inherit squishLib; service = "manure"; };
  clients = callPackage ./client.nix { };
  viewer = callPackage ./viewer.nix { };
  web = lib.cleanSourceWith { src = ../../../manure/web; filter = path: type: lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [ "node_modules" "dist" "test-results" ]); };
in runCommand "manure-0.2.0" {
  pname = "manure";
  version = "0.2.0";
  nativeBuildInputs = [ makeWrapper ];
  passthru = { inherit nativeArtifact clients viewer; runtimeSource = nativeArtifact.runtimeSource; };
  meta = { description = "Native Scala Manure with POSIX storage and Python current-protocol clients"; mainProgram = "manure-server"; platforms = [ "x86_64-linux" ]; license = lib.licenses.mit; };
} ''
  mkdir -p "$out/bin" "$out/lib/python" "$out/share/manure/web"
  ln -s ${nativeArtifact}/libexec/manure-server "$out/bin/manure-server"
  ln -s ${clients}/lib/python/manure "$out/lib/python/manure"
  for shell in dashboard unlock; do
    test -d ${web}/"$shell"
    cp -r ${web}/"$shell" "$out/share/manure/web/"
  done
  cp -r ${viewer}/share/manure/web/viewer "$out/share/manure/web/viewer"
  ln -s ${clients}/bin/manure "$out/bin/manure"
  ln -s ${clients}/bin/manure-mcp "$out/bin/manure-mcp"
  if [ -f ${clients}/share/manure/SKILL.md ]; then ln -s ${clients}/share/manure/SKILL.md "$out/share/manure/SKILL.md"; fi
  # Legacy Python server/storage/auth modules deliberately cannot be imported.
  test ! -e "$out/lib/python/manure/server.py"
''
