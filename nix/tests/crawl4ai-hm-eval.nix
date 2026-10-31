# BG: module configuration contract, no credentials or remote MCP server.
{ pkgs, nixpkgs }:
let
  lib = nixpkgs.lib;
  evaluate = system: llmEnabled: settings: (lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { inherit system; }; };
    modules = [
      ../hm/crawl4ai.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.smind.hm.dev.llm.enable = lib.mkEnableOption "LLM tools";
        options.programs.mcp.servers = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
        options.programs.codex.settings = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
      })
      {
        smind.hm.dev.llm.enable = llmEnabled;
        smind.hm.dev.llm.crawl4ai = settings;
        programs.mcp.servers.sentinel.command = "unchanged";
        programs.codex.settings.mcp_servers.sentinel.command = "unchanged";
      }
    ];
  }).config;
  settings = { enable = true; url = "http://crawl4ai.example:11235/mcp/sse"; };
  linux = evaluate "x86_64-linux" true settings;
  darwin = evaluate "aarch64-darwin" true settings;
  fileToken = evaluate "x86_64-linux" true (settings // { tokenFile = "/run/secrets/crawl4ai"; });
  disabled = evaluate "x86_64-linux" true { };
  llmDisabled = evaluate "x86_64-linux" false settings;
  invalid = evaluate "x86_64-linux" true (settings // { url = ""; });
  valid = cfg: lib.all (a: a.assertion) cfg.assertions;
in
assert valid linux && valid darwin && valid fileToken;
assert !valid invalid;
assert lib.all (cfg:
  cfg.programs.codex.settings.mcp_servers.crawl4ai.env_vars == [ "CRAWL4AI_API_TOKEN" ]
  && cfg.programs.mcp.servers.crawl4ai.args == [ settings.url ]
  && lib.hasSuffix "/bin/crawl4ai-mcp" cfg.programs.mcp.servers.crawl4ai.command
  && cfg.programs.mcp.servers.sentinel.command == "unchanged"
  && cfg.programs.codex.settings.mcp_servers.sentinel.command == "unchanged"
) [ linux darwin ];
assert fileToken.programs.mcp.servers.crawl4ai.args == [ settings.url "/run/secrets/crawl4ai" ];
assert fileToken.programs.codex.settings.mcp_servers.crawl4ai.env_vars == [ "CRAWL4AI_API_TOKEN" ];
assert lib.all (cfg:
  !(cfg.programs.mcp.servers ? crawl4ai)
  && !(cfg.programs.codex.settings.mcp_servers ? crawl4ai)
) [ disabled llmDisabled ];
pkgs.runCommandLocal "crawl4ai-hm-eval-test" { } "touch $out"
