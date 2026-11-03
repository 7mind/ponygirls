# BG: eval-only contract for the codex mcp_servers transport guard; no
# codex binary, no credentials. Codex rejects a mcp_servers table with
# neither `command` (stdio) nor `url` (streamable HTTP) with "invalid
# transport" and refuses the whole config, so the module must refuse to
# generate one. settings.mcp_servers.<name> replaces the programs.mcp
# registry-derived table wholesale, so a partial override must fail too.
{ pkgs, nixpkgs, inputs }:
let
  lib = nixpkgs.lib;
  evaluate = settings: (lib.evalModules {
    specialArgs = { inherit pkgs inputs; };
    modules = [
      (import ../hm/tools.nix { inherit inputs; })
      ../hm/codex.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.programs.mcp = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.programs.codex = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
        options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
      })
      ({ ... }: {
        smind.hm.dev.llm.enable = true;
        programs.mcp.servers.sentinel = { command = "/bin/false"; };
      } // settings)
    ];
  }).config;
  valid = cfg: lib.all (a: a.assertion) cfg.assertions;
  guardFails = cfg: lib.any
    (a: !a.assertion && lib.hasInfix "without a transport" a.message)
    cfg.assertions;
  registryStdio = evaluate { };
  registryServerUrl = evaluate { programs.mcp.servers.demo.serverUrl = "https://example.com/mcp"; };
  settingsHttp = evaluate { programs.codex.settings.mcp_servers.demo = { url = "https://example.com/mcp"; }; };
  settingsStdio = evaluate { programs.codex.settings.mcp_servers.demo = { command = "/bin/true"; args = [ "--mcp" ]; }; };
  # The regression shape: a settings override that drops the transport
  # (env_vars alone) replaces the registry-derived command/args wholesale.
  partialOverride = evaluate {
    programs.mcp.servers.demo = { command = "/bin/true"; };
    programs.codex.settings.mcp_servers.demo = { env_vars = [ "TOKEN" ]; };
  };
  transportless = evaluate { programs.codex.settings.mcp_servers.demo = { env_vars = [ "TOKEN" ]; }; };
in
assert valid registryStdio && valid registryServerUrl && valid settingsHttp && valid settingsStdio;
assert !valid partialOverride && !valid transportless;
assert guardFails partialOverride && guardFails transportless;
assert lib.all (cfg:
  lib.any (a: !a.assertion && lib.hasInfix "demo" a.message) cfg.assertions
) [ partialOverride transportless ];
pkgs.runCommandLocal "codex-mcp-guard-hm-eval-test" { } "touch $out"
