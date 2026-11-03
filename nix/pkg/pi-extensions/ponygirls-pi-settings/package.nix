# @ponygirls/pi-settings is compiled to JS so every extension uses the same
# package boundary as @ponygirls/pi-ui. The SDK link resolves declaration types;
# JavaScript imports only Node builtins.
{ lib, runCommand, nodejs, typescript, pi-coding-agent }:
let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in
runCommand "ponygirls-pi-settings" {
  nativeBuildInputs = [ nodejs typescript ];
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: !(lib.hasSuffix "/node_modules" path) && !(lib.hasSuffix "/dist" path);
  };
} ''
  cp -r $src build
  chmod -R u+w build
  cd build
  mkdir -p node_modules/@earendil-works
  ln -s ${sdk} node_modules/@earendil-works/pi-coding-agent
  ln -s ${sdk}/node_modules/@types node_modules/@types
  tsc -p tsconfig.build.json
  mkdir -p $out/node_modules/@earendil-works
  cp -r dist package.json $out/
  ln -s ${sdk} $out/node_modules/@earendil-works/pi-coding-agent
''
