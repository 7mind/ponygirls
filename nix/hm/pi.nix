# Pi configuration for the LLM coding-agent harness, split out of dev-llm.nix.
# Unlike Claude/Codex (whose `programs.*` modules come from the downstream's
# home-manager), Pi's `programs.pi` module is defined in THIS flake — the
# definition is inlined in the `imports` below (shared factory + Pi-specific
# options) — and then configured here. The shared asset bundles / MCP registry /
# merged views come from the sibling tools.nix via
# `smind.hm.dev.llm.{enable,merged.*,…}`.
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.smind.hm.dev.llm;
  piCfg = config.programs.pi;
  jsonFormat = pkgs.formats.json { };

  # Retry/timeout policy tuned for the default Xiaomi AMS provider.
  #
  # settings.json is a read-only store symlink: settings are fully
  # declarative. Runtime saves (/settings, Ctrl+T, ...) apply to the current
  # session only and pi reports the EROFS failure in the chat (see
  # patches/surface-settings-write-errors.patch); persist a change by editing
  # programs.pi.settings here and switching.
  retryPolicy = {
    httpIdleTimeoutMs = 60000;
    retry = {
      enabled = true;
      maxRetries = 1;
      baseDelayMs = 1000;
      maxAgentDelayMs = 5000;
      provider = {
        timeoutMs = 60000;
        maxRetries = 0;
        maxRetryDelayMs = 10000;
      };
    };
  };

  # The `programs.pi` module is defined IN THIS FLAKE (Pi isn't in home-manager
  # upstream): the common agent-harness surface comes from the shared factory,
  # plus the Pi-specific options (extensionsDir / appendSystemPrompt) declared in the inline module below. Both are imported
  # at the bottom; this file then configures the resulting `programs.pi`.
  mkAgentHarness = import ../lib/mk-agent-harness.nix;

  llmContexts = pkgs.callPackage ../pkg/llm-contexts/default.nix { };
  # Pi: vendored formula (version pinned in ../pkg/pi-coding-agent/package.nix;
  # nixpkgs lags at 0.75.x, and its older releases have broken Codex/ChatGPT
  # subscription token exchange). Bump: edit version + rerun the two fake-hash builds in pkg/pi-coding-agent/package.nix.
  piBase = pkgs.callPackage ../pkg/pi-coding-agent/package.nix { };

  # pi-search-hub as a Pi LOCAL package with a corrected manifest (upstream
  # declares the host-provided `typebox` in `dependencies`, which trips Pi's
  # extension-package warning and installs a duplicate copy —
  # ronnieops/pi-search-hub#33). See the derivation header for the full story.
  piSearchHub = pkgs.callPackage ../pkg/pi-search-hub/package.nix { };

  # /usage — usage statistics dashboard for Pi sessions
  # (https://pi.dev/packages/@tmustier/pi-usage-extension), as a Pi LOCAL
  # package built from the tmustier/pi-extensions monorepo and pinned to a
  # commit (usage-extension/v0.9.5). See the derivation header for why not the
  # npm:/git: specs.
  piUsageExtension = pkgs.callPackage ../pkg/pi-usage-extension/package.nix { };

  # Provider/API-key secrets are no longer injected by the pi wrapper. They are
  # supplied to ALL harnesses by the yolo sandbox via
  # `smind.hm.dev.llm.yolo.secretSessionVariables` (composed into one file,
  # bound, and sourced inside the sandbox — see nix/hm/yolo.nix and pkg/yolo).

  # pi-search-hub's duckduckgo backend spawns `python3 -c "from ddgs import
  # DDGS …"` (no interpreter override; its `which ddgs` fallback only adds
  # ddgs's own site-packages, which under Nix omits ddgs's transitive deps, so
  # it fails here). We need a python3 whose env carries ddgs+deps. We can NOT
  # add it to home.packages — a bare python3 is already in that buildEnv and a
  # second one collides (bin/python3, bin/pydoc3.13). Instead we prefix it onto
  # PATH for the pi process only (below), so the python3 pi spawns resolves to
  # this env without touching the home-manager profile.
  ddgsPython = pkgs.python3.withPackages (ps: [ ps.ddgs ]);
  piWrapped = pkgs.symlinkJoin {
    name = "pi-coding-agent-wrapped";
    paths = [ piBase ];
    nativeBuildInputs = [ pkgs.makeWrapper ];
    postBuild = ''
      wrapProgram $out/bin/pi \
        --prefix PATH : ${ddgsPython}/bin
    '';
  };

  # Declarative pi-search-hub config (replaces rpiv-web-tools). pi-search-hub
  # reads ~/.pi/agent/extensions/search.json; we manage it as a read-only HM
  # store symlink (truly declarative — runtime `/search` mutations do not
  # persist; change a backend here). API keys are NOT stored here: each
  # backend's `apiKey` names the env var supplied to the sandbox via
  # `smind.hm.dev.llm.yolo.secretSessionVariables`, resolved by pi-search-hub's
  # "ALL_CAPS string => env var" rule. Tool names are unchanged (`web_search`,
  # `web_read`); for grok-*, pi-xai 0.9.1's `mergeXaiTools` drops the client
  # `web_search` in favour of xAI's native server-side one under agentic mode.
  #
  # Search ORDER is the targeted-combine quality walk. `combine: true` forces
  # it even when the model passes combine=false; a named backend still bypasses
  # it. The hub hoists `defaultBackend` first, then walks this list, skipping
  # names in `alwaysInclude`. Targeted combine launches the first 3 remaining
  # backends in parallel and only continues to fill a failure or an empty set
  # (the cap is hardcoded, not configurable). `pkgs.formats.json`/`toJSON`
  # would sort keys alphabetically and lose that order, so we emit the JSON
  # with EXPLICIT key order from searchHubBackends — edit that list to
  # re-order. First wave is three different indexes: Exa (code/docs), Tavily
  # (AI ranking), Serper (Google). Brave fills a hole. Sofya is next, not in
  # the steady-state wave, because search spends the same credit pool as
  # web_read. DuckDuckGo is the free net. Firecrawl is last in the quality
  # walk: a search spends the same credits as a scrape, and scrape is already
  # the second reader. SearXNG and LangSearch are alwaysInclude: queried beside
  # the quality wave, each with its own deadline from query start, and never a
  # quality slot. Free results join the combine fusion on equal footing with
  # quality results (full-weight RRF), each engine contributing at most its
  # `maxResults` hits. duckduckgo needs `ddgs` at runtime (ddgsPython, prefixed onto
  # pi's PATH in piWrapped above).
  searchHubBackends = [
    {
      name = "exa";
      cfg = {
        enabled = true;
        apiKey = "EXA_API_KEY";
      };
    }
    {
      name = "tavily";
      cfg = {
        enabled = true;
        apiKey = "TAVILY_API_KEY";
      };
    }
    {
      name = "serper";
      cfg = {
        enabled = true;
        apiKey = "SERPER_API_KEY";
      };
    }
    {
      name = "brave";
      cfg = {
        enabled = true;
        apiKey = "BRAVE_SEARCH_API_KEY";
      };
    }
    {
      name = "sofya";
      cfg = {
        enabled = true;
        apiKey = "SOFYA_API_KEY";
      };
    }
    {
      name = "duckduckgo";
      cfg.enabled = true;
    }
    {
      name = "firecrawl";
      cfg = {
        enabled = true;
        apiKey = "FIRECRAWL_API_KEY";
      };
    }
    {
      name = "searxng";
      cfg = {
        enabled = true;
        instanceUrl = "https://searx.net.7mind.io";
      };
    }
    {
      name = "langsearch";
      cfg = {
        enabled = true;
        apiKey = "LANGSEARCH_API_KEY";
      };
    }
  ];
  # web_read reader chain (pi-search-hub >= the reader-fallback feature,
  # unreleased v2.9.0 — see nix/pkg/pi-search-hub/package.nix): the tool
  # builds its chain as [ params.reader ?? reader, ...readerFallback minus the
  # head ], so `reader` must ALSO be "sofya" or the implicit "jina"
  # default would jump the queue. Sofya fetches first (clean markdown; a
  # per-URL failure throws), then Firecrawl (live scrape), then Jina
  # (unlimited, rate-limited), then Exa contents — a cache hit succeeds, so Exa
  # must not precede the live readers. 422/5xx/network errors fall
  # through, 401/403 abort the chain as fatal auth defects. An explicit
  # `reader` argument from the model is hoisted to the front and falls
  # through the same chain.
  searchHubConfig = pkgs.writeText "pi-search-hub-config.json" ''
    {
      "defaultBackend": "exa",
      "selectionStrategy": "sequential",
      "combine": true,
      "combineMode": "targeted",
      "alwaysInclude": {
        "searxng": { "timeoutMs": 3000, "maxResults": 3 },
        "langsearch": { "timeoutMs": 5000, "maxResults": 3 }
      },
      "reader": "sofya",
      "readerFallback": ["sofya", "firecrawl", "jina", "exa"],
      "backends": {
    ${lib.concatStringsSep ",\n" (
      map (b: "    ${builtins.toJSON b.name}: ${builtins.toJSON b.cfg}") searchHubBackends
    )}
      }
    }
  '';

  # MCP goes through Pi's built-in MCP extension (pi >= 0.99), which reads
  # only ~/.pi/agent/mcp.json — not the shared ~/.config/mcp/mcp.json — so the
  # programs.mcp registry is re-emitted there. It connects every enabled
  # server at session start and reconnects a dropped one on the next call.
  #
  # Exposure: codemode is disabled (see `-builtin:codemode` below), so servers
  # default to `deferred` — tools stay undeclared until the built-in
  # `tool_search` tool loads them. `directTools` servers (gated by
  # smind.hm.dev.llm.pi.mcpDirectTools) get `direct` exposure instead. Both
  # are Pi-only and stay out of the shared registry used by claude/codex.
  #
  # Shape: match programs.mcp → ~/.config/mcp/mcp.json (null/empty optional
  # fields stripped, type added), then layer the Pi-only exposure. Raw
  # `programs.mcp.servers` submodule attrs carry `url = null`,
  # `enabled = null`, `env = {}`, `headers = {}` defaults; Pi's validator
  # rejects e.g. `enabled: null` ("enabled must be a boolean"), so they are
  # stripped. The empty-value filter mirrors lib.hm.mcp.transformMcpServer
  # (home-manager modules/lib/mcp.nix); reimplemented locally so this module
  # stays evaluable under pure nixpkgs lib (pi-prompt-root-test) without a
  # home-manager input.
  piMcpDirectTools = cfg.pi.mcpDirectTools;
  # Same empty-value filter as lib.hm.mcp.transformMcpServer + addType
  # (also drops disabled/serverUrl, which the shared transform excludes).
  normalizeMcpServer =
    server:
    let
      withType =
        server
        // {
          type =
            if server ? type then
              server.type
            else if (server.url or null) != null then
              "http"
            else
              "stdio";
        };
    in
    lib.filterAttrs (_: value: value != null && value != [ ] && value != { }) (
      removeAttrs withType [
        "disabled"
        "serverUrl"
      ]
    );
  piMcpJson = jsonFormat.generate "pi-mcp.json" {
    mcpServers = lib.mapAttrs
      (
        name: server:
          let
            directToolsEnabled =
              if lib.isList piMcpDirectTools then
                lib.elem name piMcpDirectTools
              else
                piMcpDirectTools;
          in
          (normalizeMcpServer server)
          // { exposure = if directToolsEnabled then "direct" else "deferred"; }
      )
      config.programs.mcp.servers;
  };

  # Repo-agnostic operating manual appended INSIDE Pi's system prompt (via
  # ~/.pi/agent/APPEND_SYSTEM.md, auto-discovered by the resource loader). Pi's
  # built-in prompt is intentionally minimal (four core tools, no plan mode /
  # sub-agents / permission prompts / TODO tool / persistent memory); this fills
  # the harness-operating gap Claude Code provides natively. Deliberately NOT
  # project-specific — per-repo facts belong in AGENTS.md / CLAUDE.md (Pi
  # discovers both). Content lives in pkg/llm-contexts/pi-context.md.
  piAppendSystemPrompt = llmContexts.pi;

  # Inference-provider extension packages, each gated by a
  # `smind.hm.dev.llm.pi.providers.<name>.enable` flag (declared in `options`
  # below). None are enabled by default; all are opt-in. This covers
  # ONLY inference providers — pi-search-hub (web search) is not a provider and
  # stays unconditionally installed (in the static packages list). Every npm spec in
  # `settings.packages` is pinned to an exact version so the managed install
  # stays reproducible.
  inferenceProviderPackages = {
    xai = "npm:pi-xai@0.18.0";
    ollama = "npm:pi-ollama-cloud@0.12.2";
  };
  defaultEnabledProviders = [ ];
  enabledProviderPackages = lib.attrValues (
    lib.filterAttrs (name: _: cfg.pi.providers.${name}.enable) inferenceProviderPackages
  );

  # Wiring common to every skill-aware harness (see claude.nix); spread with
  # `//` into the programs.pi block (no key overlap).
  sharedAgentWiring = {
    enable = true;
    enableMcpIntegration = true;
    skills = cfg.merged.skills;
    context = cfg.merged.memoryText;
  };
in
{
  imports = [
    # Common agent-harness surface (enable/package/configDir/settings/context/
    # skills/enableMcpIntegration), built from the shared factory. Pi config
    # layout (https://pi.dev/docs/latest):
    #   ~/.pi/agent/settings.json   global settings (JSON)
    #   ~/.pi/agent/AGENTS.md       concatenated agent instructions / memory
    #   ~/.pi/agent/skills/<n>/SKILL.md   skills (progressive disclosure)
    #   ~/.pi/agent/extensions/*.ts       auto-discovered TS extensions
    #   settings.packages / settings.extensions   npm:/git: packages + local exts
    #   PI_CODING_AGENT_DIR         overrides the ~/.pi/agent location
    # MCP: Pi's built-in MCP reads ~/.pi/agent/mcp.json, so
    # enableMcpIntegration re-emits the `programs.mcp` registry there.
    (mkAgentHarness {
      name = "pi";
      prettyName = "Pi";
      defaultConfigDir = ".pi/agent";
      configDirEnv = "PI_CODING_AGENT_DIR";
      formatType = "json";
      settingsFile = "settings.json";
      contextFile = "AGENTS.md";
      skillsSubdir = "skills";
      # Ledger (and other) command bundles provide keys like "plan/advance".
      # Materialise as prompts/plan:advance.md so Pi's prompt-template
      # discovery turns them into invocable /plan:advance slash commands
      # (matching the frontmatter description/argument-hint format).
      promptTemplatesSubdir = "prompts";
    })
  ];

  options = {
    # Pi-specific extras on top of the shared agent-harness surface declared by
    # the mkAgentHarness factory above (enable/package/configDir/settings/…).
    programs.pi.extensionsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Directory of TypeScript extensions symlinked into
        {file}`extensions/` under {option}`programs.pi.configDir`.
        Each entry is either {file}`<name>.ts` or {file}`<name>/index.ts`.
      '';
      example = lib.literalExpression "./pi-extensions";
    };

    programs.pi.appendSystemPrompt = lib.mkOption {
      type = lib.types.either lib.types.lines lib.types.path;
      default = "";
      description = ''
        Content appended verbatim to Pi's built-in system prompt, written to
        {file}`APPEND_SYSTEM.md` in {option}`programs.pi.configDir` (Pi
        auto-discovers it there). Unlike {option}`programs.pi.context`
        (AGENTS.md, loaded as {var}`<project_context>`), this lands *inside*
        the system prompt and therefore carries higher authority. Use it for
        global, repo-agnostic behavioural rules; keep project-specific facts
        in {option}`programs.pi.context`. Either inline content or a path.
        Empty string disables the file.
      '';
    };

    smind.hm.dev.llm.pi.mcpDirectTools = lib.mkOption {
      type = lib.types.either lib.types.bool (lib.types.listOf lib.types.str);
      default = false;
      example = [ "codegraph" "ledger" ];
      description = ''
        Declare additional Pi MCP servers' tools to the model directly
        (`exposure = "direct"`) instead of deferring them behind Pi's built-in
        `tool_search` tool (`exposure = "deferred"`). Deferral exists for
        context-window economy (progressive disclosure). `true` sets
        `exposure = "direct"` on every server in
        {option}`programs.mcp.servers`; a list of server names enables it for
        those additional servers. Pi-only: applied in `piMcpJson`, not leaked
        into the shared MCP registry used by claude/codex.
      '';
    };

    # One enable flag per inference-provider extension package (see
    # `inferenceProviderPackages` in the let block). Generated from that mapping
    # so the option set and the install list cannot drift. No provider is
    # enabled by default; all are opt-in. Search-hub is NOT here — it is not
    # an inference provider.
    smind.hm.dev.llm.pi.providers = lib.mapAttrs (name: pkgSpec: {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = lib.elem name defaultEnabledProviders;
        description = ''
          Install the Pi inference-provider extension package
          {command}`${pkgSpec}` (registers the `${name}` provider). No
          provider is enabled by default; all are opt-in.
        '';
      };
    }) inferenceProviderPackages;
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      programs.pi = sharedAgentWiring // {
        # Vendored Pi (see pkg/pi-coding-agent/package.nix), wrapped to put the
        # ddgs python on PATH. Provider/search API keys are supplied
        # by the yolo sandbox (smind.hm.dev.llm.yolo.secretSessionVariables), not here.
        package = lib.mkDefault piWrapped;
        # Repo-agnostic operating manual appended inside Pi's (minimal) system
        # prompt; per-repo facts stay in AGENTS.md/CLAUDE.md (see definition).
        appendSystemPrompt = piAppendSystemPrompt;
        # Deliver contributed bundle commands as Pi prompt templates. The
        # harness materializes keys like
        # "plan/advance" as prompts/plan:advance.md so that /plan:advance
        # works exactly as it does for Claude (/plan:advance) and Codex.
        promptTemplates = cfg.merged.commands;
        settings = {
          inherit (retryPolicy) httpIdleTimeoutMs retry;
          theme = "dark";
          # The configured default does not restrict runtime model switching.
          defaultProvider = cfg.models.pi.provider;
          defaultModel = cfg.models.pi.model;
          defaultThinkingLevel = cfg.models.pi.thinkingLevel;
          tuiMode = if cfg.fullscreenTui.enable then "fullscreen" else "regular";
          compaction = {
            enabled = true;
            reserveTokens = 100000;
            keepRecentTokens = 20000;
          };
          # User-requested: terminal progress (OSC 9;4; off by default in 0.78+),
          # steering/follow-up modes, hide reasoning, disable install telemetry.
          terminal = {
            showTerminalProgress = true;
          };
          steeringMode = "all";
          followUpMode = "all";
          hideThinkingBlock = true;
          enableInstallTelemetry = false;
          # Pi packages (the npm: ones are installed from npm on first run):
          # - pi-search-hub: unified web_search/web_read over 19 backends with
          #   auto-fallback (https://pi.dev/packages/pi-search-hub). Keys via
          #   the sandbox secretSessionVariables; declaratively configured at
          #   ~/.pi/agent/extensions/search.json (see searchHubConfig).
          #   Installed as a LOCAL package built from the npm tarball with a
          #   corrected manifest (piSearchHub above, pkg/pi-search-hub), NOT as
          #   `npm:pi-search-hub@…`: upstream declares the host-provided
          #   `typebox` in `dependencies`, so Pi's managed install warns on
          #   every startup and materialises a duplicate typebox copy
          #   (ronnieops/pi-search-hub#33). Pi never installs local packages,
          #   so the corrected manifest removes both effects (measured: the
          #   package's whole import surface is host-aliased — see the
          #   derivation header). PINNED to 2.8.0 (in
          #   pkg/pi-search-hub/package.nix): patch-search-hub-backends.ts
          #   mirrors upstream's credentials.ts FALLBACK_ENV_MAP; a floating
          #   install could drift ahead of the mirror and silently trim
          #   env-enabled backends from the rewritten enum. Bump the pin (and
          #   re-verify the import surface noted in the derivation header) and
          #   the mirror together; go back to the npm: spec once #33 is fixed
          #   upstream.
          # - pi-anthropic-auth: Claude Pro/Max OAuth compat; activates only on
          #   Anthropic OAuth, passes everything else through (`/login anthropic`).
          # - pi-xai: xAI OAuth provider (`grok-build`) with Grok models/tools
          #   (`/login grok-build`). PINNED to 0.18.0 (requires ≥ 0.9.1). 0.9.1
          #   upstreamed two fixes we previously carried as vendored extensions —
          #     * #2 grok-build-0.1 now reports contextWindow 256k (was the stale
          #       128k that made Pi auto-compact at half budget); and
          #     * #3 `mergeXaiTools` dedupes xAI built-ins by name/type and drops
          #       shadowing client function tools (e.g. pi-search-hub's client
          #       `web_search`) for grok-* under agentic mode — exactly what our
          #       drop-client-web-search-for-grok.ts did.
          #   Both fixes are present in every release since 0.9.1.
          # - pi-ollama-cloud: Ollama Cloud provider (first-party, badlogic).
          #   PINNED to 0.12.2 (its model refresh uses pi's native `refreshModels`,
          #   needs pi ≥ 0.84.0 — vendored pi is 1.0.0).
          #   Registers the `ollama-cloud` provider against https://ollama.com/v1
          #   (apiKey `$OLLAMA_API_KEY`; or ~/.pi/agent/ollama-cloud.json) — no
          #   local server. Self-contained: its only imports (@sinclair/typebox +
          #   the host pi API) come from Pi's jiti alias map, so Pi's managed
          #   `--legacy-peer-deps` install resolves everything.
          #   NOT "npm:@0xkobold/pi-ollama": that one declares the `ollama` npm
          #   package as a *peer* dependency, which Pi's --legacy-peer-deps
          #   managed install skips (and Pi does not alias `ollama`), so it fails
          #   to load with "Cannot find module 'ollama'".
          #   0.7.0 upstreamed the web-tool auth fix we previously carried as
          #   the vendored fix-ollama-cloud-web-tools-auth.ts extension (its
          #   getCloudApiKey now awaits the registry lookup and falls back to
          #   OLLAMA_API_KEY), so the extension was removed — the old copy also
          #   crashed pi 0.80.8+, which dropped the SDK's AuthStorage export.
          # pi-search-hub is unconditional (web search, not an inference
          # provider). The inference-provider packages (pi-xai, pi-ollama-cloud)
          # are each gated by `smind.hm.dev.llm.pi.providers.<name>.enable` —
          # all opt-in (none enabled by default); see `inferenceProviderPackages`.
          # MiniMax uses Pi's built-in `minimax` provider (`MINIMAX_API_KEY`).
          packages = [
            "${piSearchHub}"
            # /usage: usage statistics dashboard (piUsageExtension above,
            # pkg/pi-usage-extension/package.nix — commit-pinned vendored
            # monorepo subdir, not an npm:/git: spec).
            "${piUsageExtension}"
          ] ++ enabledProviderPackages;
          extensions = [
            # Codemode (model-written JS calling tools in a QuickJS sandbox)
            # is deliberately off; MCP tools use `deferred` / `direct`
            # exposure instead (see piMcpJson).
            "-builtin:codemode"
            "${../pkg/pi-extensions/patch-search-hub-backends.ts}"
            "${../pkg/pi-extensions/kimi-401-retry.ts}"
            # Footer model/thinking clicks (fullscreen) plus ctrl+shift+m / ctrl+shift+e.
            "${../pkg/pi-extensions}/model-picker.ts"
            # Per-model TTFT/total/tok-per-sec distributions (JSONL log) and /perf tables.
            "${../pkg/pi-extensions}/model-stats.ts"
            # pi-search-hub advertises a static all-backends list (19 in
            # 2.8.0) in the web_search description + `backend` enum regardless
            # of what's configured, so the model picks unconfigured backends
            # (which fail). Upstream issue #13 was closed without fixing this.
            # This rewrites the web_search tool definition per request to list
            # only the backends actually active per the live search.json. See
            # the extension header and the upstream bug-report draft.
          ];
        };
      };

      # Declarative pi-search-hub config (see searchHubConfig). RO store symlink,
      # like settings.json.
      home.file.".pi/agent/extensions/search.json".source = searchHubConfig;

    }
    # Pi-specific extras (gated on the programs.pi sub-options declared above).
    # Pi's built-in MCP reads ~/.pi/agent/mcp.json (see piMcpJson). RO store
    # symlink: /mcp exposure and enable/disable changes fail with "Could not
    # update …"; make them in programs.mcp / mcpDirectTools instead.
    (lib.mkIf piCfg.enableMcpIntegration {
      home.file."${piCfg.configDir}/mcp.json".source = piMcpJson;
    })
    (lib.mkIf (piCfg.extensionsDir != null) {
      home.file."${piCfg.configDir}/extensions" = {
        source = piCfg.extensionsDir;
        recursive = true;
      };
    })
    (lib.mkIf (piCfg.appendSystemPrompt != "") {
      home.file."${piCfg.configDir}/APPEND_SYSTEM.md" =
        if lib.isPath piCfg.appendSystemPrompt then
          { source = piCfg.appendSystemPrompt; }
        else
          { text = piCfg.appendSystemPrompt; };
    })
  ]);
}
