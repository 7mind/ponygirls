# BG: real registry/Pi/yolo composition, synthetic credentials, no live API.
{ pkgs, nixpkgs, inputs }:
let
  lib = nixpkgs.lib;
  evaluate = system: settings: lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { inherit system; }; inherit inputs; };
    modules = [
      (import ../hm/tools.nix { inherit inputs; })
      ../hm/codex.nix
      ../hm/pi.nix
      (import ../hm/yolo.nix { inherit inputs; })
      ../hm/atlassian.nix
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
      {
        smind.hm.dev.llm.enable = true;
        smind.hm.dev.llm.atlassian = settings;
        programs.mcp.servers.sentinel = { url = "https://example.com/mcp"; headers.Authorization = "unchanged"; };
      }
    ];
  };
  settings = { enable = true; email = "user@example.com"; tokenFile = "/run/secrets/atlassian"; };
  linux = (evaluate "x86_64-linux" settings).config;
  darwin = (evaluate "aarch64-darwin" settings).config;
  disabled = (evaluate "x86_64-linux" { }).config;
  configuredDisabled = (evaluate "x86_64-linux" (builtins.removeAttrs settings [ "enable" ])).config;
  incomplete = (evaluate "x86_64-linux" { enable = true; }).config;
  invalidEmail = (evaluate "x86_64-linux" (settings // { email = "user:name@example.com"; })).config;
  relativePath = (evaluate "x86_64-linux" (settings // { tokenFile = "relative/token"; })).config;
  valid = cfg: lib.all (a: a.assertion) cfg.assertions;
  wrapper = cfg: lib.findFirst (p: p.name == "atlassian-run") null cfg.home.packages;
  hook = cfg: lib.findFirst (h: lib.hasInfix "ATLASSIAN_AUTHORIZATION" h.command) null cfg.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox;
  runtime = (evaluate pkgs.stdenv.hostPlatform.system (settings // { tokenFile = "/build/token"; })).config;
in
assert valid linux && valid darwin;
assert !valid incomplete && !valid invalidEmail && !valid relativePath;
assert !(configuredDisabled.programs.mcp.servers ? atlassian);
assert !(disabled.programs.mcp.servers ? atlassian);
assert wrapper disabled == null;
assert hook disabled == null;
assert linux.programs.mcp.servers.atlassian.url == "https://mcp.atlassian.com/v2/mcp";
assert linux.programs.mcp.servers.atlassian.headers.Authorization == "\${ATLASSIAN_AUTHORIZATION}";
assert linux.programs.codex.settings.mcp_servers.atlassian.http_headers == { };
assert linux.programs.codex.settings.mcp_servers.atlassian.env_http_headers.Authorization == "ATLASSIAN_AUTHORIZATION";
assert linux.programs.mcp.servers.sentinel.headers.Authorization == "unchanged";
assert builtins.elem "/run/secrets/atlassian" linux.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert builtins.elem "/run/secrets/atlassian" darwin.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert hook linux != null && hook darwin != null;
assert lib.hasInfix "Atlassian MCP" linux.smind.hm.dev.llm.merged.memoryText;
pkgs.runCommandLocal "atlassian-hm-eval-test" {
  nativeBuildInputs = [ pkgs.python3 pkgs.jq ];
  mcpJson = linux.home.file."/home/alice/.pi/agent/mcp.json".source;
  sandboxHook = pkgs.writeText "atlassian-hook.sh" (hook runtime).command;
} ''
  python3 ${./atlassian-auth-test.py} ${../pkg/atlassian-auth/atlassian-auth.py} -v
  jq -e '.mcpServers.atlassian | .url == "https://mcp.atlassian.com/v2/mcp" and .headers.Authorization == "''${ATLASSIAN_AUTHORIZATION}" and .exposure == "deferred"' "$mcpJson"
  jq -e '.mcpServers.sentinel.headers.Authorization == "unchanged"' "$mcpJson"
  printf 'dummy-token\n' > /build/token
  expected='Basic dXNlckBleGFtcGxlLmNvbTpkdW1teS10b2tlbg=='
  actual="$(${wrapper runtime}/bin/atlassian-run ${pkgs.bash}/bin/bash -c 'printf %s "$ATLASSIAN_AUTHORIZATION"')"
  test "$actual" = "$expected"
  actual="$(${pkgs.bash}/bin/bash -c 'source "$1"; printf %s "$ATLASSIAN_AUTHORIZATION"' bash "$sandboxHook")"
  test "$actual" = "$expected"
  printf 'invalid token\n' > /build/token
  if ${wrapper runtime}/bin/atlassian-run ${pkgs.bash}/bin/bash -c 'touch /build/executed'; then exit 1; fi
  if ATLASSIAN_AUTHORIZATION=stale ${pkgs.bash}/bin/bash -c 'source "$1"; touch /build/executed' bash "$sandboxHook"; then exit 1; fi
  test ! -e /build/executed
  rm /build/token
  if ${wrapper runtime}/bin/atlassian-run ${pkgs.bash}/bin/bash -c 'touch /build/executed'; then exit 1; fi
  if ATLASSIAN_AUTHORIZATION=stale ${pkgs.bash}/bin/bash -c 'source "$1"; touch /build/executed' bash "$sandboxHook"; then exit 1; fi
  test ! -e /build/executed
  touch $out
''
