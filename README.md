# ponygirls

Nix packages and Home Manager settings for Pi, Codex, Claude Code, CodeGraph,
and the `yolo` sandbox. Linux uses bubblewrap; macOS uses Seatbelt through
`claude-code-sandbox`.

```nix
inputs.ponygirls.url = "github:7mind/ponygirls";

# In a Home Manager module:
imports = [ inputs.ponygirls.homeManagerModules.dev-llm ];
smind.hm.dev.llm.enable = true;
```

Packages are under `packages.<system>`: `pi-coding-agent`, `codex`,
`claude-code`, `codegraph`, `llm-skills`, `llm-contexts`, and `yolo`.
Linux additionally exposes `reattach-llm`; macOS exposes `yolo-darwin`.

The module accepts additional prompt and skill bundles through
`smind.hm.dev.llm.assetBundles`. The CQ flake uses `lib.mkDevLlm` to supply
its ledger and rendered CQ prompts. A standalone ponygirls import omits CQ
packages, MCP registration, hooks, and sandbox state/config grants.
