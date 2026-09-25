# ponygirls

Nix packages and Home Manager settings for Pi, Codex, Claude Code, CodeGraph,
and the `yolo` sandbox. Linux uses bubblewrap; macOS uses Seatbelt through
`claude-code-sandbox`.

```nix
inputs.ponygirls.url = "github:7mind/ponygirls";

# In a NixOS module:
imports = [ inputs.ponygirls.nixosModules.podman ];
smind.containers.docker.enable = true;
```

Home Manager users with the agent harness enabled are enrolled in the socket's
access group automatically:

```nix
imports = [ inputs.ponygirls.homeManagerModules.dev-llm ];
smind.hm.dev.llm.enable = true;
```

Packages are under `packages.<system>`: `pi-coding-agent`, `codex`,
`claude-code`, `codegraph`, `llm-skills`, `llm-contexts`, and `yolo`.
Linux additionally exposes `reattach-llm`; macOS exposes `yolo-darwin`.

On NixOS, `nixosModules.podman` creates a dedicated `podsvc-llm` rootless
Podman service and a group-restricted socket at `/run/podman-llm/podman.sock`.
It masks the rootful Podman API socket when rootless mode is enabled. The Home
Manager module forwards the restricted socket into `yolo` and configures the
interactive Docker-compatible client environment. The host acceptance test is
`nix/tests/test-rootless-podman.sh`.

The module accepts additional prompt and skill bundles through
`smind.hm.dev.llm.assetBundles`. Integrations can also extend the shared
`programs.mcp` registry, override each `programs.<agent>.package`, contribute
agent settings/files, and append generic yolo read-only/read-write paths. CQ
uses those extension points from its own Home Manager module; Ponygirls does
not import CQ source code or accept a CQ flake argument.

Default harness models are configured under `smind.hm.dev.llm.models`:
Codex uses `gpt-6-sol` at medium reasoning effort, Claude Code uses the
current `opus` alias at high effort, and Pi uses
`xiaomi-token-plan-ams`/`mimo-v2.6-pro`. Pi follows
`smind.hm.dev.llm.fullscreenTui.enable`, which defaults to fullscreen mode.
