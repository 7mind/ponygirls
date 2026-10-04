# stdio MCP client for the self-hosted Crawl4AI SSE endpoint.
#
# The token is never placed in argv or in the Nix store. mcp-proxy reads
# API_ACCESS_TOKEN and sends `Authorization: Bearer …`. Callers export
# CRAWL4AI_API_TOKEN (yolo secretSessionVariables) or pass a token file path
# as the second argument.
{
  lib,
  writeShellScriptBin,
  mcp-proxy,
}:
writeShellScriptBin "crawl4ai-mcp" ''
  set -eu
  url=''${1:?crawl4ai-mcp: MCP SSE URL required}
  token_file=''${2:-}
  if [ -z "''${CRAWL4AI_API_TOKEN:-}" ]; then
    if [ -z "$token_file" ] || [ ! -r "$token_file" ]; then
      printf 'crawl4ai-mcp: CRAWL4AI_API_TOKEN is unset and %s is unreadable\n' \
        "''${token_file:-the token file}" >&2
      exit 1
    fi
    CRAWL4AI_API_TOKEN=$(tr -d ' \r\n' < "$token_file")
  fi
  if [ -z "$CRAWL4AI_API_TOKEN" ]; then
    printf 'crawl4ai-mcp: API token is empty\n' >&2
    exit 1
  fi
  export API_ACCESS_TOKEN="$CRAWL4AI_API_TOKEN"
  unset CRAWL4AI_API_TOKEN
  exec ${lib.getExe mcp-proxy} --transport sse "$url"
''
