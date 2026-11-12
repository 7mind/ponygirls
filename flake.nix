{
  description = "Pi, Codex, Claude Code, and yolo coding-agent environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    squish = {
      url = "github:7mind/squish-find-the-brains/main";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    codegraph = {
      url = "github:colbymchenry/codegraph";
      flake = false;
    };
    crawl4ai = {
      url = "github:unclecode/crawl4ai/v0.9.5";
      flake = false;
    };
    openai-codex-plugin = {
      url = "github:openai/codex-plugin-cc";
      flake = false;
    };
    claude-code-sandbox = {
      url = "github:neko-kai/claude-code-sandbox";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs@{ self, nixpkgs, flake-utils, ... }:
    (flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-darwin" ] (system:
      let
        pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
        skills = pkgs.callPackage ./nix/pkg/llm-skills/default.nix { };
        contexts = pkgs.callPackage ./nix/pkg/llm-contexts/default.nix { };
        chronicleTools = pkgs.callPackage ./nix/pkg/chronicle/toolchain.nix { };
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
        devLlmManureAggregationCheck =
          assert builtins.elem ./nix/hm/manure.nix (import ./nix/hm/dev-llm.nix { inputs = { }; }).imports;
          pkgs.runCommandLocal "dev-llm-manure-aggregation-test" { } "touch $out";
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
              allowedTools = [ "mcp__codegraph__codegraph_explore" ];
              worktreeRoot = "/srv/nvme/subagents-worktrees";
              maxDepth = 2;
              nesting = true;
              repos = [
                { repoId = "myrepo"; checkoutPath = "/home/user/src/myrepo"; readRoots = [ ]; allowWriters = true; }
                { repoId = "other"; checkoutPath = "/o"; readRoots = [ "/o" "/o/lib" ]; allowWriters = false; }
              ];
              gateBypassAllowed = true;
              gateMaxRoundsCeiling = null;
              workspaceRoots = [ "/home/user/worktrees" ];
              workspaceOwnerCheckoutAllowed = true;
              maxRunnable = 8;
              maxResidentWorkers = 12;
              maxOpenAgents = 40;
            };
            open = mkPolicy {
              allowAllModels = true;
              allowedModels = [ { provider = "zai"; id = "glm-5.3"; } ];
              allowedTools = [ ];
              worktreeRoot = null;
              maxDepth = 1;
              nesting = false;
              repos = [ ];
              gateBypassAllowed = false;
              gateMaxRoundsCeiling = 3;
              workspaceRoots = [ ];
              workspaceOwnerCheckoutAllowed = false;
              maxRunnable = 4;
              maxResidentWorkers = 8;
              maxOpenAgents = 32;
            };
            # HM-level wiring for subagentsAllowedTools: least-privilege
            # codegraph default only when a `codegraph` MCP server is
            # configured (never from yolo/codegraph-bootstrap state). Minimal
            # evalModules with narrow leaf stubs only — never a full machine
            # config — so the conditional default cannot enable unrelated
            # options or recurse into the HM config.
            evalAllowedTools = mcpServers: piExtra: (nixpkgs.lib.evalModules {
              specialArgs = { pkgs = import nixpkgs { inherit system; }; };
              modules = [
                ./nix/hm/pi.nix
                ({ lib, ... }: {
                  options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
                  options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
                  options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
                  options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
                  options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
                  options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
                  options.smind.hm.dev.llm.merged.skills = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.merged.commands = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.merged.memoryText = lib.mkOption { type = lib.types.str; default = ""; };
                  options.smind.hm.dev.llm.models.pi.provider = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.models.pi.model = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.models.pi.thinkingLevel = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption { type = lib.types.bool; default = false; };
                })
                ({ ... }: {
                  config.smind.hm.dev.llm.enable = true;
                  config.programs.mcp.servers = mcpServers;
                  config.smind.hm.dev.llm.pi = piExtra;
                })
              ];
            }).config.smind.hm.dev.llm.pi.subagentsAllowedTools;
            absentDefault = evalAllowedTools { } { };
            presentDefault = evalAllowedTools { codegraph = { command = "/bin/false"; }; } { };
            disabledOverride = evalAllowedTools { codegraph = { command = "/bin/false"; }; } { subagentsAllowedTools = [ ]; };
            wildcardOverride = evalAllowedTools { codegraph = { command = "/bin/false"; }; } { subagentsAllowedTools = [ "mcp__codegraph__*" ]; };
            # HM-level wiring for subagentsWorktreeRoot: null by default,
            # absolute paths pass through as literal strings, and relative or
            # empty values trip the absolute-path assertion. Same narrow leaf
            # stubs as above; the standalone pi module never references yolo
            # options (only documents the explicit extraReadWritePaths binding).
            evalPi = piExtra: historian: (nixpkgs.lib.evalModules {
              specialArgs = { pkgs = import nixpkgs { inherit system; }; };
              modules = [
                ./nix/hm/pi.nix
                ({ lib, ... }: {
                  options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
                  options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
                  options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
                  options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
                  options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
                  options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
                  options.smind.hm.dev.llm.merged.skills = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.merged.commands = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                  options.smind.hm.dev.llm.merged.memoryText = lib.mkOption { type = lib.types.str; default = ""; };
                  options.smind.hm.dev.llm.models.pi.provider = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.models.pi.model = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.models.pi.thinkingLevel = lib.mkOption { type = lib.types.str; default = "x"; };
                  options.smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption { type = lib.types.bool; default = false; };
                })
                ({ ... }: {
                  config.smind.hm.dev.llm.enable = true;
                  config.smind.hm.dev.llm.pi = piExtra;
                  config.programs.pi.historian = historian;
                })
              ];
            }).config;
            evalWorktree = piExtra: evalPi piExtra { };
            historianDefaultModel = { provider = "openai-codex"; id = "gpt-6.1-sol"; thinking = "medium"; };
            historianOptions = { journalRoot = "/srv/pi-journals"; model = { provider = "fixture"; id = "custom"; thinking = "high"; }; };
            historianConfigured = evalPi { } historianOptions;
            historianUnconfigured = evalPi { } { model = null; };
            historianInvalid = evalPi { } { journalRoot = "relative"; };
            historianInvalidModels = map (model: evalPi { } { inherit model; }) [
              (historianOptions.model // { provider = ""; })
              (historianOptions.model // { id = ""; })
            ];
            worktreeDefault = (evalWorktree { }).smind.hm.dev.llm.pi.subagentsWorktreeRoot;
            worktreeCustom = (evalWorktree { subagentsWorktreeRoot = "/srv/nvme/subagents-worktrees"; }).smind.hm.dev.llm.pi.subagentsWorktreeRoot;
            worktreeManagedDefault = (evalWorktree { }).home.file ? "/home/alice/.pi/agent/subagents-policy.json";
            worktreeManagedCustom = (evalWorktree { subagentsWorktreeRoot = "/srv/nvme/subagents-worktrees"; }).home.file ? "/home/alice/.pi/agent/subagents-policy.json";
            worktreeInvalidAssertions = (evalWorktree { subagentsWorktreeRoot = "relative/path"; }).assertions;
            worktreeEmptyAssertions = (evalWorktree { subagentsWorktreeRoot = ""; }).assertions;
            # Scheduler limits: defaults mirror the extension (and leave the
            # file unmanaged); a changed limit manages it; misordered limits
            # trip the ordering assertion.
            limitsDefault = evalWorktree { };
            observerExtensions = builtins.filter (name: builtins.elem name [ "ponygirls-subagents" "ponygirls-historian" ])
              (map builtins.baseNameOf limitsDefault.programs.pi.settings.extensions);
            limitsCustom = evalWorktree { subagentsMaxRunnable = 8; subagentsMaxResidentWorkers = 12; };
            limitsMisordered = evalWorktree { subagentsMaxRunnable = 10; };
            failedLimitAssertion = assertions: builtins.any (a: !a.assertion && builtins.match ".*subagentsMaxRunnable.*" a.message != null) assertions;
          in
          assert builtins.attrNames listed == [ "allowedModels" "allowedTools" "gateBypassAllowed" "gateMaxRoundsCeiling" "maxDepth" "maxOpenAgents" "maxResidentWorkers" "maxRunnable" "nesting" "repos" "workspaceOwnerCheckoutAllowed" "workspaceRoots" "worktreeRoot" ];
          assert listed == {
            maxDepth = 2;
            nesting = true;
            repos = [
              { repoId = "myrepo"; checkoutPath = "/home/user/src/myrepo"; readRoots = [ "/home/user/src/myrepo" ]; allowWriters = true; }
              { repoId = "other"; checkoutPath = "/o"; readRoots = [ "/o" "/o/lib" ]; allowWriters = false; }
            ];
            allowedModels = [ { provider = "meta"; id = "muse-spark-1.3"; } ];
            allowedTools = [ "mcp__codegraph__codegraph_explore" ];
            worktreeRoot = "/srv/nvme/subagents-worktrees";
            gateBypassAllowed = true;
            gateMaxRoundsCeiling = null;
            workspaceRoots = [ "/home/user/worktrees" ];
            workspaceOwnerCheckoutAllowed = true;
            maxRunnable = 8;
            maxResidentWorkers = 12;
            maxOpenAgents = 40;
          };
          assert open == {
            maxDepth = 1;
            nesting = false;
            repos = [ ];
            allowedModels = null;
            allowedTools = [ ];
            worktreeRoot = null;
            gateBypassAllowed = false;
            gateMaxRoundsCeiling = 3;
            workspaceRoots = [ ];
            workspaceOwnerCheckoutAllowed = false;
            maxRunnable = 4;
            maxResidentWorkers = 8;
            maxOpenAgents = 32;
          };
          assert absentDefault == [ ];
          assert presentDefault == [ "mcp__codegraph__codegraph_explore" ];
          assert disabledOverride == [ ];
          assert wildcardOverride == [ "mcp__codegraph__*" ];
          assert worktreeDefault == null;
          assert worktreeCustom == "/srv/nvme/subagents-worktrees";
          assert worktreeManagedDefault == false;
          assert worktreeManagedCustom == true;
          assert builtins.any (a: !a.assertion && builtins.match ".*subagentsWorktreeRoot.*" a.message != null) worktreeInvalidAssertions;
          assert builtins.any (a: !a.assertion && builtins.match ".*subagentsWorktreeRoot.*" a.message != null) worktreeEmptyAssertions;
          assert limitsDefault.programs.pi.settings.httpIdleTimeoutMs == 900000;
          assert !(limitsDefault.programs.pi.settings.retry.provider ? timeoutMs);
          assert [ limitsDefault.smind.hm.dev.llm.pi.subagentsMaxRunnable limitsDefault.smind.hm.dev.llm.pi.subagentsMaxResidentWorkers limitsDefault.smind.hm.dev.llm.pi.subagentsMaxOpenAgents ] == [ 4 8 32 ];
          assert !(limitsDefault.home.file ? "/home/alice/.pi/agent/subagents-policy.json");
          assert limitsCustom.home.file ? "/home/alice/.pi/agent/subagents-policy.json";
          assert observerExtensions == [ "ponygirls-subagents" "ponygirls-historian" ];
          assert builtins.elem "ponygirls-cuckoo" (map builtins.baseNameOf limitsDefault.programs.pi.settings.extensions);
          assert !(limitsDefault.home.file ? "/home/alice/.pi/agent/cuckoo.json");
          assert !(limitsDefault.home.file ? "/home/alice/.pi/agent/historian.json");
          assert builtins.fromJSON limitsDefault.home.file."/home/alice/.pi/agent/historian-defaults.json".text == { version = 1; journalRoot = null; model = historianDefaultModel; };
          assert !(historianUnconfigured.home.file ? "/home/alice/.pi/agent/historian-defaults.json");
          assert !(historianUnconfigured.home.file ? "/home/alice/.pi/agent/historian.json");
          assert !(historianConfigured.home.file ? "/home/alice/.pi/agent/historian.json");
          assert builtins.fromJSON historianConfigured.home.file."/home/alice/.pi/agent/historian-defaults.json".text == historianOptions // { version = 1; };
          assert builtins.all (a: a.assertion) historianConfigured.assertions;
          assert builtins.any (a: !a.assertion && builtins.match ".*historian.journalRoot.*" a.message != null) historianInvalid.assertions;
          assert builtins.all (c: builtins.any (a: !a.assertion && builtins.match ".*historian.model.*" a.message != null) c.assertions) historianInvalidModels;
          assert !(failedLimitAssertion limitsDefault.assertions);
          assert !(failedLimitAssertion limitsCustom.assertions);
          assert failedLimitAssertion limitsMisordered.assertions;
          pkgs.runCommandLocal "subagents-policy-shape-test" { } "touch $out";
      in
      {
        # One pinned JVM/toolchain environment for all common-build modules.
        devShells.backend = self.devShells.${system}.chronicle.overrideAttrs (old:
          pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.bubblewrap pkgs.ripgrep pkgs.fd pkgs.findutils pkgs.gnugrep ];
            PI_MONOREPO_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            RITES_NODE = "${pkgs.nodejs_24}/bin/node";
            RITES_BWRAP = "${pkgs.bubblewrap}/bin/bwrap";
            RITES_CA_BUNDLE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
            RITES_TOOLCHAIN_PATH = pkgs.lib.makeBinPath [ pkgs.nodejs_24 pkgs.bash pkgs.git pkgs.ripgrep pkgs.fd pkgs.coreutils pkgs.findutils pkgs.gnugrep ];
            MANURE_POSIX_LIBRARY = "${(pkgs.callPackage ./nix/pkg/manure/posix.nix { }).shared}/lib/libmanure_posix.so";
            MANURE_POSIX_STATIC = "${(pkgs.callPackage ./nix/pkg/manure/posix.nix { }).static}/lib";
          });
        devShells.chronicle = pkgs.mkShell {
          packages = [ chronicleTools.graal chronicleTools.baboon chronicleTools.sbt chronicleTools.postgres pkgs.nodejs_24 pkgs.python3 pkgs.git pkgs.pkg-config pkgs.zlib pkgs.openssl pkgs.stdenv.cc ];
          JAVA_HOME = chronicleTools.graal.home;
          GRAALVM_HOME = chronicleTools.graal.home;
          CHRONICLE_NATIVE_IMAGE_FLAGS = pkgs.lib.concatStringsSep " " chronicleTools.nativeImageFlags;
          SBT_LAUNCH_JAR = chronicleTools.launcher;
          SBT_JAVA_OPTS = "-Dsbt.override.build.repos=true -Dsbt.repository.config=${chronicleTools.repositories}";
          PG_BIN = "${chronicleTools.postgres}/bin";
          POSTGRES_HOME = chronicleTools.postgres;
          BABOON = "${chronicleTools.baboon}/bin/baboon";
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
        };
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
          ponygirls-pi-ui = pkgs.callPackage ./nix/pkg/pi-extensions/ponygirls-pi-ui/package.nix { pi-coding-agent = self.packages.${system}.pi-coding-agent; };
          ponygirls-pi-settings = pkgs.callPackage ./nix/pkg/pi-extensions/ponygirls-pi-settings/package.nix { pi-coding-agent = self.packages.${system}.pi-coding-agent; };
          ponygirls-pi-extensions = pkgs.callPackage ./nix/pkg/pi-extensions/package.nix {
            inherit (self.packages.${system}) ponygirls-pi-ui ponygirls-pi-settings;
          };
          pi-search-hub = pkgs.callPackage ./nix/pkg/pi-search-hub/package.nix {
            inherit (self.packages.${system}) pi-coding-agent ponygirls-pi-ui;
          };
          codegraph = pkgs.callPackage ./nix/pkg/codegraph/package.nix { src = inputs.codegraph; };
          crawl4ai-mcp = pkgs.callPackage ./nix/pkg/crawl4ai/mcp.nix { };
          tokemon = pkgs.callPackage ./nix/pkg/tokemon/package.nix { };
          tui-tmux = pkgs.callPackage ./nix/pkg/tui-tmux/default.nix { };
          haystack = self.lib.mkHaystackPackage { inherit pkgs; };
          service-test-fixture-tools = pkgs.callPackage ./nix/pkg/services/test-fixture-tools.nix { };
          haystack-proxy-fixture = import ./nix/tests/haystack-proxy-fixture.nix { inherit pkgs nixpkgs; haystackModule = self.nixosModules.haystack; haystackPackage = self.packages.${system}.haystack; };
          service-postgres-tools = pkgs.callPackage ./nix/pkg/services/postgres-tools.nix { };
          manure-clients = self.lib.mkManureClientPackage { inherit pkgs; };
          manure = self.lib.mkManurePackage { inherit pkgs; };
          chronicle-collector = pkgs.callPackage ./nix/pkg/chronicle/collector.nix { };
          chronicle-web = pkgs.callPackage ./nix/pkg/chronicle/web.nix { };
          rites-web = pkgs.callPackage ./nix/pkg/rites/web.nix { };
          ontology-web = pkgs.callPackage ./nix/pkg/ontology/web.nix { };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          chronicle = self.lib.mkChroniclePackage { inherit pkgs; };
          rites = self.lib.mkRitesPackage { inherit pkgs; };
          ontology = self.lib.mkOntologyPackage { inherit pkgs; };
          ontology-worker = self.packages.${system}.ontology.worker;
          rites-worker = self.packages.${system}.rites.worker;
          manure-posix-shared = (pkgs.callPackage ./nix/pkg/manure/posix.nix { }).shared;
          manure-posix-static = (pkgs.callPackage ./nix/pkg/manure/posix.nix { }).static;
          chronicle-native-dev = self.packages.${system}.chronicle.nativeArtifact;
          chronicle-update-sbt-lock = pkgs.callPackage ./nix/pkg/chronicle/update-lock.nix { lockfileGenerator = inputs.squish.packages.${system}.generate-lockfile; };
          crawl4ai = pkgs.callPackage ./nix/pkg/crawl4ai/package.nix { src = inputs.crawl4ai; };
          # Daemonless OCI images. The chronicle image wraps the default
          # package and therefore inherits its native build; a first
          # deployment wraps exact built store paths through lib.oci instead
          # (see nix/pkg/oci/default.nix).
          oci-haystack = (self.lib.oci { inherit pkgs; }).haystack { package = self.packages.${system}.haystack; };
          oci-manure = (self.lib.oci { inherit pkgs; }).manure { package = self.packages.${system}.manure; };
          oci-chronicle = (self.lib.oci { inherit pkgs; }).chronicle { package = self.packages.${system}.chronicle; };
          oci-crawl4ai = (self.lib.oci { inherit pkgs; }).crawl4ai {
            package = self.packages.${system}.crawl4ai;
            browsers = self.packages.${system}.crawl4ai.passthru.browsers;
          };
          oci-postgres = (self.lib.oci { inherit pkgs; }).postgres { };
          oci-redis = (self.lib.oci { inherit pkgs; }).redis { };
          reattach-llm = pkgs.callPackage ./nix/pkg/reattach-llm/default.nix { };
          yolo = pkgs.callPackage ./nix/pkg/yolo/default.nix { };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
          yolo-darwin = pkgs.callPackage ./nix/pkg/yolo-darwin/default.nix {
            claude-code-sandbox = inputs.claude-code-sandbox.packages.${system}.default;
          };
          yolo = self.packages.${system}.yolo-darwin;
        };
        checks = {
          llm-skills = self.packages.${system}.llm-skills;
          llm-skills-validation = import ./nix/tests/llm-skills-validation.nix { inherit pkgs; };
          agentic-services-credentials = import ./nix/tests/agentic-services-credentials.nix { inherit pkgs; };
          crawl4ai-hm-eval = import ./nix/tests/crawl4ai-hm-eval.nix { inherit pkgs nixpkgs; };
          codex-mcp-guard-hm-eval = import ./nix/tests/codex-mcp-guard-hm-eval.nix { inherit pkgs nixpkgs inputs; };
          chronicle-web = self.packages.${system}.chronicle-web;
          chronicle-collector = self.packages.${system}.chronicle-collector;
          default-models = defaultModelsCheck;
          general-context-hm-eval = import ./nix/tests/general-context-hm-eval.nix { inherit pkgs nixpkgs inputs; };
          notify-module = pkgs.callPackage ./nix/tests/notify-module.nix { };
          atlassian-hm-eval = import ./nix/tests/atlassian-hm-eval.nix { inherit pkgs nixpkgs inputs; };
          tui-terminal = self.packages.${system}.tui-tmux.tests.terminal;
          tui-hm-eval = import ./nix/hm/tui-tools-test.nix { inherit pkgs inputs; };
          haystack = self.packages.${system}.haystack;
          manure = self.packages.${system}.manure;
          manure-nixos-eval = import ./nix/tests/manure-nixos-eval.nix {
            inherit pkgs nixpkgs;
            manureModule = self.nixosModules.manure;
          };
          manure-hm-eval = import ./nix/tests/manure-hm-eval.nix {
            inherit pkgs nixpkgs inputs;
            manureModule = self.homeManagerModules.manure;
            yoloHmModule = import ./nix/hm/yolo.nix { inherit inputs; };
            podmanHmModule = import ./nix/hm/podman.nix;
          };
          manure-client = import ./nix/tests/manure-client.nix {
            inherit pkgs;
            manurePackage = self.packages.${system}.manure;
          };
          manure-config = import ./nix/tests/manure-config.nix { inherit pkgs; manurePackage = self.packages.${system}.manure; };
          manure-backend = import ./nix/tests/manure-backend.nix { inherit pkgs; squishLib = inputs.squish.lib; };
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
                      smind.services.haystack.database = { jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/haystack"; passwordFile = "/run/secrets/haystack-database"; readinessUnit = "ponygirls-database-haystack.service"; };
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
                        options.systemd.tmpfiles.rules = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
                        options.systemd.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                        options.services.nginx = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                        options.networking.firewall = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
                      })
                      ({ lib, ... }: lib.recursiveUpdate
                        { smind.services.haystack.enable = true;
                      smind.services.haystack.database = { jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/haystack"; passwordFile = "/run/secrets/haystack-database"; readinessUnit = "ponygirls-database-haystack.service"; }; }
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
            assert !full.services.postgresql.enable;
            assert builtins.elem "database-password:/run/secrets/haystack-database" full.systemd.services.haystack.serviceConfig.LoadCredential;
            # Setup waits for the database to exist (fresh clusters race without this).
            assert builtins.elem "ponygirls-database-haystack.service" full.systemd.services.haystack-setup.after;
            assert builtins.elem "ponygirls-database-haystack.service" full.systemd.services.haystack-setup.requires;
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
            assert full.services.nginx.virtualHosts."memory.example.net".root == "${full.smind.services.haystack.package}/share/haystack/web";
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
              runtimeMod = evalHaystackHm "x86_64-linux" null null;
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
            assert nixpkgs.lib.all (a: a.assertion) runtimeMod.config.assertions;
            assert runtimeMod.config.smind.hm.dev.llm.yolo.validatedSessionVariables.HAYSTACK_TOKEN == "";
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
          runtime-token = pkgs.runCommandLocal "runtime-token-test"
            { nativeBuildInputs = [ pkgs.bash pkgs.coreutils pkgs.gnugrep ]; }
            ''
              bash ${./nix/lib/runtime-token-test.sh} ${./nix/lib/runtime-token.sh}
              touch $out
            '';
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
                ! ${goodRun}/bin/haystack-run > no-command.out 2> no-command.err
                test ! -s no-command.out
                ! grep -q "${good43}" no-command.err
                ${goodRun}/bin/haystack-run true
                ${goodRun}/bin/haystack-run sh -c 'test "$HAYSTACK_TOKEN" = "${good43}"'
                ${lfRun}/bin/haystack-run sh -c 'test "$HAYSTACK_TOKEN" = "${good43}"'
                ! ${badRun}/bin/haystack-run true
                ! ${missingRun}/bin/haystack-run true
                HAYSTACK_TOKEN="${good43}" ${missingRun}/bin/haystack-run true
                HAYSTACK_TOKEN_FILE=${tok44} ${missingRun}/bin/haystack-run true
                ! env HAYSTACK_TOKEN="${good43}" HAYSTACK_TOKEN_FILE=${tok43} ${goodRun}/bin/haystack-run true
                # The wrapper embeds the token FILE path, never its content.
                ${goodRun}/bin/haystack-run sh -c 'echo "$HAYSTACK_TOKEN"' | grep -q "${good43}"
                ! rg -q "${good43}" ${goodRun}
                touch $out
              '';
          pi-codegraph-wiring = import ./nix/lib/pi-codegraph-test.nix { inherit pkgs; };
          codegraph-bootstrap = pkgs.runCommand "codegraph-bootstrap-test" {
            nativeBuildInputs = [ pkgs.bash ];
            CODEGRAPH_TELEMETRY = "0";
          } ''
            export HOME="$TMPDIR"
            cp ${./nix/pkg/yolo/codegraph-bootstrap.sh} codegraph-bootstrap.sh
            cp ${./nix/pkg/yolo/codegraph-bootstrap-test.sh} codegraph-bootstrap-test.sh
            bash ./codegraph-bootstrap-test.sh ${self.packages.${system}.codegraph}/bin/codegraph ${pkgs.jq}/bin/jq ${pkgs.git}/bin/git
            touch $out
          '';
          ponygirls-codegraph = pkgs.runCommand "ponygirls-codegraph-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.git pkgs.flock ];
            PI_CODEGRAPH_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PONYGIRLS_CODEGRAPH_BIN = "${self.packages.${system}.codegraph}/bin/codegraph";
            PONYGIRLS_CODEGRAPH_FLOCK_BIN = "${pkgs.flock}/bin/flock";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME="$TMPDIR"
            cp -r ${./nix/pkg/pi-extensions/ponygirls-codegraph} ponygirls-codegraph
            chmod -R u+w ponygirls-codegraph
            cd ponygirls-codegraph
            mkdir -p node_modules/@earendil-works
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            ln -s "$PI_CODEGRAPH_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_CODEGRAPH_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_CODEGRAPH_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test *.test.ts
            touch $out
          '';
          subagents-policy-shape = subagentsPolicyShapeCheck;
          tokemon = self.packages.${system}.tokemon;
          dev-llm-module-boundary = devLlmModuleBoundaryCheck;
          dev-llm-haystack-aggregation = devLlmHaystackAggregationCheck;
          dev-llm-manure-aggregation = devLlmManureAggregationCheck;
          ponygirls-quirk-kimi-401-retry = pkgs.runCommand "ponygirls-quirk-kimi-401-retry-test" {
            nativeBuildInputs = [ pkgs.bun ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            cd pi-extensions
            bun test ponygirls-quirk-kimi-401-retry.test.ts
            touch $out
          '';
          ponygirls-openai-fast = pkgs.runCommand "ponygirls-openai-fast-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
            PI_PACKAGE_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            chmod -R u+w pi-extensions
            cd pi-extensions
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            node --test ponygirls-openai-fast.test.mjs
            touch $out
          '';
          ponygirls-codex-limits = pkgs.runCommand "ponygirls-codex-limits-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_PACKAGE_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-codex-limits} codex-limits
            mkdir -p ponygirls-subagents/src
            cp ${./nix/pkg/pi-extensions/ponygirls-subagents/src/parent-models.ts} ponygirls-subagents/src/parent-models.ts
            cp ${./nix/pkg/pi-extensions/ponygirls-subagents/src/errors.ts} ponygirls-subagents/src/errors.ts
            chmod -R u+w codex-limits
            cd codex-limits
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_PACKAGE_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_PACKAGE_ROOT/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
            ln -s "$PI_PACKAGE_ROOT/node_modules/@types" node_modules/@types
            tsc --strict --noEmit --skipLibCheck --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions index.ts
            node --test tests.mjs subagents.test.mjs metadata.test.mjs
            test -f ${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-codex-limits/index.ts
            touch $out
          '';
          ponygirls-codex-risk-retry = pkgs.runCommand "ponygirls-codex-risk-retry-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_RETRY_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_RETRY_GOALS_EXTENSION = "${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-codex-goals";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp ${./nix/pkg/pi-extensions/ponygirls-codex-risk-retry.ts} ponygirls-codex-risk-retry.ts
            cp ${./nix/pkg/pi-extensions/ponygirls-codex-risk-retry.test.mjs} ponygirls-codex-risk-retry.test.mjs
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_RETRY_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_RETRY_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc --strict --noEmit --skipLibCheck --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions ponygirls-codex-risk-retry.ts
            node --test ponygirls-codex-risk-retry.test.mjs
            touch $out
          '';
          ponygirls-model-stats = pkgs.runCommand "ponygirls-model-stats-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            chmod -R u+w pi-extensions
            cd pi-extensions
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            node --test ponygirls-model-stats-state.test.ts
            touch $out
          '';
          rites-web = self.packages.${system}.rites-web;
          pi-search-hub = self.packages.${system}.pi-search-hub;
          pi-search-hub-eval = pkgs.callPackage ./nix/pkg/pi-search-hub/eval/check.nix {
            inherit (self.packages.${system}) pi-coding-agent pi-search-hub;
          };
          ponygirls-pi-ui = pkgs.runCommand "ponygirls-pi-ui-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-pi-ui} ponygirls-pi-ui
            chmod -R u+w ponygirls-pi-ui
            cd ponygirls-pi-ui
            mkdir -p node_modules/@earendil-works
            ln -s "$PI_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.ts
            : ${self.packages.${system}.ponygirls-pi-extensions}
            touch $out
          '';
          ponygirls-pi-settings = pkgs.runCommand "ponygirls-pi-settings-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME=$TMPDIR
            cp -r ${./nix/pkg/pi-extensions/ponygirls-pi-settings} ponygirls-pi-settings
            chmod -R u+w ponygirls-pi-settings
            cd ponygirls-pi-settings
            mkdir -p node_modules/@earendil-works ../node_modules/@ponygirls
            ln -s "$PI_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_SDK_ROOT/node_modules/@types" node_modules/@types
            ln -s ${self.packages.${system}.ponygirls-pi-settings} ../node_modules/@ponygirls/pi-settings
            tsc -p tsconfig.json
            node --test tests/*.test.ts
            cd ..
            node --input-type=module -e 'import { parseToggleCommand } from "@ponygirls/pi-settings"; if (parseToggleCommand("on").enabled !== true) throw new Error("Compiled settings import failed")'
            test ! -e ${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-pi-settings
            test "$(readlink ${self.packages.${system}.ponygirls-pi-extensions}/node_modules/@ponygirls/pi-settings)" = ${self.packages.${system}.ponygirls-pi-settings}
            touch $out
          '';
          ponygirls-model-picker = pkgs.runCommand "ponygirls-model-picker-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
            PI_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            chmod -R u+w pi-extensions
            cd pi-extensions
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            node --test ponygirls-model-picker-state.test.ts
            touch $out
          '';
          ponygirls-usage = pkgs.runCommand "ponygirls-usage-test" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${./nix/pkg/pi-extensions} pi-extensions
            chmod -R u+w pi-extensions
            cd pi-extensions
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
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
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            ln -s "$PI_GOALS_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/typebox" node_modules/typebox
            ln -s "$PI_GOALS_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.ts
            node --test tests/host.test.mjs
            touch $out
          '';
          ponygirls-context-archive = pkgs.runCommand "ponygirls-context-archive-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME=$TMPDIR
            sdk=${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo
            cp -r ${./nix/pkg/pi-extensions/ponygirls-context-archive} context-archive
            chmod -R u+w context-archive
            cd context-archive
            mkdir -p node_modules/@ponygirls
            ln -s ${self.packages.${system}.ponygirls-pi-settings} node_modules/@ponygirls/pi-settings
            ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            mkdir -p node_modules/@earendil-works
            ln -s "$sdk" node_modules/@earendil-works/pi-coding-agent
            for package in pi-ai pi-agent-core pi-tui; do
              ln -s "$sdk/node_modules/@earendil-works/$package" node_modules/@earendil-works/$package
            done
            ln -s "$sdk/node_modules/typebox" node_modules/typebox
            ln -s "$sdk/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.mjs
            touch $out
          '';
          ponygirls-cuckoo = pkgs.runCommand "ponygirls-cuckoo-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript ];
            PI_CUCKOO_EXTENSION = "${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-cuckoo/index.ts";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME=$TMPDIR
            sdk=${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo
            cp -r ${./nix/pkg/pi-extensions/ponygirls-cuckoo} cuckoo
            chmod -R u+w cuckoo
            cd cuckoo
            mkdir -p node_modules/@ponygirls node_modules/@earendil-works
            ln -s ${self.packages.${system}.ponygirls-pi-settings} node_modules/@ponygirls/pi-settings
            ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            ln -s "$sdk" node_modules/@earendil-works/pi-coding-agent
            for package in pi-ai pi-agent-core pi-tui; do
              ln -s "$sdk/node_modules/@earendil-works/$package" node_modules/@earendil-works/$package
            done
            ln -s "$sdk/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.mjs
            touch $out
          '';
          ponygirls-historian = pkgs.runCommand "ponygirls-historian-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.git ];
            PI_HISTORIAN_SUBAGENTS_EXTENSION = "${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-subagents/index.ts";
            PI_SUBAGENTS_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME=$TMPDIR
            sdk=${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo
            cp -r ${./nix/pkg/pi-extensions/ponygirls-historian} ponygirls-historian
            mkdir -p ponygirls-decisions/src
            cp ${./nix/pkg/pi-extensions/ponygirls-decisions/src/project.ts} ponygirls-decisions/src/project.ts
            chmod -R u+w ponygirls-historian
            cd ponygirls-historian
            mkdir -p node_modules/@ponygirls node_modules/@earendil-works
            ln -s ${self.packages.${system}.ponygirls-pi-settings} node_modules/@ponygirls/pi-settings
            ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            ln -s "$sdk" node_modules/@earendil-works/pi-coding-agent
            for package in pi-ai pi-agent-core pi-tui; do
              ln -s "$sdk/node_modules/@earendil-works/$package" node_modules/@earendil-works/$package
            done
            ln -s "$sdk/node_modules/typebox" node_modules/typebox
            ln -s "$sdk/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.mjs
            PI_HISTORIAN_EXTENSION=${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-historian/index.ts node --test tests/host.test.mjs
            touch $out
          '';
          ponygirls-decisions = pkgs.runCommand "ponygirls-decisions-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.git ];
            PI_DECISIONS_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            export HOME=$TMPDIR
            cp -r ${./nix/pkg/pi-extensions/ponygirls-decisions} ponygirls-decisions
            chmod -R u+w ponygirls-decisions
            cd ponygirls-decisions
            mkdir -p node_modules/@earendil-works
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
            ln -s ${self.packages.${system}.ponygirls-pi-settings} node_modules/@ponygirls/pi-settings
            ln -s "$PI_DECISIONS_SDK_ROOT" node_modules/@earendil-works/pi-coding-agent
            ln -s "$PI_DECISIONS_SDK_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
            ln -s "$PI_DECISIONS_SDK_ROOT/node_modules/typebox" node_modules/typebox
            ln -s "$PI_DECISIONS_SDK_ROOT/node_modules/@types" node_modules/@types
            tsc -p tsconfig.json
            node --test tests/*.test.ts tests/*.test.mjs
            touch $out
          '';
          ponygirls-tokemon = pkgs.runCommand "ponygirls-tokemon-test" {
            nativeBuildInputs = [ pkgs.nodejs pkgs.typescript pkgs.python3 ];
            PI_SDK_ROOT = "${self.packages.${system}.pi-coding-agent}/lib/node_modules/pi-monorepo";
            PI_OFFLINE = "1";
            PI_TELEMETRY = "0";
          } ''
            cp -r ${./nix/pkg/pi-extensions/ponygirls-tokemon} ponygirls-tokemon
            chmod -R u+w ponygirls-tokemon
            cd ponygirls-tokemon
            export TOKEMON_PYTHON_SOURCE=${./nix/pkg/tokemon/src}
            mkdir -p node_modules/@earendil-works
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
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
              PI_BG_TASKS_EXTENSION = "${self.packages.${system}.ponygirls-pi-extensions}/ponygirls-bg-tasks";
              PI_OFFLINE = "1";
              PI_TELEMETRY = "0";
            } ''
              export HOME=$TMPDIR
              cp -r ${./nix/pkg/pi-extensions/ponygirls-bg-tasks} ponygirls-bg-tasks
              chmod -R u+w ponygirls-bg-tasks
              cd ponygirls-bg-tasks
              mkdir -p node_modules/@earendil-works
              mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
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
            export YOLO_RUNTIME_TOKEN_HELPER=${import ./nix/lib/runtime-token.nix { inherit pkgs; }}
            bash llm-sandbox-test.sh
            bash profile-test.sh
            bash resource-limits-test.sh
            bash sandbox-entrypoint-test.sh
            touch $out
          '';
          yolo-managed-config-eval = import ./nix/tests/yolo-managed-config-eval.nix {
            inherit pkgs nixpkgs;
          };
          yolo-claude-dispatch = import ./nix/tests/yolo-claude-dispatch.nix {
            inherit pkgs nixpkgs;
          };
          yolo-darwin-profile = pkgs.runCommand "yolo-darwin-profile-test" {
            nativeBuildInputs = [ pkgs.bash pkgs.jq pkgs.coreutils pkgs.gnugrep pkgs.gawk pkgs.python3 pkgs.sqlite ];
          } ''
            cp -r ${./nix/pkg/yolo} yolo
            cp -r ${./nix/pkg/yolo-darwin} yolo-darwin
            chmod -R u+w yolo yolo-darwin
            export YOLO_RUNTIME_TOKEN_HELPER=${import ./nix/lib/runtime-token.nix { inherit pkgs; }}
            bash yolo-darwin/profile-test.sh
            touch $out
          '';
          yolo-forge-tokens-eval = import ./nix/tests/yolo-forge-tokens-eval.nix {
            inherit pkgs nixpkgs;
            yoloHmModule = import ./nix/hm/yolo.nix { inherit inputs; };
          };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          chronicle = self.packages.${system}.chronicle;
          rites = self.packages.${system}.rites;
          rites-backend = pkgs.callPackage ./nix/pkg/rites/backend-tests.nix { squishLib = inputs.squish.lib; };
          rites-browser = pkgs.callPackage ./nix/pkg/rites/browser-tests.nix { };
          chronicle-backend = self.packages.${system}.chronicle.backendValidation;
          chronicle-protocol = self.packages.${system}.chronicle.protocolValidation;
          chronicle-validation = self.packages.${system}.chronicle.validationEvidence;
          chronicle-evidence-layout = import ./nix/tests/chronicle-evidence-layout.nix { inherit pkgs; };
          chronicle-validation-policy = pkgs.runCommand "chronicle-validation-policy-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/tests/chronicle-validation-policy.py} ${./chronicle/scripts/validation-report.py} ${./nix/pkg/chronicle/validation-evidence.py}
            touch "$out"
          '';
          manure-native = import ./nix/tests/manure-native.nix { inherit pkgs; manurePackage = self.packages.${system}.manure; };
          manure-portable-root = import ./nix/tests/manure-portable-root.nix { inherit pkgs; manurePackage = self.packages.${system}.manure; };
          manure-unittests = import ./nix/tests/manure-unittests.nix {
            inherit pkgs;
            backendCheck = self.checks.${system}.manure-backend;
            installedClientCheck = self.checks.${system}.manure-client;
            nativeCheck = self.checks.${system}.manure-native;
            portableRootCheck = self.checks.${system}.manure-portable-root;
          };
          haystack-proxy = import ./nix/tests/haystack-proxy.nix { inherit pkgs inputs; haystackPackage = self.packages.${system}.haystack; };
          hm-service-unit-graph-harness = import ./nix/tests/hm-service-unit-graph-harness.nix { inherit pkgs; };
          hm-service-unit-graph-vm = import ./nix/tests/hm-service-unit-graph-vm.nix {
            inherit pkgs;
            chronicleHmModule=self.homeManagerModules.chronicleServer;
            agenticHmModule=self.homeManagerModules.agenticServicesServer;
            sourceRevision=self.rev or "";
          };
          service-unit-graph-harness = import ./nix/tests/service-unit-graph-harness.nix { inherit pkgs; };
          service-unit-graph-vm = import ./nix/tests/service-unit-graph-vm.nix {
            inherit pkgs nixpkgs;
            chronicleModule=self.nixosModules.chronicle;
            haystackModule=self.nixosModules.haystack;
            manureModule=self.nixosModules.manure;
            sourceRevision=self.rev or "";
          };
          service-fixture-browser-home = import ./nix/tests/fixture-browser-home.nix { inherit pkgs; fixtureTools=self.packages.${system}.service-test-fixture-tools; };
          service-fixture-tool-closure = import ./nix/tests/fixture-tool-closure.nix { inherit pkgs; fixtureTools=self.packages.${system}.service-test-fixture-tools; };
          haystack-browser = import ./nix/tests/haystack-browser.nix {
            inherit pkgs;
            haystackPackage = self.packages.${system}.haystack;
            proxyFixture = self.packages.${system}.haystack-proxy-fixture;
            fixtureTools = self.packages.${system}.service-test-fixture-tools;
            sourceRevision = self.rev or "";
          };
          haystack-native = import ./nix/tests/haystack-native.nix { inherit pkgs; haystackPackage = self.packages.${system}.haystack; };
          chronicle-operations-example = import ./nix/tests/chronicle-operations-example.nix { inherit pkgs nixpkgs inputs; ponygirls = self; };
          readme-hm-server = import ./nix/tests/readme-hm-server.nix { inherit pkgs inputs; ponygirls = self; };
          shared-services-modules = import ./nix/tests/shared-services-modules.nix { inherit pkgs nixpkgs inputs; };
          shared-postgres-modules = import ./nix/tests/shared-postgres-modules.nix { inherit pkgs nixpkgs; };
          provider-credential-transports = import ./nix/tests/provider-credential-transports.nix { inherit pkgs; };
          shared-postgres = import ./nix/tests/shared-postgres.nix { inherit pkgs; };
          chronicle-modules = import ./nix/tests/chronicle-modules.nix { inherit pkgs nixpkgs; chronicleModule = self.nixosModules.chronicle; };
          chronicle-hm-server = import ./nix/tests/chronicle-hm-server.nix { inherit pkgs; chronicleModule = self.homeManagerModules.chronicleServer; };
          agentic-services-hm-eval = import ./nix/tests/agentic-services-hm-eval.nix { inherit pkgs inputs; agenticServicesModule = self.homeManagerModules.agenticServicesServer; };
          chronicle-models = import ./nix/tests/chronicle-models.nix { inherit pkgs nixpkgs; chronicleModule = self.nixosModules.chronicle; };
          backend-foundation-policy = pkgs.runCommand "backend-foundation-policy-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/tests/backend-foundation-report.py} ${./scripts/backend-foundation-report.py}
            touch "$out"
          '';
          backend-runner-contract = pkgs.runCommand "backend-runner-contract-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/tests/backend-runner-contract.py} ${self.outPath}
            touch "$out"
          '';
          backend-foundation = pkgs.callPackage ./nix/pkg/backend-foundation.nix { squishLib = inputs.squish.lib; };
          manure-toolchain-routing = pkgs.runCommand "manure-toolchain-routing-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/tests/manure-toolchain-routing.py} ${./scripts/manure-native-image.sh} ${./manure/server/native-image/PosixLinkFeature.java}
            touch "$out"
          '';
          manure-acceptance-policy = pkgs.runCommand "manure-acceptance-policy-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/tests/manure-acceptance-report.py} ${./scripts/manure-acceptance-report.py} ${./nix/tests/fixtures/manure-posix-acceptance}
            touch "$out"
          '';
          manure-direct-jni = pkgs.callPackage ./nix/pkg/manure/direct-jni.nix { };
          manure-posix-acceptance = pkgs.callPackage ./nix/pkg/manure/posix-acceptance.nix { squishLib = inputs.squish.lib; };
          backend-source = import ./nix/tests/backend-source.nix { inherit pkgs; };
          backend-coassembly = pkgs.callPackage ./nix/tests/backend-coassembly.nix { squishLib = inputs.squish.lib; };
          rites-worker-source = pkgs.callPackage ./nix/tests/rites-worker-source.nix { };
          chronicle-sbt-lock = import ./nix/tests/chronicle-sbt-lock.nix { inherit pkgs; };
          chronicle-sbt-lock-helper = let
            updater = pkgs.callPackage ./nix/pkg/chronicle/update-lock.nix {
              lockfileGenerator = pkgs.writeShellScriptBin "squish-lockfile" "exit 99";
            };
          in pkgs.runCommand "chronicle-sbt-lock-helper-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./nix/pkg/chronicle/check-lock-guards.py} ${updater}/bin/chronicle-update-sbt-lock
            touch "$out"
          '';
          # The full suite requires Linux /proc process identity and bubblewrap.
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
            mkdir -p node_modules/@ponygirls && ln -s ${self.packages.${system}.ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
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
          podman-module = podmanModuleCheck;
          manure-browser = import ./nix/tests/manure-browser.nix { nativeCheck = self.checks.${system}.manure-native; };
          manure-vm = import ./nix/tests/manure-vm.nix {
            inherit pkgs nixpkgs;
            manureModule = self.nixosModules.manure;
            manureHmModule = self.homeManagerModules.manure;
            yoloHmModule = import ./nix/hm/yolo.nix { inherit inputs; };
            toolsHmModule = import ./nix/hm/tools.nix { inherit inputs; };
          };
          # Pre-exec launch validator fixtures (host-only: python3 +
          # qemu-img, no guest, no QEMU launch, no KVM needed).
          manure-vm-audit-test = pkgs.runCommandLocal "manure-vm-audit-test" {
            nativeBuildInputs = [ pkgs.python3 pkgs.qemu ];
          } ''
            ${pkgs.python3}/bin/python ${./nix/tests/manure-vm-audit.py} selftest
            touch $out
          '';
          crawl4ai-startup = import ./nix/tests/crawl4ai-startup.nix { inherit pkgs; package = self.packages.${system}.crawl4ai; };
          oci-images = import ./nix/tests/oci-images.nix { inherit pkgs; oci = self.lib.oci { inherit pkgs; }; };
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
        homeManagerModules.chronicle = import ./nix/hm/chronicle.nix;
        homeManagerModules.chronicleServer = import ./nix/hm/chronicle-server.nix { mkChroniclePackage = self.lib.mkChroniclePackage; };
        homeManagerModules.agenticServicesServer = import ./nix/hm/agentic-services-server.nix { inherit inputs; };
        homeManagerModules.haystack = import ./nix/hm/haystack.nix;
        homeManagerModules.manure = import ./nix/hm/manure.nix;
        homeManagerModules.service-postgres = import ./nix/hm/service-postgres.nix;
        nixosModules.service-postgres = import ./nix/nixos/service-postgres.nix;
        # OCI image packaging: `lib.oci` exposes one spec per service plus the
        # generic mkServiceImage builder (see nix/pkg/oci/default.nix).
        lib.oci = { pkgs }: pkgs.callPackage ./nix/pkg/oci/default.nix { };
        lib.mkHaystackPackage = { pkgs }: pkgs.callPackage ./nix/pkg/haystack/package.nix { squishLib = inputs.squish.lib; };
        lib.mkManureClientPackage = { pkgs }: pkgs.callPackage ./nix/pkg/manure/client.nix { };
        lib.mkManurePackage = { pkgs }: pkgs.callPackage ./nix/pkg/manure/package.nix { squishLib = inputs.squish.lib; };
        lib.mkChroniclePackage = { pkgs }: pkgs.callPackage ./nix/pkg/chronicle/server.nix { squishLib = inputs.squish.lib; };
        lib.mkOntologyPackage = { pkgs }: pkgs.callPackage ./nix/pkg/ontology/package.nix {
          squishLib = inputs.squish.lib;
          pi-coding-agent = pkgs.callPackage ./nix/pkg/pi-coding-agent/package.nix { };
        };
        lib.mkRitesPackage = { pkgs }: pkgs.callPackage ./nix/pkg/rites/package.nix {
          squishLib = inputs.squish.lib;
          pi-coding-agent = pkgs.callPackage ./nix/pkg/pi-coding-agent/package.nix { };
        };
        nixosModules.chronicle = import ./nix/nixos/chronicle.nix { mkChroniclePackage = self.lib.mkChroniclePackage; };
        nixosModules.haystack = import ./nix/nixos/haystack.nix { mkHaystackPackage = self.lib.mkHaystackPackage; };
        nixosModules.manure = import ./nix/nixos/manure.nix { mkManurePackage = self.lib.mkManurePackage; };
        nixosModules.podman = import ./nix/nixos/podman.nix;
        nixosModules.crawl4ai = import ./nix/nixos/crawl4ai.nix;
        nixosModules.crawl4ai-isolation = import ./nix/nixos/crawl4ai-isolation.nix;
      };
}
