{
  description = "Pi, Codex, Claude Code, and yolo coding-agent environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    codegraph = {
      url = "github:colbymchenry/codegraph";
      flake = false;
    };
    crawl4ai = {
      url = "github:unclecode/crawl4ai/v0.9.4";
      flake = false;
    };
    openai-codex-plugin = {
      url = "github:openai/codex-plugin-cc";
      flake = false;
    };
    claude-code-sandbox.url = "github:neko-kai/claude-code-sandbox";
  };

  outputs = inputs@{ self, nixpkgs, flake-utils, ... }:
    (flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-darwin" ] (system:
      let
        pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
        skills = pkgs.callPackage ./nix/pkg/llm-skills/default.nix { };
        contexts = pkgs.callPackage ./nix/pkg/llm-contexts/default.nix { };
        podmanModuleConfig = (nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            self.nixosModules.podman
            ({ lib, ... }: {
              options.home-manager.users = lib.mkOption {
                type = lib.types.attrsOf lib.types.anything;
                default = { };
              };
              config = {
                system.stateVersion = "26.11";
                smind.containers.docker.enable = true;
                users.users.agent.isNormalUser = true;
                home-manager.users = {
                  agent.smind.hm.dev.llm.enable = true;
                  root.smind.hm.dev.llm.enable = true;
                };
              };
            })
          ];
        }).config;
        podmanModuleCheck =
          assert podmanModuleConfig.virtualisation.podman.enable;
          assert !podmanModuleConfig.virtualisation.podman.dockerSocket.enable;
          assert !podmanModuleConfig.systemd.services.podman.enable;
          assert !podmanModuleConfig.systemd.sockets.podman.enable;
          assert podmanModuleConfig.systemd.user.sockets.podman-llm.socketConfig.ListenStream == "/run/podman-llm/podman.sock";
          assert podmanModuleConfig.systemd.user.sockets.podman-llm.socketConfig.SocketMode == "0660";
          assert podmanModuleConfig.users.users.podsvc-llm.uid == 77778;
          assert builtins.elem "podsvc-llm" podmanModuleConfig.users.users.agent.extraGroups;
          assert !(builtins.elem "podsvc-llm" podmanModuleConfig.users.users.root.extraGroups);
          pkgs.runCommandLocal "podman-module-test" { } "touch $out";
        devLlmModuleBoundaryCheck =
          assert builtins.functionArgs (import ./nix/hm/dev-llm.nix) == { inputs = false; };
          pkgs.runCommandLocal "dev-llm-module-boundary-test" { } "touch $out";
        devLlmHaystackAggregationCheck =
          assert builtins.elem ./nix/hm/haystack.nix (import ./nix/hm/dev-llm.nix { inputs = { }; }).imports;
          pkgs.runCommandLocal "dev-llm-haystack-aggregation-test" { } "touch $out";
        defaultModels = (nixpkgs.lib.evalModules {
          specialArgs = { inherit pkgs; };
          modules = [
            (import ./nix/hm/tools.nix { inherit inputs; })
            ({ lib, ... }: {
              options = {
                assertions = lib.mkOption {
                  type = lib.types.listOf lib.types.attrs;
                  default = [ ];
                };
                home.packages = lib.mkOption {
                  type = lib.types.listOf lib.types.package;
                  default = [ ];
                };
                programs.mcp = lib.mkOption {
                  type = lib.types.attrs;
                  default = { };
                };
              };
            })
          ];
        }).config.smind.hm.dev.llm.models;
        defaultModelsCheck =
          assert defaultModels.codex.model == "gpt-6.1-sol";
          assert defaultModels.codex.reasoningEffort == "medium";
          assert defaultModels.claude.model == "opus";
          assert defaultModels.claude.effort == "high";
          assert defaultModels.pi.provider == "xiaomi-token-plan-ams";
          assert defaultModels.pi.model == "mimo-v2.6-pro";
          pkgs.runCommandLocal "default-models-test" { } "touch $out";
        # The declarative subagents-policy.json must stay complete: every
        # field the extension's loadPolicy reads, with the hm-level empty
        # readRoots rewritten to [checkoutPath] exactly like the extension.
        subagentsPolicyShapeCheck =
          let
            mkPolicy = import ./nix/lib/subagents-policy.nix;
            listed = mkPolicy {
              allowAllModels = false;
              allowedModels = [ { provider = "meta"; id = "muse-spark-1.3"; } ];
              maxDepth = 2;
              nesting = true;
              repos = [
                { repoId = "myrepo"; checkoutPath = "/home/user/src/myrepo"; readRoots = [ ]; allowWriters = true; }
                { repoId = "other"; checkoutPath = "/o"; readRoots = [ "/o" "/o/lib" ]; allowWriters = false; }
              ];
              gateBypassAllowed = true;
              gateMaxRoundsCeiling = null;
            };
            open = mkPolicy {
              allowAllModels = true;
              allowedModels = [ { provider = "zai"; id = "glm-5.3"; } ];
              maxDepth = 1;
              nesting = false;
              repos = [ ];
              gateBypassAllowed = false;
              gateMaxRoundsCeiling = 3;
            };
          in
          assert builtins.attrNames listed == [ "allowedModels" "gateBypassAllowed" "gateMaxRoundsCeiling" "maxDepth" "nesting" "repos" ];
          assert listed == {
            maxDepth = 2;
            nesting = true;
            repos = [
              { repoId = "myrepo"; checkoutPath = "/home/user/src/myrepo"; readRoots = [ "/home/user/src/myrepo" ]; allowWriters = true; }
              { repoId = "other"; checkoutPath = "/o"; readRoots = [ "/o" "/o/lib" ]; allowWriters = false; }
            ];
            allowedModels = [ { provider = "meta"; id = "muse-spark-1.3"; } ];
            gateBypassAllowed = true;
            gateMaxRoundsCeiling = null;
          };
          assert open == {
            maxDepth = 1;
            nesting = false;
            repos = [ ];
            allowedModels = null;
            gateBypassAllowed = false;
            gateMaxRoundsCeiling = 3;
          };
          pkgs.runCommandLocal "subagents-policy-shape-test" { } "touch $out";
      in
      {
        packages = {
          llm-skills = skills.package;
          llm-contexts = contexts.package;
          llm-context-with-env = pkgs.runCommandLocal "context-with-env.md" { } ''
            : "${skills.package}"
            cp ${pkgs.writeText "context-with-env-body" (contexts.general + "\n\n" + skills.environmentContent)} "$out"
          '';
          claude-code = pkgs.callPackage ./nix/pkg/claude-code/package.nix { };
          codex = pkgs.callPackage ./nix/pkg/codex/package.nix { };
          pi-coding-agent = pkgs.callPackage ./nix/pkg/pi-coding-agent/package.nix { };
          pi-search-hub = pkgs.callPackage ./nix/pkg/pi-search-hub/package.nix { };
          codegraph = pkgs.callPackage ./nix/pkg/codegraph/package.nix { src = inputs.codegraph; };
          crawl4ai-mcp = pkgs.callPackage ./nix/pkg/crawl4ai/mcp.nix { };
          tokemon = pkgs.callPackage ./nix/pkg/tokemon/package.nix { };
          tui-tmux = pkgs.callPackage ./nix/pkg/tui-tmux/default.nix { };
          haystack = pkgs.callPackage ./nix/pkg/haystack/package.nix { };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          crawl4ai = pkgs.callPackage ./nix/pkg/crawl4ai/package.nix { src = inputs.crawl4ai; };
          reattach-llm = pkgs.callPackage ./nix/pkg/reattach-llm/default.nix { };
          yolo = pkgs.callPackage ./nix/pkg/yolo/default.nix { };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
          yolo-darwin = pkgs.callPackage ./nix/pkg/yolo-darwin/default.nix {
            claude-code-sandbox = inputs.claude-code-sandbox.packages.${system}.default;
          };
          yolo = self.packages.${system}.yolo-darwin;
        };
        checks = {
          default-models = defaultModelsCheck;
          notify-module = pkgs.callPackage ./nix/tests/notify-module.nix { };
          tui-terminal = self.packages.${system}.tui-tmux.tests.terminal;
          tui-hm-eval = import ./nix/hm/tui-tools-test.nix { inherit pkgs inputs; };
          haystack = self.packages.${system}.haystack;
          haystack-nixos-eval =
            let
              mkSystem = extra: (nixpkgs.lib.nixosSystem {
                inherit system;
                modules = [
                  self.nixosModules.haystack
                  ({ lib, ... }: lib.recursiveUpdate
                    {
                      system.stateVersion = "26.11";
                      smind.services.haystack.enable = true;
                    }
                    extra)
                ];
              }).config;
              fullUsers = {
                operator = {
                  type = "human";
                  tokens.browser.tokenHashFile = "/run/secrets/human-sha";
                };
                w-agent = {
                  type = "agent";
                  tokens.default.tokenHashFile = "/run/secrets/agent-sha";
                };
              };
              fullClients = {
                alice.userId = "w-agent";
                alice.tokenId = "default";
                alice.tokenFile = "/run/secrets/agent-token";
              };
              full = mkSystem {
                smind.services.haystack.users = fullUsers;
                smind.services.haystack.clients = fullClients;
                smind.services.haystack.publicUrl = "https://memory.example.net";
              };
              serverOnly = mkSystem { smind.services.haystack.users = fullUsers; };
              externalEdge = mkSystem {
                smind.services.haystack.users = fullUsers;
                smind.services.haystack.clients = fullClients;
                smind.services.haystack.publicUrl = "https://memory.example.net";
                smind.services.haystack.proxy.enable = false;
              };
              # Negative cases run our module under evalModules with stubbed
              # NixOS options: full nixosSystem carries unrelated assertions
              # that fail in minimal configs, and projecting one attr skips
              # assertion checks entirely. Our messages are pure strings, so
              # forcing the filtered list is safe here.
              forceChecked = extra: builtins.tryEval (
                let
                  sys = nixpkgs.lib.evalModules {
                    specialArgs = { pkgs = import nixpkgs { inherit system; }; };
                    modules = [
                      self.nixosModules.haystack
                      ({ lib, ... }: {
                        options.services.postgresql = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                        options.systemd.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                        options.services.nginx = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                        options.networking.firewall = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                      })
                      ({ lib, ... }: lib.recursiveUpdate
                        { smind.services.haystack.enable = true; }
                        extra)
                    ];
                  };
                  ours = builtins.filter
                    (a: nixpkgs.lib.hasPrefix "smind.services.haystack" a.message)
                    sys.config.assertions;
                in
                builtins.deepSeq (map (a: a.assertion) ours) true
              );
              humanMapping = forceChecked {
                smind.services.haystack.users = fullUsers;
                smind.services.haystack.clients.alice = {
                  userId = "operator";
                  tokenId = "browser";
                  tokenFile = "/run/secrets/x";
                };
              };
              unknownToken = forceChecked {
                smind.services.haystack.users = fullUsers;
                smind.services.haystack.clients.alice = {
                  userId = "w-agent";
                  tokenId = "nope";
                  tokenFile = "/run/secrets/x";
                };
              };
              firewallWithoutProxy = forceChecked {
                smind.services.haystack.users = fullUsers;
                smind.services.haystack.clients = fullClients;
                smind.services.haystack.publicUrl = "https://memory.example.net";
                smind.services.haystack.proxy.enable = false;
                smind.services.haystack.proxy.openFirewall = true;
              };
            in
            assert full.systemd.services.haystack.description != "";
            assert builtins.elem "multi-user.target" full.systemd.services.haystack.wantedBy;
            # Digest credentials load via LoadCredential, never store material.
            assert builtins.elem "haystack-hash-w-agent-default:/run/secrets/agent-sha"
              full.systemd.services.haystack.serviceConfig.LoadCredential;
            assert (builtins.elemAt full.services.postgresql.ensureUsers 0).name == "haystack";
            # Server-only host: we enable no proxy and open no firewall ports.
            assert !serverOnly.services.nginx.enable;
            assert serverOnly.networking.firewall.allowedTCPPorts == [ ];
            # External edge (proxy.enable = false): no host virtual host and
            # no firewall ports, but the service itself is unaffected.
            assert !(externalEdge.services.nginx.virtualHosts ? "memory.example.net");
            assert externalEdge.networking.firewall.allowedTCPPorts == [ ];
            assert externalEdge.systemd.services.haystack.description != "";
            # Full host: proxy on, firewall still closed unless asked.
            assert full.services.nginx.virtualHosts ? "memory.example.net";
            assert full.services.nginx.virtualHosts."memory.example.net".root == "${full.smind.services.haystack.package}/lib/node_modules/haystack/web/dist";
            assert full.services.nginx.virtualHosts."memory.example.net".locations."/".proxyPass == null;
            assert full.services.nginx.virtualHosts."memory.example.net".locations."/api/".proxyWebsockets;
            assert full.services.nginx.virtualHosts."memory.example.net".locations."/mcp".proxyWebsockets;
            assert full.networking.firewall.allowedTCPPorts == [ ];
            # Human credentials and unknown tokens are rejected as mappings.
            assert !humanMapping.success;
            assert !unknownToken.success;
            # Firewall ports without a managed proxy are rejected.
            assert !firewallWithoutProxy.success;
            pkgs.runCommandLocal "haystack-nixos-eval-test" { } "touch $out";
          haystack-hm-eval =
            let
              evalHaystackHm = sys: tokenFile: osConfig: (nixpkgs.lib.evalModules {
                specialArgs = { pkgs = import nixpkgs { system = sys; }; inherit osConfig; };
                modules = [
                  self.homeManagerModules.haystack
                  ({ lib, ... }: {
                    options.assertions = lib.mkOption {
                      type = lib.types.listOf lib.types.attrs;
                      default = [ ];
                    };
                    # Minimal stand-ins for the real HM options this client
                    # module contributes to (programs.mcp/codex, yolo vars,
                    # home.packages, home.username).
                    options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
                    options.smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
                    options.smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
                    options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
                    options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
                  })
                  ({ ... }: {
                    config.smind.hm.dev.llm.haystack = {
                      enable = true;
                      url = "http://127.0.0.1:47328";
                      inherit tokenFile;
                      userId = "workstation-agent";
                      tokenId = "default";
                      activityProjectId = "agent-activity";
                    };
                    # A pre-existing unrelated server must survive composition.
                    config.programs.mcp.servers.codegraph = { command = "/bin/false"; };
                  })
                ];
              });
              linuxMod = evalHaystackHm "x86_64-linux" "/run/secrets/haystack-token" null;
              darwinMod = evalHaystackHm "aarch64-darwin" "/run/secrets/haystack-token" null;
              disabledMod = linuxMod.extendModules {
                modules = [ { smind.hm.dev.llm.haystack.enable = nixpkgs.lib.mkForce false; } ];
              };
              linuxCfg = linuxMod.config.smind.hm.dev.llm.haystack;
              darwinCfg = darwinMod.config.smind.hm.dev.llm.haystack;
              # NixOS-mapped account: no explicit url/tokenFile; resolved
              # from osConfig service + clients mapping.
              mappedMod = (nixpkgs.lib.evalModules {
                specialArgs = {
                  pkgs = import nixpkgs { system = "x86_64-linux"; };
                  osConfig = {
                    smind.services.haystack = {
                      enable = true;
                      port = 47328;
                      activityProjectId = "agent-activity";
                      clients.alice = {
                        userId = "w-agent";
                        tokenId = "default";
                        tokenFile = "/run/secrets/agent-token";
                      };
                    };
                  };
                };
                modules = [
                  self.homeManagerModules.haystack
                  ({ lib, ... }: {
                    options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
                    options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = true; };
                    options.smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
                    options.smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
                    options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
                    options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
                  })
                  # No explicit enable: auto-enable must resolve it.
                  ({ ... }: { })
                ];
              });
              mappedCfg = mappedMod.config.smind.hm.dev.llm.haystack;
            in
            assert linuxCfg.url == "http://127.0.0.1:47328";
            assert darwinCfg.url == "http://127.0.0.1:47328";
            # One logical entry; literal placeholder (no secret) for Claude/Pi.
            assert linuxMod.config.programs.mcp.servers.haystack.url == "http://127.0.0.1:47328/mcp";
            assert linuxMod.config.programs.mcp.servers.haystack.headers.Authorization == "Bearer \${HAYSTACK_TOKEN}";
            # Narrow native Codex override.
            assert linuxMod.config.programs.codex.settings.mcp_servers.haystack.bearer_token_env_var == "HAYSTACK_TOKEN";
            # Exact-byte-validated transport wiring.
            assert linuxMod.config.smind.hm.dev.llm.yolo.validatedSessionVariables.HAYSTACK_TOKEN == "/run/secrets/haystack-token";
            # The module's own assertions hold for these configurations.
            assert nixpkgs.lib.all (a: a.assertion) linuxMod.config.assertions;
            assert nixpkgs.lib.all (a: a.assertion) darwinMod.config.assertions;
            assert nixpkgs.lib.all (a: a.assertion) mappedMod.config.assertions;
            # Unrelated servers survive composition.
            assert linuxMod.config.programs.mcp.servers.codegraph.command == "/bin/false";
            # Shared policy reaches the bundle with the resolved namespace.
            assert nixpkgs.lib.any
              (b: builtins.match ".*agent-activity.*" (builtins.concatStringsSep "\n" (b.context or [ ])) != null)
              linuxMod.config.smind.hm.dev.llm.assetBundles;
            assert nixpkgs.lib.any
              (b: builtins.match ".*human-attention:required.*" (builtins.concatStringsSep "\n" (b.context or [ ])) != null)
              linuxMod.config.smind.hm.dev.llm.assetBundles;
            assert nixpkgs.lib.all (module:
              let policy = builtins.concatStringsSep "\n" (nixpkgs.lib.concatMap (b: b.context or [ ]) module.config.smind.hm.dev.llm.assetBundles);
              in nixpkgs.lib.all (text: nixpkgs.lib.hasInfix text policy) [
                "gh api user" "using subagents" "Save useful candidates to Haystack"
                "verify the persisted revision with get"
                "Typed field nodes" "fields.skill_name" "Markdown code fences"
              ]) [ linuxMod darwinMod mappedMod ];
            assert disabledMod.config.smind.hm.dev.llm.assetBundles == [ ];
            assert !(disabledMod.config.programs.mcp.servers ? haystack);
            # Mapped account resolves everything from osConfig.
            assert mappedCfg.enable == true;
            assert mappedMod.config.programs.mcp.servers.haystack.url == "http://127.0.0.1:47328/mcp";
            assert mappedMod.config.smind.hm.dev.llm.yolo.validatedSessionVariables.HAYSTACK_TOKEN == "/run/secrets/agent-token";
            pkgs.runCommandLocal "haystack-hm-eval-test" { } "touch $out";
          # haystack-run wrapper: exact-byte accept/reject behavior.
          haystack-run-check =
            let
              evalWithToken = tokenFile: (nixpkgs.lib.evalModules {
                specialArgs = { pkgs = import nixpkgs { system = "x86_64-linux"; }; osConfig = null; };
                modules = [
                  self.homeManagerModules.haystack
                  ({ lib, ... }: {
                    options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
                    options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                    options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
                    options.smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
                    options.smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
                    options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
                    options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
                  })
                  ({ ... }: {
                    config.smind.hm.dev.llm.haystack = {
                      enable = true;
                      url = "http://127.0.0.1:47328";
                      inherit tokenFile;
                      userId = "workstation-agent";
                      tokenId = "default";
                      activityProjectId = "agent-activity";
                    };
                  })
                ];
              });
              good43 = nixpkgs.lib.concatStringsSep "" (builtins.genList (_: "A") 43);
              tok43 = pkgs.writeText "haystack-good-token" good43;
              tok44 = pkgs.writeText "haystack-good-token-lf" (good43 + "\n");
              tokBad = pkgs.writeText "haystack-bad-token" "short";
              runFor = file: builtins.head (builtins.filter
                (p: (p.pname or p.name) == "haystack-run")
                (evalWithToken file).config.home.packages);
              goodRun = runFor tok43;
              lfRun = runFor tok44;
              badRun = runFor tokBad;
              missingRun = runFor "/run/does-not-exist";
            in
            pkgs.runCommandLocal "haystack-run-test"
              { nativeBuildInputs = [ pkgs.coreutils pkgs.ripgrep ]; }
              ''
                ${goodRun}/bin/haystack-run true
                ${goodRun}/bin/haystack-run sh -c 'test "$HAYSTACK_TOKEN" = "${good43}"'
                ${lfRun}/bin/haystack-run sh -c 'test "$HAYSTACK_TOKEN" = "${good43}"'
                ! ${badRun}/bin/haystack-run true
                ! ${missingRun}/bin/haystack-run true
                # The wrapper embeds the token FILE path, never its content.
                ${goodRun}/bin/haystack-run sh -c 'echo "$HAYSTACK_TOKEN"' | grep -q "${good43}"
                ! rg -q "${good43}" ${goodRun}
                touch $out
              '';
          subagents-policy-shape = subagentsPolicyShapeCheck;
          tokemon = self.packages.${system}.tokemon;
          dev-llm-module-boundary = devLlmModuleBoundaryCheck;
          dev-llm-haystack-aggregation = devLlmHaystackAggregationCheck;
          ponygirls-quirk-kimi-401-retry = pkgs.runCommand "ponygirls-quirk-kimi-401-retry-test" {
            nativeBuildInputs = [ pkgs.bun ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            bun test ponygirls-quirk-kimi-401-retry.test.ts
            touch $out
          '';
          ponygirls-model-stats = pkgs.runCommand "ponygirls-model-stats-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            node --test ponygirls-model-stats-state.test.ts
            touch $out
          '';
          ponygirls-usage = pkgs.runCommand "ponygirls-usage-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            node --test ponygirls-usage-state.test.ts
            touch $out
          '';
          ponygirls-codex-goals = pkgs.runCommand "ponygirls-codex-goals-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_GOALS_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-codex-goals} ponygirls-codex-goals
            chmod -R u+w ponygirls-codex-goals
            cd ponygirls-codex-goals
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_GOALS_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/typebox" node_modules/typebox
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.ts
            node --test tests/host.test.mjs
            touch $out
          '';
          ponygirls-subagents = pkgs.runCommand "ponygirls-subagents-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.git pkgs.bubblewrap ];
            PI_SUBAGENTS_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-subagents} ponygirls-subagents
            chmod -R u+w ponygirls-subagents
            cd ponygirls-subagents
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_SUBAGENTS_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_SUBAGENTS_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_SUBAGENTS_SDK_ROOT/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
            ln -s "$PI_SUBAGENTS_SDK_ROOT/node_modules/@earendil-works/pi-agent-core" node_modules/@earendil-works/pi-agent-core
            ln -s "$PI_SUBAGENTS_SDK_ROOT/node_modules/typebox" node_modules/typebox
            ln -s "$PI_SUBAGENTS_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            PI_SUBAGENTS_SDK_ROOT="$PI_SUBAGENTS_SDK_ROOT" node --test tests/*.test.ts
            touch $out
          '';
          ponygirls-tokemon = pkgs.runCommand "ponygirls-tokemon-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-tokemon} ponygirls-tokemon
            chmod -R u+w ponygirls-tokemon
            cd ponygirls-tokemon
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_SDK_ROOT/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
            ln -s "$PI_SDK_ROOT/node_modules/@earendil-works/pi-agent-core" node_modules/@earendil-works/pi-agent-core
            ln -s "$PI_SDK_ROOT/node_modules/typebox" node_modules/typebox
            ln -s "$PI_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.ts
            touch $out
          '';
          ponygirls-bg-tasks =
            let
              pi = self.packages.${system}.pi-coding-agent;
              # The same executables the Home Manager wrapper supplies (wrapper-args.nix).
              piWrapped = pkgs.runCommand "pi-bg-tasks-wrapped" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
                makeWrapper ${pi}/bin/pi $out/bin/pi \
                  ${pkgs.callPackage ./nix/pkg/pi-extensions/ponygirls-bg-tasks/wrapper-args.nix { }}
              '';
            in
            pkgs.runCommand "ponygirls-bg-tasks-test" {
              nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.python3 pkgs.bash pkgs.coreutils pkgs.procps ];
              PI_BG_TASKS_SDK_ROOT = "${pi}/lib/node_modules/pi-monorepo";
              PI_BG_TASKS_PYTHON = "${pkgs.python3}/bin/python3";
              PI_BG_TASKS_SHELL = "${pkgs.bash}/bin/bash";
              PI_BG_TASKS_PI = "${piWrapped}/bin/pi";
              PI_BG_TASKS_EXTENSION = "${./nix/pkg/pi-extensions/ponygirls-bg-tasks}";
              PI_OFFLINE = "1";
              PI_TELEMETRY = "0";
            } ''
              export HOME=$TMPDIR
              cp -r ${./nix/pkg/pi-extensions/ponygirls-bg-tasks} ponygirls-bg-tasks
              chmod -R u+w ponygirls-bg-tasks
              cd ponygirls-bg-tasks
              mkdir -p node_modules/@earendil-works
              ln -s "$PI_BG_TASKS_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
              ln -s "$PI_BG_TASKS_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
              ln -s "$PI_BG_TASKS_SDK_ROOT/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
              ln -s "$PI_BG_TASKS_SDK_ROOT/node_modules/@earendil-works/pi-agent-core" node_modules/@earendil-works/pi-agent-core
              ln -s "$PI_BG_TASKS_SDK_ROOT/node_modules/typebox" node_modules/typebox
              ln -s "$PI_BG_TASKS_SDK_ROOT/node_modules/@types" node_modules/@types
              tsc -p tsconfig.json
              python3 -m unittest discover -s tests -p '*_test.py'
              node --test tests/*.test.ts tests/*.test.mjs
              touch $out
            '';
          yolo-profile = pkgs.runCommand "yolo-profile-test" {
            nativeBuildInputs = [ pkgs.bash pkgs.jq pkgs.coreutils pkgs.gnugrep pkgs.gawk pkgs.python3 pkgs.sqlite pkgs.util-linux ];
          } ''
            cp -r ${./nix/pkg/yolo} yolo
            chmod -R u+w yolo
            cd yolo
            bash llm-sandbox-test.sh
            bash profile-test.sh
            bash resource-limits-test.sh
            bash sandbox-entrypoint-test.sh
            touch $out
          '';
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          podman-module = podmanModuleCheck;
          crawl4ai-module =
            let
              crawl4aiConfig = (nixpkgs.lib.nixosSystem {
                inherit system;
                modules = [
                  self.nixosModules.crawl4ai
                  self.nixosModules.crawl4ai-isolation
                  ({
                    config,
                    lib,
                    ...
                  }: {
                    system.stateVersion = "26.11";
                    smind.services.crawl4ai = {
                      enable = true;
                      package = self.packages.${system}.crawl4ai;
                    };
                    smind.services.crawl4ai.isolation.enable = true;
                    assertions = [
                      {
                        assertion = config.systemd.services.crawl4ai.serviceConfig.User == "crawl4ai";
                        message = "crawl4ai service user";
                      }
                      {
                        assertion = config.systemd.services.crawl4ai-isolation.serviceConfig.Type == "oneshot";
                        message = "crawl4ai isolation unit";
                      }
                      {
                        assertion = builtins.elem 11235 config.networking.firewall.allowedTCPPorts;
                        message = "crawl4ai port";
                      }
                    ];
                  })
                ];
              }).config;
            in
            assert crawl4aiConfig.systemd.services ? crawl4ai-redis;
            assert !(crawl4aiConfig.systemd.services ? container-crawl4ai);
            assert !(crawl4aiConfig.systemd.services ? "container@crawl4ai");
            assert builtins.elem "container@crawl4ai.service" crawl4aiConfig.systemd.services.crawl4ai-isolation.requiredBy;
            assert builtins.elem "container@crawl4ai.service" crawl4aiConfig.systemd.services.crawl4ai-isolation.before;
            assert !(crawl4aiConfig.environment.etc ? "systemd/system/container@crawl4ai.service.d/isolation.conf");
            assert !(builtins.elem "f /var/lib/crawl4ai/redis-password 0400 crawl4ai crawl4ai -" crawl4aiConfig.systemd.tmpfiles.rules);
            pkgs.runCommandLocal "crawl4ai-module-test" { } ''
              test -n ${crawl4aiConfig.systemd.services.crawl4ai.serviceConfig.ExecStart}
              grep -q 'rm -f /var/lib/crawl4ai/redis-password' ${crawl4aiConfig.systemd.services.crawl4ai-redis.serviceConfig.ExecStart}
              touch "$out"
            '';
          crawl4ai-isolation-syntax = pkgs.runCommand "crawl4ai-isolation-syntax" { } ''
            substitute ${./nix/lib/crawl4ai-isolation.nft} "$out" \
              --replace-fail '@ifname@' ve-crawl4ai
            grep -q 'iifname "ve-crawl4ai"' "$out"
            grep -q '192.168.0.0/16' "$out"
          '';
        };
      })) // {
        homeManagerModules.dev-llm = import ./nix/hm/dev-llm.nix { inherit inputs; };
        homeManagerModules.haystack = import ./nix/hm/haystack.nix;
        nixosModules.haystack = import ./nix/nixos/haystack.nix;
        nixosModules.podman = import ./nix/nixos/podman.nix;
        nixosModules.crawl4ai = import ./nix/nixos/crawl4ai.nix;
        nixosModules.crawl4ai-isolation = import ./nix/nixos/crawl4ai-isolation.nix;
      };
}
