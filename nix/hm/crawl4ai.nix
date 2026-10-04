# Wires the shared programs.mcp registry so Claude Code, Codex, and Pi all
# spawn the same stdio proxy to the Crawl4AI SSE endpoint. The proxy reads
# the API token from the environment or from a file; it is not written into
# the Nix store.
{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.dev.llm.crawl4ai;
  mcp = pkgs.callPackage ../pkg/crawl4ai/mcp.nix { };
in
{
  options.smind.hm.dev.llm.crawl4ai = {
    enable = lib.mkEnableOption ''
      Crawl4AI as an MCP server for the coding-agent harnesses (Claude Code,
      Codex, and Pi)
    '';

    url = lib.mkOption {
      type = lib.types.str;
      example = "http://crawl4ai.example:11235/mcp/sse";
      description = "SSE endpoint of the Crawl4AI server (/mcp/sse).";
    };

    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Host path of the API token file, passed to the MCP proxy and read at
        startup. Inside yolo, {env}`CRAWL4AI_API_TOKEN` from
        {option}`smind.hm.dev.llm.yolo.secretSessionVariables` takes
        precedence, so the sandbox does not need this path bind-mounted.
      '';
    };
  };

  config = lib.mkIf (config.smind.hm.dev.llm.enable && cfg.enable) {
    assertions = [
      {
        assertion = cfg.url != "";
        message = "smind.hm.dev.llm.crawl4ai.url must be set when Crawl4AI MCP is enabled";
      }
    ];

    programs.mcp.servers.crawl4ai = {
      command = lib.getExe mcp;
      args = [ cfg.url ] ++ lib.optional (cfg.tokenFile != null) cfg.tokenFile;
    };
  };
}
