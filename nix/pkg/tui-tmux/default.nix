{ lib, writeShellApplication, tmux, runCommand, python3 }:
let
  package = writeShellApplication {
    name = "tui-tmux";
    text = ''
      if [[ $# -lt 3 || $1 != -S || $2 != /* ]]; then
        echo 'usage: tui-tmux -S /absolute/test-owned/socket <tmux arguments...>' >&2
        exit 64
      fi
      socket=$2
      shift 2
      unset TMUX TMUX_PANE
      exec ${lib.getExe tmux} -f /dev/null -S "$socket" "$@"
    '';
    meta = {
      description = "Private-server tmux entry point for driving TUIs without the yolo clipboard shim";
      license = lib.licenses.mit;
      mainProgram = "tui-tmux";
      platforms = lib.platforms.unix;
    };
    derivationArgs.passthru.tests.terminal = runCommand "tui-tmux-terminal-test" {
      nativeBuildInputs = [ python3 tmux ];
    } ''
      python3 ${./test.py} ${package}/bin/tui-tmux
      touch "$out"
    '';
  };
in
package
