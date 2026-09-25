# Portable home-manager module for the LLM coding-agent harness (Claude Code,
# Codex, Pi) plus the shared asset-bundle / MCP infrastructure and the
# bubblewrap `yolo` sandbox. It can be consumed without CQ through
# `inputs.ponygirls.homeManagerModules.dev-llm`.
#
# This file is a thin aggregator: the implementation is split across focused
# sibling modules, all sharing the `smind.hm.dev.llm.*` option namespace —
#
#   tools.nix   reusable shared infrastructure: the master `enable` switch, the
#               asset-bundle merge + `merged.*` views, the `programs.mcp`
#               registry, and the common host packages. (needs inputs + self)
#   claude.nix  Claude Code configuration (programs.claude-code).
#   codex.nix   Codex configuration (programs.codex).
#   pi.nix      Pi configuration (programs.pi); also carries the in-flake
#               programs.pi module definition (shared factory + Pi options).
#   podman.nix  NixOS-provided restricted rootless-Podman socket wiring.
#   yolo.nix    the bubblewrap `yolo` sandbox wrapper + its options. (needs inputs)
#
# Curried only over this flake's own inputs. Downstream integrations compose
# this module and configure its public Home Manager options.
{ inputs }:
{
  imports = [
    (import ./tools.nix { inherit inputs; })
    (import ./claude.nix { inherit inputs; })
    ./codex.nix
    ./pi.nix
    (import ./yolo.nix { inherit inputs; })
    ./podman.nix
  ];
}
