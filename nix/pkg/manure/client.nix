# Cross-platform owned current-protocol clients ONLY: no server/POSIX dependency.
{ lib, runCommand, makeWrapper, python3 }:
let
  source = lib.cleanSourceWith {
    src = ../../../manure;
    filter = path: type:
      let relative = lib.removePrefix "${toString ../../../manure}/" (toString path);
      in toString path == toString ../../../manure || builtins.elem relative [ "manure" "manure/__init__.py" "manure/client.py" "manure/current_protocol.py" "manure/cli.py" "manure/mcp.py" "skill" "skill/SKILL.md" ];
  };
in runCommand "manure-clients-0.2.0" {
  pname = "manure-clients";
  version = "0.2.0";
  nativeBuildInputs = [ makeWrapper python3 ];
  passthru.clientSource = source;
  meta = { description = "Manure current-contract CLI and stdio MCP clients"; mainProgram = "manure"; platforms = lib.platforms.unix; license = lib.licenses.mit; };
} ''
  mkdir -p "$out/bin" "$out/lib/python" "$out/share/manure"
  cp -r ${source}/manure "$out/lib/python/manure"
  for client in manure manure-mcp; do
    module=cli
    if [ "$client" = manure-mcp ]; then module=mcp; fi
    makeWrapper ${python3}/bin/python3 "$out/bin/$client" \
      --prefix PYTHONPATH : "$out/lib/python" --add-flags "-m manure.$module"
  done
  ${lib.optionalString (builtins.pathExists ../../../manure/skill/SKILL.md) ''cp ${source}/skill/SKILL.md "$out/share/manure/SKILL.md"''}
  PYTHONPATH="$out/lib/python" python3 -c 'import manure.client, manure.current_protocol, manure.cli, manure.mcp'
  test ! -e "$out/lib/python/manure/server.py"
''
