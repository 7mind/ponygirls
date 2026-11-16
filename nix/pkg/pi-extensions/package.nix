# The ponygirls pi extensions as one tree, so each extension resolves the
# shared libraries through ./node_modules and pi lists the
# extensions by their own names instead of store-path hashes.
{ lib, runCommand, typescript, ponygirls-pi-ui, ponygirls-pi-settings }:
let
  chronicleApi = import ./chronicle-api.nix { inherit runCommand typescript; };
in
runCommand "ponygirls-pi-extensions" {
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: !(lib.hasSuffix "/node_modules" path) && !(builtins.elem (baseNameOf path) [ "ponygirls-pi-ui" "ponygirls-pi-settings" ]);
  };
} ''
  cp -r $src $out
  chmod -R u+w $out
  mkdir -p $out/node_modules/@ponygirls
  ln -s ${ponygirls-pi-ui} $out/node_modules/@ponygirls/pi-ui
  ln -s ${ponygirls-pi-settings} $out/node_modules/@ponygirls/pi-settings
  ln -s ${chronicleApi} $out/node_modules/@ponygirls/chronicle-api
''
