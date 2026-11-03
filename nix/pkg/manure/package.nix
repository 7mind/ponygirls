# Scala production backend; retain the owned Python CLI/MCP ONLY as clients.
{ lib, callPackage, runCommand, makeWrapper, python3, squishLib }:
let
  nativeArtifact = callPackage ../services/native.nix { inherit squishLib; service = "manure"; };
  clients = lib.cleanSourceWith {
    src = ../../../manure;
    filter = path: type:
      let relative = lib.removePrefix "${toString ../../../manure}/" (toString path);
      in toString path == toString ../../../manure || builtins.elem relative [ "manure" "manure/__init__.py" "manure/client.py" "manure/cli.py" "manure/mcp.py" "skill" "skill/SKILL.md" ] || relative == "generated" || lib.hasPrefix "generated/python" relative;
  };
  web = lib.cleanSourceWith { src = ../../../manure/web; filter = path: type: lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [ "node_modules" "dist" "test-results" ]); };
in runCommand "manure-0.2.0" {
  pname = "manure";
  version = "0.2.0";
  nativeBuildInputs = [ makeWrapper ];
  passthru = { inherit nativeArtifact; runtimeSource = nativeArtifact.runtimeSource; };
  meta = { description = "Native Scala Manure with POSIX storage and Python current-protocol clients"; mainProgram = "manure-server"; platforms = [ "x86_64-linux" ]; license = lib.licenses.mit; };
} ''
  mkdir -p "$out/bin" "$out/lib/python" "$out/share/manure/web"
  ln -s ${nativeArtifact}/libexec/manure-server "$out/bin/manure-server"
  cp -r ${clients}/manure "$out/lib/python/manure"
  ${lib.optionalString (builtins.pathExists "${clients}/generated/python") ''cp -r ${clients}/generated/python/. "$out/lib/python/"''}
  for shell in dashboard unlock; do
    test -d ${web}/"$shell"
    cp -r ${web}/"$shell" "$out/share/manure/web/"
  done
  for client in manure manure-mcp; do
    module=cli
    if [ "$client" = manure-mcp ]; then module=mcp; fi
    makeWrapper ${python3}/bin/python3 "$out/bin/$client" \
      --prefix PYTHONPATH : "$out/lib/python" --add-flags "-m manure.$module"
  done
  ${lib.optionalString (builtins.pathExists "${clients}/skill/SKILL.md") ''cp ${clients}/skill/SKILL.md "$out/share/manure/SKILL.md"''}
  # Legacy Python server/storage/auth modules deliberately cannot be imported.
  test ! -e "$out/lib/python/manure/server.py"
''
