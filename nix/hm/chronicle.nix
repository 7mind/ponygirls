{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.dev.llm.chronicle;
  active = cfg.enable || cfg.collector.enable;
  baseUrl = if cfg.url == null then "" else lib.removeSuffix "/" cfg.url;
  runtimeToken = import ../lib/runtime-token.nix { inherit pkgs; };
  runtimeCredential = path: path != null && lib.hasPrefix "/" (toString path)
    && toString path != builtins.storeDir && !(lib.hasPrefix "${builtins.storeDir}/" (toString path));
  runner = pkgs.writeShellScriptBin "chronicle-run" ''
    if [[ $# == 0 ]]; then
      echo 'usage: chronicle-run COMMAND [ARG...]' >&2
      exit 2
    fi
    exec ${runtimeToken} CHRONICLE_TOKEN ${lib.escapeShellArg (if cfg.tokenFile == null then "" else toString cfg.tokenFile)} "$@"
  '';
  collectorConfig = pkgs.writeText "chronicle-collector.json" (builtins.toJSON ({
    enabled = true;
    endpoint = baseUrl;
    tokenFile = if cfg.collector.tokenFile == null then "" else toString cfg.collector.tokenFile;
    stateDir = cfg.collector.stateDirectory;
    inherit (cfg.collector) trustedHTTP discoverNative discoverYolo excludeDefaultProfile excludedYoloProfiles roots exclusions redactions;
  } // cfg.collector.limits));
  collectorCommand = "${cfg.collector.package}/bin/chronicle-collector --config ${collectorConfig}";
in
{
  options.smind.hm.dev.llm.chronicle = {
    enable = lib.mkEnableOption "Chronicle session-history MCP access (collection is a separate opt-in)";
    url = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://chronicle.example.net";
      description = "Chronicle base URL; the MCP registry appends /mcp.";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Runtime MCP/agent bearer token file (Read scope), never token contents. Also the compatibility default for collector.tokenFile.";
    };
    collector = {
      enable = lib.mkEnableOption "the Chronicle user collector; opt in only after reviewing roots, exclusions and model destinations";
      tokenFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = cfg.tokenFile;
        defaultText = lib.literalExpression "config.smind.hm.dev.llm.chronicle.tokenFile";
        description = "Runtime Ingest-only bearer token file for ingestion and progress reporting, separate from the MCP/agent Read token. Must be outside the Nix store.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.callPackage ../pkg/chronicle/collector.nix { };
        description = "Chronicle collector CLI package (Node 24).";
      };
      stateDirectory = lib.mkOption {
        type = lib.types.str;
        default = "${config.xdg.stateHome}/chronicle";
        description = "Private persistent spool, namespace, receipts and diagnostics.";
      };
      trustedHTTP = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Explicitly permit non-loopback plaintext HTTP on a trusted private network.";
      };
      discoverNative = lib.mkOption { type = lib.types.bool; default = true; description = "Discover native Claude, Codex active/archived, and Pi/subagent stores."; };
      discoverYolo = lib.mkOption { type = lib.types.bool; default = true; description = "Reconcile all named yolo profile stores as profiles are added."; };
      excludeDefaultProfile = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Exclude shared native/default-yolo storage. When true, admit only observed named yolo roots: ALL explicit/custom roots and unknown legacy pending origins are held, including named-looking IDs/paths. Reversible admission does not delete pending payloads; restart the collector after configuration changes.";
      };
      excludedYoloProfiles = lib.mkOption {
        type = lib.types.listOf (lib.types.addCheck (lib.types.strMatching "[A-Za-z0-9._-]+") (name: name != "." && name != ".."));
        default = [ ];
        apply = names: lib.sort builtins.lessThan (lib.unique names);
        description = "Exact case-sensitive named yolo profile exclusion set. Any nonempty set also holds ALL explicit/custom roots and unknown legacy origins because their discovery provenance cannot prove eligibility. A named folder called default is named, not native. Admission never infers origin from recorded IDs, paths, tags or prose; existing privacy-policy invalidation remains independent.";
      };
      roots = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
          options = {
            id = lib.mkOption { type = lib.types.str; description = "Stable discovery-root identity, independent of its filesystem location."; };
            format = lib.mkOption { type = lib.types.enum [ "pi" "claude" "codex" ]; description = "Producer format."; };
            path = lib.mkOption { type = lib.types.str; description = "Absolute session root."; };
          };
        });
        default = [ ];
        description = "Additional explicit roots; symlinks and attachment dereferences are refused.";
      };
      exclusions = lib.mkOption {
        type = lib.types.submodule {
          options = lib.genAttrs [ "roots" "profiles" "projects" "sessions" "paths" ] (_: lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
          });
        };
        default = { };
        description = "Exclusions applied before spool or upload; see collector documentation for matching semantics.";
      };
      redactions = lib.mkOption {
        type = lib.types.submodule {
          options = lib.genAttrs [ "fieldNames" "textPatterns" "secretFiles" ] (_: lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
          });
        };
        default = { };
        description = "Additional field-name and literal-text redactions before spool/upload. secretFiles names runtime-only credential files outside the Nix store; contents are loaded each cycle and never embedded in Nix. Missing/invalid files stop collection. The collector's own bearer is always included. Inline binary is omitted.";
      };
      limits = lib.mkOption {
        type = lib.types.attrsOf lib.types.ints.positive;
        default = { };
        example = { quietMs = 60000; maxFileBytes = 4194304; maxPayloadBytes = 8388608; };
        description = "Documented collector numeric bounds/timings; the collector rejects unknown keys.";
      };
    };
  };

  config = lib.mkMerge [
    (lib.mkIf active {
      assertions = [
        { assertion = cfg.url != null && cfg.url != ""; message = "Chronicle: url is required when MCP or collection is enabled."; }
        { assertion = !cfg.enable || runtimeCredential cfg.tokenFile; message = "Chronicle: tokenFile must name an absolute runtime credential outside the Nix store when MCP is enabled."; }
        { assertion = !cfg.collector.enable || lib.all runtimeCredential cfg.collector.redactions.secretFiles; message = "Chronicle: collector.redactions.secretFiles must name absolute runtime credentials outside the Nix store."; }
        { assertion = !cfg.collector.enable || runtimeCredential cfg.collector.tokenFile; message = "Chronicle: collector.tokenFile must name an absolute runtime credential outside the Nix store when collection is enabled."; }
        { assertion = !cfg.collector.enable || pkgs.stdenv.hostPlatform.isLinux; message = "Chronicle collector daemon currently supports Linux systemd user services; Darwin CLI/discovery is supported, launchd is deferred."; }
        { assertion = lib.hasPrefix "/" cfg.collector.stateDirectory; message = "Chronicle: collector.stateDirectory must be absolute."; }
        { assertion = lib.all (r: lib.hasPrefix "/" r.path && r.id != "") cfg.collector.roots; message = "Chronicle: each root requires a stable nonempty id and absolute path."; }
      ];
      home.packages = lib.optional cfg.enable runner ++ lib.optional cfg.collector.enable cfg.collector.package;
      xdg.configFile = lib.mkIf cfg.collector.enable {
        "chronicle/collector.json".source = collectorConfig;
      };
    })
    (lib.mkIf cfg.enable {
      programs.mcp.servers.chronicle = {
        url = "${baseUrl}/mcp";
        headers.Authorization = "Bearer \${CHRONICLE_TOKEN}";
      };
      programs.codex.settings.mcp_servers.chronicle = {
        url = "${baseUrl}/mcp";
        bearer_token_env_var = "CHRONICLE_TOKEN";
      };
      smind.hm.dev.llm.yolo.validatedSessionVariables.CHRONICLE_TOKEN = if cfg.tokenFile == null then "" else toString cfg.tokenFile;
    })
    (lib.mkIf (cfg.collector.enable && pkgs.stdenv.hostPlatform.isLinux) {
      systemd.user.services.chronicle-collector = {
        Unit = { Description = "Chronicle agent session archive collector"; After = [ "network-online.target" ]; };
        Service = {
          ExecStart = collectorCommand;
          Restart = "on-failure";
          RestartSec = 15;
          UMask = "0077";
          NoNewPrivileges = true;
        };
        Install.WantedBy = [ "default.target" ];
      };
    })
  ];
}
