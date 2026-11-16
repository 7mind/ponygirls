{ pkgs }:
pkgs.writeShellScript "tmux-window-context" ''
  exec ${pkgs.python3}/bin/python3 ${../pkg/agent-notify/tmux_context.py} --tmux ${pkgs.tmux}/bin/tmux
''
