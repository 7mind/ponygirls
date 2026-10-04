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
          pi-usage-extension = pkgs.callPackage ./nix/pkg/pi-usage-extension/package.nix { };
          codegraph = pkgs.callPackage ./nix/pkg/codegraph/package.nix { src = inputs.codegraph; };
          crawl4ai-mcp = pkgs.callPackage ./nix/pkg/crawl4ai/mcp.nix { };
          tokemon = pkgs.callPackage ./nix/pkg/tokemon/package.nix { };
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
          tokemon = self.packages.${system}.tokemon;
          dev-llm-module-boundary = devLlmModuleBoundaryCheck;
          kimi-401-retry = pkgs.runCommand "kimi-401-retry-test" {
            nativeBuildInputs = [ pkgs.bun ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            bun test kimi-401-retry.test.ts
            touch $out
          '';
          model-stats = pkgs.runCommand "model-stats-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            node --test model-stats-state.test.ts
            touch $out
          '';
          yolo-profile = pkgs.runCommand "yolo-profile-test" {
            nativeBuildInputs = [ pkgs.bash pkgs.jq pkgs.coreutils pkgs.gnugrep pkgs.gawk pkgs.python3 pkgs.sqlite ];
          } ''
            cp -r ${./nix/pkg/yolo} yolo
            chmod -R u+w yolo
            cd yolo
            bash llm-sandbox-test.sh
            bash profile-test.sh
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
            assert crawl4aiConfig.systemd.services.container-crawl4ai.requires == [ "crawl4ai-isolation.service" ]
              || builtins.elem "crawl4ai-isolation.service" crawl4aiConfig.systemd.services.container-crawl4ai.requires;
            pkgs.runCommandLocal "crawl4ai-module-test" { } ''
              test -n ${crawl4aiConfig.systemd.services.crawl4ai.serviceConfig.ExecStart}
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
        nixosModules.podman = import ./nix/nixos/podman.nix;
        nixosModules.crawl4ai = import ./nix/nixos/crawl4ai.nix;
        nixosModules.crawl4ai-isolation = import ./nix/nixos/crawl4ai-isolation.nix;
      };
}
