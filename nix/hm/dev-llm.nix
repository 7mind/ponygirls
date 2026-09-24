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
#   codex.nix   Codex configuration (programs.codex); codex-ledger-mcp.nix
#               binds its ledger registration to the rendered Codex prompt root.
#   pi.nix      Pi configuration (programs.pi); also carries the in-flake
#               programs.pi module definition (shared factory + Pi options).
#   yolo.nix    the bubblewrap `yolo` sandbox wrapper + its options. (needs inputs)
#
# Curried over the flake's own `inputs` (codegraph, claude-code-sandbox) and
# Optional `cq` and `cqSource` supply the ledger package and prompt assets
# when the CQ flake composes this module through `lib.mkDevLlm`.
{ inputs, cq, cqSource }:
{
  imports = [
    (import ./tools.nix { inherit inputs cq cqSource; })
    (import ./claude.nix { inherit inputs cq cqSource; })
    (import ./codex.nix { inherit cqSource; })
    (import ./pi.nix { inherit cqSource; })
    (import ./yolo.nix { inherit inputs cqSource; })
  ] ++ (if cqSource == null then [ ] else [
    (import ./codex-ledger-mcp.nix { inherit cqSource; })
  ]);
}
