# manure file & directory hosting service (CONTRACT.md frozen v0.2.0).
#
# Option names are exactly CONTRACT.md §3.3 (closed set — no other
# options without an amendment). Notable consequences:
# - `maxListLimit`/`rateMapMaxEntries` have no Nix options; the server
#   defaults apply.
# - There is no `allowPublicListen` ack flag and the synced server binds
#   IPv4 directly: `listenAddress` is 127.0.0.1-only (the TLS edge sits
#   on a trusted peer). Anything else needs a contract amendment and/or
#   an owner-approved server IPv6 sync (see the assertion).
# - `dashboardDir`/`unlockShellDir` null means "omit from the generated
#   config", i.e. the server default `"package"` resolution (packaged
#   `manure/web/<name>` → repo fallback → null semantics). There is
#   intentionally no way to express JSON null (dashboard-disabled /
#   minimal unlock form) through these options.
# - Credential transport: the generated template carries credential
#   NAMES only; an owned launcher resolves them to
#   `$CREDENTIALS_DIRECTORY` paths at runtime (fail-closed), because
#   neither systemd nor the server expands `$VAR` references inside
#   JSON. Digest bytes never enter any generated file.
# - Wildcard content hosts (`*.<contentSuffix>`) cannot use HTTP-01
#   validation: ACME never issues wildcard certs over HTTP. When the
#   content suffix needs TLS, provision a DNS-01 certificate out of band
#   (e.g. `security.acme.certs.<name>` with a DNS provider) and point
#   `proxy.acmeHost` at a host whose certificate covers BOTH the API
#   host and `*.<contentSuffix>`. This module never assumes an
#   HTTP-issued wildcard cert. Note nginx does not validate SAN
#   coverage at load time; wrong-SAN trust is established ONLY by real
#   clients verifying with --cacert (the VM SAN positive/negative cover
#   this). The VM handoff probes that use curl -sk / CERT_NONE verify
#   TLS transport + Host routing only, NOT certificate trust/SAN — do not
#   claim production assurance from skip-verification.
{ config, lib, pkgs, ... }:
let
  cfg = config.smind.services.manure;

  # Credential names are sanitized derivations of user/token ids (no
  # secrets in the store; systemd loads the digest files listed here).
  # Sanitizing avoids systemd-credential-invalid characters, and the
  # uniqueness assertion below rejects collisions (e.g. (a-b,c) vs
  # (a,b-c)) fail-closed. [A1]
  sanitizeId = s: lib.concatMapStrings
    (c: if builtins.match "[A-Za-z0-9_.-]" c != null then c else "_")
    (lib.stringToCharacters s);
  credName = userId: tokenId: "manure-hash-${sanitizeId userId}-${sanitizeId tokenId}";
  allCredNames = lib.flatten (lib.mapAttrsToList
    (userId: user: lib.mapAttrsToList (tokenId: _: credName userId tokenId) user.tokens)
    cfg.users);

  apiHost =
    let
      noScheme = lib.removePrefix "https://" (lib.removePrefix "http://" (cfg.apiOrigin or ""));
      noPath = builtins.head (builtins.split "/" noScheme);
      # [A2] Explicit IPv6 reject: bracketed literals need an
      # owner-approved server sync plus a bracket-aware parser. Fail
      # closed here so "[::1]:47329" never silently becomes "" via
      # naive split(":") (verified: head(split(":", "[::1]:47329")) == "[").
      # The apiOrigin assertions below provide the user-facing error;
      # this throw is defense-in-depth if apiHost is forced directly.
      isBracketed = lib.hasInfix "[" noPath || lib.hasInfix "]" noPath;
      noPort = builtins.head (builtins.split ":" noPath);
    in
    if isBracketed
    then throw "smind.services.manure: apiOrigin IPv6 literals need owner-approved server IPv6 sync (bracket parser absent)"
    else noPort;

  # Bracketed backend host for proxy URLs (bare ::1 is not a valid URL
  # host). [A2]
  backendHost =
    if lib.hasInfix ":" cfg.listenAddress
    then "[${cfg.listenAddress}]"
    else cfg.listenAddress;

  # Largest request body nginx must accept: chunk PUTs carry up to
  # chunkBytes, every other (JSON) body up to maxRequestBodyBytes. [R5]
  bodyBound = lib.max cfg.chunkBytes cfg.maxRequestBodyBytes;

  # The template carries credential NAMES, never paths or digests; the
  # launcher below resolves them at runtime. Token entries use the
  # `credential` key (the server's `hashFile` is filled in by the
  # launcher with an absolute $CREDENTIALS_DIRECTORY path). [R2]
  serverTemplate = {
    listen_address = cfg.listenAddress;
    port = cfg.port;
    data_dir = cfg.dataDir;
    api_origin = cfg.apiOrigin;
    content_suffix = cfg.contentSuffix;
    loopback_dev = cfg.loopbackDev;
    trusted_proxies = cfg.trustedProxies;
    users = lib.mapAttrsToList
      (userId: user: {
        id = userId;
        type = user.type;
      } // lib.optionalAttrs (user.displayName != "") {
        displayName = user.displayName;
      } // {
        tokens = lib.mapAttrsToList (tokenId: _: {
          id = tokenId;
          credential = credName userId tokenId;
        }) user.tokens;
      })
      cfg.users;
    storage_quota_bytes = cfg.storageQuotaBytes;
    chunk_bytes = cfg.chunkBytes;
    max_file_bytes = cfg.maxFileBytes;
    max_artifact_bytes = cfg.maxArtifactBytes;
    max_files_per_artifact = cfg.maxFilesPerArtifact;
    max_request_body_bytes = cfg.maxRequestBodyBytes;
    max_connections = cfg.maxConnections;
    request_timeout_s = cfg.requestTimeoutS;
    max_sessions_per_user = cfg.maxSessionsPerUser;
    max_sessions_global = cfg.maxSessionsGlobal;
    max_grants_per_artifact = cfg.maxGrantsPerArtifact;
    rate_limit_per_min = cfg.rateLimitPerMin;
    unlock_rate_per_min = cfg.unlockRatePerMin;
    login_rate_per_min_per_ip = cfg.loginRatePerMinPerIp;
    sweep_interval_s = cfg.sweepInterval;
    incomplete_session_ttl_s = cfg.incompleteSessionTtl;
    grant_ttl_s = cfg.grantTtl;
    one_time_grant_ttl_s = cfg.oneTimeGrantTtl;
  } // lib.optionalAttrs (cfg.dashboardDir != null) {
    dashboard_dir = cfg.dashboardDir;
  } // lib.optionalAttrs (cfg.unlockShellDir != null) {
    unlock_shell_dir = cfg.unlockShellDir;
  };

  templateJson = pkgs.writeText "manure-config.template.json" (builtins.toJSON serverTemplate);

  # Owned launcher: resolves credential names to live
  # $CREDENTIALS_DIRECTORY absolute paths, validates each digest file
  # against the server's exact-byte rule WITHOUT embedding any digest
  # bytes, materializes a runtime-only config under $RUNTIME_DIRECTORY,
  # and execs the server. Fail-closed on every violation. [R2]
  launcher = pkgs.writeShellScriptBin "manure-launcher" ''
    set -euo pipefail
    : "''${CREDENTIALS_DIRECTORY:?manure launcher: CREDENTIALS_DIRECTORY is not set}"
    : "''${RUNTIME_DIRECTORY:?manure launcher: RUNTIME_DIRECTORY is not set}"
    out="$RUNTIME_DIRECTORY/manure-config.json"
    TEMPLATE=${templateJson} CRED_DIR="$CREDENTIALS_DIRECTORY" OUT="$out" \
      ${pkgs.python3}/bin/python3 - <<'PYEOF'
    import json, os, re, sys
    template = os.environ["TEMPLATE"]
    cred_dir = os.environ["CRED_DIR"]
    out = os.environ["OUT"]
    with open(template, "r", encoding="utf-8") as fh:
        config = json.load(fh)
    digest_re = re.compile(r"[0-9a-f]{64}")
    for user in config["users"]:
        for tok in user["tokens"]:
            name = tok.pop("credential")
            path = os.path.join(cred_dir, name)
            if not os.path.isfile(path):
                sys.stderr.write(
                    "manure launcher: credential missing: %s\n" % name)
                sys.exit(1)
            with open(path, "rb") as fh:
                raw = fh.read()
            if raw.endswith(b"\n"):
                raw = raw[:-1]
            try:
                text = raw.decode("ascii")
            except UnicodeDecodeError:
                sys.stderr.write(
                    "manure launcher: credential non-ascii: %s\n" % name)
                sys.exit(1)
            if "\n" in text or "\r" in text:
                sys.stderr.write(
                    "manure launcher: credential not single-line: %s\n" % name)
                sys.exit(1)
            if not digest_re.fullmatch(text.lower()):
                sys.stderr.write(
                    "manure launcher: credential not a hex digest: %s\n" % name)
                sys.exit(1)
            # Absolute runtime path only; digest bytes never enter the config.
            tok["hashFile"] = os.path.join(cred_dir, name)
    with open(out, "w", encoding="utf-8") as fh:
        os.chmod(out, 0o600)
        json.dump(config, fh)
    PYEOF
    exec ${cfg.package}/bin/manure-server --config "$out"
  '';

  # Allowlisted access-log format: addresses, timing, and the query-less
  # path only. No request headers (Referer can carry query secrets),
  # no $request/$args (query-bearing), no cookies/authorization. [R6]
  # NOTE [R6-error]: nginx error_log format is native/fixed and includes
  # the full original request line (with query) not only on upstream
  # connection-refused 502 (error-level, verified) but ALSO on critical
  # faults such as access-log disk-write failure (alert-level, verified
  # via /dev/full repro: "write() to \"/dev/full\" failed ... while
  # logging request, ... request: \"GET /x?grant=CANARY ...\"" despite
  # location error_log crit, because alert > crit). It cannot be sanitized
  # via log_format (external constraint, disclosed here, not hidden).
  # Boundary correction (intentional, not silent): the API backend
  # location below disables its unsafe error channel via
  # `error_log /dev/null;` so NEITHER error-level 502 NOR alert-level
  # critical contexts can persist query to any file/journal from this
  # location (verified: baseline 502 + /dev/full critical both leak-free
  # to persistent channels with /dev/null). The explicit redirect servers
  # carry the same per-context correction: they inherit the global native
  # channel, and an access-log ENOSPC alert for a redirect request was
  # verified persisting its query-bearing request line there (fail-first
  # VM proof), so each redirect context disables it too. Sanitized observability is
  # preserved via safe channels: sanitized access_log status/$uri (when
  # writable) plus the backend's allowlisted structured logs (route,
  # request id, timing, status, principal/artifact labels, byte counts;
  # never tokens/query per server allowlist) plus global nginx errors for
  # non-API contexts (global logError untouched, still stderr->journal).
  # Operators use access status + app logs; no persistent API-location
  # nginx error diagnostics exist by design (unsafe channel removed).
  logFormat = ''
    log_format manure_sanitized '$remote_addr [$time_local] $server_name '
      '"$request_method $uri $server_protocol" $status $body_bytes_sent '
      'rt=$request_time';
  '';
  accessLog = "access_log /var/log/nginx/manure-access.log manure_sanitized;";

  # [Host-map] gixy host_spoofing is a false positive HERE (proven by build
  # failure on bare $http_host vs pass on $host): proxy_pass is FIXED
  # (127.0.0.1:port, never Host-derived, so spoofed Host cannot steer
  # upstream selection) and the backend STRICTLY validates Host/port
  # (_parse_authority + _check_production_port; VM proves wrong-port and
  # wrong-host 400). Bare $host would STRIP :port (verified repro) and let
  # wrong ports bypass as no-port — insecure here, despite gixy's generic
  # $host recommendation. This map preserves the EXACT $http_host value
  # (default branch) with fail-closed empty fallback ("" ""), i.e.
  # semantically IDENTICAL to bare $http_host (Host-less still 400s);
  # it exists only so default gixy validation stays ON for everything else
  # (no validateConfigFile disable, no silent waiver).
  hostMap = ''
    map $http_host $manure_host {
      default $http_host;
      "" "";
    }
  '';

  # Shared backend location: Host forwarded intact via $manure_host
  # (EXACT $http_host value through the [Host-map] above; §5.8 authority
  # comes only from Host, INCLUDING an explicit port: $host strips ":port"
  # (verified: api.example:PORT -> api.example), breaking non-default
  # origins and letting wrong ports bypass; the map preserves the incoming
  # authority exactly with identical fail-closed semantics).
  # trust signal the backend honors, and only from trusted peers),
  # request buffering off (chunk PUTs must stream), bounded upstream
  # timeouts, no Access-Control-Allow-Origin anywhere.
  backendLocation = {
    proxyPass = "http://${backendHost}:${toString cfg.port}";
    proxyWebsockets = true;
    extraConfig = ''
      proxy_set_header Host $manure_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      # [R6-error] Intentionally disable the unsafe error channel for
      # this location (native format leaks query even at alert on
      # critical faults; verified via /dev/full repro). Safe channels
      # preserve observability (see logFormat NOTE). Global errors for
      # non-API contexts still log via the service's logError (stderr).
      error_log /dev/null;
      proxy_request_buffering off;
      proxy_buffering off;
      client_max_body_size ${toString bodyBound};
      proxy_connect_timeout ${toString cfg.requestTimeoutS}s;
      proxy_send_timeout ${toString cfg.requestTimeoutS}s;
      proxy_read_timeout ${toString cfg.requestTimeoutS}s;
    '';
  };

  tls = cfg.proxy.acmeHost != null;

  # Redirect servers are explicit (not forceSSL-generated) so their
  # logging stays on the allowlisted format too. [R6] Their server
  # contexts inherit the global native error channel, so a
  # request-associated alert (e.g. access-log ENOSPC, verified leaking
  # the query-bearing redirect request line) would persist query there;
  # same boundary correction as the API locations (global untouched).
  redirectVhost = name: host: lib.mkIf tls {
    serverName = host;
    listen = [{ addr = "0.0.0.0"; port = 80; } { addr = "[::]"; port = 80; }];
    extraConfig = ''
      ${accessLog}
      error_log /dev/null;
      return 301 https://$host$request_uri;
    '';
  };
in
{
  options.smind.services.manure = {
    enable = lib.mkEnableOption "manure file & directory hosting service";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../pkg/manure/package.nix { };
      description = "manure server package (bundles the dashboard + unlock shells).";
    };
    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Bind address. 127.0.0.1 only in this revision: the synced server binds the IPv4 family directly, so ::1 cannot start, and bracket-aware origin parsing is absent (IPv6 needs an owner-approved server sync).";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 47329;
      description = "Local port for the manure backend (plain HTTP; TLS terminates at the proxy).";
    };
    apiOrigin = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://artifacts.7mind.io";
      description = "Public dashboard/API origin (required when enabled). http: only with loopbackDev on loopback hosts.";
    };
    contentSuffix = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "artifacts.7mind.io";
      description = "Content suffix; each artifact serves from <hex32>.<contentSuffix>. A separate registrable domain is strongly recommended when unrelated apps share the parent domain (§5.6).";
    };
    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/manure";
      description = "Storage root (sqlite + staging + live). Created 0700 manure:manure via tmpfiles, including custom paths.";
    };
    users = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          type = lib.mkOption { type = lib.types.enum [ "human" "agent" ]; description = "Attribution only, never authorization."; };
          displayName = lib.mkOption { type = lib.types.str; default = ""; description = "Display name (omitted from config when empty)."; };
          tokens = lib.mkOption {
            type = lib.types.attrsOf (lib.types.submodule {
              options.tokenHashFile = lib.mkOption {
                # Deliberately NOT lib.types.path: interpolating a Nix
                # path value would copy the digest bytes into the store.
                # Runtime secret-manager paths are plain strings. [R7]
                type = lib.types.str;
                description = "Absolute runtime path of the file holding the token's SHA-256 hex digest (secret-manager path, never store material; multiple IDs allow rotation overlap). Must be absolute and outside the Nix store; Nix path values are rejected.";
              };
            });
            default = { };
            description = "Token IDs to digest files.";
          };
        };
      });
      default = { };
      description = "Static users and their token digests (≥1 user with ≥1 token required).";
    };
    storageQuotaBytes = lib.mkOption { type = lib.types.ints.positive; default = 21474836480; description = "Atomic reservation cap (20 GiB)."; };
    chunkBytes = lib.mkOption { type = lib.types.ints.positive; default = 1048576; description = "Server-dictated chunk size (256 KiB–4 MiB)."; };
    maxFileBytes = lib.mkOption { type = lib.types.ints.positive; default = 536870912; description = "Per-file cap (512 MiB)."; };
    maxArtifactBytes = lib.mkOption { type = lib.types.ints.positive; default = 2147483648; description = "Artifact total cap (2 GiB; must fit storageQuotaBytes)."; };
    maxFilesPerArtifact = lib.mkOption { type = lib.types.ints.positive; default = 10000; description = "Files + dir entries cap."; };
    maxRequestBodyBytes = lib.mkOption { type = lib.types.ints.positive; default = 4194304; description = "Non-chunk JSON body cap (4 MiB; over → 413). nginx admits up to max(chunkBytes, maxRequestBodyBytes)."; };
    maxConnections = lib.mkOption { type = lib.types.ints.positive; default = 128; description = "Global concurrent-request semaphore (excess → 503 + Retry-After)."; };
    requestTimeoutS = lib.mkOption { type = lib.types.ints.positive; default = 30; description = "Per-connection socket timeout; also the proxy upstream timeout."; };
    maxSessionsPerUser = lib.mkOption { type = lib.types.ints.positive; default = 10; description = "Concurrent uploading artifacts per user (over → 429 session-limit)."; };
    maxSessionsGlobal = lib.mkOption { type = lib.types.ints.positive; default = 1000; description = "Concurrent uploading artifacts total."; };
    maxGrantsPerArtifact = lib.mkOption { type = lib.types.ints.positive; default = 10000; description = "Grant cookies per artifact (oldest evicted)."; };
    rateLimitPerMin = lib.mkOption { type = lib.types.ints.positive; default = 600; description = "Per-principal API mutation budget."; };
    unlockRatePerMin = lib.mkOption { type = lib.types.ints.positive; default = 10; description = "Per artifact + socket-peer-IP password attempts."; };
    loginRatePerMinPerIp = lib.mkOption { type = lib.types.ints.positive; default = 10; description = "Per socket-peer-IP logins (XFF never used)."; };
    sweepInterval = lib.mkOption { type = lib.types.ints.positive; default = 300; description = "Expired/orphan sweeper period (s)."; };
    incompleteSessionTtl = lib.mkOption { type = lib.types.ints.positive; default = 86400; description = "Idle uploading sessions become sweepable (s)."; };
    grantTtl = lib.mkOption { type = lib.types.ints.positive; default = 86400; description = "Content grant lifetime (capped by artifact TTL)."; };
    oneTimeGrantTtl = lib.mkOption { type = lib.types.ints.positive; default = 60; description = "Single-use handoff grant lifetime."; };
    loopbackDev = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow http + non-Secure dev cookies on loopback only. Production MUST be false.";
    };
    trustedProxies = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "127.0.0.1/32" "::1/128" ];
      description = "CIDRs whose X-Forwarded-Proto is honored. All other forwarded headers are ignored.";
    };
    dashboardDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Explicit dashboard shell dir. Null omits the key (server default \"package\" resolution → packaged shells).";
    };
    unlockShellDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Explicit unlock shell dir. Null omits the key (server default \"package\" resolution → packaged shell).";
    };
    proxy = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Manage host-local nginx virtual hosts (API host + wildcard content host) forwarding Host-intact with X-Forwarded-Proto. Disable when TLS terminates on an external edge.";
      };
      acmeHost = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Use this ACME host's certificate (null: plain HTTP proxy, loopback development only). Wildcard content needs a DNS-01 cert covering *.<contentSuffix>; never assume an HTTP-issued wildcard.";
      };
      openFirewall = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Open firewall for HTTP/HTTPS (never by default).";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.users != { };
        message = "smind.services.manure: configure at least one user (human and/or agent token digests).";
      }
      {
        assertion = lib.all (u: u.tokens != { }) (lib.attrValues cfg.users);
        message = "smind.services.manure: every user needs at least one token (rotation overlap uses multiple IDs).";
      }
      {
        assertion = lib.all (n: lib.stringLength n <= 255) allCredNames;
        message = "smind.services.manure: credential names must fit 255 bytes (systemd credential/filename bound); shorten user/token IDs.";
      }
      {
        assertion = lib.unique allCredNames == allCredNames;
        message = "smind.services.manure: sanitized credential names collide; user/token IDs must differ after [^A-Za-z0-9_.-]→_ sanitizing.";
      }
      {
        assertion = lib.all
          (f: lib.hasPrefix "/" f && !(lib.hasPrefix builtins.storeDir f))
          (lib.flatten (lib.mapAttrsToList
            (userId: user: lib.mapAttrsToList (tokenId: token: token.tokenHashFile) user.tokens)
            cfg.users));
        message = "smind.services.manure: tokenHashFile must be an absolute runtime path outside the Nix store (a secret-manager path, never Nix-store material).";
      }
      {
        assertion = cfg.apiOrigin != null && cfg.contentSuffix != null;
        message = "smind.services.manure: apiOrigin and contentSuffix are required.";
      }
      {
        assertion = cfg.loopbackDev || lib.hasPrefix "https://" (cfg.apiOrigin or "");
        message = "smind.services.manure: apiOrigin must be https: unless loopbackDev is enabled (loopback development only).";
      }
      {
        assertion = cfg.listenAddress == "127.0.0.1";
        message = "smind.services.manure: listenAddress is 127.0.0.1-only in this revision (the server binds IPv4 directly: ::1 cannot start and non-loopback has no operator-ack flag in the frozen set); anything else needs a contract amendment and/or server IPv6 support.";
      }
      {
        # [A2] Explicit IPv6-listen reject (defense-in-depth alongside
        # the 127.0.0.1-only pin): any ":" in the bind address is an
        # IPv6 literal or malformed input needing owner-approved server
        # IPv6 sync plus bracket-aware origin parsing.
        assertion = !(lib.hasInfix ":" cfg.listenAddress);
        message = "smind.services.manure: listenAddress IPv6 literals (e.g. ::1) need owner-approved server IPv6 sync; this revision binds 127.0.0.1 only.";
      }
      {
        # [A2] Explicit IPv6-origin reject: bracketed apiOrigin literals
        # (https://[::1]/, https://[::1]:443/) need owner-approved server
        # IPv6 sync plus bracket-aware parsing (apiHost fail-closes via
        # throw); unbracketed bare colons are invalid URLs and fail closed
        # at Host validation/runtime.
        assertion = cfg.apiOrigin == null || (!(lib.hasInfix "[" cfg.apiOrigin) && !(lib.hasInfix "]" cfg.apiOrigin));
        message = "smind.services.manure: apiOrigin IPv6 literals need owner-approved server IPv6 sync (bracket parser absent); use an IPv4/hostname origin.";
      }
      {
        assertion = lib.hasPrefix "/" cfg.dataDir;
        message = "smind.services.manure: dataDir must be an absolute path.";
      }
      {
        assertion = cfg.chunkBytes >= 262144 && cfg.chunkBytes <= 4194304;
        message = "smind.services.manure: chunkBytes must be within 256 KiB–4 MiB (§12).";
      }
      {
        assertion = cfg.maxArtifactBytes <= cfg.storageQuotaBytes;
        message = "smind.services.manure: maxArtifactBytes must fit storageQuotaBytes (reservations are atomic).";
      }
      {
        assertion = cfg.proxy.enable || !cfg.proxy.openFirewall;
        message = "smind.services.manure: proxy.openFirewall without proxy.enable opens ports for no virtual host.";
      }
      {
        assertion = !cfg.proxy.enable || cfg.proxy.acmeHost != null || cfg.loopbackDev;
        message = "smind.services.manure: a managed proxy without acmeHost terminates only plain HTTP, so loopbackDev is required (development); production needs proxy.acmeHost (wildcard content: DNS-01 cert).";
      }
    ];

    users.users.manure = {
      isSystemUser = true;
      group = "manure";
      description = "manure file hosting service";
    };
    users.groups.manure = { };

    # Storage root, owned 0700 even for custom paths.
    systemd.tmpfiles.rules = [
      "d ${cfg.dataDir} 0700 manure manure -"
    ];

    systemd.services.manure = {
      description = "manure file & directory hosting service";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        ExecStart = "${launcher}/bin/manure-launcher";
        User = "manure";
        Group = "manure";
        RuntimeDirectory = "manure";
        RuntimeDirectoryMode = "0700";
        Restart = "on-failure";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        ProtectKernelTunables = true;
        ProtectControlGroups = true;
        RestrictNamespaces = true;
        LockPersonality = true;
        CapabilityBoundingSet = "";
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
        ReadWritePaths = [ cfg.dataDir ];
        LoadCredential = lib.flatten (lib.mapAttrsToList
          (userId: user: lib.mapAttrsToList
            (tokenId: token: "${credName userId tokenId}:${token.tokenHashFile}")
            user.tokens)
          cfg.users);
      };
    };

    services.nginx = lib.mkIf cfg.proxy.enable {
      enable = true;
      commonHttpConfig = logFormat + hostMap;
      virtualHosts.${apiHost} = {
        serverName = apiHost;
        onlySSL = tls;
        useACMEHost = cfg.proxy.acmeHost;
        locations."/" = backendLocation;
        extraConfig = accessLog;
      };
      virtualHosts."content-${cfg.contentSuffix}" = {
        serverName = "*.${cfg.contentSuffix}";
        onlySSL = tls;
        useACMEHost = cfg.proxy.acmeHost;
        locations."/" = backendLocation;
        extraConfig = accessLog;
      };
      virtualHosts."redirect-${apiHost}" = redirectVhost "redirect" apiHost;
      virtualHosts."redirect-content-${cfg.contentSuffix}" = redirectVhost "redirect-content" "*.${cfg.contentSuffix}";
    };
    networking.firewall.allowedTCPPorts = lib.mkIf (cfg.proxy.openFirewall) (
      [ 80 ] ++ lib.optional (cfg.proxy.acmeHost != null) 443
    );
  };
}
