# manure NixOS module eval test (CONTRACT.md N1 + §5.8 edge shape).
#
# Two layers: pure-eval assertions on full nixosSystem configs
# (units, vhosts, firewall, launcher wiring), and stub-world
# assertion forcing (positive + negative). A build-time phase greps
# the REALIZED template/launcher derivations: credential names only,
# no digest material, no store secret paths.
{ pkgs, nixpkgs, manureModule }:
let
  lib = nixpkgs.lib;

  mkSystem = extra: (nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    modules = [
      manureModule
      ({ lib, ... }: lib.recursiveUpdate
        {
          system.stateVersion = "26.11";
          smind.services.manure.enable = true;
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
      tokens.next.tokenHashFile = "/run/secrets/agent-sha-next";
    };
  };

  full = mkSystem {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.dataDir = "/srv/manure-data";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };

  dev = mkSystem {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "http://127.0.0.1:47329";
    smind.services.manure.contentSuffix = "artifacts.localhost";
    smind.services.manure.loopbackDev = true;
  };

  noProxy = mkSystem {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.enable = false;
  };

  wideChunks = mkSystem {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
    smind.services.manure.chunkBytes = 4194304;
    smind.services.manure.maxRequestBodyBytes = 1048576;
  };

  stubOptions = { lib, ... }: {
    options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
    options.services.nginx = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
    options.networking.firewall.allowedTCPPorts = lib.mkOption { type = lib.types.listOf lib.types.port; default = [ ]; };
    options.systemd.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
    options.systemd.tmpfiles.rules = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
    options.users.users = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
    options.users.groups = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
  };

  evalManure = extra: nixpkgs.lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { system = "x86_64-linux"; }; };
    modules = [
      manureModule
      stubOptions
      ({ lib, ... }: lib.recursiveUpdate
        { smind.services.manure.enable = true; }
        extra)
    ];
  };

  forceChecked = extra: builtins.tryEval (
    let
      sys = evalManure extra;
    in
    if lib.all (a: a.assertion) sys.config.assertions
    then true
    else throw "manure eval test: expected assertion failure did not fire"
  );

  noUsers = forceChecked { };
  httpProd = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "http://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
  };
  nonLoopback = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.listenAddress = "0.0.0.0";
  };
  firewallWithoutProxy = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.enable = false;
    smind.services.manure.proxy.openFirewall = true;
  };
  plainProxyProd = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
  };
  badChunk = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
    smind.services.manure.chunkBytes = 4096;
  };
  emptyTokens = forceChecked {
    smind.services.manure.users = {
      lonely = { type = "agent"; tokens = { }; };
    };
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
  };
  # [R7] a store-materialized digest path is rejected (would copy
  # credential bytes into the store via LoadCredential interpolation).
  storeDigest = forceChecked {
    smind.services.manure.users = {
      w-agent = {
        type = "agent";
        tokens.default.tokenHashFile = toString (pkgs.writeText "digest" "00");
      };
    };
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };
  # [A1] colliding sanitized credential names are rejected.
  collidingCreds = forceChecked {
    smind.services.manure.users = {
      a-b = { type = "agent"; tokens.c.tokenHashFile = "/run/secrets/1"; };
      a = { type = "agent"; tokens.b-c.tokenHashFile = "/run/secrets/2"; };
    };
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };
  # [A1] overlong IDs exceed the 255-byte systemd credential/filename bound.
  longIds = forceChecked {
    smind.services.manure.users = {
      w-agent = {
        type = "agent";
        tokens.${lib.concatStrings (lib.genList (_: "t") 240)}.tokenHashFile = "/run/secrets/1";
      };
    };
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };
  # [A2] IPv6 listen is rejected (needs owner-approved server sync).
  ipv6Listen = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
    smind.services.manure.listenAddress = "::1";
  };
  # [A2] IPv6 apiOrigin literals are rejected (bracket parser absent).
  ipv6Origin = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://[::1]/";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };
  ipv6OriginPort = forceChecked {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://[::1]:443/";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  };

  apiVhost = full.services.nginx.virtualHosts."artifacts.example.net";
  contentVhost = full.services.nginx.virtualHosts."content-content.example.net";
  apiLoc = apiVhost.locations."/";
  contentLoc = contentVhost.locations."/";
  wideLoc = wideChunks.services.nginx.virtualHosts."artifacts.example.net".locations."/";
in
assert lib.all (a: a.assertion) (evalManure {
  smind.services.manure.users = fullUsers;
  smind.services.manure.apiOrigin = "https://artifacts.example.net";
  smind.services.manure.contentSuffix = "content.example.net";
  smind.services.manure.dataDir = "/srv/manure-data";
  smind.services.manure.proxy.acmeHost = "artifacts.example.net";
}).config.assertions;
assert lib.all (a: a.assertion) (evalManure {
  smind.services.manure.users = fullUsers;
  smind.services.manure.apiOrigin = "http://127.0.0.1:47329";
  smind.services.manure.contentSuffix = "artifacts.localhost";
  smind.services.manure.loopbackDev = true;
}).config.assertions;
assert lib.all (a: a.assertion) (evalManure {
  smind.services.manure.users = fullUsers;
  smind.services.manure.apiOrigin = "https://artifacts.example.net";
  smind.services.manure.contentSuffix = "content.example.net";
  smind.services.manure.proxy.enable = false;
}).config.assertions;
assert full.systemd.services.manure.description != "";
assert builtins.elem "multi-user.target" full.systemd.services.manure.wantedBy;
# Digest credentials load via LoadCredential, never store material
# (rotation overlap = two entries for one user).
assert builtins.elem "manure-hash-w-agent-default:/run/secrets/agent-sha"
  full.systemd.services.manure.serviceConfig.LoadCredential;
assert builtins.elem "manure-hash-w-agent-next:/run/secrets/agent-sha-next"
  full.systemd.services.manure.serviceConfig.LoadCredential;
assert builtins.elem "manure-hash-operator-browser:/run/secrets/human-sha"
  full.systemd.services.manure.serviceConfig.LoadCredential;
# [R2] the unit execs the owned launcher (runtime credential
# resolution), not the server against a JSON literal; the launcher
# gets a private runtime dir for the materialized config.
assert full.systemd.services.manure.serviceConfig.ExecStart != "";
assert builtins.match ".*manure-launcher.*" full.systemd.services.manure.serviceConfig.ExecStart != null;
assert full.systemd.services.manure.serviceConfig.RuntimeDirectory == "manure";
# Bound loopback backend, named system user, storage in ReadWritePaths.
assert full.systemd.services.manure.serviceConfig.User == "manure";
assert builtins.elem "/srv/manure-data" full.systemd.services.manure.serviceConfig.ReadWritePaths;
assert builtins.elem "d /srv/manure-data 0700 manure manure -" full.systemd.tmpfiles.rules;
assert full.users.users.manure.isSystemUser;
# Hardening minima.
assert full.systemd.services.manure.serviceConfig.NoNewPrivileges == true;
assert full.systemd.services.manure.serviceConfig.ProtectSystem == "strict";
assert full.systemd.services.manure.serviceConfig.PrivateTmp == true;
# Edge: API host + wildcard content host, Host intact via $manure_host
# (EXACT $http_host value through the http-level map; preserves explicit
# :port for non-default origins; bare $host would strip and let wrong ports
# bypass backend validation), proto from edge, no buffering, no CORS.
assert apiVhost.onlySSL;
assert apiVhost.useACMEHost == "artifacts.example.net";
assert contentVhost.serverName == "*.content.example.net";
assert contentVhost.onlySSL;
assert contentVhost.useACMEHost == "artifacts.example.net";
assert apiLoc.proxyPass == "http://127.0.0.1:47329";
assert contentLoc.proxyPass == "http://127.0.0.1:47329";
assert apiLoc.proxyWebsockets;
assert contentLoc.proxyWebsockets;
assert builtins.match ".*proxy_set_header Host \\$manure_host;.*" apiLoc.extraConfig != null;
assert builtins.match ".*proxy_set_header Host \\$manure_host;.*" contentLoc.extraConfig != null;
# [Host-map] http-level map preserves EXACT $http_host (default) with
# fail-closed empty fallback; keeps default gixy validation ON (bare
# $http_host fails host_spoofing build; bare $host would strip :port).
assert builtins.match ".*map \\$http_host \\$manure_host.*" full.services.nginx.commonHttpConfig != null;
assert builtins.match ".*default \\$http_host;.*" full.services.nginx.commonHttpConfig != null;
# Regression: bare $host (without map/http_) must not return (strips :port).
assert builtins.match ".*proxy_set_header Host \\$host;.*" apiLoc.extraConfig == null;
assert builtins.match ".*proxy_set_header Host \\$host;.*" contentLoc.extraConfig == null;
assert builtins.match ".*proxy_set_header X-Forwarded-Proto \\$scheme;.*" apiLoc.extraConfig != null;
assert builtins.match ".*proxy_set_header X-Forwarded-Proto \\$scheme;.*" contentLoc.extraConfig != null;
assert builtins.match ".*proxy_request_buffering off;.*" apiLoc.extraConfig != null;
assert builtins.match ".*proxy_buffering off;.*" contentLoc.extraConfig != null;
# [R6-error] API location intentionally disables its unsafe error channel
# (native format leaks query even at alert on critical faults; verified via
# /dev/full repro). Safe channels preserve observability (sanitized access
# status when writable + backend allowlisted logs + global errors for
# non-API contexts). Never `error_log off;` (ambiguous) nor a persistent
# error file for this location (would retain query on alert).
assert builtins.match ".*error_log /dev/null;.*" apiLoc.extraConfig != null;
assert builtins.match ".*error_log /dev/null;.*" contentLoc.extraConfig != null;
assert builtins.match ".*manure-error\\.log.*" apiLoc.extraConfig == null;
assert builtins.match ".*manure-error\\.log.*" contentLoc.extraConfig == null;
assert builtins.match ".*error_log off;.*" apiLoc.extraConfig == null;
assert builtins.match ".*error_log off;.*" contentLoc.extraConfig == null;
assert builtins.match ".*Access-Control-Allow-Origin.*" apiLoc.extraConfig == null;
assert builtins.match ".*Access-Control-Allow-Origin.*" contentLoc.extraConfig == null;
# [R5] the admitted body bound is max(chunkBytes, maxRequestBodyBytes):
# defaults admit a 4 MiB manifest with 1 MiB chunks; wide chunks raise it.
assert builtins.match ".*client_max_body_size 4194304;.*" apiLoc.extraConfig != null;
assert builtins.match ".*client_max_body_size 4194304;.*" wideLoc.extraConfig != null;
assert builtins.match ".*proxy_read_timeout 30s;.*" contentLoc.extraConfig != null;
# [R6] allowlisted log format at http level (covers vhosts AND the
# explicit redirect servers): no raw headers, no query-bearing fields.
assert builtins.match ".*log_format manure_sanitized.*" full.services.nginx.commonHttpConfig != null;
assert builtins.match ".*\\$uri.*" full.services.nginx.commonHttpConfig != null;
assert builtins.match ".*http_referer.*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*http_user_agent.*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*http_authorization.*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*http_cookie.*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*\\$request[^_a-z].*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*\\$args.*" full.services.nginx.commonHttpConfig == null;
assert builtins.match ".*access_log /var/log/nginx/manure-access.log manure_sanitized;.*" apiVhost.extraConfig != null;
assert builtins.match ".*access_log /var/log/nginx/manure-access.log.*" apiLoc.extraConfig == null;
# Redirect servers are explicit with the same sanitized logging.
assert full.services.nginx.virtualHosts."redirect-artifacts.example.net".serverName == "artifacts.example.net";
assert builtins.match ".*return 301.*" full.services.nginx.virtualHosts."redirect-artifacts.example.net".extraConfig != null;
assert builtins.match ".*manure_sanitized.*" full.services.nginx.virtualHosts."redirect-artifacts.example.net".extraConfig != null;
# [R6-redirect-error] redirect server contexts inherit the global native
# error channel; a request-associated alert (e.g. access-log ENOSPC)
# would persist the query-bearing request line there. Same boundary
# correction as the API locations: disable the unsafe channel per
# redirect context (global diagnostics untouched).
assert builtins.match ".*error_log /dev/null;.*" full.services.nginx.virtualHosts."redirect-artifacts.example.net".extraConfig != null;
assert builtins.match ".*error_log /dev/null;.*" full.services.nginx.virtualHosts."redirect-content-content.example.net".extraConfig != null;
assert full.services.nginx.virtualHosts."redirect-content-content.example.net".serverName == "*.content.example.net";
# Dev loopback host: plain HTTP proxy, wildcard content vhost, no
# redirect servers, no firewall ports.
assert !dev.services.nginx.virtualHosts."127.0.0.1".onlySSL;
assert dev.services.nginx.virtualHosts."content-artifacts.localhost".serverName == "*.artifacts.localhost";
assert !(dev.services.nginx.virtualHosts ? "redirect-127.0.0.1");
assert dev.networking.firewall.allowedTCPPorts == [ ];
# Firewall closed unless asked (TLS cert configured, still closed).
assert full.networking.firewall.allowedTCPPorts == [ ];
# External edge (proxy.enable = false): no virtual hosts, no ports,
# service itself unaffected.
assert !(noProxy.services.nginx.virtualHosts ? "artifacts.example.net");
assert noProxy.networking.firewall.allowedTCPPorts == [ ];
assert noProxy.systemd.services.manure.description != "";
# Negative cases fail for the right reason.
assert !noUsers.success;
assert !httpProd.success;
assert !nonLoopback.success;
assert !firewallWithoutProxy.success;
assert !plainProxyProd.success;
assert !badChunk.success;
assert !emptyTokens.success;
assert !storeDigest.success;
assert !collidingCreds.success;
assert !longIds.success;
assert !ipv6Listen.success;
assert !ipv6Origin.success;
assert !ipv6OriginPort.success;
pkgs.runCommandLocal "manure-nixos-eval-test"
{
  # Realized template + launcher: grep the actual bytes (credential
  # names only; no digest material, no /run/secrets paths, launcher
  # resolves $CREDENTIALS_DIRECTORY at runtime and fails closed).
  launcherBin = (evalManure {
    smind.services.manure.users = fullUsers;
    smind.services.manure.apiOrigin = "https://artifacts.example.net";
    smind.services.manure.contentSuffix = "content.example.net";
    smind.services.manure.proxy.acmeHost = "artifacts.example.net";
  }).config.systemd.services.manure.serviceConfig.ExecStart;
} ''
  test -x "$launcherBin"
  grep -q 'CREDENTIALS_DIRECTORY' "$launcherBin"
  grep -q 'RUNTIME_DIRECTORY' "$launcherBin"
  grep -q 'manure-server --config' "$launcherBin"
  # The template path is baked into the launcher; extract and inspect it.
  tmpl=$(grep -o '/nix/store/[^ "]*manure-config.template.json' "$launcherBin" | head -n 1)
  test -n "$tmpl"
  grep -q '"credential":"manure-hash-w-agent-default"' "$tmpl"
  grep -q '"credential":"manure-hash-operator-browser"' "$tmpl"
  # No digest material, no secret paths, no $VAR literals in the template.
  ! grep -Eq '[0-9a-f]{64}' "$tmpl"
  ! grep -q '/run/secrets' "$tmpl"
  ! grep -q 'CREDENTIALS_DIRECTORY' "$tmpl"
  ! grep -q '"hashFile"' "$tmpl"
  touch $out
''
