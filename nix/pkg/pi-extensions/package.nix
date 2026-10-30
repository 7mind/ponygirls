# The ponygirls pi extensions as one tree, so each extension resolves the
# shared UI kit as `@ponygirls/pi-ui` through ./node_modules and pi lists the
# extensions by their own names instead of store-path hashes.
{ lib, runCommand, ponygirls-pi-ui }:
runCommand "ponygirls-pi-extensions" {
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: !(lib.hasSuffix "/node_modules" path) && baseNameOf path != "ponygirls-pi-ui";
  };
} ''
  cp -r $src $out
  chmod -R u+w $out
  mkdir -p $out/node_modules/@ponygirls
  ln -s ${ponygirls-pi-ui} $out/node_modules/@ponygirls/pi-ui
''
