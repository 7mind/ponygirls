{ pkgs, nixpkgs }:
let
  lib = nixpkgs.lib;
  source = pkgs.callPackage ../pkg/chronicle/source.nix { };
  hm = system: extra: (lib.evalModules {
    specialArgs.pkgs = import nixpkgs { inherit system; };
    modules = [
      ../hm/chronicle.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
        options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.systemd.user.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      })
      extra
    ];
  }).config;
  configured = {
    smind.hm.dev.llm.chronicle = {
      enable = true;
      url = "https://chronicle.example.net/";
      tokenFile = "/run/secrets/chronicle-agent";
      collector.enable = true;
    };
    programs.mcp.servers.keep-me.command = "/bin/false";
  };
  linux = hm "x86_64-linux" configured;
  darwin = hm "aarch64-darwin" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.enable = false; });
  disabled = hm "x86_64-linux" { };
  missing = hm "x86_64-linux" { smind.hm.dev.llm.chronicle.enable = true; };
  darwinDaemon = hm "aarch64-darwin" configured;
  checked = cfg: lib.all (a: a.assertion) cfg.assertions;
  server = extra: (lib.nixosSystem {
    system = "x86_64-linux";
    modules = [ ../nixos/chronicle.nix { system.stateVersion = "26.11"; } extra ];
  }).config;
  serverConfig = {
    smind.services.chronicle = {
      enable = true;
      package = pkgs.writeShellScriptBin "chronicle-server" "exit 0";
      publicUrl = "https://chronicle.example.net";
      users.alice = { login = "alice"; passwordHashFile = "/run/secrets/alice-password-hash"; };
      database.passwordFile = "/run/secrets/chronicle-database-password";
      annotation = { endpoint = "http://127.0.0.1:8000/v1/chat/completions"; model = "annotation-model"; revision = "test-v1"; credentialFile = "/run/secrets/annotation-key"; };
      embedding = { endpoint = "http://127.0.0.1:8001/v1/embeddings"; model = "embedding-model"; revision = "test-v1"; credentialFile = "/run/secrets/embedding-key"; dimensions = 768; queryPrefix = "query: "; documentPrefix = "document: "; };
    };
  };
  enabledServer = server serverConfig;
  disabledServer = server { };
  sendDimensions = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.embedding.sendDimensions = true; });
  noSsd = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.database.ssdTuning = false; });
  customSsd = server (serverConfig // { services.postgresql.settings = { random_page_cost = 2.0; effective_io_concurrency = 64; maintenance_io_concurrency = 32; }; });
  externalDatabase = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.database = { manageLocal = false; jdbcUrl = "jdbc:postgresql://db.example/chronicle"; }; });
  insecureServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.publicUrl = "http://example.net"; });
  ownAssertions = cfg: lib.filter (a: !a.assertion && lib.hasPrefix "Chronicle:" a.message) cfg.assertions;
in
assert !(source.filter "${toString source.origSrc}/.local" "directory");
assert checked linux;
assert checked darwin;
assert !(checked missing);
assert !(checked darwinDaemon);
assert linux.programs.mcp.servers.chronicle.url == "https://chronicle.example.net/mcp";
assert linux.programs.mcp.servers.keep-me.command == "/bin/false";
assert linux.programs.mcp.servers.chronicle.headers.Authorization == "Bearer \${CHRONICLE_TOKEN}";
assert linux.programs.codex.settings.mcp_servers.chronicle.bearer_token_env_var == "CHRONICLE_TOKEN";
assert linux.smind.hm.dev.llm.yolo.validatedSessionVariables.CHRONICLE_TOKEN == "/run/secrets/chronicle-agent";
assert linux.systemd.user.services.chronicle-collector.Service.UMask == "0077";
assert darwin.systemd.user.services == { };
assert disabled.programs.mcp.servers == { };
assert disabled.home.packages == [ ];
assert lib.all (a: a.assertion) (ownAssertions enabledServer);
assert !(lib.all (a: a.assertion) (ownAssertions insecureServer));
assert !(disabledServer.systemd.services ? chronicle);
assert enabledServer.systemd.services.chronicle.serviceConfig.User == "chronicle";
assert enabledServer.systemd.services.chronicle.serviceConfig.TimeoutStopSec == 60;
assert builtins.elem "chronicle-database.service" enabledServer.systemd.services.chronicle.requires;
assert builtins.elem "postgresql-setup.service" enabledServer.systemd.services.chronicle-database.after;
assert builtins.elem "postgresql-setup.service" enabledServer.systemd.services.chronicle-database.requires;
assert !enabledServer.smind.services.chronicle.embedding.sendDimensions;
assert sendDimensions.smind.services.chronicle.embedding.sendDimensions;
assert enabledServer.services.postgresql.settings.random_page_cost == 1.1;
assert enabledServer.services.postgresql.settings.effective_io_concurrency == 200;
assert enabledServer.services.postgresql.settings.maintenance_io_concurrency == 100;
assert !(noSsd.services.postgresql.settings ? random_page_cost);
assert !(externalDatabase.services.postgresql.settings ? random_page_cost);
assert !(disabledServer.services.postgresql.settings ? random_page_cost);
assert customSsd.services.postgresql.settings.random_page_cost == 2.0;
assert customSsd.services.postgresql.settings.effective_io_concurrency == 64;
assert customSsd.services.postgresql.settings.maintenance_io_concurrency == 32;
assert !(enabledServer.services.postgresql.settings ? shared_buffers);
assert !(enabledServer.services.postgresql.settings ? fsync);
assert !(enabledServer.services.postgresql.settings ? synchronous_commit);
assert enabledServer.services.postgresql.enable;
assert enabledServer.services.postgresql.ensureDatabases == [ "chronicle" ];
assert !(builtins.elem 47330 enabledServer.networking.firewall.allowedTCPPorts);
assert enabledServer.services.nginx.virtualHosts."chronicle.example.net".locations."/".proxyWebsockets;
pkgs.runCommandLocal "chronicle-modules-test" { nativeBuildInputs = [ pkgs.jq ]; } ''
  test -n '${enabledServer.systemd.services.chronicle.serviceConfig.ExecStart}'
  jq -e '.embedding.sendDimensions == false' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.embedding.sendDimensions == true' ${lib.last (lib.splitString " " sendDimensions.systemd.services.chronicle.serviceConfig.ExecStart)}
  touch "$out"
''
