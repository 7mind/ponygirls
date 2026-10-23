{ pkgs }:
pkgs.writeShellScript "runtime-token" (builtins.readFile ./runtime-token.sh)
