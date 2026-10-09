# manure Home Manager client (CONTRACT.md frozen v0.2.0): CLI + stdio
# MCP wiring over runtime file-backed credentials.
#
# Option names are exactly CONTRACT.md §3.3 (closed set — no package
# option; the client package is resolved internally and only
# instantiated while enabled, so a disabled module builds nothing).
#
# Single credential transport (R3): MANURE_TOKEN_FILE everywhere —
# host session, MCP server env, and yolo sandbox. MANURE_TOKEN is
# never set by this module in any of those maps, so a stdio MCP child
# inheriting its harness environment can never observe both halves of
# the ambiguous-credentials pair (§9). The client validates token-file
# bytes itself per the exact-byte rule, preserving fail-closed
# behavior without a second transport.
#
# Host CLI defaults (R4): secret-free session variables
# (MANURE_URL/MANURE_TOKEN_FILE/MANURE_CACHE_DIR carry URLs and PATHS
# only) give the contractual flag > env > default precedence; a
# configured cacheDir additionally reaches the MCP env, the sandbox
# session, and a writable sandbox bind.
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.smind.hm.dev.llm.manure;
  llmEnabled = config.smind.hm.dev.llm.enable or false;

  # Client-agent SKILL, picked up automatically once it lands
  # (client-owned `manure/skill/SKILL.md`; absent pre-client-sync).
  skillFile = ../../manure/skill/SKILL.md;
  skillBody = if builtins.pathExists skillFile then builtins.readFile skillFile else null;

  cacheDir = if cfg.cacheDir != null then toString cfg.cacheDir else null;
  # Effective upload-session cache: the configured dir, else the
  # client's compiled default. Yolo silently skips nonexistent bind
  # sources, so a host pre-start hook provisions it before sandbox
  # entry (a fresh custom cache outside the default writables would
  # otherwise lose resume records on the host). [R4]
  # Host hook uses double quotes (not escapeShellArg single quotes) so
  # $HOME expands at runtime for the default; a failing host mkdir only
  # warns (yolo host-hook semantics), so a sandbox guard below fail-closes
  # when the persistent bind is still unavailable inside.
  effectiveCacheDir =
    if cacheDir != null then cacheDir else "$HOME/.cache/manure";
  cacheHook = {
    tags = [ "manure-cache" ];
    command = "mkdir -p \"${effectiveCacheDir}\"";
  };
  cacheGuard = {
    tags = [ "manure-cache" ];
    command = ''cache="${effectiveCacheDir}"; if [ ! -d "$cache" ] || [ ! -w "$cache" ]; then echo "manure: cache dir unavailable: $cache (persistent bind missing; resume records would be lost)" >&2; exit 1; fi'';
  };

  # MCP server env (paths/URLs only — no secret material in the store).
  mcpEnv = {
    MANURE_URL = cfg.url;
    MANURE_TOKEN_FILE = toString cfg.tokenFile;
  } // lib.optionalAttrs (cacheDir != null) {
    MANURE_CACHE_DIR = cacheDir;
  };
in
{
  options.smind.hm.dev.llm.manure = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        manure hosting client for agent harnesses (CLI + stdio MCP).
        Defaults to enabled when fully resolvable (url + tokenFile);
        override to false to opt out, or to true to fail loudly on
        partial config. Disabled builds and wires nothing.
      '';
    };
    url = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "http://127.0.0.1:47329";
      description = "manure API base URL (client accepts http: only for loopback hosts). Also exported as the host MANURE_URL default.";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Runtime file holding the raw 43-char bearer token (a path, never secret material). Also exported as the host MANURE_TOKEN_FILE default.";
    };
    userId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Expected user ID (informational; authorship comes from the token).";
    };
    tokenId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Expected token ID (informational; rotation overlap uses multiple IDs server-side).";
    };
    cacheDir = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Upload-session cache default (feeds MANURE_CACHE_DIR on the host, in MCP env, and in the sandbox, plus a writable sandbox bind; unset falls back to ~/.cache/manure). Holds manifests only — never bearer secrets, never external passwords.";
    };
  };

  config = lib.mkMerge [
    {
      # Auto-enable only when fully resolvable; never half-wire.
      smind.hm.dev.llm.manure.enable = lib.mkDefault (
        llmEnabled && cfg.url != null && cfg.tokenFile != null
      );
    }
    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = cfg.url != null && cfg.tokenFile != null;
          message = "smind.hm.dev.llm.manure: set both url and tokenFile.";
        }
        {
          assertion = cfg.url == null || lib.hasPrefix "http://" cfg.url || lib.hasPrefix "https://" cfg.url;
          message = "smind.hm.dev.llm.manure: url must be an http(s) URL.";
        }
      ];

      # One logical stdio entry; every harness spawns it natively.
      programs.mcp.servers.manure =
        let
          pkg = pkgs.callPackage ../pkg/manure/package.nix { };
        in
        {
          command = "${pkg}/bin/manure-mcp";
          env = mcpEnv;
        };

      # The CLI ships in the same package.
      home.packages = [ (pkgs.callPackage ../pkg/manure/package.nix { }) ];

      # Host CLI defaults: secret-free session variables (URLs and
      # paths only). CLI flag > this env > compiled default (§9).
      home.sessionVariables = {
        MANURE_URL = cfg.url;
        MANURE_TOKEN_FILE = toString cfg.tokenFile;
      } // lib.optionalAttrs (cacheDir != null) {
        MANURE_CACHE_DIR = cacheDir;
      };

      # Sandbox transport: the same single file-backed transport —
      # MANURE_TOKEN_FILE as a session variable, the file itself bound
      # read-only, cache bound read-write. No MANURE_TOKEN anywhere.
      smind.hm.dev.llm.yolo.sessionVariables = {
        MANURE_URL = cfg.url;
        MANURE_TOKEN_FILE = toString cfg.tokenFile;
      } // lib.optionalAttrs (cacheDir != null) {
        MANURE_CACHE_DIR = cacheDir;
      };
      smind.hm.dev.llm.yolo.extraReadOnlyPaths = [ (toString cfg.tokenFile) ];
      smind.hm.dev.llm.yolo.extraReadWritePaths = lib.optional (cacheDir != null) cacheDir;
      # Host pre-start hook provisions the effective cache dir before
      # entry; sandbox guard fail-closes if the bind is still unavailable
      # (host mkdir only warns, bind then skips). [R4]
      smind.hm.dev.llm.yolo.hooks.pre-start.host = [ cacheHook ];
      smind.hm.dev.llm.yolo.hooks.pre-start.sandbox = [ cacheGuard ];

      # Usage notes for every agent; the SKILL body joins once the
      # client agent lands it (guarded readFile above).
      smind.hm.dev.llm.assetBundles = [
        ({
          skills = lib.optionalAttrs (skillBody != null) { manure = skillBody; };
          context = [
            ''
              ## manure file & directory hosting

              `manure` CLI + `manure-mcp` stdio tools publish files and
              directories as artifacts (`internal` | `external(password)` |
              `public`, optional TTL). Connection: `MANURE_URL` plus the
              bearer file at `MANURE_TOKEN_FILE` (host and sandbox
              defaults are preconfigured; a CLI flag overrides the env).
              Never export `MANURE_TOKEN` alongside `MANURE_TOKEN_FILE`
              — both non-empty is `ambiguous-credentials` (exit 2, no
              network). Uploads are chunk-resumable (`upload --resume
              ID`, auto-resume on matching cache record); the cache
              holds manifests only, never secrets. An `external`
              password is returned ONCE by the generating call — resumed
              uploads print null plus a `rotate-password` note; loss
              recovery is `rotate-password` (any authenticated user).
              Token-free external fetch uses the content URL plus
              `--password[-file]` (grant flow, no URL secrets). Public
              fetches need no token.
            ''
          ];
        })
      ];
    })
  ];
}
