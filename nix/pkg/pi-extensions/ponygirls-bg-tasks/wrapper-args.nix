# makeWrapper arguments that supply ponygirls-bg-tasks' runtime executables to
# the pi process: the stdlib-only supervisor interpreter and the shell that
# runs task commands (`bash --noprofile --norc -c`). Shared by the Home Manager
# pi wrapper and the packaged flake check, so both run the same executables.
{ lib, python3, bash, stdenv }:
let
  darwinGroup = stdenv.mkDerivation {
    name = "pi-bg-tasks-darwin-group";
    dontUnpack = true;
    buildPhase = ''
      "$CC" -std=c11 -D_DARWIN_C_SOURCE -dynamiclib -O2 -Wall -Wextra \
        -o darwin-group.dylib ${./darwin-group.c} -lproc
    '';
    installPhase = ''
      mkdir -p "$out/lib"
      cp darwin-group.dylib "$out/lib/"
    '';
  };
  env = {
    PI_BG_TASKS_PYTHON = "${python3}/bin/python3";
    PI_BG_TASKS_SHELL = "${bash}/bin/bash";
  } // lib.optionalAttrs stdenv.hostPlatform.isDarwin {
    PI_BG_TASKS_DARWIN_GROUP = "${darwinGroup}/lib/darwin-group.dylib";
  };
in {
  inherit env;
  args = lib.escapeShellArgs (lib.concatLists (lib.mapAttrsToList (name: value: [
    "--set-default" name value
  ]) env));
}
