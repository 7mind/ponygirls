# manure Home Manager module eval test (CONTRACT.md N3).
#
# Pure evaluation on Linux + Darwin: asserts the frozen HM option
# shape, CLI + stdio MCP wiring with path-only env (no secrets in the
# store), the single file-backed credential transport ([R3]: no
# MANURE_TOKEN in any map the module owns, so an inheriting MCP child
# can never observe both halves of the ambiguous pair), host CLI
# defaults ([R4]), sandbox binds, composition with unrelated MCP
# servers, and that a disabled module builds and wires nothing.
#
# A final REAL-composition leg ([R8]) evaluates the module together
# with the in-repo harness aggregation (tools/codex/pi/yolo): the
# manure asset bundle must survive the real merge machinery and the
# MCP entry must reach Pi's re-emitted mcp.json (verified by grep at
# build time). Only downstream-owned HM leaf options are stubbed.
{ pkgs, nixpkgs, inputs, manureModule, yoloHmModule, podmanHmModule }:
let
  lib = nixpkgs.lib;

  evalManureHm = sys: tokenFile: cacheDir: osConfig: (nixpkgs.lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { system = sys; }; inherit osConfig; };
    modules = [
      manureModule
      yoloHmModule
      podmanHmModule
      ./manure-hm-stub.nix
      ({ ... }: {
        config.smind.hm.dev.llm.manure = {
          enable = true;
          url = "http://127.0.0.1:47329";
          inherit tokenFile;
          userId = "w-agent";
          tokenId = "default";
          inherit cacheDir;
        };
        # A pre-existing unrelated server must survive composition.
        config.programs.mcp.servers.codegraph = { command = "/bin/false"; };
      })
    ];
  });

  linuxMod = evalManureHm "x86_64-linux" "/run/secrets/manure-token" "/home/alice/.cache/manure" null;
  darwinMod = evalManureHm "aarch64-darwin" "/run/secrets/manure-token" null null;
  disabledMod = linuxMod.extendModules {
    modules = [ { smind.hm.dev.llm.manure.enable = lib.mkForce false; } ];
  };
  partialMod = builtins.tryEval (
    let
      sys = nixpkgs.lib.evalModules {
        specialArgs = { pkgs = import nixpkgs { system = "x86_64-linux"; }; osConfig = null; };
        modules = [
          manureModule
          yoloHmModule
          podmanHmModule
          ./manure-hm-stub.nix
          ({ ... }: {
            config.smind.hm.dev.llm.manure = {
              enable = true;
              url = "http://127.0.0.1:47329";
            };
          })
        ];
      };
    in
    if lib.all (a: a.assertion) sys.config.assertions
    then true
    else throw "manure HM eval test: expected assertion failure did not fire"
  );

  linuxMcp = linuxMod.config.programs.mcp.servers.manure;
  darwinMcp = darwinMod.config.programs.mcp.servers.manure;
  linuxYolo = linuxMod.config.smind.hm.dev.llm.yolo.sessionVariables;
  linuxHost = linuxMod.config.home.sessionVariables;

  # [R8] real-consumer composition: the actual in-repo harness
  # modules (merge machinery, Pi MCP re-emit, Codex wiring, yolo
  # transport options) with only downstream HM leaves stubbed.
  realCompose = sys: (nixpkgs.lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { system = sys; }; inherit inputs; osConfig = null; };
    modules = [
      (import ../hm/tools.nix { inherit inputs; })
      ../hm/codex.nix
      ../hm/pi.nix
      (import ../hm/yolo.nix { inherit inputs; })
      manureModule
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.programs.mcp = lib.mkOption {
          type = lib.types.submodule {
            freeformType = lib.types.attrsOf lib.types.anything;
            options.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          };
          default = { };
        };
        options.programs.codex = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
        options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
        options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
        options.xdg.configHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.config"; };
      })
      ({ ... }: {
        config.smind.hm.dev.llm.enable = true;
        config.smind.hm.dev.llm.manure = {
          enable = true;
          url = "http://127.0.0.1:47329";
          tokenFile = "/run/secrets/manure-token";
          cacheDir = "/home/alice/.cache/manure";
        };
        config.programs.mcp.servers.sentinel-keepme = { command = "/bin/false"; };
      })
    ];
  });
  realLinux = realCompose "x86_64-linux";
  realDarwin = realCompose "aarch64-darwin";
  piMcpJson = realLinux.config.home.file."/home/alice/.pi/agent/mcp.json".source;
in
assert linuxMod.config.smind.hm.dev.llm.manure.url == "http://127.0.0.1:47329";
assert darwinMod.config.smind.hm.dev.llm.manure.url == "http://127.0.0.1:47329";
# One logical stdio entry; command is the packaged manure-mcp.
assert lib.hasSuffix "/bin/manure-mcp" linuxMcp.command;
assert lib.hasSuffix "/bin/manure-mcp" darwinMcp.command;
# Env carries paths/URLs only — the token FILE path, never its content.
assert linuxMcp.env.MANURE_URL == "http://127.0.0.1:47329";
assert linuxMcp.env.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert linuxMcp.env.MANURE_CACHE_DIR == "/home/alice/.cache/manure";
assert !(darwinMcp.env ? MANURE_CACHE_DIR);
# [R3] single transport: MANURE_TOKEN appears in NO map this module
# owns (MCP env, host session, yolo session/validated). An MCP child
# inheriting its harness env therefore observes exactly one transport.
assert !(linuxMcp.env ? MANURE_TOKEN);
assert !(linuxHost ? MANURE_TOKEN);
assert !(linuxYolo ? MANURE_TOKEN);
assert !(linuxMod.config.smind.hm.dev.llm.yolo.validatedSessionVariables ? MANURE_TOKEN);
assert (linuxYolo // linuxMcp.env) ? MANURE_TOKEN_FILE;
assert !((linuxYolo // linuxMcp.env) ? MANURE_TOKEN);
assert (linuxHost // linuxMcp.env) ? MANURE_TOKEN_FILE;
assert !((linuxHost // linuxMcp.env) ? MANURE_TOKEN);
# Sandbox transport: file path variable + read-only credential bind.
assert linuxYolo.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert linuxYolo.MANURE_URL == "http://127.0.0.1:47329";
assert linuxYolo.MANURE_CACHE_DIR == "/home/alice/.cache/manure";
assert builtins.elem "/run/secrets/manure-token" linuxMod.config.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
# [R4] host CLI defaults (secret-free) + writable custom-cache bind.
assert linuxHost.MANURE_URL == "http://127.0.0.1:47329";
assert linuxHost.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert linuxHost.MANURE_CACHE_DIR == "/home/alice/.cache/manure";
assert builtins.elem "/home/alice/.cache/manure" linuxMod.config.smind.hm.dev.llm.yolo.extraReadWritePaths;
# [R4] the host pre-start hook provisions the effective cache dir
# before sandbox entry (tag-gated, exact mkdir command, double-quoted so
# $HOME expands at runtime) plus a sandbox guard that fail-closes when the
# persistent bind is still unavailable (host mkdir only warns, bind skips).
# Membership form (not whole-list equality): the REAL yolo module contributes
# its own hooks (e.g. tagged codegraph) alongside ours; only OUR element is
# pinned exactly here, so yolo-owned entries can evolve without false-failing.
assert builtins.any (h: h.tags == [ "manure-cache" ] && h.command == "mkdir -p \"/home/alice/.cache/manure\"")
  linuxMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.host;
assert builtins.any (h: h.tags == [ "manure-cache" ] && h.command == "mkdir -p \"$HOME/.cache/manure\"")
  darwinMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.host;
assert builtins.any (h: h.tags == [ "manure-cache" ]) linuxMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: builtins.match ".*cache dir unavailable.*" h.command != null) linuxMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: builtins.match ".*exit 1.*" h.command != null) linuxMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: builtins.match ".*/home/alice/.cache/manure.*" h.command != null) linuxMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: h.tags == [ "manure-cache" ]) darwinMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: builtins.match ".*exit 1.*" h.command != null) darwinMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert builtins.any (h: builtins.match ".*HOME.*cache/manure.*" h.command != null) darwinMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert !(darwinMod.config.home.sessionVariables ? MANURE_CACHE_DIR);
assert !(darwinMod.config.smind.hm.dev.llm.yolo.sessionVariables ? MANURE_CACHE_DIR);
assert darwinMod.config.smind.hm.dev.llm.yolo.extraReadWritePaths == [ ];
# The module's own assertions hold for these configurations.
assert lib.all (a: a.assertion) linuxMod.config.assertions;
assert lib.all (a: a.assertion) darwinMod.config.assertions;
# Unrelated servers survive composition.
assert linuxMod.config.programs.mcp.servers.codegraph.command == "/bin/false";
# Usage notes reach the bundle; the client-owned SKILL joins when it lands.
assert lib.all (b: b ? context) linuxMod.config.smind.hm.dev.llm.assetBundles;
assert lib.any
  (b: builtins.match ".*manure-mcp.*" (builtins.concatStringsSep "\n" (b.context or [ ])) != null)
  linuxMod.config.smind.hm.dev.llm.assetBundles;
# Disabled: no package, no MCP entry, no vars, no binds, no bundles.
assert disabledMod.config.home.packages == [ ];
assert !(disabledMod.config.programs.mcp.servers ? manure);
assert disabledMod.config.home.sessionVariables == { };
assert disabledMod.config.smind.hm.dev.llm.yolo.validatedSessionVariables == { };
assert disabledMod.config.smind.hm.dev.llm.yolo.sessionVariables == { };
assert disabledMod.config.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ ];
assert disabledMod.config.smind.hm.dev.llm.yolo.extraReadWritePaths == [ ];
# Disabled: manure contributes no hooks (yolo keeps its own defaults, e.g.
# the codegraph sandbox bootstrap — those are yolo-owned, not asserted here).
assert ! lib.any (h: h.tags == [ "manure-cache" ]) disabledMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.host;
assert ! lib.any (h: h.tags == [ "manure-cache" ]) disabledMod.config.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
assert disabledMod.config.smind.hm.dev.llm.assetBundles == [ ];
# Explicit enable with partial config fails loudly.
assert !partialMod.success;
# [R8] the manure bundle survives the REAL merge machinery on both
# systems, and the registry keeps both entries (no clobber).
assert lib.all (a: a.assertion) realLinux.config.assertions;
assert lib.all (a: a.assertion) realDarwin.config.assertions;
assert lib.hasInfix "manure file & directory hosting" realLinux.config.smind.hm.dev.llm.merged.memoryText;
assert lib.hasInfix "manure file & directory hosting" realDarwin.config.smind.hm.dev.llm.merged.memoryText;
assert realLinux.config.programs.mcp.servers.manure.env.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert realLinux.config.programs.mcp.servers.sentinel-keepme.command == "/bin/false";
# Pi re-emits the manure stdio entry and the host/yolo defaults come
# from the same composition (mcp.json content grepped at build time).
assert realLinux.config.home.sessionVariables.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert realLinux.config.smind.hm.dev.llm.yolo.sessionVariables.MANURE_TOKEN_FILE == "/run/secrets/manure-token";
assert builtins.elem "/home/alice/.cache/manure" realLinux.config.smind.hm.dev.llm.yolo.extraReadWritePaths;
pkgs.runCommandLocal "manure-hm-eval-test"
{
  mcpJson = piMcpJson;
} ''
  grep -q '"manure"' "$mcpJson"
  grep -q 'manure-mcp' "$mcpJson"
  grep -q 'MANURE_TOKEN_FILE' "$mcpJson"
  grep -q '/run/secrets/manure-token' "$mcpJson"
  grep -q '"exposure": *"deferred"' "$mcpJson"
  # No secret material, no second transport in the emitted file.
  ! grep -q 'MANURE_TOKEN[^_]' "$mcpJson"
  touch $out
''
