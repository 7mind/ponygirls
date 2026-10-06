# ponygirls

<img width="1774" height="887" alt="image" src="https://github.com/user-attachments/assets/523ef773-ea3d-46e2-af3b-e7f7d16c8fcb" />

A Nix flake that assembles a complete AI coding-agent workstation: the agent
CLIs themselves, a set of Pi extensions, a sandbox that keeps agents away from
the rest of your machine, quota dashboards so you know when a subscription runs
dry, and the Home Manager / NixOS configuration that wires it all together.

Linux uses [bubblewrap](https://github.com/containers/bubblewrap) for
sandboxing; macOS uses Seatbelt through `claude-code-sandbox`.

## The big picture

Four kinds of thing live here, and they build on each other:

1. **Agents and tools** — packaged CLIs you can run on their own: Pi, Codex,
   Claude Code, the pi-search-hub web-search package, the CodeGraph MCP server.
2. **Pi extensions** — small TypeScript add-ons that make Pi nicer to drive:
   clickable model picking, latency stats, usage tables, long-running goals,
   subagents, background tasks, quota panes.
3. **The sandbox and its satellites** — `yolo`, which runs any of the agents
   inside a locked-down sandbox with named profiles, plus helpers for
   containers, VMs, and terminal reattachment.
4. **The configuration** — Home Manager and NixOS modules that install and
   configure all of the above declaratively, including the shared skills and
   context documents each agent reads.

Every package is under `packages.<system>` and can be built or run standalone
(`nix build .#pi-coding-agent`, `nix run .#tokemon`, …) — the modules are
convenience, not a requirement.

---

## Components

### Coding agents and tooling

| Package | What it is |
|---|---|
| `pi-coding-agent` | **Pi** — the terminal coding agent from [earendil-works/pi](https://github.com/earendil-works/pi), built from source at a pinned release, with its bundled provider/model registry. We carry a small set of patches on top of upstream (OAuth force-refresh on HTTP 401, extension console output no longer garbling the TUI, surfaced settings-write errors), each documented in `nix/pkg/pi-coding-agent/package.nix` with the upstream issue it tracks. |
| `codex` | **OpenAI Codex CLI**, packaged from the official release binaries (including its code-mode host) so no Rust build is needed and alpha tags track closely. `nix/pkg/codex/update.sh` bumps it. |
| `claude-code` | **Anthropic Claude Code**, packaged from the official per-platform native npm artefacts and made Nix-compatible (the Bun single-file executable is left byte-identical except for the dynamic-loader fixup). `update.sh` bumps it. |
| `pi-search-hub` | A Pi package providing unified `web_search` / `web_read` over ~19 search and reader backends with automatic fallback. We install it as a local, manifest-corrected package at a pinned version (upstream packaging defects are documented in `nix/pkg/pi-search-hub/package.nix`). |
| `codegraph` | **CodeGraph** — a semantic code-intelligence MCP server (tree-sitter knowledge graph over your repositories) from [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph). Upstream ships no Nix support, so this is a vendored build against this flake's nixpkgs. |

### Pi extensions (`nix/pkg/pi-extensions/`)

TypeScript extensions loaded by Pi. Each is a self-contained file or directory
with its own tests; the Home Manager module loads them all, and `./pi-test`
runs Pi against the copies in this checkout without deploying anything.

| Extension | What it does |
|---|---|
| `ponygirls-model-picker` | Makes the footer useful: one status line with path, session, native stats, and **clickable model / thinking-effort controls** (fullscreen), plus `ctrl+shift+m` / `ctrl+shift+e` shortcuts that open the same menus. |
| `ponygirls-model-stats` | Measures every provider response (time to first token, total span, decode tok/s) and shows per-model distributions as `/perf` tables. |
| `ponygirls-usage` | The `/usage` screen: period tabs (today / week / 30 days / all time) with a flat per-provider, per-model cost table, and a global input-size distribution view (chart or table). |
| `ponygirls-codex-goals` | Codex-style **session goals** (`/goal`): a persistent objective with a token budget that the model is steered by — and unlike most goal systems, every goal instruction is a visible, persisted message in the session transcript, so nothing is said to the model off the record. |
| `ponygirls-subagents` | **Supervisor/worker subagents** (`/agents`): durable asynchronous delegation to child agents running in separate processes, with an inspector screen showing the agent tree and live transcripts, attributed messaging, interruption/resumption, optional reviewer validation gates, per-child tool brokering (direct or in a bubblewrap sandbox), and Git worktree workspaces. |
| `ponygirls-bg-tasks` | **Background shell tasks**: a `bg_task` tool for long-running commands, a `/bg` screen to read their terminal output, and completion notices that wake an idle session. |
| `ponygirls-tokemon` | Provider quota info *inside* Pi: a `tokemon` tool for the model (how many credits are left before it plans a big refactor) and a `/tokemon` pane, plus a small quota widget in the status bar. Covers the providers the running Pi is configured for. |
| `ponygirls-quirk-search-hub-backends` | Works around a pi-search-hub defect: the `web_search` tool advertises all ~19 backends regardless of configuration, so the model routinely picks unconfigured ones. This rewrites the tool definition to list only what is actually enabled. |
| `ponygirls-quirk-kimi-401-retry` | Works around a Pi defect with Kimi coding OAuth: short-lived access tokens are not refreshed on an API-level 401, so a perfectly valid subscription dies mid-turn. This re-drives the turn after a bounded re-auth once Pi has settled. |

### Quota dashboards

| Package | What it is |
|---|---|
| `tokemon` | A terminal dashboard (Python + rich) showing **quota and billing state across every provider account you use** — Claude, Codex/ChatGPT, GitHub Copilot, Kimi, MiniMax, OpenRouter, Vercel, xAI, ZAI — including accounts discovered through yolo profiles and Pi's credential store. Live polling, colourised state (`ok` / `low` / `EXHAUSTED` / unlimited), reset times. |

### The sandbox and web tooling

| Package | What it is |
|---|---|
| `yolo` | **The sandbox launcher.** `yolo claude`, `yolo codex`, `yolo pi`, `yolo shell`, or `yolo cmd <anything>` runs the command inside a bubblewrap sandbox: a private `/dev`, a cleared environment, your project directory bound read-write and little else. Everything an agent can reach is explicitly granted — capabilities can be added or removed per run with tags (`gpu`, `display`, `vm`, `audio`, `codegraph`) and ad-hoc `--ro` / `--rw` / `--env` flags. **Named profiles** (`--profile work`) give each agent an isolated set of credentials, settings, and session history under `~/.config/yolo/`, so one machine can hold work, personal, and throwaway identities; `--auth-override` lets one profile borrow another's credentials. A host-side clipboard broker keeps `tmux load-buffer`/`save-buffer` working across the boundary without exposing host tmux. |
| `reattach-llm` | Reattaches running Claude / Codex terminal sessions into an `llm` tmux session, so agent terminals survive SSH disconnects and can be re-entered later. |
| `crawl4ai` (Linux) | **Crawl4AI** — the web-crawling library plus its self-hosted API/MCP server (Playwright Chromium, SSE at `/mcp/sse`). |
| `crawl4ai-mcp` | A tiny stdio MCP client that proxies to the Crawl4AI SSE endpoint, keeping the API token out of process arguments and out of the Nix store. |

On macOS, `yolo` resolves to `yolo-darwin`: the same launcher idea implemented
with Seatbelt (via `claude-code-sandbox`) — per-profile isolation of Claude
Code, Codex, and Pi configuration and credentials on a single user account.
Its subcommands (`claude`, `codex`, `pi`, `shell`, `cmd`) and profile
management match the Linux tool; the bubblewrap-only capabilities do not apply.

### Agent content

| Package | What it is |
|---|---|
| `llm-skills` | The shared **skill set** — progressive-disclosure instruction documents (SKILL.md with metadata) every agent can be handed: baboon, constructive-test-taxonomy, dual-tests, environment, flake-upgrade, izumi, resilient-ws-ui, tass. Metadata is validated at build time. |
| `llm-contexts` | The shared **context fragments**: the general context every agent reads (CLAUDE.md / AGENTS.md memory) and Pi's repo-agnostic operating manual (appended into Pi's system prompt). |
| `llm-context-with-env` | The general context combined with the sandbox-environment skill, for hosts running agents inside `yolo`. |

---

## Configuration

### Home Manager: `homeManagerModules.dev-llm`

One module, `smind.hm.dev.llm.*`, that turns a user account into an agent
workstation. It configures Claude Code, Codex, and Pi (packages, settings,
default models, MCP servers), installs the sandbox, and merges shared content.
Switch the whole thing on with:

```nix
inputs.ponygirls.url = "github:7mind/ponygirls";

# home.nix
imports = [ inputs.ponygirls.homeManagerModules.dev-llm ];
smind.hm.dev.llm.enable = true;
```

The main knobs (all under `smind.hm.dev.llm`):

- **`models`** — default model and reasoning effort per harness. Out of the
  box: Codex on `gpt-6.1-sol` (medium effort), Claude Code on the current
  `opus` alias (high effort), Pi on `xiaomi-token-plan-ams` / `mimo-v2.6-pro`.
  Pi follows `fullscreenTui.enable`, which defaults to fullscreen mode.
- **`assetBundles`** — contribute skills, slash commands, subagent
  definitions, and memory fragments; everything is merged and delivered to all
  three agents (`merged.skills`, `merged.commands`, `merged.agents`,
  `merged.contextText` expose the result).
- **`pi.providers.<name>.enable`** — opt-in inference provider packages for Pi
  (xAI/Grok, Ollama Cloud, …).
- **`crawl4ai`** — register the Crawl4AI MCP endpoint with Claude Code, Codex,
  and Pi via the shared `programs.mcp` registry, without writing the API token
  into the Nix store.
- **`yolo.*`** — sandbox policy: extra read-only / read-write paths, device
  binds (e.g. GPU render nodes), prompt fragments and pre-start hooks keyed by
  suppression tags, session and secret variables (secrets are composed into a
  single file bound into the sandbox, never passed through argv), extra
  packages on the sandbox `PATH`, and the optional **KVM VM capability**
  (`yolo.vm.enable`) — QEMU and cloud-image utilities inside the sandbox plus
  `/dev/kvm` and a persistent state directory, so an agent can run its own
  NixOS/Ubuntu test VMs without host disks or a privileged VM manager.

Integrations can extend `programs.mcp`, override `programs.<agent>.package`,
contribute settings and files, and append generic yolo paths. (Our own CQ
integration uses exactly those extension points from its own Home Manager
module; ponygirls does not import CQ code or take a CQ flake argument.)

Users with the harness enabled are enrolled in the container socket's access
group automatically.

### NixOS modules

- **`nixosModules.podman`** — a dedicated rootless Podman service account
  (`podsvc-llm`) with a group-restricted Docker-compatible socket at
  `/run/podman-llm/podman.sock` (mode `0660`). Agents get container access
  through that socket only; the rootful API socket is masked. The Home Manager
  module forwards the restricted socket into `yolo` and sets up the client
  environment. Host acceptance test: `nix/tests/test-rootless-podman.sh`.

  ```nix
  imports = [ inputs.ponygirls.nixosModules.podman ];
  smind.containers.docker.enable = true;
  ```

- **`nixosModules.crawl4ai`** — runs the Crawl4AI API/MCP server (Playwright
  Chromium, Redis, SSE at `/mcp/sse`). It does not isolate egress by itself.

- **`nixosModules.crawl4ai-isolation`** — the host-side nftables bridge filter
  for the Crawl4AI container: it may serve answers and reach the public
  internet, and may not open connections to local or non-global addresses,
  including the host.

---

## Working on ponygirls itself

- **`./pi-test`** — run Pi with this checkout's extensions instead of their
  deployed copies, no `home-manager switch` needed. Everything else (packages,
  settings) matches your live `~/.pi/agent`.
- **`nix flake check`** — module evaluation assertions (podman wiring, crawl4ai
  wiring, default models, module boundaries) plus the unit/integration test
  suites for every Pi extension, `tokemon`, and the yolo scripts.
- **`nix/tests/test-yolo-vm.sh`** — host acceptance test for the KVM VM
  capability; run after activating a configuration with
  `smind.hm.dev.llm.yolo.vm.enable = true`.
- **`nix/tests/test-rootless-podman.sh`** — verifies the `podsvc-llm` service
  account is genuinely restricted (no privileged groups, no sudo, no
  bind-mount escape into host secrets).

## Platform support

- `x86_64-linux`: everything, including `yolo` (bubblewrap), containers, and
  the VM capability.
- `aarch64-darwin`: the agents, Pi extensions, tokemon, content packages, and
  `yolo` (= `yolo-darwin`, Seatbelt).
