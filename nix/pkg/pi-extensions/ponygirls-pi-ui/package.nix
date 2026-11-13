# @ponygirls/pi-ui: the shared extension UI kit, compiled to JS. The output
# links the pinned pi-tui under node_modules so Node resolves it from the
# kit's real path (tests); inside pi, the extension loader's aliases win.
{ lib, runCommand, nodejs, typescript, pi-coding-agent, ponygirls-pi-settings }:
let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in
runCommand "ponygirls-pi-ui" {
  nativeBuildInputs = [ nodejs typescript ];
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: !(lib.hasSuffix "/node_modules" path) && !(lib.hasSuffix "/dist" path);
  };
} ''
  cp -r $src build
  chmod -R u+w build
  cd build
  mkdir -p node_modules/@earendil-works node_modules/@ponygirls
  ln -s ${ponygirls-pi-settings} node_modules/@ponygirls/pi-settings
  ln -s ${sdk}/node_modules/@earendil-works/pi-tui node_modules/@earendil-works/pi-tui
  tsc -p tsconfig.build.json
  mkdir -p $out/node_modules/@earendil-works $out/node_modules/@ponygirls
  ln -s ${ponygirls-pi-settings} $out/node_modules/@ponygirls/pi-settings
  cp -r dist package.json $out/
  ln -s ${sdk}/node_modules/@earendil-works/pi-tui $out/node_modules/@earendil-works/pi-tui
''
