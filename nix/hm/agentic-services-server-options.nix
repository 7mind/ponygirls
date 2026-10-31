# Deployment boundaries only. Secrets are runtime paths, never evaluated values.
{ inputs }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) mkOption mkEnableOption types;
  cfg = config.smind.hm.services.agentic;
  str =
    default: description:
    mkOption {
      type = types.str;
      inherit default description;
    };
  port =
    default:
    mkOption {
      type = types.port;
      inherit default;
      description = "TCP listener port.";
    };
  runtimePath =
    description:
    mkOption {
      type = types.nullOr types.str;
      default = null;
      inherit description;
    };
  strings =
    description:
    mkOption {
      type = types.listOf types.str;
      default = [ ];
      inherit description;
    };
  package =
    default:
    mkOption {
      type = types.package;
      inherit default;
      description = "Service package.";
    };
  backend = defaultPort: {
    listenAddress = str "127.0.0.1" "Loopback backend bind address; the proxy owns network exposure.";
    port = port defaultPort;
  };
in
{
  options.smind.hm.services.agentic = {
    enable = mkEnableOption "private Home Manager user services and reverse proxy";
    stateDirectory = str "${config.home.homeDirectory}/.local/state/agentic-services" ''
      Absolute persistent state directory. Existing deployments must explicitly
      retain their deployed path; moving it creates new operator credentials.
      The path must be suitable for nginx configuration (no whitespace).
    '';
    unitPrefix = mkOption {
      type = types.strMatching "[A-Za-z0-9_-]+";
      default = "agentic";
      description = "Stable unit-name prefix. For example ivm retains ivm-services-setup, ivm-crawl4ai and ivm-services-proxy.";
    };
    setupDependencies = strings "External setup/secret-provisioner unit names. Ordered with Wants, never Requires, to avoid stop propagation on secret refresh.";
    host = {
      hostname = mkOption {
        type = types.strMatching "[A-Za-z0-9.-]+";
        default = "localhost";
        description = "Proxy Host allowlist and default public URL hostname.";
      };
      address = mkOption {
        type = types.strMatching "[0-9.]+";
        default = "127.0.0.1";
        description = "Private IPv4 proxy listen address; configure network isolation externally.";
      };
      scheme = mkOption {
        type = types.enum [
          "https"
          "http"
        ];
        default = "https";
        description = "HTTPS requires externally provisioned certificates. Explicit http is an insecure-transport opt-in for a trusted private network only.";
      };
      loopbackAlias = mkOption {
        type = types.bool;
        default = false;
        description = "Also listen on the 127.0.1.1 hostname alias.";
      };
    };
    ports = lib.mapAttrs (_: port) {
      searxng = 8443;
      crawl4ai = 8444;
      haystack = 8445;
      manure = 8446;
      static = 8447;
    };
    urls = lib.genAttrs [ "searxng" "crawl4ai" "haystack" "manure" "static" ] (
      name:
      str "${cfg.host.scheme}://${cfg.host.hostname}:${toString cfg.ports.${name}}" "Externally visible ${name} origin. May differ from the proxy listener when an external edge forwards requests."
    );
    tls = {
      certificateFile = runtimePath "Absolute runtime TLS certificate path owned by an external provisioner.";
      keyFile = runtimePath "Absolute runtime TLS key path owned by an external provisioner.";
    };
    crawl4ai = backend 11235 // {
      package = package (pkgs.callPackage ../pkg/crawl4ai/package.nix { src = inputs.crawl4ai; });
      tokenFile = runtimePath "Absolute runtime crawler API-token file, outside the Nix store.";
      redisPort = port 16379;
    };
    searxng = backend 8888 // {
      package = package pkgs.searxng;
      settings = mkOption {
        type = (pkgs.formats.yaml { }).type;
        default = { };
        description = "Caller-provided SearXNG base settings (use_default_settings defaults to true). Bind, port, secret placeholder, limiter and image_proxy are owned by this module.";
      };
    };
    haystack = backend 47328 // {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Run Haystack, PostgreSQL, backups and its proxy listener. Disabling leaves all persistent files untouched.";
      };
      package = package (pkgs.callPackage ../pkg/haystack/package.nix { });
      agentTokenFile = runtimePath "Absolute runtime 43-character agent token file. Existing token mismatches fail closed without rotation.";
      activityProjectId = str "activity" "Default activity project ID.";
      legacyHosts = strings "Additional allowed backend Host names (not additional proxy listeners).";
      legacyOrigins = strings "Additional allowed backend origins.";
      insecureHttpOrigins = strings "Explicit trusted-private-network HTTP origin opt-ins.";
    };
    manure = backend 47329 // {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Run Manure and its proxy listener. Disabling leaves all persistent files untouched.";
      };
      package = package (pkgs.callPackage ../pkg/manure/package.nix { });
      agentTokenFile = runtimePath "Absolute runtime 43-character agent token file. Existing token mismatches fail closed without rotation.";
      legacyOrigins = strings "Additional allowed backend API origins.";
      allowInsecureHttp = mkOption {
        type = types.bool;
        default = cfg.host.scheme == "http";
        description = "Explicit private-network HTTP opt-in for Manure, including any legacy origins.";
      };
    };
    static = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Trusted-private-network static reads and authenticated WebDAV publishing.";
      };
      root = str "${cfg.stateDirectory}/www" "Absolute static publishing directory; disabling never removes its contents.";
      publishTokenFile = runtimePath "Optional absolute runtime token file for the publish basic-auth identity. Absent credentials fail writes closed.";
      authRealm = mkOption {
        type = types.strMatching "[A-Za-z0-9 _-]+";
        default = "publish";
        description = "Static publishing basic-auth realm.";
      };
      listingPath = mkOption {
        type = types.strMatching "/[A-Za-z0-9_./-]+/";
        default = "/.list/";
        description = "Read-only JSON directory listing location.";
      };
      maxBodySize = mkOption {
        type = types.strMatching "[0-9]+[kKmMgG]?";
        default = "1g";
        description = "nginx static publishing request size limit.";
      };
    };
    proxy = {
      extraHttpConfig = mkOption {
        type = types.lines;
        default = "";
        description = "Trusted caller-supplied nginx http-context configuration (for example rate-limit zones).";
      };
      extraServerConfig = mkOption {
        type = types.lines;
        default = "";
        description = "Trusted caller-supplied complete nginx server blocks, for example an independently configured Chronicle backend.";
      };
    };
  };
}
