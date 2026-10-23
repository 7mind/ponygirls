# manure Home Manager client (CONTRACT.md frozen v0.2.0): CLI + stdio
# MCP wiring over runtime literal or file-backed credentials.
#
# Option names are exactly CONTRACT.md §3.3 (closed set — no package
# option; the client package is resolved internally and only
# instantiated while enabled, so a disabled module builds nothing).
#
# Runtime credentials override the configured file fallback. No secret material
# is evaluated by Nix; CLI resolution stays lazy for help and public fetches.
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

  pkg = pkgs.callPackage ../pkg/manure/package.nix { };
  defaultFile = if cfg.tokenFile == null then "" else toString cfg.tokenFile;
  manureClient = pkgs.runCommand "manure-client" { } ''
    mkdir -p $out/bin
    for command in manure manure-mcp; do
      cat > "$out/bin/$command" <<'SCRIPT'
    #!${pkgs.runtimeShell}
    if [[ -z "''${MANURE_TOKEN:-}" && -z "''${MANURE_TOKEN_FILE:-}" ]]; then
      export MANURE_TOKEN_FILE=${lib.escapeShellArg defaultFile}
    fi
    SCRIPT
      printf 'exec %s/bin/%s "$@"\n' ${pkg} "$command" >> "$out/bin/$command"
    done
    chmod +x $out/bin/*
  '';

  # MCP server env (paths/URLs only — no secret material in the store).
  mcpEnv = {
    MANURE_URL = cfg.url;
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
        Defaults to enabled when a url is configured;
        override to false to opt out, or to true to fail loudly on
        partial config. Disabled builds and wires nothing.
      '';
    };
    url = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "http://127.0.0.1:47329";
      description = "manure API base URL (non-loopback http: requires explicit MANURE_ALLOW_INSECURE_HTTP=1 in the client environment). Also exported as the host MANURE_URL default.";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Runtime file holding the raw 43-char bearer token (a path, never secret material). Used as a fallback only when neither runtime MANURE_TOKEN nor MANURE_TOKEN_FILE is nonempty; never exported as a host session default.";
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
      # A configured URL permits runtime-only credentials.
      smind.hm.dev.llm.manure.enable = lib.mkDefault (
        llmEnabled && cfg.url != null
      );
    }
    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = cfg.url != null;
          message = "smind.hm.dev.llm.manure: set url.";
        }
        {
          assertion = cfg.url == null || lib.hasPrefix "http://" cfg.url || lib.hasPrefix "https://" cfg.url;
          message = "smind.hm.dev.llm.manure: url must be an http(s) URL.";
        }
      ];

      # One logical stdio entry; every harness spawns it natively.
      programs.mcp.servers.manure =
        {
          command = "${manureClient}/bin/manure-mcp";
          env = mcpEnv;
        };

      # The CLI ships in the same package.
      home.packages = [ manureClient ];

      # Host CLI defaults: secret-free session variables (URLs and
      # paths only). Credential defaults are resolved lazily by the CLI wrapper.
      home.sessionVariables = {
        MANURE_URL = cfg.url;
      } // lib.optionalAttrs (cacheDir != null) {
        MANURE_CACHE_DIR = cacheDir;
      };

      # File mode retains a read-only credential bind; literal runtime mode
      # uses the private composed environment file instead.
      smind.hm.dev.llm.yolo.sessionVariables = {
        MANURE_URL = cfg.url;
      } // lib.optionalAttrs (cacheDir != null) {
        MANURE_CACHE_DIR = cacheDir;
      };
      smind.hm.dev.llm.yolo.validatedSessionVariables.MANURE_TOKEN_FILE = defaultFile;
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
              runtime `MANURE_TOKEN` or `MANURE_TOKEN_FILE`; configured
              token files are fallbacks only when neither is nonempty.
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
